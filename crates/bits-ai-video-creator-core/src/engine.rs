use crate::db::Database;
use crate::error::{CoreError, Result};
use crate::models::{now_rfc3339, Run, RunStatus, Settings, WorkflowDefinition, WorkflowNode};
use crate::redaction::Redactor;
use crate::secrets::SecretVault;
use crate::validation;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect::Policy;
use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_STORED_OUTPUT_CHARS: usize = 100_000;
const MAX_STEPS: usize = 1_000;

#[derive(Debug, Clone)]
pub struct EngineSettings {
    pub run_timeout: Duration,
    pub max_retries: u32,
    pub retry_delay: Duration,
    pub allow_local_network: bool,
    pub proxy: Option<ProxyConfig>,
}

#[derive(Debug, Clone)]
pub struct ProxyConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

pub const PROXY_PASSWORD_SECRET: &str = "http.proxy.password";

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            run_timeout: Duration::from_secs(300),
            max_retries: 1,
            retry_delay: Duration::from_secs(1),
            allow_local_network: false,
            proxy: None,
        }
    }
}

impl From<&Settings> for EngineSettings {
    fn from(settings: &Settings) -> Self {
        Self {
            run_timeout: Duration::from_secs(settings.run_timeout_seconds as u64),
            max_retries: settings.max_retries,
            retry_delay: Duration::from_millis(settings.retry_delay_ms as u64),
            allow_local_network: settings.allow_local_network,
            proxy: settings.http_proxy_url.as_ref().map(|url| ProxyConfig {
                url: url.clone(),
                username: settings.http_proxy_username.clone(),
                password: None,
            }),
        }
    }
}

#[derive(Debug, Clone)]
struct RetryPolicy {
    attempts: u32,
    delay: Duration,
}

struct ExecutionContext<'a> {
    input: &'a Value,
    step_outputs: HashMap<String, Value>,
    secrets: HashMap<String, String>,
    redactor: Redactor,
    retry: RetryPolicy,
}

struct NodeOutcome {
    output: Value,
    branch: Option<String>,
}

