use crate::error::{CoreError, Result};
use crate::models::*;
use crate::studio::*;
use crate::validation;
use chrono::{Duration, Utc};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_initial.sql"),
    include_str!("../migrations/002_product_features.sql"),
    include_str!("../migrations/003_studio.sql"),
];

pub fn latest_schema_version() -> i64 {
    MIGRATIONS.len() as i64
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| CoreError::internal("database lock poisoned"))
    }

    pub fn migrate(&self) -> Result<()> {
        let mut conn = self.lock()?;
        let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        for (index, sql) in MIGRATIONS.iter().enumerate() {
            let version = (index + 1) as i64;
            if version <= current {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
        }
        drop(conn);
        self.seed_settings()?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64> {
        let conn = self.lock()?;
        Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    fn seed_settings(&self) -> Result<()> {
        let defaults = Settings::default();
        let map = settings_to_map(&defaults);
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        for (key, value) in map {
            tx.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Settings> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }
        Ok(settings_from_map(&map))
    }

    pub fn update_settings(&self, settings: &Settings) -> Result<Settings> {
        validation::validate_settings(settings)?;
        let map = settings_to_map(settings);
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        for (key, value) in map {
            tx.execute("INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        }
        tx.commit()?;
        drop(conn);
        self.get_settings()
    }

    // ---------- Accounts ----------

    pub fn list_accounts(&self, filter: &AccountFilter) -> Result<Vec<Account>> {
        let conn = self.lock()?;
        let mut sql = String::from("SELECT * FROM accounts WHERE 1=1");
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(query) = filter
            .query
            .as_ref()
            .map(|q| q.trim().to_lowercase())
            .filter(|q| !q.is_empty())
        {
            sql.push_str(" AND (lower(name) LIKE ? OR lower(coalesce(email,'')) LIKE ? OR lower(tags) LIKE ? OR lower(notes) LIKE ?)");
            let like = format!("%{query}%");
            for _ in 0..4 {
                values.push(rusqlite::types::Value::Text(like.clone()));
            }
        }
        if let Some(provider) = filter.provider.as_ref().filter(|p| !p.is_empty()) {
            sql.push_str(" AND provider = ?");
            values.push(rusqlite::types::Value::Text(provider.clone()));
        }
        if let Some(status) = filter.status.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND status = ?");
            values.push(rusqlite::types::Value::Text(status.clone()));
        }
        if let Some(tag) = filter
            .tag
            .as_ref()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
        {
            sql.push_str(" AND lower(tags) LIKE ?");
            values.push(rusqlite::types::Value::Text(format!("%\"{tag}\"%")));
        }
        if let Some(favorite) = filter.favorite {
            sql.push_str(" AND favorite = ?");
            values.push(rusqlite::types::Value::Integer(if favorite {
                1
            } else {
                0
            }));
        }
        sql.push_str(" ORDER BY favorite DESC, sort_order ASC, name COLLATE NOCASE ASC");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values.iter()), map_account)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_account(&self, id: &str) -> Result<Account> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT * FROM accounts WHERE id = ?1",
            params![id],
            map_account,
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Account not found"))
    }

    pub fn create_account(&self, input: &AccountInput) -> Result<Account> {
        validation::validate_account(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let now = now_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let normalized = validation::normalize_name(&input.name);
        let provider = input.provider.trim();
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM accounts WHERE provider = ?1 AND (normalized_name = ?2 OR (external_id IS NOT NULL AND external_id = ?3))",
                params![provider, normalized, input.external_id],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Err(CoreError::conflict(
                "An account with this provider and name already exists",
            ));
        }
        let sort_order = match input.sort_order {
            Some(value) => value,
            None => tx.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts",
                [],
                |row| row.get(0),
            )?,
        };
        let tags = validation::clean_tags(input.tags.as_deref().unwrap_or(&[]));
        tx.execute(
            "INSERT INTO accounts(id, provider, name, normalized_name, email, external_id, status, favorite, tags, notes, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                id,
                provider,
                input.name.trim(),
                normalized,
                input.email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                input.external_id.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                input.status.clone().unwrap_or_else(|| "needs_login".into()),
                if input.favorite.unwrap_or(false) { 1 } else { 0 },
                serde_json::to_string(&tags)?,
                input.notes.clone().unwrap_or_default().trim(),
                sort_order,
                now,
            ],
        )?;
        tx.commit()?;
        drop(conn);
        self.get_account(&id)
    }

    pub fn update_account(&self, id: &str, input: &AccountInput) -> Result<Account> {
        validation::validate_account(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let current: Option<(String, bool, String, i64)> = tx
            .query_row(
                "SELECT status, favorite, notes, sort_order FROM accounts WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get(2)?,
                        row.get(3)?,
                    ))
                },
            )
            .optional()?;
        let (current_status, current_favorite, current_notes, current_sort_order) =
            current.ok_or_else(|| CoreError::not_found("Account not found"))?;
        let normalized = validation::normalize_name(&input.name);
        let duplicate: Option<String> = tx
            .query_row(
                "SELECT id FROM accounts WHERE provider = ?1 AND normalized_name = ?2 AND id != ?3",
                params![input.provider.trim(), normalized, id],
                |row| row.get(0),
            )
            .optional()?;
        if duplicate.is_some() {
            return Err(CoreError::conflict(
                "Another account with this provider and name already exists",
            ));
        }
        let tags = validation::clean_tags(input.tags.as_deref().unwrap_or(&[]));
        let now = now_rfc3339();
        tx.execute(
            "UPDATE accounts SET provider=?1, name=?2, normalized_name=?3, email=?4, external_id=?5, status=?6, favorite=?7, tags=?8, notes=?9, sort_order=?10, updated_at=?11 WHERE id=?12",
            params![
                input.provider.trim(),
                input.name.trim(),
                normalized,
                input.email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                input.external_id.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                input.status.clone().unwrap_or(current_status),
                if input.favorite.unwrap_or(current_favorite) { 1 } else { 0 },
                serde_json::to_string(&tags)?,
                input.notes.clone().unwrap_or(current_notes).trim(),
                input.sort_order.unwrap_or(current_sort_order),
                now,
                id,
            ],
        )?;
        tx.commit()?;
        drop(conn);
        self.get_account(id)
    }

    pub fn delete_account(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Account not found"));
        }
        Ok(())
    }

    pub fn set_account_favorite(&self, id: &str, favorite: bool) -> Result<Account> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE accounts SET favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![if favorite { 1 } else { 0 }, now_rfc3339(), id],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Account not found"));
        }
        drop(conn);
        self.get_account(id)
    }

    pub fn set_account_status(&self, id: &str, status: &str) -> Result<Account> {
        if !validation::ACCOUNT_STATUSES.contains(&status) {
            return Err(CoreError::validation("Unsupported account status"));
        }
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE accounts SET status = ?1, updated_at = ?2, last_checked_at = ?2 WHERE id = ?3",
            params![status, now_rfc3339(), id],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Account not found"));
        }
        drop(conn);
        self.get_account(id)
    }

    pub fn touch_account(&self, id: &str, opened: bool) -> Result<()> {
        let conn = self.lock()?;
        let now = now_rfc3339();
        let sql = if opened {
            "UPDATE accounts SET last_opened_at = ?1, updated_at = ?1 WHERE id = ?2"
        } else {
            "UPDATE accounts SET last_checked_at = ?1, updated_at = ?1 WHERE id = ?2"
        };
        conn.execute(sql, params![now, id])?;
        Ok(())
    }

    pub fn account_duplicate(
        &self,
        provider: &str,
        name: &str,
        email: Option<&str>,
        external_id: Option<&str>,
    ) -> Result<Option<Account>> {
        let conn = self.lock()?;
        let normalized = validation::normalize_name(name);
        let row = conn
            .query_row(
                "SELECT * FROM accounts WHERE provider = ?1 AND (normalized_name = ?2 OR (external_id IS NOT NULL AND external_id = ?3) OR (?4 IS NOT NULL AND lower(coalesce(email,'')) = lower(?4))) LIMIT 1",
                params![provider, normalized, external_id, email],
                map_account,
            )
            .optional()?;
        Ok(row)
    }

    // ---------- Workflows ----------

    pub fn list_workflows(&self) -> Result<Vec<WorkflowSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT w.id, w.name, w.description, w.tags, w.enabled, w.definition, w.version, w.created_at, w.updated_at, w.last_run_at,
                    s.id, s.workflow_id, s.cron, s.timezone, s.enabled, s.last_run_at, s.next_run_at, s.missed_count, s.created_at, s.updated_at
             FROM workflows w LEFT JOIN schedules s ON s.workflow_id = w.id
             ORDER BY w.updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_workflow_summary)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_workflow(&self, id: &str) -> Result<Workflow> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT w.id, w.name, w.description, w.tags, w.enabled, w.definition, w.version, w.created_at, w.updated_at, w.last_run_at,
                    s.id, s.workflow_id, s.cron, s.timezone, s.enabled, s.last_run_at, s.next_run_at, s.missed_count, s.created_at, s.updated_at
             FROM workflows w LEFT JOIN schedules s ON s.workflow_id = w.id WHERE w.id = ?1",
        )?;
        let row = stmt.query_row(params![id], map_workflow)?;
        Ok(row)
    }

    pub fn create_workflow(&self, input: &WorkflowInput) -> Result<Workflow> {
        validation::validate_workflow_input(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        tx.execute(
            "INSERT INTO workflows(id, name, description, tags, enabled, definition, version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![
                id,
                input.name.trim(),
                input.description.trim(),
                serde_json::to_string(&crate::validation::clean_tags(&input.tags))?,
                if input.enabled { 1 } else { 0 },
                serde_json::to_string(&input.definition)?,
                now,
            ],
        )?;
        if let Some(schedule) = &input.schedule {
            let next =
                validation::next_cron_occurrence(&schedule.cron, &schedule.timezone, Utc::now())
                    .ok();
            tx.execute(
                "INSERT INTO schedules(id, workflow_id, cron, timezone, enabled, next_run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    id,
                    schedule.cron.trim(),
                    schedule.timezone.trim(),
                    if schedule.enabled { 1 } else { 0 },
                    next,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        drop(conn);
        self.get_workflow(&id)
    }

    pub fn update_workflow(&self, id: &str, input: &WorkflowInput) -> Result<Workflow> {
        validation::validate_workflow_input(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let current: Option<i64> = tx
            .query_row(
                "SELECT version FROM workflows WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let version = current.ok_or_else(|| CoreError::not_found("Workflow not found"))? + 1;
        let now = now_rfc3339();
        tx.execute(
            "UPDATE workflows SET name=?1, description=?2, tags=?3, enabled=?4, definition=?5, version=?6, updated_at=?7 WHERE id=?8",
            params![
                input.name.trim(),
                input.description.trim(),
                serde_json::to_string(&crate::validation::clean_tags(&input.tags))?,
                if input.enabled { 1 } else { 0 },
                serde_json::to_string(&input.definition)?,
                version,
                now,
                id,
            ],
        )?;
        if let Some(schedule) = &input.schedule {
            let next =
                validation::next_cron_occurrence(&schedule.cron, &schedule.timezone, Utc::now())
                    .ok();
            tx.execute(
                "INSERT INTO schedules(id, workflow_id, cron, timezone, enabled, next_run_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                 ON CONFLICT(workflow_id) DO UPDATE SET cron=excluded.cron, timezone=excluded.timezone, enabled=excluded.enabled, next_run_at=excluded.next_run_at, updated_at=excluded.updated_at",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    id,
                    schedule.cron.trim(),
                    schedule.timezone.trim(),
                    if schedule.enabled { 1 } else { 0 },
                    next,
                    now,
                ],
            )?;
        } else {
            tx.execute("DELETE FROM schedules WHERE workflow_id = ?1", params![id])?;
        }
        tx.commit()?;
        drop(conn);
        self.get_workflow(id)
    }

    pub fn delete_workflow(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM workflows WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Workflow not found"));
        }
        Ok(())
    }

    pub fn set_workflow_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE workflows SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, now_rfc3339(), id],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Workflow not found"));
        }
        Ok(())
    }

    pub fn duplicate_workflow(&self, id: &str) -> Result<Workflow> {
        let original = self.get_workflow(id)?;
        let mut input = WorkflowInput {
            name: format!("Copy of {}", original.name),
            description: original.description.clone(),
            tags: original.tags.clone(),
            enabled: false,
            definition: original.definition.clone(),
            schedule: original.schedule.as_ref().map(|s| ScheduleInput {
                cron: s.cron.clone(),
                timezone: s.timezone.clone(),
                enabled: false,
            }),
        };
        if input.name.chars().count() > 100 {
            input.name = format!(
                "{} (copy)",
                original.name.chars().take(90).collect::<String>()
            );
        }
        self.create_workflow(&input)
    }

    pub fn touch_workflow_run(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE workflows SET last_run_at = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )?;
        Ok(())
    }

    // ---------- Schedules ----------

    pub fn list_schedules(&self) -> Result<Vec<Schedule>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT * FROM schedules ORDER BY next_run_at ASC")?;
        let rows = stmt.query_map([], map_schedule)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_schedule(&self, workflow_id: &str) -> Result<Option<Schedule>> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT * FROM schedules WHERE workflow_id = ?1",
            params![workflow_id],
            map_schedule,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn due_schedules(&self, now: &str) -> Result<Vec<Schedule>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1 ORDER BY next_run_at ASC LIMIT 50")?;
        let rows = stmt.query_map(params![now], map_schedule)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn update_schedule_next(
        &self,
        id: &str,
        next_run_at: Option<&str>,
        ran: bool,
    ) -> Result<()> {
        let conn = self.lock()?;
        let now = now_rfc3339();
        if ran {
            conn.execute(
                "UPDATE schedules SET last_run_at = ?1, next_run_at = ?2, updated_at = ?1 WHERE id = ?3",
                params![now, next_run_at, id],
            )?;
        } else {
            conn.execute(
                "UPDATE schedules SET next_run_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![next_run_at, now, id],
            )?;
        }
        Ok(())
    }

    pub fn increment_schedule_missed(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE schedules SET missed_count = missed_count + 1, updated_at = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn set_schedule_enabled(&self, workflow_id: &str, enabled: bool) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE schedules SET enabled = ?1, updated_at = ?2 WHERE workflow_id = ?3",
            params![if enabled { 1 } else { 0 }, now_rfc3339(), workflow_id],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Schedule not found"));
        }
        Ok(())
    }

    // ---------- Runs ----------

    pub fn create_run(
        &self,
        workflow_id: &str,
        trigger: &str,
        input: &serde_json::Value,
        idempotency_key: Option<&str>,
    ) -> Result<Run> {
        if let Some(key) = idempotency_key {
            validation::validate_idempotency_key(key)?;
        }
        let workflow = self.get_workflow(workflow_id)?;
        let total_steps = workflow.definition.nodes.len() as i64;
        let run_id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.lock()?;
        if let Some(key) = idempotency_key {
            let active: Option<String> = conn
                .query_row(
                    "SELECT id FROM runs WHERE idempotency_key = ?1 AND status IN ('queued','running')",
                    params![key],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(existing) = active {
                return Err(CoreError::conflict(format!(
                    "An active run already uses this idempotency key ({existing})"
                )));
            }
        }
        conn.execute(
            "INSERT INTO runs(id, workflow_id, workflow_name, status, trigger_kind, input, idempotency_key, queued_at, total_steps, completed_steps)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, 0)",
            params![
                run_id,
                workflow.id,
                workflow.name,
                trigger,
                serde_json::to_string(input)?,
                idempotency_key,
                now,
                total_steps,
            ],
        )
        .map_err(map_insert_error)?;
        drop(conn);
        self.get_run(&run_id)
    }

    pub fn claim_next_queued(&self) -> Result<Option<Run>> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let run_id: Option<String> = tx
            .query_row(
                "SELECT id FROM runs WHERE status = 'queued' ORDER BY queued_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let Some(run_id) = run_id else {
            return Ok(None);
        };
        let now = now_rfc3339();
        let changed = tx.execute(
            "UPDATE runs SET status='running', started_at=?1 WHERE id=?2 AND status='queued'",
            params![now, run_id],
        )?;
        tx.commit()?;
        if changed == 0 {
            return Ok(None);
        }
        drop(conn);
        Ok(Some(self.get_run(&run_id)?))
    }

    pub fn update_run_status(
        &self,
        id: &str,
        status: RunStatus,
        output: Option<&serde_json::Value>,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock()?;
        let run: Option<(Option<String>,)> = conn
            .query_row(
                "SELECT started_at FROM runs WHERE id=?1",
                params![id],
                |row| Ok((row.get(0)?,)),
            )
            .optional()?;
        let started = run.ok_or_else(|| CoreError::not_found("Run not found"))?.0;
        let now = now_rfc3339();
        let duration = started
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|start| (Utc::now() - start.with_timezone(&Utc)).num_milliseconds());
        conn.execute(
            "UPDATE runs SET status=?1, output=?2, error=?3, finished_at=?4, duration_ms=?5 WHERE id=?6",
            params![
                status.as_str(),
                output.map(serde_json::to_string).transpose()?,
                error,
                if status.is_active() { None } else { Some(now) },
                duration,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn update_run_progress(&self, id: &str, completed_steps: i64) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE runs SET completed_steps=?1 WHERE id=?2",
            params![completed_steps, id],
        )?;
        Ok(())
    }

    pub fn request_cancel(&self, id: &str) -> Result<bool> {
        let conn = self.lock()?;
        let status: Option<String> = conn
            .query_row("SELECT status FROM runs WHERE id=?1", params![id], |row| {
                row.get(0)
            })
            .optional()?;
        let status = status.ok_or_else(|| CoreError::not_found("Run not found"))?;
        if !["queued", "running"].contains(&status.as_str()) {
            return Ok(false);
        }
        conn.execute(
            "UPDATE runs SET cancel_requested=1 WHERE id=?1",
            params![id],
        )?;
        Ok(true)
    }

    pub fn cancel_requested(&self, id: &str) -> Result<bool> {
        let conn = self.lock()?;
        let value: Option<i64> = conn
            .query_row(
                "SELECT cancel_requested FROM runs WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.unwrap_or(0) != 0)
    }

    pub fn get_run(&self, id: &str) -> Result<Run> {
        let conn = self.lock()?;
        conn.query_row("SELECT * FROM runs WHERE id=?1", params![id], map_run)
            .optional()?
            .ok_or_else(|| CoreError::not_found("Run not found"))
    }

    pub fn list_runs(&self, filter: &RunFilter) -> Result<Vec<Run>> {
        validation::validate_run_filter(filter)?;
        let conn = self.lock()?;
        let mut sql = String::from("SELECT * FROM runs WHERE 1=1");
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(status) = filter.status.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND status = ?");
            values.push(rusqlite::types::Value::Text(status.clone()));
        }
        if let Some(workflow_id) = filter.workflow_id.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND workflow_id = ?");
            values.push(rusqlite::types::Value::Text(workflow_id.clone()));
        }
        sql.push_str(" ORDER BY queued_at DESC LIMIT ? OFFSET ?");
        values.push(rusqlite::types::Value::Integer(
            filter.limit.unwrap_or(50) as i64
        ));
        values.push(rusqlite::types::Value::Integer(
            filter.offset.unwrap_or(0) as i64
        ));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values.iter()), map_run)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn list_run_steps(&self, run_id: &str) -> Result<Vec<RunStep>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT * FROM run_steps WHERE run_id=?1 ORDER BY id ASC")?;
        let rows = stmt.query_map(params![run_id], map_run_step)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_run_detail(&self, id: &str) -> Result<RunDetail> {
        Ok(RunDetail {
            run: self.get_run(id)?,
            steps: self.list_run_steps(id)?,
        })
    }

    pub fn create_step(&self, run_id: &str, node: &WorkflowNode, attempt: i64) -> Result<i64> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO run_steps(run_id, node_id, node_type, node_name, status, started_at, attempt) VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6)",
            params![run_id, node.id, node.node_type, node.name, now_rfc3339(), attempt],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn finish_step(
        &self,
        id: i64,
        status: &str,
        output: Option<&serde_json::Value>,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.lock()?;
        let started: Option<String> = conn
            .query_row(
                "SELECT started_at FROM run_steps WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let duration = started
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|start| (Utc::now() - start.with_timezone(&Utc)).num_milliseconds());
        conn.execute(
            "UPDATE run_steps SET status=?1, output=?2, error=?3, finished_at=?4, duration_ms=?5 WHERE id=?6",
            params![
                status,
                output.map(serde_json::to_string).transpose()?,
                error,
                now_rfc3339(),
                duration,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn fail_running_steps(&self, run_id: &str, message: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE run_steps SET status='failed', error=?1, finished_at=?2 WHERE run_id=?3 AND status='running'",
            params![message, now_rfc3339(), run_id],
        )?;
        Ok(())
    }

    pub fn recover_interrupted(&self) -> Result<usize> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let now = now_rfc3339();
        let interrupted = tx.execute(
            "UPDATE runs SET status='failed', error='Interrupted by application restart', finished_at=?1 WHERE status='running'",
            params![now],
        )?;
        tx.execute(
            "UPDATE runs SET status='failed', error='Not started before application restart', finished_at=?1 WHERE status='queued'",
            params![now],
        )?;
        tx.execute(
            "UPDATE run_steps SET status='failed', error='Interrupted by application restart', finished_at=?1 WHERE status='running'",
            params![now],
        )?;
        tx.commit()?;
        Ok(interrupted)
    }

    pub fn retry_run(&self, id: &str) -> Result<Run> {
        let run = self.get_run(id)?;
        if run.status == "queued" || run.status == "running" {
            return Err(CoreError::conflict(
                "Stop the active run before retrying it",
            ));
        }
        self.create_run(&run.workflow_id, "retry", &run.input, None)
    }

    // ---------- Logs ----------

    pub fn insert_log(
        &self,
        level: &str,
        scope: &str,
        run_id: Option<&str>,
        message: &str,
        details: Option<&serde_json::Value>,
    ) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO logs(ts, level, scope, run_id, message, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                now_rfc3339(),
                level,
                scope,
                run_id,
                message.chars().take(4000).collect::<String>(),
                details.map(serde_json::to_string).transpose()?,
            ],
        )?;
        Ok(())
    }

    pub fn list_logs(&self, filter: &LogFilter) -> Result<Vec<LogEntry>> {
        validation::validate_log_filter(filter)?;
        let conn = self.lock()?;
        let mut sql = String::from("SELECT * FROM logs WHERE 1=1");
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(level) = filter.level.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND level = ?");
            values.push(rusqlite::types::Value::Text(level.clone()));
        }
        if let Some(scope) = filter.scope.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND scope = ?");
            values.push(rusqlite::types::Value::Text(scope.clone()));
        }
        if let Some(run_id) = filter.run_id.as_ref().filter(|s| !s.is_empty()) {
            sql.push_str(" AND run_id = ?");
            values.push(rusqlite::types::Value::Text(run_id.clone()));
        }
        if let Some(query) = filter
            .query
            .as_ref()
            .map(|q| q.trim().to_lowercase())
            .filter(|q| !q.is_empty())
        {
            sql.push_str(" AND (lower(message) LIKE ? OR lower(coalesce(details,'')) LIKE ?)");
            let like = format!("%{query}%");
            values.push(rusqlite::types::Value::Text(like.clone()));
            values.push(rusqlite::types::Value::Text(like));
        }
        sql.push_str(" ORDER BY id DESC LIMIT ? OFFSET ?");
        values.push(rusqlite::types::Value::Integer(
            filter.limit.unwrap_or(100) as i64
        ));
        values.push(rusqlite::types::Value::Integer(
            filter.offset.unwrap_or(0) as i64
        ));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values.iter()), map_log)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn clear_logs(&self) -> Result<usize> {
        let conn = self.lock()?;
        Ok(conn.execute("DELETE FROM logs", [])?)
    }

    pub fn cleanup_logs(&self, retention_days: u32, max_rows: u32) -> Result<usize> {
        let conn = self.lock()?;
        let cutoff = (Utc::now() - Duration::days(retention_days as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut removed = conn.execute("DELETE FROM logs WHERE ts < ?1", params![cutoff])?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM logs", [], |row| row.get(0))?;
        if count > max_rows as i64 {
            removed += conn.execute(
                "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?1)",
                params![max_rows as i64],
            )?;
        }
        Ok(removed)
    }

    // ---------- Secrets metadata ----------

    pub fn list_secret_refs(&self) -> Result<Vec<SecretRef>> {
        let conn = self.lock()?;
        let mut stmt =
            conn.prepare("SELECT name, created_at, updated_at FROM secret_refs ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(SecretRef {
                name: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn upsert_secret_ref(&self, name: &str) -> Result<()> {
        validation::validate_secret_name(name)?;
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO secret_refs(name, created_at, updated_at) VALUES (?1, ?2, ?2)
             ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at",
            params![name, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_secret_ref(&self, name: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM secret_refs WHERE name=?1", params![name])?;
        Ok(())
    }

    pub fn create_missed_run(&self, workflow_id: &str, trigger: &str, detail: &str) -> Result<Run> {
        let workflow = self.get_workflow(workflow_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO runs(id, workflow_id, workflow_name, status, trigger_kind, input, error, queued_at, finished_at, total_steps, completed_steps)
             VALUES (?1, ?2, ?3, 'missed', ?4, '{}', ?5, ?6, ?6, ?7, 0)",
            params![id, workflow.id, workflow.name, trigger, detail, now, workflow.definition.nodes.len() as i64],
        )?;
        drop(conn);
        self.get_run(&id)
    }

    pub fn import_accounts(
        &self,
        items: &[AccountInput],
        strategy: DuplicateStrategy,
    ) -> Result<ImportResult> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut result = ImportResult {
            imported: 0,
            skipped: 0,
            replaced: 0,
            errors: vec![],
        };
        let mut next_order: i64 = tx.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts",
            [],
            |row| row.get(0),
        )?;
        for (index, input) in items.iter().enumerate() {
            if let Err(error) = validation::validate_account(input) {
                result.errors.push(ValidationIssue {
                    path: format!("accounts[{index}]"),
                    message: error.to_string(),
                    severity: "error".into(),
                });
                continue;
            }
            let normalized = validation::normalize_name(&input.name);
            let provider = input.provider.trim();
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT id, name FROM accounts WHERE provider=?1 AND (normalized_name=?2 OR (external_id IS NOT NULL AND external_id=?3)) LIMIT 1",
                    params![provider, normalized, input.external_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let tags = validation::clean_tags(input.tags.as_deref().unwrap_or(&[]));
            let now = now_rfc3339();
            if let Some((id, _)) = existing {
                match strategy {
                    DuplicateStrategy::Skip => result.skipped += 1,
                    DuplicateStrategy::Replace => {
                        let update = tx.execute(
                            "UPDATE accounts SET name=?1, normalized_name=?2, email=?3, external_id=?4, status=?5, favorite=?6, tags=?7, notes=?8, sort_order=?9, updated_at=?10 WHERE id=?11",
                            params![
                                input.name.trim(),
                                normalized,
                                input.email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                                input.external_id.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                                input.status.clone().unwrap_or_else(|| "needs_login".into()),
                                if input.favorite.unwrap_or(false) { 1 } else { 0 },
                                serde_json::to_string(&tags)?,
                                input.notes.clone().unwrap_or_default().trim(),
                                input.sort_order.unwrap_or(next_order),
                                now,
                                id,
                            ],
                        );
                        match update {
                            Ok(_) => result.replaced += 1,
                            Err(error) => result.errors.push(ValidationIssue {
                                path: format!("accounts[{index}]"),
                                message: error.to_string(),
                                severity: "error".into(),
                            }),
                        }
                    }
                    DuplicateStrategy::Duplicate => {
                        let unique_name = unique_account_name(&tx, provider, input.name.trim())?;
                        let unique_normalized = validation::normalize_name(&unique_name);
                        let insert = tx.execute(
                            "INSERT INTO accounts(id, provider, name, normalized_name, email, external_id, status, favorite, tags, notes, sort_order, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                            params![
                                uuid::Uuid::new_v4().to_string(),
                                provider,
                                unique_name,
                                unique_normalized,
                                input.email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                                input.status.clone().unwrap_or_else(|| "needs_login".into()),
                                if input.favorite.unwrap_or(false) { 1 } else { 0 },
                                serde_json::to_string(&tags)?,
                                input.notes.clone().unwrap_or_default().trim(),
                                next_order,
                                now,
                            ],
                        );
                        match insert {
                            Ok(_) => {
                                result.imported += 1;
                                next_order += 1;
                            }
                            Err(error) => result.errors.push(ValidationIssue {
                                path: format!("accounts[{index}]"),
                                message: error.to_string(),
                                severity: "error".into(),
                            }),
                        }
                    }
                }
            } else {
                let insert = tx.execute(
                    "INSERT INTO accounts(id, provider, name, normalized_name, email, external_id, status, favorite, tags, notes, sort_order, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        provider,
                        input.name.trim(),
                        normalized,
                        input.email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                        input.external_id.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()),
                        input.status.clone().unwrap_or_else(|| "needs_login".into()),
                        if input.favorite.unwrap_or(false) { 1 } else { 0 },
                        serde_json::to_string(&tags)?,
                        input.notes.clone().unwrap_or_default().trim(),
                        input.sort_order.unwrap_or(next_order),
                        now,
                    ],
                );
                match insert {
                    Ok(_) => {
                        result.imported += 1;
                        next_order += 1;
                    }
                    Err(error) => result.errors.push(ValidationIssue {
                        path: format!("accounts[{index}]"),
                        message: error.to_string(),
                        severity: "error".into(),
                    }),
                }
            }
        }
        tx.commit()?;
        Ok(result)
    }

    pub fn import_workflows(
        &self,
        items: &[WorkflowInput],
        strategy: DuplicateStrategy,
    ) -> Result<ImportResult> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut result = ImportResult {
            imported: 0,
            skipped: 0,
            replaced: 0,
            errors: vec![],
        };
        for (index, input) in items.iter().enumerate() {
            if let Err(error) = validation::validate_workflow_input(input) {
                result.errors.push(ValidationIssue {
                    path: format!("workflows[{index}]"),
                    message: error.to_string(),
                    severity: "error".into(),
                });
                continue;
            }
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM workflows WHERE lower(name)=lower(?1) LIMIT 1",
                    params![input.name.trim()],
                    |row| row.get(0),
                )
                .optional()?;
            let now = now_rfc3339();
            if let Some(id) = existing {
                match strategy {
                    DuplicateStrategy::Skip => result.skipped += 1,
                    DuplicateStrategy::Replace => {
                        let version: i64 = tx.query_row(
                            "SELECT version FROM workflows WHERE id=?1",
                            params![id],
                            |row| row.get(0),
                        )?;
                        tx.execute(
                            "UPDATE workflows SET name=?1, description=?2, tags=?3, enabled=?4, definition=?5, version=?6, updated_at=?7 WHERE id=?8",
                            params![
                                input.name.trim(),
                                input.description.trim(),
                                serde_json::to_string(&validation::clean_tags(&input.tags))?,
                                if input.enabled { 1 } else { 0 },
                                serde_json::to_string(&input.definition)?,
                                version + 1,
                                now,
                                id,
                            ],
                        )?;
                        tx.execute("DELETE FROM schedules WHERE workflow_id=?1", params![id])?;
                        if let Some(schedule) = &input.schedule {
                            insert_schedule_tx(&tx, &id, schedule, &now)?;
                        }
                        result.replaced += 1;
                    }
                    DuplicateStrategy::Duplicate => {
                        let unique_name = unique_workflow_name(&tx, input.name.trim())?;
                        insert_workflow_tx(&tx, &unique_name, input, &now)?;
                        result.imported += 1;
                    }
                }
            } else {
                insert_workflow_tx(&tx, input.name.trim(), input, &now)?;
                result.imported += 1;
            }
        }
        tx.commit()?;
        Ok(result)
    }

    // ---------- Storyboards ----------

    pub fn list_storyboards(&self) -> Result<Vec<StoryboardSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id,title,logline,style,aspect_ratio,scene_count,shot_count,total_duration_seconds,created_at,updated_at FROM storyboards ORDER BY updated_at DESC LIMIT 1000",
        )?;
        let rows = stmt.query_map([], map_storyboard_summary)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(CoreError::from)
    }

    pub fn get_storyboard(&self, id: &str) -> Result<Storyboard> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT * FROM storyboards WHERE id=?1",
            params![id],
            map_storyboard,
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Storyboard not found"))
    }

    pub fn create_storyboard(&self, input: &StoryboardInput) -> Result<Storyboard> {
        let normalized = normalize_storyboard_input(input)?;
        let counts = storyboard_counts(&normalized.scenes);
        let now = now_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let scenes = serde_json::to_string(&normalized.scenes)?;
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO storyboards(id,title,logline,style,aspect_ratio,scenes,scene_count,shot_count,total_duration_seconds,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            params![
                id,
                normalized.title,
                normalized.logline,
                normalized.style,
                normalized.aspect_ratio,
                scenes,
                counts.scenes as i64,
                counts.shots as i64,
                counts.duration_seconds as i64,
                now,
            ],
        )?;
        drop(conn);
        self.get_storyboard(&id)
    }

    pub fn update_storyboard(&self, id: &str, input: &StoryboardInput) -> Result<Storyboard> {
        let normalized = normalize_storyboard_input(input)?;
        let counts = storyboard_counts(&normalized.scenes);
        let scenes = serde_json::to_string(&normalized.scenes)?;
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE storyboards SET title=?2,logline=?3,style=?4,aspect_ratio=?5,scenes=?6,scene_count=?7,shot_count=?8,total_duration_seconds=?9,updated_at=?10 WHERE id=?1",
            params![
                id,
                normalized.title,
                normalized.logline,
                normalized.style,
                normalized.aspect_ratio,
                scenes,
                counts.scenes as i64,
                counts.shots as i64,
                counts.duration_seconds as i64,
                now_rfc3339(),
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Storyboard not found"));
        }
        drop(conn);
        self.get_storyboard(id)
    }

    pub fn delete_storyboard(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM storyboards WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Storyboard not found"));
        }
        Ok(())
    }

    pub fn duplicate_storyboard(&self, id: &str) -> Result<Storyboard> {
        let storyboard = self.get_storyboard(id)?;
        let input = StoryboardInput {
            title: format!("{} copy", storyboard.title),
            logline: storyboard.logline,
            style: storyboard.style,
            aspect_ratio: storyboard.aspect_ratio,
            scenes: storyboard.scenes,
        };
        self.create_storyboard(&input)
    }

    pub fn list_voiceover_assets(
        &self,
        storyboard_id: Option<&str>,
    ) -> Result<Vec<VoiceoverAsset>> {
        let conn = self.lock()?;
        if let Some(storyboard_id) = storyboard_id {
            let mut stmt = conn.prepare(
                "SELECT id,storyboard_id,scene_id,path,format,bytes,voice,created_at FROM voiceover_assets WHERE storyboard_id=?1 ORDER BY created_at DESC LIMIT 200",
            )?;
            let rows = stmt.query_map(params![storyboard_id], map_voiceover_asset)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(CoreError::from)
        } else {
            let mut stmt = conn.prepare(
                "SELECT id,storyboard_id,scene_id,path,format,bytes,voice,created_at FROM voiceover_assets ORDER BY created_at DESC LIMIT 200",
            )?;
            let rows = stmt.query_map([], map_voiceover_asset)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(CoreError::from)
        }
    }

    pub fn insert_voiceover_asset(
        &self,
        storyboard_id: &str,
        scene_id: &str,
        path: &str,
        format: &str,
        bytes: i64,
        voice: &str,
    ) -> Result<VoiceoverAsset> {
        let storyboard = self.get_storyboard(storyboard_id)?;
        if !storyboard.scenes.iter().any(|scene| scene.id == scene_id) {
            return Err(CoreError::validation("Scene not found in storyboard"));
        }
        let format = format.trim().to_ascii_lowercase();
        if !crate::tts::TTS_FORMATS.contains(&format.as_str()) {
            return Err(CoreError::validation("Unsupported voiceover format"));
        }
        if path.trim().is_empty() || path.chars().count() > 4_096 {
            return Err(CoreError::validation("Voiceover path is invalid"));
        }
        if !(1..=crate::tts::MAX_TTS_AUDIO_BYTES as i64).contains(&bytes) {
            return Err(CoreError::validation("Voiceover file size is invalid"));
        }
        let voice = voice.trim();
        if voice.chars().count() > 160 {
            return Err(CoreError::validation("Voiceover voice name is invalid"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO voiceover_assets(id,storyboard_id,scene_id,path,format,bytes,voice,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![id, storyboard_id, scene_id, path.trim(), format, bytes, voice, now],
        )?;
        drop(conn);
        Ok(VoiceoverAsset {
            id,
            storyboard_id: storyboard_id.into(),
            scene_id: scene_id.into(),
            path: path.trim().into(),
            format,
            bytes,
            voice: voice.into(),
            created_at: now,
        })
    }

    pub fn delete_voiceover_asset(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM voiceover_assets WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Voiceover asset not found"));
        }
        Ok(())
    }

    // ---------- Dashboard ----------

    pub fn dashboard(&self) -> Result<DashboardStats> {
        let conn = self.lock()?;
        let total_accounts =
            conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))?;
        let total_storyboards =
            conn.query_row("SELECT COUNT(*) FROM storyboards", [], |row| row.get(0))?;
        let total_voiceover_assets =
            conn.query_row("SELECT COUNT(*) FROM voiceover_assets", [], |row| {
                row.get(0)
            })?;
        let total_workflows =
            conn.query_row("SELECT COUNT(*) FROM workflows", [], |row| row.get(0))?;
        let enabled_workflows = conn.query_row(
            "SELECT COUNT(*) FROM workflows WHERE enabled=1",
            [],
            |row| row.get(0),
        )?;
        let queued_runs = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status='queued'",
            [],
            |row| row.get(0),
        )?;
        let running_runs = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status='running'",
            [],
            |row| row.get(0),
        )?;
        let succeeded_runs = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status='succeeded'",
            [],
            |row| row.get(0),
        )?;
        let failed_runs = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status='failed'",
            [],
            |row| row.get(0),
        )?;
        let settings = self.get_settings_from_conn(&conn)?;
        let next_scheduled_run: Option<String> = conn
            .query_row("SELECT MIN(next_run_at) FROM schedules WHERE enabled=1 AND next_run_at IS NOT NULL", [], |row| row.get(0))
            .optional()?
            .flatten();

        let accounts_by_provider = count_buckets(
            &conn,
            "SELECT provider, COUNT(*) FROM accounts GROUP BY provider ORDER BY COUNT(*) DESC",
        )?;
        let accounts_by_status = count_buckets(
            &conn,
            "SELECT status, COUNT(*) FROM accounts GROUP BY status ORDER BY COUNT(*) DESC",
        )?;

        let mut stmt = conn.prepare("SELECT * FROM runs ORDER BY queued_at DESC LIMIT 8")?;
        let recent_runs = stmt
            .query_map([], map_run)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut stmt =
            conn.prepare("SELECT * FROM logs WHERE level='error' ORDER BY id DESC LIMIT 5")?;
        let recent_errors = stmt
            .query_map([], map_log)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut days = Vec::new();
        for offset in (0..7).rev() {
            let day = (Utc::now() - Duration::days(offset))
                .format("%Y-%m-%d")
                .to_string();
            let succeeded: i64 = conn.query_row(
                "SELECT COUNT(*) FROM runs WHERE status='succeeded' AND date(finished_at)=?1",
                params![day],
                |row| row.get(0),
            )?;
            let failed: i64 = conn.query_row(
                "SELECT COUNT(*) FROM runs WHERE status IN ('failed','cancelled') AND date(finished_at)=?1",
                params![day],
                |row| row.get(0),
            )?;
            days.push(DayCount {
                day,
                succeeded,
                failed,
            });
        }

        Ok(DashboardStats {
            total_accounts,
            accounts_by_provider,
            accounts_by_status,
            total_storyboards,
            total_voiceover_assets,
            total_workflows,
            enabled_workflows,
            queued_runs,
            running_runs,
            succeeded_runs,
            failed_runs,
            runs_last_7_days: days,
            recent_runs,
            recent_errors,
            scheduler_enabled: settings.scheduler_enabled,
            next_scheduled_run,
        })
    }

    // ---------- Prompt library ----------

    pub fn list_prompts(&self, filter: &PromptFilter) -> Result<Vec<Prompt>> {
        let conn = self.lock()?;
        let mut sql = String::from("SELECT * FROM prompts WHERE 1=1");
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(query) = filter
            .query
            .as_ref()
            .map(|q| q.trim().to_lowercase())
            .filter(|q| !q.is_empty())
        {
            sql.push_str(
                " AND (lower(title) LIKE ? OR lower(prompt) LIKE ? OR lower(category) LIKE ?)",
            );
            let like = format!("%{query}%");
            for _ in 0..3 {
                values.push(rusqlite::types::Value::Text(like.clone()));
            }
        }
        if let Some(category) = filter
            .category
            .as_ref()
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
        {
            sql.push_str(" AND category = ?");
            values.push(rusqlite::types::Value::Text(category.to_string()));
        }
        sql.push_str(" ORDER BY pinned DESC, sort_order ASC, updated_at DESC LIMIT 1000");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values), map_prompt)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(CoreError::from)
    }

    pub fn get_prompt(&self, id: &str) -> Result<Prompt> {
        let conn = self.lock()?;
        conn.query_row("SELECT * FROM prompts WHERE id=?1", params![id], map_prompt)
            .optional()?
            .ok_or_else(|| CoreError::not_found("Prompt not found"))
    }

    pub fn create_prompt(&self, input: &PromptInput) -> Result<Prompt> {
        validation::validate_prompt_input(input)?;
        let now = now_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.lock()?;
        let order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM prompts",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO prompts(id,title,prompt,category,pinned,card_color,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![
                id,
                input.title.trim(),
                input.prompt,
                input.category.trim(),
                if input.pinned { 1 } else { 0 },
                input.card_color,
                order,
                now,
            ],
        )?;
        drop(conn);
        self.get_prompt(&id)
    }

    pub fn update_prompt(&self, id: &str, input: &PromptInput) -> Result<Prompt> {
        validation::validate_prompt_input(input)?;
        let now = now_rfc3339();
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE prompts SET title=?2,prompt=?3,category=?4,pinned=?5,card_color=?6,updated_at=?7 WHERE id=?1",
            params![
                id,
                input.title.trim(),
                input.prompt,
                input.category.trim(),
                if input.pinned { 1 } else { 0 },
                input.card_color,
                now,
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Prompt not found"));
        }
        drop(conn);
        self.get_prompt(id)
    }

    pub fn delete_prompt(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM prompts WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Prompt not found"));
        }
        Ok(())
    }

    pub fn set_prompt_pinned(&self, id: &str, pinned: bool) -> Result<Prompt> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE prompts SET pinned=?2, updated_at=?3 WHERE id=?1",
            params![id, if pinned { 1 } else { 0 }, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Prompt not found"));
        }
        drop(conn);
        self.get_prompt(id)
    }

    // ---------- Declarative plugin packs ----------

    pub fn install_plugin(&self, manifest: &PluginManifest) -> Result<PluginSummary> {
        crate::plugins::validate_manifest(manifest)?;
        let now = now_rfc3339();
        let json = serde_json::to_string(manifest)?;
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO plugins(id,name,version,description,author,manifest,enabled,installed_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,description=excluded.description,author=excluded.author,manifest=excluded.manifest,updated_at=excluded.updated_at",
            params![
                manifest.id,
                manifest.name.trim(),
                manifest.version.trim(),
                manifest.description.trim(),
                manifest.author.trim(),
                json,
                now,
            ],
        )?;
        drop(conn);
        self.get_plugin(&manifest.id)
    }

    pub fn list_plugins(&self) -> Result<Vec<PluginSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id,name,version,description,author,enabled,manifest,installed_at,updated_at FROM plugins ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], map_plugin_summary)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(CoreError::from)
    }

    pub fn get_plugin(&self, id: &str) -> Result<PluginSummary> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT id,name,version,description,author,enabled,manifest,installed_at,updated_at FROM plugins WHERE id=?1",
            params![id],
            map_plugin_summary,
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Plugin not found"))
    }

    pub fn get_plugin_manifest(&self, id: &str) -> Result<PluginManifest> {
        let conn = self.lock()?;
        let json: Option<String> = conn
            .query_row(
                "SELECT manifest FROM plugins WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let json = json.ok_or_else(|| CoreError::not_found("Plugin not found"))?;
        let manifest: PluginManifest = serde_json::from_str(&json)
            .map_err(|_| CoreError::internal("Stored plugin manifest is invalid"))?;
        Ok(manifest)
    }

    pub fn set_plugin_enabled(&self, id: &str, enabled: bool) -> Result<PluginSummary> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE plugins SET enabled=?2, updated_at=?3 WHERE id=?1",
            params![id, if enabled { 1 } else { 0 }, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(CoreError::not_found("Plugin not found"));
        }
        drop(conn);
        self.get_plugin(id)
    }

    pub fn delete_plugin(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let changed = conn.execute("DELETE FROM plugins WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::not_found("Plugin not found"));
        }
        Ok(())
    }

    // ---------- Internal metadata ----------

    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock()?;
        Ok(conn
            .query_row(
                "SELECT value FROM app_meta WHERE key=?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO app_meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_meta(&self, key: &str) -> Result<()> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM app_meta WHERE key=?1", params![key])?;
        Ok(())
    }

    pub fn device_id(&self) -> Result<String> {
        if let Some(value) = self.get_meta("device.id")? {
            if !value.trim().is_empty() && value.len() <= 128 {
                return Ok(value);
            }
        }
        let value = uuid::Uuid::new_v4().to_string();
        self.set_meta("device.id", &value)?;
        Ok(value)
    }

    fn get_settings_from_conn(&self, conn: &Connection) -> Result<Settings> {
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }
        Ok(settings_from_map(&map))
    }

    // ---------- Backup ----------

    pub fn integrity_check(&self) -> Result<String> {
        let conn = self.lock()?;
        let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result)
    }

    pub fn backup_to(&self, path: &Path) -> Result<u64> {
        if path.exists() {
            return Err(CoreError::conflict("Backup destination already exists"));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = self.lock()?;
        let path_string = path.to_string_lossy().to_string();
        conn.execute("VACUUM INTO ?1", params![path_string])?;
        let size = std::fs::metadata(path)?.len();
        Ok(size)
    }

    pub fn count_active_runs(&self) -> Result<i64> {
        let conn = self.lock()?;
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status IN ('queued','running')",
            [],
            |row| row.get(0),
        )?)
    }
}

