use crate::db::Database;
use crate::error::{CoreError, Result};
use crate::models::{now_rfc3339, Schedule};
use crate::validation;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

/// A due schedule older than this is recorded as missed instead of executed.
/// This prevents an app that was closed overnight from replaying every slot.
pub const DEFAULT_GRACE_SECONDS: i64 = 300;
pub const MAX_MISSED_OCCURRENCES: i64 = 1_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerTick {
    pub checked: usize,
    pub queued: usize,
    pub missed: usize,
    pub skipped: usize,
}

/// Polls the schedules table and enqueues due runs. Missed occurrences are
/// recorded, never silently executed; the next future slot is always used.
#[derive(Clone)]
pub struct Scheduler {
    db: Database,
    wake: Arc<Notify>,
    grace: ChronoDuration,
    shutdown: CancellationToken,
}

impl Scheduler {
    pub fn new(db: Database, wake: Arc<Notify>) -> Self {
        Self {
            db,
            wake,
            grace: ChronoDuration::seconds(DEFAULT_GRACE_SECONDS),
            shutdown: CancellationToken::new(),
        }
    }

    pub fn with_grace(mut self, grace: ChronoDuration) -> Self {
        self.grace = grace.max(ChronoDuration::zero());
        self
    }

    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }

    pub fn tick(&self) -> Result<SchedulerTick> {
        let mut tick = SchedulerTick::default();
        let settings = self.db.get_settings()?;
        if !settings.scheduler_enabled {
            return Ok(tick);
        }
        let now = Utc::now();
        let now_text = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let due = self.db.due_schedules(&now_text)?;
        for schedule in due {
            tick.checked += 1;
            if let Err(error) = self.process_schedule(&schedule, now, &mut tick) {
                let _ = self.db.insert_log(
                    "error",
                    "scheduler",
                    None,
                    &format!(
                        "Unable to process schedule for workflow {}: {error}",
                        schedule.workflow_id
                    ),
                    Some(&json!({"scheduleId": schedule.id})),
                );
                tick.skipped += 1;
            }
        }
        Ok(tick)
    }

    fn process_schedule(
        &self,
        schedule: &Schedule,
        now: DateTime<Utc>,
        tick: &mut SchedulerTick,
    ) -> Result<()> {
        let workflow = match self.db.get_workflow(&schedule.workflow_id) {
            Ok(workflow) => workflow,
            Err(CoreError::NotFound(_)) => {
                tick.skipped += 1;
                return Ok(());
            }
            Err(error) => return Err(error),
        };

        let scheduled_at = schedule
            .next_run_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or(now);

        if !workflow.enabled {
            tick.skipped += 1;
            let next = next_after(&schedule.cron, &schedule.timezone, now)?;
            self.db
                .update_schedule_next(&schedule.id, next.as_deref(), false)?;
            return Ok(());
        }

        let lateness = now.signed_duration_since(scheduled_at);
        if lateness > self.grace {
            let missed_occurrences =
                count_missed(&schedule.cron, &schedule.timezone, scheduled_at, now)?;
            let detail = format!(
                "Missed {missed_occurrences} scheduled occurrence(s) while BITS AI Video Creator was not running; the oldest was due at {scheduled_at}"
            );
            self.db
                .create_missed_run(&workflow.id, "schedule", &detail)?;
            for _ in 0..missed_occurrences {
                self.db.increment_schedule_missed(&schedule.id)?;
            }
            tick.missed += 1;
            let next = next_after(&schedule.cron, &schedule.timezone, now)?;
            self.db
                .update_schedule_next(&schedule.id, next.as_deref(), false)?;
            self.db.insert_log(
                "warn",
                "scheduler",
                None,
                &format!("Recorded missed schedule for '{}'", workflow.name),
                Some(&json!({
                    "workflowId": workflow.id,
                    "scheduleId": schedule.id,
                    "missedOccurrences": missed_occurrences,
                    "scheduledAt": scheduled_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                })),
            )?;
            return Ok(());
        }

        let idempotency_key = format!(
            "schedule:{}:{}",
            schedule.id,
            scheduled_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        );
        let input = json!({
            "scheduleId": schedule.id,
            "scheduledAt": scheduled_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        });
        match self
            .db
            .create_run(&workflow.id, "schedule", &input, Some(&idempotency_key))
        {
            Ok(run) => {
                tick.queued += 1;
                self.wake.notify_one();
                self.db.insert_log(
                    "info",
                    "scheduler",
                    Some(&run.id),
                    &format!("Queued scheduled run for '{}'", workflow.name),
                    Some(&json!({"scheduleId": schedule.id})),
                )?;
            }
            Err(CoreError::Conflict(_)) => {
                // A run for this exact slot already exists (for example after a
                // restart); do not double-execute it.
                tick.skipped += 1;
            }
            Err(error) => return Err(error),
        }

        let next = next_after(&schedule.cron, &schedule.timezone, now)?;
        self.db
            .update_schedule_next(&schedule.id, next.as_deref(), true)?;
        Ok(())
    }

    pub fn run_once(&self) -> Result<SchedulerTick> {
        self.tick()
    }

    pub fn spawn(&self, interval: Duration) -> tokio::task::JoinHandle<()> {
        let scheduler = self.clone();
        tokio::spawn(async move {
            scheduler.run_loop(interval).await;
        })
    }

    pub async fn run_loop(&self, interval: Duration) {
        loop {
            if self.shutdown.is_cancelled() {
                break;
            }
            match self.tick() {
                Ok(tick) if tick.checked > 0 => {
                    let _ = self.db.insert_log(
                        "debug",
                        "scheduler",
                        None,
                        &format!(
                            "Scheduler tick: {} checked, {} queued, {} missed, {} skipped",
                            tick.checked, tick.queued, tick.missed, tick.skipped
                        ),
                        None,
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    let _ = self.db.insert_log(
                        "error",
                        "scheduler",
                        None,
                        &format!("Scheduler tick failed: {error}"),
                        None,
                    );
                }
            }
            tokio::select! {
                _ = self.shutdown.cancelled() => break,
                _ = tokio::time::sleep(interval) => {}
            }
        }
    }
}