/// Executes a single claimed run. All network and sleep work happens off the UI
/// thread; every step is persisted so an interrupted run is diagnosable.
#[derive(Clone)]
pub struct Engine {
    db: Database,
    secrets: SecretVault,
    settings: Arc<RwLock<EngineSettings>>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

/// Resolves every hostname and drops addresses that are local/private unless
/// the caller opted in. Reqwest connects to the returned addresses, so a
/// second DNS answer cannot rebind the request to an internal host.
pub(crate) struct GuardedResolver {
    allow_local: bool,
}

impl Resolve for GuardedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let allow_local = self.allow_local;
        Box::pin(async move {
            let resolved = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)?;
            let addrs: Vec<std::net::SocketAddr> = resolved
                .filter(|address| allow_local || !validation::is_local_or_private_ip(address.ip()))
                .collect();
            if addrs.is_empty() {
                return Err("host resolves only to blocked local/private addresses".into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

pub(crate) fn build_http_client(allow_local: bool, proxy: Option<&ProxyConfig>) -> Result<Client> {
    let mut builder = Client::builder()
        .user_agent(format!(
            "BITS AI Video Creator/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(10))
        .no_proxy()
        .dns_resolver(Arc::new(GuardedResolver { allow_local }))
        .redirect(Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            let url = attempt.url();
            if !matches!(url.scheme(), "http" | "https") {
                return attempt.error("redirect to unsupported scheme");
            }
            if url.username() != "" || url.password().is_some() {
                return attempt.error("redirect URL contains credentials");
            }
            let Some(host) = url.host_str() else {
                return attempt.error("redirect URL is missing a host");
            };
            if !allow_local && validation::is_local_or_private_host(host) {
                return attempt.error("redirect to a local/private address is blocked");
            }
            attempt.follow()
        }));
    if let Some(proxy) = proxy {
        validation::validate_http_proxy_url(&proxy.url)?;
        let mut configured = reqwest::Proxy::all(proxy.url.trim())
            .map_err(|_| CoreError::validation("Proxy URL could not be configured"))?;
        if let (Some(username), Some(password)) = (&proxy.username, &proxy.password) {
            if !username.is_empty() {
                configured = configured.basic_auth(username, password);
            }
        }
        builder = builder.proxy(configured);
    }
    builder
        .build()
        .map_err(|error| CoreError::internal(format!("Unable to build HTTP client: {error}")))
}

/// With an explicit proxy reqwest resolves the proxy host, not the destination.
/// Resolve the destination ourselves so a public hostname that points at a
/// private address cannot be smuggled through the proxy.
async fn ensure_proxy_target_is_public(url: &url::Url) -> Result<()> {
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::validation("URL must include a host"))?;
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let resolved = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| CoreError::Http("Unable to resolve the request host".into()))?;
    let mut found = false;
    for address in resolved {
        found = true;
        if validation::is_local_or_private_ip(address.ip()) {
            return Err(CoreError::validation(
                "Request host resolves to a local/private address",
            ));
        }
    }
    if !found {
        return Err(CoreError::Http(
            "Request host did not resolve to any address".into(),
        ));
    }
    Ok(())
}

fn load_engine_settings(db: &Database, secrets: &SecretVault) -> EngineSettings {
    let settings = db.get_settings().unwrap_or_default();
    let mut engine_settings = EngineSettings::from(&settings);
    if let Some(proxy) = engine_settings.proxy.as_mut() {
        proxy.password = secrets
            .get(PROXY_PASSWORD_SECRET)
            .ok()
            .flatten()
            .filter(|value| !value.is_empty());
    }
    engine_settings
}

impl Engine {
    pub fn new(db: Database, secrets: SecretVault) -> Result<Self> {
        let engine_settings = Arc::new(RwLock::new(load_engine_settings(&db, &secrets)));
        Ok(Self {
            db,
            secrets,
            settings: engine_settings,
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Builds a client per HTTP action so the redirect policy and DNS guard use
    /// the same per-node local-network decision, including after redirects.
    fn http_client(&self, allow_local: bool) -> Result<Client> {
        build_http_client(allow_local, self.settings().proxy.as_ref())
    }

    pub fn update_settings(&self, settings: EngineSettings) {
        if let Ok(mut current) = self.settings.write() {
            *current = settings;
        }
    }

    pub fn apply_settings(&self, settings: &Settings) {
        let mut engine_settings = EngineSettings::from(settings);
        if let Some(proxy) = engine_settings.proxy.as_mut() {
            proxy.password = self
                .secrets
                .get(PROXY_PASSWORD_SECRET)
                .ok()
                .flatten()
                .filter(|value| !value.is_empty());
        }
        self.update_settings(engine_settings);
    }

    pub fn settings(&self) -> EngineSettings {
        self.settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    pub fn secrets(&self) -> &SecretVault {
        &self.secrets
    }

    /// Requests cancellation for a queued or running run. Queued runs are
    /// marked cancelled before a worker can claim them; running runs are
    /// signalled through their cancellation token.
    pub fn cancel(&self, run_id: &str) -> Result<bool> {
        let requested = self.db.request_cancel(run_id)?;
        if let Ok(tokens) = self.cancellations.lock() {
            if let Some(token) = tokens.get(run_id) {
                token.cancel();
            }
        }
        Ok(requested)
    }

    /// Builds a redactor for top-level run errors. The per-step executor has its
    /// own context; this covers failures that escape before a step is created.
    fn redactor_for_run(&self, run: &Run) -> Redactor {
        let Ok(workflow) = self.db.get_workflow(&run.workflow_id) else {
            return Redactor::empty();
        };
        let Ok(names) = collect_secret_refs(&workflow.definition) else {
            return Redactor::empty();
        };
        let values = names
            .iter()
            .filter_map(|name| self.secrets.get(name).ok().flatten())
            .collect::<Vec<_>>();
        Redactor::new(values)
    }

    pub async fn execute_run(&self, run_id: &str) -> Result<Run> {
        let run = self.db.get_run(run_id)?;
        if run.status != "running" {
            return Err(CoreError::conflict("Only a running run can be executed"));
        }
        let redactor = self.redactor_for_run(&run);
        let token = CancellationToken::new();
        if let Ok(mut tokens) = self.cancellations.lock() {
            tokens.insert(run_id.to_string(), token.clone());
        }
        self.safe_log(
            "info",
            "workflow",
            Some(run_id),
            &format!("Run started for workflow '{}'", run.workflow_name),
            Some(json!({"workflowId": run.workflow_id, "trigger": run.trigger})),
            &Redactor::empty(),
        );

        let result = self.execute_inner(&run, &token).await;
        if let Ok(mut tokens) = self.cancellations.lock() {
            tokens.remove(run_id);
        }

        match result {
            Ok(output) => {
                self.db
                    .update_run_status(run_id, RunStatus::Succeeded, Some(&output), None)?;
                self.db.touch_workflow_run(&run.workflow_id)?;
                self.safe_log(
                    "info",
                    "workflow",
                    Some(run_id),
                    &format!("Run succeeded for workflow '{}'", run.workflow_name),
                    None,
                    &Redactor::empty(),
                );
            }
            Err(CoreError::Cancelled) => {
                let _ = self.db.fail_running_steps(run_id, "Run cancelled");
                self.db.update_run_status(
                    run_id,
                    RunStatus::Cancelled,
                    None,
                    Some("Run cancelled"),
                )?;
                self.safe_log(
                    "warn",
                    "workflow",
                    Some(run_id),
                    "Run cancelled",
                    None,
                    &Redactor::empty(),
                );
            }
            Err(CoreError::Timeout) => {
                let message = format!(
                    "Run timed out after {} seconds",
                    self.settings().run_timeout.as_secs().max(1)
                );
                let _ = self.db.fail_running_steps(run_id, &message);
                self.db
                    .update_run_status(run_id, RunStatus::Failed, None, Some(&message))?;
                self.safe_log(
                    "error",
                    "workflow",
                    Some(run_id),
                    &message,
                    None,
                    &Redactor::empty(),
                );
            }
            Err(error) => {
                let message = format!("Run failed: {}", redactor.redact(&error.to_string()));
                let _ = self.db.fail_running_steps(run_id, &message);
                self.db
                    .update_run_status(run_id, RunStatus::Failed, None, Some(&message))?;
                self.safe_log("error", "workflow", Some(run_id), &message, None, &redactor);
            }
        }

        self.db.get_run(run_id)
    }

    async fn execute_inner(&self, run: &Run, token: &CancellationToken) -> Result<Value> {
        let workflow = self.db.get_workflow(&run.workflow_id)?;
        let report = validation::validate_workflow(&workflow.definition);
        if !report.valid {
            let first = report
                .issues
                .iter()
                .find(|issue| issue.severity == "error")
                .map(|issue| format!("{}: {}", issue.path, issue.message))
                .unwrap_or_else(|| "invalid workflow".into());
            return Err(CoreError::validation(format!(
                "Workflow is invalid: {first}"
            )));
        }
        let trigger = workflow
            .definition
            .nodes
            .iter()
            .find(|node| node.node_type.starts_with("trigger."))
            .ok_or_else(|| CoreError::validation("Workflow has no trigger node"))?;

        let secret_names = collect_secret_refs(&workflow.definition)?;
        let mut secrets = HashMap::new();
        let mut missing = Vec::new();
        for name in &secret_names {
            match self.secrets.get(name) {
                Ok(Some(value)) => {
                    secrets.insert(name.clone(), value);
                }
                Ok(None) => missing.push(name.clone()),
                Err(error) => return Err(error),
            }
        }
        if !missing.is_empty() {
            return Err(CoreError::validation(format!(
                "Required secrets are not configured: {}",
                missing.join(", ")
            )));
        }
        let redactor = Redactor::new(secrets.values().cloned());
        let settings = self.settings();
        let mut context = ExecutionContext {
            input: &run.input,
            step_outputs: HashMap::new(),
            secrets,
            redactor,
            retry: RetryPolicy {
                attempts: settings.max_retries,
                delay: settings.retry_delay,
            },
        };

        let deadline = Instant::now() + settings.run_timeout;
        let mut current = trigger.id.clone();
        let mut completed = 0i64;
        let mut last: Option<(String, Value)>;
        let mut iterations = 0usize;

        loop {
            iterations += 1;
            if iterations > MAX_STEPS {
                return Err(CoreError::internal(
                    "Workflow exceeded the safety step limit",
                ));
            }
            self.check_interrupt(&run.id, token, deadline)?;
            let node = workflow
                .definition
                .nodes
                .iter()
                .find(|node| node.id == current)
                .cloned()
                .ok_or_else(|| CoreError::validation("Workflow edge points to a missing node"))?;

            let outcome = self
                .execute_with_retries(run, &node, &mut context, token, deadline)
                .await?;
            completed += 1;
            self.db.update_run_progress(&run.id, completed)?;
            context
                .step_outputs
                .insert(node.id.clone(), outcome.output.clone());
            last = Some((node.id.clone(), outcome.output.clone()));

            if node.node_type == "error.retry" {
                let attempts = node
                    .config
                    .get("attempts")
                    .and_then(|value| value.as_u64())
                    .map(|value| value.min(5) as u32)
                    .unwrap_or(context.retry.attempts);
                let delay = node
                    .config
                    .get("delayMs")
                    .and_then(|value| value.as_u64())
                    .map(Duration::from_millis)
                    .unwrap_or(context.retry.delay);
                context.retry = RetryPolicy { attempts, delay };
            }

            let next = next_node(&workflow.definition, &node, &outcome)?;
            match next {
                Some(next_id) => current = next_id,
                None => break,
            }
        }

        let mut steps = serde_json::Map::new();
        for (node_id, value) in &context.step_outputs {
            steps.insert(
                node_id.clone(),
                limit_value(value.clone(), MAX_STORED_OUTPUT_CHARS),
            );
        }
        let (last_node_id, last_output) =
            last.ok_or_else(|| CoreError::internal("Workflow completed without executing a node"))?;
        let output = json!({
            "lastNodeId": last_node_id,
            "result": last_output,
            "steps": steps,
        });
        Ok(context.redactor.redact_value(&output))
    }

    async fn execute_with_retries(
        &self,
        run: &Run,
        node: &WorkflowNode,
        context: &mut ExecutionContext<'_>,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<NodeOutcome> {
        let max_attempts = if is_retryable(&node.node_type) {
            context.retry.attempts + 1
        } else {
            1
        };
        let mut attempt = 1u32;
        loop {
            self.check_interrupt(&run.id, token, deadline)?;
            let step_id = self.db.create_step(&run.id, node, attempt as i64)?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let _ = self
                    .db
                    .finish_step(step_id, "failed", None, Some("Run timed out"));
                return Err(CoreError::Timeout);
            }
            let result =
                tokio::time::timeout(remaining, self.execute_node(run, node, context, token)).await;
            match result {
                Err(_) => {
                    let _ = self
                        .db
                        .finish_step(step_id, "failed", None, Some("Step timed out"));
                    return Err(CoreError::Timeout);
                }
                Ok(Err(CoreError::Cancelled)) => {
                    let _ = self
                        .db
                        .finish_step(step_id, "cancelled", None, Some("Run cancelled"));
                    return Err(CoreError::Cancelled);
                }
                Ok(Err(error)) => {
                    let message = context.redactor.redact(&error.to_string());
                    let _ = self.db.finish_step(step_id, "failed", None, Some(&message));
                    if attempt < max_attempts {
                        self.safe_log(
                            "warn",
                            "workflow",
                            Some(&run.id),
                            &format!(
                                "Step '{}' failed (attempt {attempt}/{max_attempts}): {message}",
                                node.name
                            ),
                            Some(json!({"nodeId": node.id, "nodeType": node.node_type})),
                            &context.redactor,
                        );
                        let delay = context.retry.delay.min(Duration::from_secs(60));
                        if !delay.is_zero() {
                            tokio::select! {
                                _ = token.cancelled() => return Err(CoreError::Cancelled),
                                _ = tokio::time::sleep(delay) => {}
                            }
                        }
                        if Instant::now() >= deadline {
                            return Err(CoreError::Timeout);
                        }
                        attempt += 1;
                        continue;
                    }
                    return Err(error);
                }
                Ok(Ok(outcome)) => {
                    let stored = limit_value(
                        context.redactor.redact_value(&outcome.output),
                        MAX_STORED_OUTPUT_CHARS,
                    );
                    self.db
                        .finish_step(step_id, "succeeded", Some(&stored), None)?;
                    return Ok(outcome);
                }
            }
        }
    }

    async fn execute_node(
        &self,
        run: &Run,
        node: &WorkflowNode,
        context: &ExecutionContext<'_>,
        token: &CancellationToken,
    ) -> Result<NodeOutcome> {
        match node.node_type.as_str() {
            "trigger.manual" | "trigger.schedule" => Ok(NodeOutcome {
                output: context.input.clone(),
                branch: None,
            }),
            "action.http" => Ok(NodeOutcome {
                output: self.http_action(run, node, context).await?,
                branch: None,
            }),
            "action.delay" => {
                let seconds = node
                    .config
                    .get("seconds")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(1);
                let seconds = seconds.clamp(1, 86_400);
                tokio::select! {
                    _ = token.cancelled() => return Err(CoreError::Cancelled),
                    _ = tokio::time::sleep(Duration::from_secs(seconds)) => {}
                }
                Ok(NodeOutcome {
                    output: json!({"seconds": seconds}),
                    branch: None,
                })
            }
            "action.log" => {
                let message = node
                    .config
                    .get("message")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| CoreError::validation("Log action requires a message"))?;
                let message = self.render_string(message, context)?;
                let level = node
                    .config
                    .get("level")
                    .and_then(|value| value.as_str())
                    .unwrap_or("info");
                if !["trace", "debug", "info", "warn", "error"].contains(&level) {
                    return Err(CoreError::validation("Unsupported log level"));
                }
                let message = context.redactor.redact(&message);
                self.db.insert_log(
                    level,
                    "workflow",
                    Some(&run.id),
                    &message,
                    Some(&json!({"nodeId": node.id})),
                )?;
                Ok(NodeOutcome {
                    output: json!({"message": message, "level": level}),
                    branch: None,
                })
            }
            "action.account_check" => {
                let account_id = node
                    .config
                    .get("accountId")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| CoreError::validation("Account check requires an account"))?;
                let account_id = self.render_string(account_id, context)?;
                let fail_if_inactive = node
                    .config
                    .get("failIfInactive")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let output = match self.db.get_account(&account_id) {
                    Ok(account) => {
                        let active = account.status == "active";
                        if fail_if_inactive && !active {
                            return Err(CoreError::validation(format!(
                                "Account '{}' is not active (status: {})",
                                account.name, account.status
                            )));
                        }
                        json!({
                            "accountId": account.id,
                            "name": account.name,
                            "provider": account.provider,
                            "status": account.status,
                            "exists": true,
                            "active": active,
                        })
                    }
                    Err(CoreError::NotFound(_)) => {
                        if fail_if_inactive {
                            return Err(CoreError::validation("Selected account no longer exists"));
                        }
                        json!({
                            "accountId": account_id,
                            "exists": false,
                            "active": false,
                            "status": "missing",
                        })
                    }
                    Err(error) => return Err(error),
                };
                Ok(NodeOutcome {
                    output,
                    branch: None,
                })
            }
            "logic.condition" => {
                let left_config = node
                    .config
                    .get("left")
                    .cloned()
                    .ok_or_else(|| CoreError::validation("Condition requires a left value"))?;
                let left = self.render_value(&left_config, context)?;
                let operator = node
                    .config
                    .get("operator")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| CoreError::validation("Condition requires an operator"))?;
                let right = match node.config.get("right") {
                    Some(value) => Some(self.render_value(value, context)?),
                    None => None,
                };
                let result = evaluate_condition(operator, &left, right.as_ref())?;
                Ok(NodeOutcome {
                    output: json!({
                        "result": result,
                        "operator": operator,
                        "left": left,
                        "right": right,
                    }),
                    branch: Some(if result {
                        "true".into()
                    } else {
                        "false".into()
                    }),
                })
            }
            "transform.template" => {
                let template = node
                    .config
                    .get("template")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| CoreError::validation("Transform requires a template"))?;
                let rendered = self.render_string(template, context)?;
                let format = node
                    .config
                    .get("format")
                    .and_then(|value| value.as_str())
                    .unwrap_or("text");
                if format == "json" {
                    let value = serde_json::from_str(&rendered)
                        .map_err(|_| CoreError::validation("Transform output is not valid JSON"))?;
                    Ok(NodeOutcome {
                        output: value,
                        branch: None,
                    })
                } else {
                    Ok(NodeOutcome {
                        output: Value::String(rendered),
                        branch: None,
                    })
                }
            }
            "error.retry" => Ok(NodeOutcome {
                output: json!({
                    "attempts": context.retry.attempts,
                    "delayMs": context.retry.delay.as_millis() as u64,
                }),
                branch: None,
            }),
            other => Err(CoreError::validation(format!(
                "Unsupported node type: {other}"
            ))),
        }
    }

    async fn http_action(
        &self,
        run: &Run,
        node: &WorkflowNode,
        context: &ExecutionContext<'_>,
    ) -> Result<Value> {
        let method_text = node
            .config
            .get("method")
            .and_then(|value| value.as_str())
            .unwrap_or("GET")
            .to_uppercase();
        let method = Method::from_bytes(method_text.as_bytes())
            .map_err(|_| CoreError::validation("Unsupported HTTP method"))?;
        let url_template = node
            .config
            .get("url")
            .and_then(|value| value.as_str())
            .ok_or_else(|| CoreError::validation("HTTP action requires a URL"))?;
        let url_text = self.render_string(url_template, context)?;
        let node_allows_local = node
            .config
            .get("allowLocal")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let allow_local = node_allows_local
            && self
                .settings
                .read()
                .map(|s| s.allow_local_network)
                .unwrap_or(false);
        let url = validation::validate_http_url(&url_text, allow_local)?;
        if self.settings().proxy.is_some() && !allow_local {
            ensure_proxy_target_is_public(&url).await?;
        }
        let client = self.http_client(allow_local)?;

        let mut request = client.request(method.clone(), url.clone());
        let has_content_type = node
            .config
            .get("headers")
            .and_then(|value| value.as_object())
            .map(|headers| {
                headers
                    .keys()
                    .any(|key| key.eq_ignore_ascii_case("content-type"))
            })
            .unwrap_or(false);
        if let Some(headers) = node
            .config
            .get("headers")
            .and_then(|value| value.as_object())
        {
            for (name, value) in headers {
                let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| {
                        CoreError::validation(format!("Invalid HTTP header name: {name}"))
                    })?;
                let rendered = self.render_value(value, context)?;
                let header_value = display_value(&rendered);
                let header_value =
                    reqwest::header::HeaderValue::from_str(&header_value).map_err(|_| {
                        CoreError::validation(format!("Invalid value for HTTP header {name}"))
                    })?;
                request = request.header(header_name, header_value);
            }
        }

        if method != Method::GET && method != Method::HEAD {
            if let Some(body) = node.config.get("body") {
                let (body_text, is_json) = match body {
                    Value::String(template) => (self.render_string(template, context)?, false),
                    other => (
                        serde_json::to_string(&self.render_value(other, context)?)?,
                        true,
                    ),
                };
                if is_json && !has_content_type {
                    request = request.header(reqwest::header::CONTENT_TYPE, "application/json");
                }
                request = request.body(body_text);
            }
        }

        let timeout = node
            .config
            .get("timeoutMs")
            .and_then(|value| value.as_u64())
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_secs(30));
        let mut response = request.timeout(timeout).send().await.map_err(|error| {
            let detail = error.without_url().to_string();
            CoreError::Http(format!("HTTP request failed: {detail}"))
        })?;

        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let mut captured_headers = serde_json::Map::new();
        for (name, value) in response.headers() {
            let raw = String::from_utf8_lossy(value.as_bytes()).to_string();
            let rendered = if crate::redaction::is_sensitive_key(name.as_str()) {
                "[REDACTED]".to_string()
            } else {
                context.redactor.redact(&raw)
            };
            captured_headers.insert(name.to_string(), Value::String(rendered));
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| CoreError::Http(format!("Unable to read HTTP response: {error}")))?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(CoreError::Http(
                    "HTTP response exceeded the 1 MB limit".into(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let text = String::from_utf8_lossy(&bytes).to_string();
        let body_value = if content_type.contains("application/json") {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()))
        } else {
            Value::String(text.clone())
        };
        let body_value = limit_value(
            context.redactor.redact_value(&body_value),
            MAX_RESPONSE_BYTES / 2,
        );

        if !status.is_success() {
            self.safe_log(
                "warn",
                "workflow",
                Some(&run.id),
                &format!(
                    "HTTP {} returned by {}",
                    status.as_u16(),
                    url.host_str().unwrap_or("host")
                ),
                Some(json!({"status": status.as_u16(), "body": body_value})),
                &context.redactor,
            );
            return Err(CoreError::Http(format!(
                "HTTP {} returned by {}",
                status.as_u16(),
                url.host_str().unwrap_or("host")
            )));
        }

        Ok(json!({
            "status": status.as_u16(),
            "headers": captured_headers,
            "body": body_value,
        }))
    }