/// Maps the partial unique idempotency index conflict to a domain conflict so
/// the scheduler/worker can treat a duplicate slot as an expected outcome.
fn map_insert_error(error: rusqlite::Error) -> CoreError {
    if let rusqlite::Error::SqliteFailure(inner, _) = &error {
        if inner.code == rusqlite::ErrorCode::ConstraintViolation {
            return CoreError::conflict("A concurrent operation created a duplicate record");
        }
    }
    CoreError::Database(error)
}

fn unique_account_name(conn: &Connection, provider: &str, base: &str) -> Result<String> {
    for attempt in 1..=500 {
        let candidate = if attempt == 1 {
            format!("{base} (imported)")
        } else {
            format!("{base} (imported {attempt})")
        };
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM accounts WHERE provider=?1 AND normalized_name=?2",
            params![provider, validation::normalize_name(&candidate)],
            |row| row.get(0),
        )?;
        if count == 0 {
            return Ok(candidate);
        }
    }
    Err(CoreError::conflict(
        "Unable to generate a unique imported account name",
    ))
}

fn unique_workflow_name(conn: &Connection, base: &str) -> Result<String> {
    for attempt in 1..=500 {
        let candidate = if attempt == 1 {
            format!("{base} (imported)")
        } else {
            format!("{base} (imported {attempt})")
        };
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workflows WHERE lower(name)=lower(?1)",
            params![candidate],
            |row| row.get(0),
        )?;
        if count == 0 {
            return Ok(candidate);
        }
    }
    Err(CoreError::conflict(
        "Unable to generate a unique imported workflow name",
    ))
}