fn next_after(cron: &str, timezone: &str, after: DateTime<Utc>) -> Result<Option<String>> {
    match validation::next_cron_occurrence(cron, timezone, after) {
        Ok(next) => Ok(Some(next)),
        Err(error) if error.to_string().contains("no future occurrence") => Ok(None),
        Err(error) => Err(error),
    }
}

fn count_missed(
    cron: &str,
    timezone: &str,
    first_due: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<i64> {
    let mut count = 0i64;
    let mut cursor = first_due;
    while cursor <= now && count < MAX_MISSED_OCCURRENCES {
        count += 1;
        match validation::next_cron_occurrence(cron, timezone, cursor) {
            Ok(next) => {
                let parsed = DateTime::parse_from_rfc3339(&next)
                    .map_err(|_| CoreError::internal("Invalid cron occurrence"))?
                    .with_timezone(&Utc);
                if parsed <= cursor {
                    break;
                }
                cursor = parsed;
            }
            Err(_) => break,
        }
    }
    Ok(count.max(1))
}

pub fn format_now() -> String {
    now_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        AccountFilter, RunStatus, ScheduleInput, WorkflowDefinition, WorkflowEdge, WorkflowInput,
        WorkflowNode,
    };

    fn scheduler_workflow(trigger_cron: &str) -> WorkflowInput {
        WorkflowInput {
            name: format!("Scheduled {}", uuid::Uuid::new_v4()),
            description: String::new(),
            tags: vec![],
            enabled: true,
            definition: WorkflowDefinition {
                schema_version: 1,
                nodes: vec![
                    WorkflowNode {
                        id: "start".into(),
                        node_type: "trigger.schedule".into(),
                        name: "Schedule".into(),
                        config: json!({"cron": trigger_cron, "timezone": "UTC"}),
                        position: None,
                    },
                    WorkflowNode {
                        id: "log".into(),
                        node_type: "action.log".into(),
                        name: "Log".into(),
                        config: json!({"message": "scheduled"}),
                        position: None,
                    },
                ],
                edges: vec![WorkflowEdge {
                    id: "e1".into(),
                    from: "start".into(),
                    to: "log".into(),
                    branch: None,
                }],
            },
            schedule: Some(ScheduleInput {
                cron: trigger_cron.into(),
                timezone: "UTC".into(),
                enabled: true,
            }),
        }
    }

    fn setup(cron: &str) -> (Database, Scheduler, Arc<Notify>, String) {
        let db = Database::open_in_memory().unwrap();
        let workflow = db.create_workflow(&scheduler_workflow(cron)).unwrap();
        let wake = Arc::new(Notify::new());
        let scheduler = Scheduler::new(db.clone(), wake.clone());
        (db, scheduler, wake, workflow.id)
    }

    fn set_due(db: &Database, workflow_id: &str, due: DateTime<Utc>) {
        let schedule = db.get_schedule(workflow_id).unwrap().unwrap();
        db.update_schedule_next(&schedule.id, Some(&due.to_rfc3339()), false)
            .unwrap();
    }

    #[test]
    fn queues_a_due_schedule_and_advances_it() {
        let (db, scheduler, _wake, workflow_id) = setup("*/5 * * * * *");
        set_due(&db, &workflow_id, Utc::now() - ChronoDuration::seconds(2));
        let tick = scheduler.tick().unwrap();
        assert_eq!(tick.queued, 1);
        assert_eq!(tick.missed, 0);
        let runs = db.list_runs(&Default::default()).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].trigger, "schedule");
        assert_eq!(runs[0].status, "queued");
        let schedule = db.get_schedule(&workflow_id).unwrap().unwrap();
        assert!(schedule.next_run_at.as_deref().unwrap() > now_rfc3339().as_str());
        assert!(schedule.last_run_at.is_some());
        assert!(db.due_schedules(&now_rfc3339()).unwrap().is_empty());
    }

    #[test]
    fn old_due_schedules_are_recorded_as_missed_not_executed() {
        let (db, scheduler, _wake, workflow_id) = setup("*/5 * * * * *");
        set_due(&db, &workflow_id, Utc::now() - ChronoDuration::hours(1));
        let tick = scheduler.tick().unwrap();
        assert_eq!(tick.missed, 1);
        assert_eq!(tick.queued, 0);
        let runs = db.list_runs(&Default::default()).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "missed");
        let schedule = db.get_schedule(&workflow_id).unwrap().unwrap();
        assert!(schedule.missed_count > 0);
        assert!(schedule.next_run_at.as_deref().unwrap() > now_rfc3339().as_str());
    }

    #[test]
    fn disabled_workflows_advance_without_running() {
        let (db, scheduler, _wake, workflow_id) = setup("*/5 * * * * *");
        db.set_workflow_enabled(&workflow_id, false).unwrap();
        set_due(&db, &workflow_id, Utc::now() - ChronoDuration::seconds(1));
        let tick = scheduler.tick().unwrap();
        assert_eq!(tick.skipped, 1);
        assert_eq!(db.list_runs(&Default::default()).unwrap().len(), 0);
        let schedule = db.get_schedule(&workflow_id).unwrap().unwrap();
        assert!(schedule.next_run_at.as_deref().unwrap() > now_rfc3339().as_str());
    }

    #[test]
    fn scheduler_disabled_in_settings_does_nothing() {
        let (db, scheduler, _wake, workflow_id) = setup("*/5 * * * * *");
        set_due(&db, &workflow_id, Utc::now() - ChronoDuration::seconds(1));
        let mut settings = db.get_settings().unwrap();
        settings.scheduler_enabled = false;
        db.update_settings(&settings).unwrap();
        let tick = scheduler.tick().unwrap();
        assert_eq!(tick.checked, 0);
        assert_eq!(db.list_runs(&Default::default()).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_slot_is_not_enqueued_twice() {
        let (db, scheduler, _wake, workflow_id) = setup("*/5 * * * * *");
        let due = Utc::now() - ChronoDuration::seconds(1);
        set_due(&db, &workflow_id, due);
        scheduler.tick().unwrap();
        // Force the same slot back into the table; the idempotency key must
        // reject a second queued run for it.
        let schedule = db.get_schedule(&workflow_id).unwrap().unwrap();
        db.update_schedule_next(&schedule.id, Some(&due.to_rfc3339()), false)
            .unwrap();
        let _ = scheduler.tick().unwrap();
        let runs = db.list_runs(&Default::default()).unwrap();
        assert!(runs.len() <= 2);
        assert_eq!(runs.iter().filter(|run| run.status == "queued").count(), 1);
        let _ = AccountFilter::default();
        let _ = RunStatus::Queued;
    }
}