    fn check_interrupt(
        &self,
        run_id: &str,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<()> {
        if token.is_cancelled() || self.db.cancel_requested(run_id)? {
            return Err(CoreError::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(CoreError::Timeout);
        }
        Ok(())
    }

    fn resolve_reference(&self, reference: &str, context: &ExecutionContext<'_>) -> Result<Value> {
        let parts: Vec<&str> = reference
            .split('.')
            .filter(|part| !part.is_empty())
            .collect();
        if parts.len() < 2 {
            return Err(CoreError::validation(format!(
                "Invalid template reference: {reference}"
            )));
        }
        let missing =
            || CoreError::validation(format!("Template reference is not available: {reference}"));
        match parts[0] {
            "input" => lookup(context.input, &parts[1..])
                .cloned()
                .ok_or_else(missing),
            "steps" => {
                let node_id = parts[1];
                let output = context.step_outputs.get(node_id).ok_or_else(missing)?;
                lookup(output, &parts[2..]).cloned().ok_or_else(missing)
            }
            "secrets" => {
                let name = parts[1..].join(".");
                context
                    .secrets
                    .get(&name)
                    .map(|value| Value::String(value.clone()))
                    .ok_or_else(missing)
            }
            _ => Err(CoreError::validation(format!(
                "Unknown template namespace: {}",
                parts[0]
            ))),
        }
    }

    fn render_string(&self, template: &str, context: &ExecutionContext<'_>) -> Result<String> {
        if let Some(captures) = exact_template().captures(template) {
            let value = self.resolve_reference(&captures[1], context)?;
            return Ok(display_value(&value));
        }
        let mut output = String::new();
        let mut last = 0;
        for captures in template_pattern().captures_iter(template) {
            let whole = captures.get(0).expect("whole match");
            output.push_str(&template[last..whole.start()]);
            let value = self.resolve_reference(&captures[1], context)?;
            output.push_str(&display_value(&value));
            last = whole.end();
        }
        output.push_str(&template[last..]);
        Ok(output)
    }

    fn render_value(&self, value: &Value, context: &ExecutionContext<'_>) -> Result<Value> {
        match value {
            Value::String(text) => {
                if let Some(captures) = exact_template().captures(text) {
                    self.resolve_reference(&captures[1], context)
                } else {
                    Ok(Value::String(self.render_string(text, context)?))
                }
            }
            Value::Array(items) => Ok(Value::Array(
                items
                    .iter()
                    .map(|item| self.render_value(item, context))
                    .collect::<Result<Vec<_>>>()?,
            )),
            Value::Object(map) => {
                let mut out = serde_json::Map::new();
                for (key, item) in map {
                    out.insert(key.clone(), self.render_value(item, context)?);
                }
                Ok(Value::Object(out))
            }
            other => Ok(other.clone()),
        }
    }

    fn safe_log(
        &self,
        level: &str,
        scope: &str,
        run_id: Option<&str>,
        message: &str,
        details: Option<Value>,
        redactor: &Redactor,
    ) {
        let message = redactor.redact(message);
        let details = details.map(|value| redactor.redact_value(&value));
        let _ = self
            .db
            .insert_log(level, scope, run_id, &message, details.as_ref());
    }
}

fn is_retryable(node_type: &str) -> bool {
    matches!(node_type, "action.http" | "action.account_check")
}

fn next_node(
    definition: &WorkflowDefinition,
    node: &WorkflowNode,
    outcome: &NodeOutcome,
) -> Result<Option<String>> {
    let outgoing: Vec<_> = definition
        .edges
        .iter()
        .filter(|edge| edge.from == node.id)
        .collect();
    if node.node_type == "logic.condition" {
        let branch = outcome.branch.as_deref().unwrap_or("true");
        return Ok(outgoing
            .iter()
            .find(|edge| edge.branch.as_deref().unwrap_or("true") == branch)
            .map(|edge| edge.to.clone()));
    }
    if outgoing.len() > 1 {
        return Err(CoreError::validation(
            "Node has multiple outgoing edges without a condition",
        ));
    }
    Ok(outgoing.first().map(|edge| edge.to.clone()))
}

fn evaluate_condition(operator: &str, left: &Value, right: Option<&Value>) -> Result<bool> {
    let left_text = display_value(left);
    match operator {
        "equals" => Ok(values_equal(left, right.unwrap_or(&Value::Null))),
        "not_equals" => Ok(!values_equal(left, right.unwrap_or(&Value::Null))),
        "contains" => Ok(left_text.contains(&display_value(right.unwrap_or(&Value::Null)))),
        "not_contains" => Ok(!left_text.contains(&display_value(right.unwrap_or(&Value::Null)))),
        "exists" => Ok(left != &Value::Null),
        "empty" => Ok(matches!(left, Value::Null)
            || matches!(left, Value::String(text) if text.is_empty())
            || matches!(left, Value::Array(items) if items.is_empty())
            || matches!(left, Value::Object(map) if map.is_empty())),
        "gt" | "gte" | "lt" | "lte" => {
            let left_number = left
                .as_f64()
                .or_else(|| left_text.parse::<f64>().ok())
                .ok_or_else(|| CoreError::validation("Condition left value must be numeric"))?;
            let right_text = display_value(right.unwrap_or(&Value::Null));
            let right_number = right
                .and_then(|value| value.as_f64())
                .or_else(|| right_text.parse::<f64>().ok())
                .ok_or_else(|| CoreError::validation("Condition right value must be numeric"))?;
            Ok(match operator {
                "gt" => left_number > right_number,
                "gte" => left_number >= right_number,
                "lt" => left_number < right_number,
                _ => left_number <= right_number,
            })
        }
        other => Err(CoreError::validation(format!(
            "Unsupported condition operator: {other}"
        ))),
    }
}

fn values_equal(left: &Value, right: &Value) -> bool {
    if let (Some(left), Some(right)) = (left.as_f64(), right.as_f64()) {
        return (left - right).abs() < f64::EPSILON;
    }
    if left.is_boolean() || right.is_boolean() {
        return left.as_bool() == right.as_bool();
    }
    display_value(left) == display_value(right)
}

fn display_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn lookup<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = root;
    for part in path {
        if part.is_empty() {
            return None;
        }
        if let Ok(index) = part.parse::<usize>() {
            current = current.as_array()?.get(index)?;
        } else {
            current = current.get(*part)?;
        }
    }
    Some(current)
}

fn collect_secret_refs(definition: &WorkflowDefinition) -> Result<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    for node in &definition.nodes {
        let text = serde_json::to_string(&node.config)?;
        for captures in template_pattern().captures_iter(&text) {
            let reference = &captures[1];
            let parts: Vec<&str> = reference
                .split('.')
                .filter(|part| !part.is_empty())
                .collect();
            if parts.len() >= 2 && parts[0] == "secrets" {
                let name = parts[1..].join(".");
                validation::validate_secret_name(&name)?;
                names.insert(name);
            }
        }
    }
    Ok(names)
}