fn insert_workflow_tx(
    conn: &Connection,
    name: &str,
    input: &WorkflowInput,
    now: &str,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO workflows(id, name, description, tags, enabled, definition, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
        params![
            id,
            name,
            input.description.trim(),
            serde_json::to_string(&validation::clean_tags(&input.tags))?,
            if input.enabled { 1 } else { 0 },
            serde_json::to_string(&input.definition)?,
            now,
        ],
    )?;
    if let Some(schedule) = &input.schedule {
        insert_schedule_tx(conn, &id, schedule, now)?;
    }
    Ok(id)
}

fn insert_schedule_tx(
    conn: &Connection,
    workflow_id: &str,
    schedule: &ScheduleInput,
    now: &str,
) -> Result<()> {
    let next =
        validation::next_cron_occurrence(&schedule.cron, &schedule.timezone, Utc::now()).ok();
    conn.execute(
        "INSERT INTO schedules(id, workflow_id, cron, timezone, enabled, next_run_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            uuid::Uuid::new_v4().to_string(),
            workflow_id,
            schedule.cron.trim(),
            schedule.timezone.trim(),
            if schedule.enabled { 1 } else { 0 },
            next,
            now,
        ],
    )?;
    Ok(())
}

fn count_buckets(conn: &Connection, sql: &str) -> Result<Vec<CountBucket>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(CountBucket {
            label: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn settings_to_map(settings: &Settings) -> Vec<(String, String)> {
    vec![
        ("theme".into(), settings.theme.clone()),
        ("concurrency".into(), settings.concurrency.to_string()),
        (
            "runTimeoutSeconds".into(),
            settings.run_timeout_seconds.to_string(),
        ),
        ("maxRetries".into(), settings.max_retries.to_string()),
        ("retryDelayMs".into(), settings.retry_delay_ms.to_string()),
        (
            "schedulerEnabled".into(),
            settings.scheduler_enabled.to_string(),
        ),
        (
            "logRetentionDays".into(),
            settings.log_retention_days.to_string(),
        ),
        ("maxLogRows".into(), settings.max_log_rows.to_string()),
        (
            "allowLocalNetwork".into(),
            settings.allow_local_network.to_string(),
        ),
        (
            "httpProxyUrl".into(),
            settings.http_proxy_url.clone().unwrap_or_default(),
        ),
        (
            "httpProxyUsername".into(),
            settings.http_proxy_username.clone().unwrap_or_default(),
        ),
        ("aiEndpoint".into(), settings.ai_endpoint.clone()),
        ("aiModel".into(), settings.ai_model.clone()),
        ("ttsEndpoint".into(), settings.tts_endpoint.clone()),
        ("ttsModel".into(), settings.tts_model.clone()),
        ("ttsVoice".into(), settings.tts_voice.clone()),
        ("ttsFormat".into(), settings.tts_format.clone()),
        ("ttsSpeed".into(), settings.tts_speed.to_string()),
        (
            "localApiEnabled".into(),
            settings.local_api_enabled.to_string(),
        ),
        ("localApiPort".into(), settings.local_api_port.to_string()),
        (
            "updateEndpoint".into(),
            settings.update_endpoint.clone().unwrap_or_default(),
        ),
    ]
}

fn settings_from_map(map: &std::collections::HashMap<String, String>) -> Settings {
    let defaults = Settings::default();
    Settings {
        theme: map.get("theme").cloned().unwrap_or(defaults.theme),
        concurrency: map
            .get("concurrency")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.concurrency),
        run_timeout_seconds: map
            .get("runTimeoutSeconds")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.run_timeout_seconds),
        max_retries: map
            .get("maxRetries")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.max_retries),
        retry_delay_ms: map
            .get("retryDelayMs")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.retry_delay_ms),
        scheduler_enabled: map
            .get("schedulerEnabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.scheduler_enabled),
        log_retention_days: map
            .get("logRetentionDays")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.log_retention_days),
        max_log_rows: map
            .get("maxLogRows")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.max_log_rows),
        allow_local_network: map
            .get("allowLocalNetwork")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.allow_local_network),
        http_proxy_url: map
            .get("httpProxyUrl")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        http_proxy_username: map
            .get("httpProxyUsername")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        ai_endpoint: map
            .get("aiEndpoint")
            .cloned()
            .unwrap_or(defaults.ai_endpoint),
        ai_model: map.get("aiModel").cloned().unwrap_or(defaults.ai_model),
        tts_endpoint: map
            .get("ttsEndpoint")
            .cloned()
            .unwrap_or(defaults.tts_endpoint),
        tts_model: map.get("ttsModel").cloned().unwrap_or(defaults.tts_model),
        tts_voice: map.get("ttsVoice").cloned().unwrap_or(defaults.tts_voice),
        tts_format: map.get("ttsFormat").cloned().unwrap_or(defaults.tts_format),
        tts_speed: map
            .get("ttsSpeed")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.tts_speed),
        local_api_enabled: map
            .get("localApiEnabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.local_api_enabled),
        local_api_port: map
            .get("localApiPort")
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.local_api_port),
        update_endpoint: map
            .get("updateEndpoint")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
    }
}

fn map_storyboard_summary(row: &Row<'_>) -> rusqlite::Result<StoryboardSummary> {
    Ok(StoryboardSummary {
        id: row.get("id")?,
        title: row.get("title")?,
        logline: row.get("logline")?,
        style: row.get("style")?,
        aspect_ratio: row.get("aspect_ratio")?,
        scene_count: row.get("scene_count")?,
        shot_count: row.get("shot_count")?,
        total_duration_seconds: row.get("total_duration_seconds")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_storyboard(row: &Row<'_>) -> rusqlite::Result<Storyboard> {
    let scenes: String = row.get("scenes")?;
    Ok(Storyboard {
        id: row.get("id")?,
        schema_version: STORYBOARD_SCHEMA_VERSION,
        title: row.get("title")?,
        logline: row.get("logline")?,
        style: row.get("style")?,
        aspect_ratio: row.get("aspect_ratio")?,
        scenes: serde_json::from_str(&scenes).unwrap_or_default(),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_voiceover_asset(row: &Row<'_>) -> rusqlite::Result<VoiceoverAsset> {
    Ok(VoiceoverAsset {
        id: row.get(0)?,
        storyboard_id: row.get(1)?,
        scene_id: row.get(2)?,
        path: row.get(3)?,
        format: row.get(4)?,
        bytes: row.get(5)?,
        voice: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn map_prompt(row: &Row<'_>) -> rusqlite::Result<Prompt> {
    Ok(Prompt {
        id: row.get("id")?,
        title: row.get("title")?,
        prompt: row.get("prompt")?,
        category: row.get("category")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        card_color: row.get("card_color")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_plugin_summary(row: &Row<'_>) -> rusqlite::Result<PluginSummary> {
    let manifest: String = row.get(6)?;
    let preset_count = serde_json::from_str::<PluginManifest>(&manifest)
        .map(|value| value.presets.len())
        .unwrap_or(0);
    Ok(PluginSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        description: row.get(3)?,
        author: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        preset_count,
        installed_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_account(row: &Row<'_>) -> rusqlite::Result<Account> {
    let tags: String = row.get("tags")?;
    Ok(Account {
        id: row.get("id")?,
        provider: row.get("provider")?,
        name: row.get("name")?,
        email: row.get("email")?,
        external_id: row.get("external_id")?,
        status: row.get("status")?,
        favorite: row.get::<_, i64>("favorite")? != 0,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        notes: row.get("notes")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_opened_at: row.get("last_opened_at")?,
        last_checked_at: row.get("last_checked_at")?,
    })
}

fn map_workflow_summary(row: &Row<'_>) -> rusqlite::Result<WorkflowSummary> {
    let tags: String = row.get(3)?;
    let definition: String = row.get(5)?;
    let node_count = serde_json::from_str::<WorkflowDefinition>(&definition)
        .map(|d| d.nodes.len() as i64)
        .unwrap_or(0);
    Ok(WorkflowSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        enabled: row.get::<_, i64>(4)? != 0,
        node_count,
        version: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_run_at: row.get(9)?,
        schedule: map_schedule_optional(row, 10)?,
    })
}

fn map_workflow(row: &Row<'_>) -> rusqlite::Result<Workflow> {
    let tags: String = row.get(3)?;
    let definition: String = row.get(5)?;
    Ok(Workflow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        enabled: row.get::<_, i64>(4)? != 0,
        definition: serde_json::from_str(&definition).unwrap_or(WorkflowDefinition {
            schema_version: 1,
            nodes: vec![],
            edges: vec![],
        }),
        version: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_run_at: row.get(9)?,
        schedule: map_schedule_optional(row, 10)?,
    })
}

fn map_schedule_optional(row: &Row<'_>, offset: usize) -> rusqlite::Result<Option<Schedule>> {
    let id: Option<String> = row.get(offset)?;
    let Some(id) = id else { return Ok(None) };
    Ok(Some(Schedule {
        id,
        workflow_id: row.get(offset + 1)?,
        cron: row.get(offset + 2)?,
        timezone: row.get(offset + 3)?,
        enabled: row.get::<_, i64>(offset + 4)? != 0,
        last_run_at: row.get(offset + 5)?,
        next_run_at: row.get(offset + 6)?,
        missed_count: row.get(offset + 7)?,
        created_at: row.get(offset + 8)?,
        updated_at: row.get(offset + 9)?,
    }))
}

fn map_schedule(row: &Row<'_>) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: row.get("id")?,
        workflow_id: row.get("workflow_id")?,
        cron: row.get("cron")?,
        timezone: row.get("timezone")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        last_run_at: row.get("last_run_at")?,
        next_run_at: row.get("next_run_at")?,
        missed_count: row.get("missed_count")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_run(row: &Row<'_>) -> rusqlite::Result<Run> {
    let input: String = row.get("input")?;
    let output: Option<String> = row.get("output")?;
    Ok(Run {
        id: row.get("id")?,
        workflow_id: row.get("workflow_id")?,
        workflow_name: row.get("workflow_name")?,
        status: row.get("status")?,
        trigger: row.get("trigger_kind")?,
        input: serde_json::from_str(&input).unwrap_or(serde_json::Value::Null),
        output: output.and_then(|v| serde_json::from_str(&v).ok()),
        error: row.get("error")?,
        idempotency_key: row.get("idempotency_key")?,
        queued_at: row.get("queued_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        duration_ms: row.get("duration_ms")?,
        total_steps: row.get("total_steps")?,
        completed_steps: row.get("completed_steps")?,
        cancel_requested: row.get::<_, i64>("cancel_requested")? != 0,
    })
}

fn map_run_step(row: &Row<'_>) -> rusqlite::Result<RunStep> {
    let output: Option<String> = row.get("output")?;
    Ok(RunStep {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        node_id: row.get("node_id")?,
        node_type: row.get("node_type")?,
        node_name: row.get("node_name")?,
        status: row.get("status")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        duration_ms: row.get("duration_ms")?,
        output: output.and_then(|v| serde_json::from_str(&v).ok()),
        error: row.get("error")?,
        attempt: row.get("attempt")?,
    })
}

fn map_log(row: &Row<'_>) -> rusqlite::Result<LogEntry> {
    let details: Option<String> = row.get("details")?;
    Ok(LogEntry {
        id: row.get("id")?,
        ts: row.get("ts")?,
        level: row.get("level")?,
        scope: row.get("scope")?,
        run_id: row.get("run_id")?,
        message: row.get("message")?,
        details: details.and_then(|v| serde_json::from_str(&v).ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_input() -> AccountInput {
        AccountInput {
            provider: "google-flow".into(),
            name: "Studio".into(),
            email: Some("studio@example.com".into()),
            external_id: None,
            status: Some("active".into()),
            favorite: Some(true),
            tags: Some(vec!["production".into()]),
            notes: Some("Keep this note".into()),
            sort_order: None,
        }
    }

    #[test]
    fn update_account_preserves_omitted_fields_without_relocking_the_database() {
        let db = Database::open_in_memory().unwrap();
        let created = db.create_account(&account_input()).unwrap();
        let updated = db
            .update_account(
                &created.id,
                &AccountInput {
                    provider: "google-flow".into(),
                    name: "Studio (renamed)".into(),
                    email: Some("studio@example.com".into()),
                    external_id: None,
                    status: None,
                    favorite: None,
                    tags: Some(vec!["production".into(), "priority".into()]),
                    notes: None,
                    sort_order: None,
                },
            )
            .unwrap();
        assert_eq!(updated.name, "Studio (renamed)");
        assert_eq!(updated.status, "active");
        assert!(updated.favorite);
        assert_eq!(updated.notes, "Keep this note");
        assert_eq!(updated.tags, vec!["production", "priority"]);
    }

    #[test]
    fn account_status_and_favorite_updates_are_persisted() {
        let db = Database::open_in_memory().unwrap();
        let created = db.create_account(&account_input()).unwrap();
        let favorited = db.set_account_favorite(&created.id, false).unwrap();
        assert!(!favorited.favorite);
        let checked = db.set_account_status(&created.id, "needs_login").unwrap();
        assert_eq!(checked.status, "needs_login");
        assert!(checked.last_checked_at.is_some());
    }

    #[test]
    fn settings_round_trip_updates_engine_fields() {
        let db = Database::open_in_memory().unwrap();
        let mut settings = db.get_settings().unwrap();
        settings.concurrency = 3;
        settings.run_timeout_seconds = 42;
        settings.allow_local_network = true;
        let updated = db.update_settings(&settings).unwrap();
        assert_eq!(updated.concurrency, 3);
        assert_eq!(updated.run_timeout_seconds, 42);
        assert!(updated.allow_local_network);
    }

    #[test]
    fn prompt_library_crud_pinning_and_filters() {
        let db = Database::open_in_memory().unwrap();
        let created = db
            .create_prompt(&PromptInput {
                title: "Cinematic shot".into(),
                prompt: "A slow dolly shot".into(),
                category: "Video".into(),
                pinned: false,
                card_color: "blue".into(),
            })
            .unwrap();
        assert_eq!(created.category, "Video");
        assert!(!created.pinned);

        let pinned = db.set_prompt_pinned(&created.id, true).unwrap();
        assert!(pinned.pinned);
        let listed = db
            .list_prompts(&PromptFilter {
                query: Some("dolly".into()),
                category: Some("Video".into()),
            })
            .unwrap();
        assert_eq!(listed.len(), 1);

        let updated = db
            .update_prompt(
                &created.id,
                &PromptInput {
                    title: "Cinematic shot v2".into(),
                    prompt: "A slow dolly shot at dusk".into(),
                    category: "Video".into(),
                    pinned: true,
                    card_color: "violet".into(),
                },
            )
            .unwrap();
        assert_eq!(updated.title, "Cinematic shot v2");

        db.delete_prompt(&created.id).unwrap();
        assert!(db.get_prompt(&created.id).is_err());
    }

    #[test]
    fn plugin_install_list_toggle_and_remove() {
        let db = Database::open_in_memory().unwrap();
        let manifest = PluginManifest {
            schema_version: 1,
            id: "com.example.webhooks".into(),
            name: "Example webhooks".into(),
            version: "1.0.0".into(),
            description: "Presets".into(),
            author: "Example".into(),
            homepage: None,
            presets: vec![PluginPreset {
                id: "post-event".into(),
                name: "Post event".into(),
                description: "Send an event".into(),
                method: "POST".into(),
                url: "https://api.example.com/events".into(),
                headers: std::collections::BTreeMap::new(),
                body: Some(serde_json::json!({"ok": true})),
                timeout_ms: Some(30_000),
            }],
        };
        let installed = db.install_plugin(&manifest).unwrap();
        assert_eq!(installed.preset_count, 1);
        assert!(installed.enabled);

        let disabled = db.set_plugin_enabled(&installed.id, false).unwrap();
        assert!(!disabled.enabled);
        assert_eq!(db.list_plugins().unwrap().len(), 1);
        assert_eq!(
            db.get_plugin_manifest(&installed.id).unwrap().presets.len(),
            1
        );

        db.delete_plugin(&installed.id).unwrap();
        assert!(db.list_plugins().unwrap().is_empty());
    }

    #[test]
    fn meta_storage_and_device_id_are_stable() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.get_meta("missing").unwrap().is_none());
        db.set_meta("license.token", "abc").unwrap();
        assert_eq!(
            db.get_meta("license.token").unwrap().as_deref(),
            Some("abc")
        );
        let first = db.device_id().unwrap();
        assert_eq!(first, db.device_id().unwrap());
        db.delete_meta("license.token").unwrap();
        assert!(db.get_meta("license.token").unwrap().is_none());
    }

    #[test]
    fn settings_round_trip_updates_integration_fields() {
        let db = Database::open_in_memory().unwrap();
        let mut settings = db.get_settings().unwrap();
        settings.http_proxy_url = Some("http://proxy.example.com:8080".into());
        settings.http_proxy_username = Some("bits-ai-video-creator-user".into());
        settings.ai_endpoint = "https://ai.example.com/v1".into();
        settings.ai_model = "example-model".into();
        settings.tts_endpoint = "https://speech.example.com/v1".into();
        settings.tts_model = "example-tts".into();
        settings.tts_voice = "coral".into();
        settings.tts_format = "wav".into();
        settings.tts_speed = 1.2;
        settings.local_api_enabled = true;
        settings.local_api_port = 49000;
        settings.update_endpoint = Some("https://updates.example.com/latest.json".into());
        let updated = db.update_settings(&settings).unwrap();
        assert_eq!(
            updated.http_proxy_url.as_deref(),
            Some("http://proxy.example.com:8080")
        );
        assert_eq!(updated.local_api_port, 49000);
        assert!(updated.local_api_enabled);
        assert_eq!(
            updated.update_endpoint.as_deref(),
            Some("https://updates.example.com/latest.json")
        );
        assert_eq!(updated.tts_endpoint, "https://speech.example.com/v1");
        assert_eq!(updated.tts_model, "example-tts");
        assert_eq!(updated.tts_voice, "coral");
        assert_eq!(updated.tts_format, "wav");
        assert!((updated.tts_speed - 1.2).abs() < f32::EPSILON);
    }

    fn storyboard_input() -> StoryboardInput {
        StoryboardInput {
            title: "Coastal delivery".into(),
            logline: "A courier crosses the island before sunset.".into(),
            style: "Warm cinematic".into(),
            aspect_ratio: "16:9".into(),
            scenes: vec![Scene {
                id: "scene-1".into(),
                title: "Departure".into(),
                description: "The courier leaves the harbour.".into(),
                location: "Harbour".into(),
                time_of_day: "Morning".into(),
                shots: vec![Shot {
                    id: "shot-1".into(),
                    description: "A wide shot of the harbour.".into(),
                    prompt: "Warm 35mm film, low sun, harbour mist.".into(),
                    camera: "Slow dolly in".into(),
                    duration_seconds: 6,
                    dialogue: "We start here.".into(),
                    transition: "Cut".into(),
                }],
                voiceover: Voiceover {
                    text: "Every delivery starts with a departure.".into(),
                    ..Voiceover::default()
                },
            }],
        }
    }

    #[test]
    fn storyboard_crud_duplicate_and_voiceover_assets() {
        let db = Database::open_in_memory().unwrap();
        let created = db.create_storyboard(&storyboard_input()).unwrap();
        assert_eq!(created.title, "Coastal delivery");
        assert_eq!(created.scenes.len(), 1);

        let list = db.list_storyboards().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);
        assert_eq!(list[0].scene_count, 1);
        assert_eq!(list[0].shot_count, 1);
        assert_eq!(list[0].total_duration_seconds, 6);
        assert_eq!(
            list[0].logline,
            "A courier crosses the island before sunset."
        );

        let mut changed = storyboard_input();
        changed.title = "Coastal delivery (revised)".into();
        changed.scenes.push(Scene {
            id: "scene-2".into(),
            title: "Arrival".into(),
            shots: vec![],
            ..changed.scenes[0].clone()
        });
        changed.scenes[1].id = "scene-2".into();
        changed.scenes[1].shots.clear();
        let updated = db.update_storyboard(&created.id, &changed).unwrap();
        assert_eq!(updated.title, "Coastal delivery (revised)");
        assert_eq!(updated.scenes.len(), 2);
        assert_eq!(db.list_storyboards().unwrap()[0].scene_count, 2);

        let duplicated = db.duplicate_storyboard(&created.id).unwrap();
        assert_eq!(duplicated.title, "Coastal delivery (revised) copy");
        assert_ne!(duplicated.id, created.id);
        assert_eq!(db.list_storyboards().unwrap().len(), 2);

        let scene_id = created.scenes[0].id.clone();
        let asset = db
            .insert_voiceover_asset(
                &created.id,
                &scene_id,
                "/tmp/coastal.mp3",
                "mp3",
                2048,
                "alloy",
            )
            .unwrap();
        assert_eq!(asset.bytes, 2048);
        assert_eq!(
            db.list_voiceover_assets(Some(&created.id)).unwrap().len(),
            1
        );
        assert_eq!(db.dashboard().unwrap().total_voiceover_assets, 1);
        db.delete_voiceover_asset(&asset.id).unwrap();
        assert!(db
            .list_voiceover_assets(Some(&created.id))
            .unwrap()
            .is_empty());

        db.delete_storyboard(&created.id).unwrap();
        assert!(db.get_storyboard(&created.id).is_err());
        assert_eq!(db.list_storyboards().unwrap().len(), 1);
    }
}