fn template_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}").expect("static template regex")
    })
}

fn exact_template() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$").expect("static template regex")
    })
}

fn limit_value(value: Value, max_chars: usize) -> Value {
    match value {
        Value::String(text) => {
            if text.chars().count() > max_chars {
                Value::String(format!(
                    "{}… [truncated]",
                    text.chars().take(max_chars).collect::<String>()
                ))
            } else {
                Value::String(text)
            }
        }
        Value::Array(items) => {
            let mut out: Vec<Value> = items
                .into_iter()
                .take(200)
                .map(|item| limit_value(item, max_chars))
                .collect();
            if out.len() == 200 {
                out.push(Value::String("[additional items omitted]".into()));
            }
            Value::Array(out)
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (index, (key, item)) in map.into_iter().enumerate() {
                if index >= 200 {
                    out.insert("__truncated".into(), Value::Bool(true));
                    break;
                }
                out.insert(key, limit_value(item, max_chars));
            }
            Value::Object(out)
        }
        other => other,
    }
}

/// Claims queued runs and executes them with bounded concurrency. The desktop
/// shell spawns this once at startup and wakes it after enqueueing a run.
#[derive(Clone)]
pub struct RunExecutor {
    engine: Engine,
    db: Database,
    wake: Arc<Notify>,
    license: Option<crate::license::LicenseManager>,
    shutdown: CancellationToken,
}

impl RunExecutor {
    pub fn new(engine: Engine, db: Database, wake: Arc<Notify>) -> Self {
        Self {
            engine,
            db,
            wake,
            license: None,
            shutdown: CancellationToken::new(),
        }
    }

    /// Attach a license manager so queued runs (including scheduled and
    /// retried runs) cannot execute after the license expires or is removed.
    pub fn with_license(mut self, license: crate::license::LicenseManager) -> Self {
        self.license = Some(license);
        self
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn wake(&self) {
        self.wake.notify_one();
    }

    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }

    pub fn spawn(&self, concurrency: usize) -> Vec<tokio::task::JoinHandle<()>> {
        (0..concurrency.max(1))
            .map(|worker| {
                let executor = self.clone();
                tokio::spawn(async move { executor.run_worker(worker).await })
            })
            .collect()
    }

    pub async fn run_worker(&self, _worker: usize) {
        loop {
            if self.shutdown.is_cancelled() {
                break;
            }
            loop {
                if self.shutdown.is_cancelled() {
                    return;
                }
                match self.db.claim_next_queued() {
                    Ok(Some(run)) => {
                        if let Some(license) = &self.license {
                            if let Err(error) = license.require() {
                                let _ = self.db.fail_running_steps(&run.id, &error.to_string());
                                let _ = self.db.update_run_status(
                                    &run.id,
                                    RunStatus::Failed,
                                    None,
                                    Some(&error.to_string()),
                                );
                                let _ = self.db.insert_log(
                                    "warn",
                                    "license",
                                    Some(&run.id),
                                    "Run refused because the license is not valid",
                                    None,
                                );
                                continue;
                            }
                        }
                        let engine = self.engine.clone();
                        let run_id = run.id.clone();
                        let joined =
                            tokio::spawn(async move { engine.execute_run(&run_id).await }).await;
                        match joined {
                            Ok(Ok(_)) => {}
                            Ok(Err(error)) => {
                                let _ = self.db.insert_log(
                                    "error",
                                    "executor",
                                    Some(&run.id),
                                    &format!("Unable to execute run: {error}"),
                                    None,
                                );
                            }
                            Err(join_error) => {
                                let message = if join_error.is_panic() {
                                    "Run failed: worker task panicked; the run was marked failed and the worker continues"
                                } else {
                                    "Run failed: worker task was cancelled"
                                };
                                let _ = self.db.fail_running_steps(&run.id, message);
                                let _ = self.db.update_run_status(
                                    &run.id,
                                    RunStatus::Failed,
                                    None,
                                    Some(message),
                                );
                                let _ = self.db.insert_log(
                                    "error",
                                    "executor",
                                    Some(&run.id),
                                    message,
                                    None,
                                );
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = self.db.insert_log(
                            "error",
                            "executor",
                            None,
                            &format!("Unable to claim queued run: {error}"),
                            None,
                        );
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        break;
                    }
                }
            }
            tokio::select! {
                _ = self.shutdown.cancelled() => break,
                _ = self.wake.notified() => {}
            }
        }
    }
}

pub fn timestamp_now() -> String {
    now_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AccountInput, LogFilter, WorkflowEdge, WorkflowInput};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    fn setup() -> (Database, Engine) {
        let db = Database::open_in_memory().unwrap();
        let vault = SecretVault::memory(db.clone());
        let engine = Engine::new(db.clone(), vault).unwrap();
        (db, engine)
    }

    fn node(id: &str, node_type: &str, config: Value) -> WorkflowNode {
        WorkflowNode {
            id: id.into(),
            node_type: node_type.into(),
            name: id.into(),
            config,
            position: None,
        }
    }

    fn edge(id: &str, from: &str, to: &str, branch: Option<&str>) -> WorkflowEdge {
        WorkflowEdge {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            branch: branch.map(|value| value.into()),
        }
    }

    fn create_workflow(
        db: &Database,
        nodes: Vec<WorkflowNode>,
        edges: Vec<WorkflowEdge>,
    ) -> String {
        let workflow = db
            .create_workflow(&WorkflowInput {
                name: format!("Test {}", uuid::Uuid::new_v4()),
                description: String::new(),
                tags: vec![],
                enabled: true,
                definition: WorkflowDefinition {
                    schema_version: 1,
                    nodes,
                    edges,
                },
                schedule: None,
            })
            .unwrap();
        workflow.id
    }

    fn creation_error(nodes: Vec<WorkflowNode>, edges: Vec<WorkflowEdge>) -> String {
        let db = Database::open_in_memory().unwrap();
        db.create_workflow(&WorkflowInput {
            name: "Invalid".into(),
            description: String::new(),
            tags: vec![],
            enabled: true,
            definition: WorkflowDefinition {
                schema_version: 1,
                nodes,
                edges,
            },
            schedule: None,
        })
        .unwrap_err()
        .to_string()
    }

    async fn run_now(db: &Database, engine: &Engine, workflow_id: &str) -> Run {
        let run = db
            .create_run(
                workflow_id,
                "manual",
                &json!({"name": "World", "go": true, "expected": true}),
                None,
            )
            .unwrap();
        let claimed = db.claim_next_queued().unwrap().unwrap();
        assert_eq!(claimed.id, run.id);
        engine.execute_run(&run.id).await.unwrap()
    }

    #[tokio::test]
    async fn executes_a_manual_workflow_and_records_steps() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "greet",
                    "transform.template",
                    json!({"template": "Hello {{input.name}}", "format": "text"}),
                ),
                node(
                    "log",
                    "action.log",
                    json!({"message": "{{steps.greet}}", "level": "info"}),
                ),
            ],
            vec![
                edge("e1", "start", "greet", None),
                edge("e2", "greet", "log", None),
            ],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "succeeded");
        assert_eq!(run.completed_steps, 3);
        let steps = db.list_run_steps(&run.id).unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[1].output.as_ref().unwrap(), &json!("Hello World"));
        assert!(
            db.list_logs(&crate::models::LogFilter::default())
                .unwrap()
                .len()
                >= 2
        );
    }

    #[tokio::test]
    async fn condition_chooses_one_branch() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "check",
                    "logic.condition",
                    json!({"left": "{{input.go}}", "operator": "equals", "right": "{{input.expected}}"}),
                ),
                node("yes", "action.log", json!({"message": "yes"})),
                node("no", "action.log", json!({"message": "no"})),
            ],
            vec![
                edge("e1", "start", "check", None),
                edge("e2", "check", "yes", Some("true")),
                edge("e3", "check", "no", Some("false")),
            ],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "succeeded");
        let steps = db.list_run_steps(&run.id).unwrap();
        assert!(steps.iter().any(|step| step.node_id == "yes"));
        assert!(!steps.iter().any(|step| step.node_id == "no"));
    }

    #[tokio::test]
    async fn missing_secret_fails_without_leaking_other_values() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "call",
                    "action.http",
                    json!({"url": "https://example.com", "headers": {"Authorization": "Bearer {{secrets.missing}}"}}),
                ),
            ],
            vec![edge("e1", "start", "call", None)],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.unwrap().contains("missing"));
    }

    #[tokio::test]
    async fn runtime_blocks_private_network_without_opt_in() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "call",
                    "action.http",
                    json!({"url": "http://127.0.0.1:9/", "allowLocal": true}),
                ),
            ],
            vec![edge("e1", "start", "call", None)],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.unwrap().to_lowercase().contains("local"));
    }

    #[tokio::test]
    async fn guarded_resolver_drops_loopback_answers() {
        use reqwest::dns::Resolve;

        let denied = GuardedResolver { allow_local: false };
        let name: Name = "localhost".parse().unwrap();
        assert!(denied.resolve(name).await.is_err());

        let allowed = GuardedResolver { allow_local: true };
        let name: Name = "localhost".parse().unwrap();
        assert!(allowed.resolve(name).await.is_ok());
    }

    #[tokio::test]
    async fn runtime_blocks_ipv4_mapped_loopback() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "call",
                    "action.http",
                    json!({"url": "http://[::ffff:127.0.0.1]:9/", "allowLocal": true}),
                ),
            ],
            vec![edge("e1", "start", "call", None)],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.unwrap().to_lowercase().contains("local"));
    }

    #[tokio::test]
    async fn delay_is_bounded_by_the_run_timeout() {
        let (db, engine) = setup();
        engine.update_settings(EngineSettings {
            run_timeout: Duration::from_millis(150),
            ..EngineSettings::default()
        });
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node("wait", "action.delay", json!({"seconds": 5})),
            ],
            vec![edge("e1", "start", "wait", None)],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.unwrap().contains("timed out"));
    }

    #[tokio::test]
    async fn cancellation_stops_a_running_delay() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node("wait", "action.delay", json!({"seconds": 30})),
            ],
            vec![edge("e1", "start", "wait", None)],
        );
        let run = db
            .create_run(&workflow_id, "manual", &json!({}), None)
            .unwrap();
        let claimed = db.claim_next_queued().unwrap().unwrap();
        assert_eq!(claimed.id, run.id);
        let engine_clone = engine.clone();
        let id = run.id.clone();
        let handle = tokio::spawn(async move { engine_clone.execute_run(&id).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(engine.cancel(&run.id).unwrap());
        let finished = handle.await.unwrap().unwrap();
        assert_eq!(finished.status, "cancelled");
    }

    #[tokio::test]
    async fn retry_policy_recovers_from_a_transient_http_failure() {
        let (db, engine) = setup();
        engine.update_settings(EngineSettings {
            allow_local_network: true,
            run_timeout: Duration::from_secs(10),
            max_retries: 0,
            retry_delay: Duration::from_millis(50),
            proxy: None,
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let counter = Arc::new(AtomicUsize::new(0));
        let request_count = counter.clone();
        let server = tokio::spawn(async move {
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request_buffer = [0u8; 8192];
                let _ = tokio::time::timeout(
                    Duration::from_millis(500),
                    tokio::io::AsyncReadExt::read(&mut socket, &mut request_buffer),
                )
                .await;
                let index = request_count.fetch_add(1, Ordering::SeqCst);
                let (status, body) = if index == 0 {
                    ("500 Internal Server Error", "nope")
                } else {
                    ("200 OK", "{\"ok\":true}")
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
                let _ = socket.shutdown().await;
            }
        });
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "retry",
                    "error.retry",
                    json!({"attempts": 2, "delayMs": 50}),
                ),
                node(
                    "call",
                    "action.http",
                    json!({"url": format!("http://{address}/"), "allowLocal": true}),
                ),
            ],
            vec![
                edge("e1", "start", "retry", None),
                edge("e2", "retry", "call", None),
            ],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "succeeded", "{:?}", run.error);
        assert_eq!(counter.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn secrets_are_redacted_from_logs_and_step_output() {
        let (db, engine) = setup();
        engine.secrets().set("token", "super-secret-value").unwrap();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "echo",
                    "transform.template",
                    json!({"template": "Bearer {{secrets.token}}", "format": "text"}),
                ),
                node(
                    "log",
                    "action.log",
                    json!({"message": "using {{secrets.token}}"}),
                ),
            ],
            vec![
                edge("e1", "start", "echo", None),
                edge("e2", "echo", "log", None),
            ],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "succeeded");
        let steps = db.list_run_steps(&run.id).unwrap();
        let stored = serde_json::to_string(&steps).unwrap();
        assert!(!stored.contains("super-secret-value"));
        let logs = db.list_logs(&crate::models::LogFilter::default()).unwrap();
        let stored_logs = serde_json::to_string(&logs).unwrap();
        assert!(!stored_logs.contains("super-secret-value"));
    }

    #[tokio::test]
    async fn account_check_reads_real_account_state() {
        let (db, engine) = setup();
        let account = db
            .create_account(&AccountInput {
                provider: "google-flow".into(),
                name: "Main".into(),
                email: None,
                external_id: None,
                status: Some("needs_login".into()),
                favorite: None,
                tags: None,
                notes: None,
                sort_order: None,
            })
            .unwrap();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node(
                    "check",
                    "action.account_check",
                    json!({"accountId": account.id, "failIfInactive": true}),
                ),
            ],
            vec![edge("e1", "start", "check", None)],
        );
        let run = run_now(&db, &engine, &workflow_id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.unwrap().contains("not active"));
    }

    #[test]
    fn rejects_duplicate_active_idempotency_keys() {
        let db = Database::open_in_memory().unwrap();
        let workflow_id = create_workflow(
            &db,
            vec![node("start", "trigger.manual", json!({}))],
            vec![],
        );
        db.create_run(&workflow_id, "manual", &json!({}), Some("once"))
            .unwrap();
        assert!(db
            .create_run(&workflow_id, "manual", &json!({}), Some("once"))
            .is_err());
    }

    #[test]
    fn recovery_fails_interrupted_runs() {
        let db = Database::open_in_memory().unwrap();
        let workflow_id = create_workflow(
            &db,
            vec![node("start", "trigger.manual", json!({}))],
            vec![],
        );
        let run = db
            .create_run(&workflow_id, "manual", &json!({}), None)
            .unwrap();
        db.claim_next_queued().unwrap();
        assert_eq!(db.recover_interrupted().unwrap(), 1);
        let recovered = db.get_run(&run.id).unwrap();
        assert_eq!(recovered.status, "failed");
        assert!(recovered.error.unwrap().contains("restart"));
    }

    #[tokio::test]
    async fn executor_refuses_queued_runs_without_a_valid_license() {
        let (db, engine) = setup();
        let workflow_id = create_workflow(
            &db,
            vec![
                node("start", "trigger.manual", json!({})),
                node("log", "action.log", json!({"message": "should not run"})),
            ],
            vec![edge("e1", "start", "log", None)],
        );
        let run = db
            .create_run(&workflow_id, "manual", &json!({}), None)
            .unwrap();
        let license =
            crate::license::LicenseManager::with_public_key(db.clone(), vec![0u8; 32]).unwrap();
        let executor =
            RunExecutor::new(engine, db.clone(), Arc::new(Notify::new())).with_license(license);
        let worker = executor.clone();
        let handle = tokio::spawn(async move { worker.run_worker(0).await });
        for _ in 0..100 {
            if db.get_run(&run.id).unwrap().status == "failed" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        executor.shutdown();
        handle.await.unwrap();
        let stored = db.get_run(&run.id).unwrap();
        assert_eq!(stored.status, "failed");
        assert!(stored
            .error
            .unwrap()
            .to_lowercase()
            .contains("lisensi"));
        assert!(db
            .list_logs(&LogFilter::default())
            .unwrap()
            .iter()
            .any(|entry| entry.scope == "license"));
    }

    #[test]
    fn invalid_graph_is_rejected_before_execution() {
        let error = creation_error(
            vec![
                node("start", "trigger.manual", json!({})),
                node("a", "action.log", json!({"message": "a"})),
                node("b", "action.log", json!({"message": "b"})),
            ],
            vec![
                edge("e1", "start", "a", None),
                edge("e2", "a", "b", None),
                edge("e3", "b", "a", None),
            ],
        );
        assert!(error.to_lowercase().contains("cycle"));
    }
}
