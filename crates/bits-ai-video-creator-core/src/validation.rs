use crate::error::{CoreError, Result};
use crate::models::{
    AccountInput, LogFilter, RunFilter, ScheduleInput, Settings, ValidationIssue,
    WorkflowDefinition, WorkflowEdge, WorkflowInput, WorkflowNode,
};
use crate::providers;
use chrono::Utc;
use chrono_tz::Tz;
use std::collections::{HashMap, HashSet, VecDeque};
use std::str::FromStr;
use url::Url;

pub const ACCOUNT_STATUSES: &[&str] = &["active", "needs_login", "disabled", "error"];
pub const MAX_WORKFLOW_BYTES: usize = 2 * 1024 * 1024;
pub const NODE_TYPES: &[&str] = &[
    "trigger.manual",
    "trigger.schedule",
    "action.http",
    "action.delay",
    "action.log",
    "action.account_check",
    "logic.condition",
    "transform.template",
    "error.retry",
];

pub fn normalize_name(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn issue(path: impl Into<String>, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        path: path.into(),
        message: message.into(),
        severity: "error".into(),
    }
}

fn warning(path: impl Into<String>, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        path: path.into(),
        message: message.into(),
        severity: "warning".into(),
    }
}

pub fn validate_account(input: &AccountInput) -> Result<()> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(CoreError::validation(
            "Account name must be between 1 and 80 characters",
        ));
    }
    if !providers::is_supported(&input.provider) {
        return Err(CoreError::validation("Unsupported account provider"));
    }
    if let Some(status) = &input.status {
        if !ACCOUNT_STATUSES.contains(&status.as_str()) {
            return Err(CoreError::validation("Unsupported account status"));
        }
    }
    if let Some(email) = &input.email {
        let email = email.trim();
        if !email.is_empty()
            && (email.len() > 254 || !email.contains('@') || email.starts_with('@'))
        {
            return Err(CoreError::validation("Enter a valid email address"));
        }
    }
    if let Some(external_id) = &input.external_id {
        if external_id.chars().count() > 200 {
            return Err(CoreError::validation("External account id is too long"));
        }
    }
    if let Some(tags) = &input.tags {
        if tags.len() > 20 {
            return Err(CoreError::validation("Use at most 20 tags"));
        }
        let mut seen = HashSet::new();
        for tag in tags {
            let trimmed = tag.trim();
            if trimmed.is_empty() || trimmed.chars().count() > 40 {
                return Err(CoreError::validation("Tags must be 1–40 characters"));
            }
            if !seen.insert(trimmed.to_lowercase()) {
                return Err(CoreError::validation("Tags must be unique"));
            }
        }
    }
    if let Some(notes) = &input.notes {
        if notes.chars().count() > 2000 {
            return Err(CoreError::validation(
                "Notes are limited to 2,000 characters",
            ));
        }
    }
    if let Some(order) = input.sort_order {
        if !(0..=1_000_000).contains(&order) {
            return Err(CoreError::validation("Invalid account order"));
        }
    }
    Ok(())
}

pub fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .filter(|t| seen.insert(t.to_lowercase()))
        .take(20)
        .collect()
}

pub fn validate_log_filter(filter: &LogFilter) -> Result<()> {
    if let Some(level) = &filter.level {
        if !["trace", "debug", "info", "warn", "error"].contains(&level.as_str()) {
            return Err(CoreError::validation("Unsupported log level"));
        }
    }
    if filter.limit.unwrap_or(100) > 500 {
        return Err(CoreError::validation("Log limit cannot exceed 500"));
    }
    Ok(())
}

pub fn validate_run_filter(filter: &RunFilter) -> Result<()> {
    if let Some(status) = &filter.status {
        if ![
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled",
            "missed",
        ]
        .contains(&status.as_str())
        {
            return Err(CoreError::validation("Unsupported run status"));
        }
    }
    if filter.limit.unwrap_or(50) > 200 {
        return Err(CoreError::validation("Run limit cannot exceed 200"));
    }
    Ok(())
}

pub fn validate_settings(settings: &Settings) -> Result<()> {
    if !["dark", "light", "system"].contains(&settings.theme.as_str()) {
        return Err(CoreError::validation(
            "Theme must be dark, light, or system",
        ));
    }
    if !(1..=8).contains(&settings.concurrency) {
        return Err(CoreError::validation("Concurrency must be between 1 and 8"));
    }
    if !(5..=3600).contains(&settings.run_timeout_seconds) {
        return Err(CoreError::validation(
            "Run timeout must be between 5 and 3,600 seconds",
        ));
    }
    if settings.max_retries > 5 {
        return Err(CoreError::validation("Retries must be between 0 and 5"));
    }
    if !(100..=60_000).contains(&settings.retry_delay_ms) {
        return Err(CoreError::validation(
            "Retry delay must be between 100 and 60,000 ms",
        ));
    }
    if !(1..=365).contains(&settings.log_retention_days) {
        return Err(CoreError::validation(
            "Log retention must be between 1 and 365 days",
        ));
    }
    if !(1_000..=100_000).contains(&settings.max_log_rows) {
        return Err(CoreError::validation(
            "Log row cap must be between 1,000 and 100,000",
        ));
    }
    if let Some(proxy) = settings
        .http_proxy_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_http_proxy_url(proxy)?;
    }
    if let Some(username) = &settings.http_proxy_username {
        if username.chars().count() > 200 || username.contains(['\r', '\n', '\0']) {
            return Err(CoreError::validation("Proxy username is invalid"));
        }
    }
    validate_ai_endpoint(&settings.ai_endpoint, settings.allow_local_network)?;
    if settings.ai_model.trim().is_empty() || settings.ai_model.chars().count() > 100 {
        return Err(CoreError::validation(
            "AI model name must be between 1 and 100 characters",
        ));
    }
    validate_ai_endpoint(&settings.tts_endpoint, settings.allow_local_network)?;
    if settings.tts_model.trim().is_empty() || settings.tts_model.chars().count() > 100 {
        return Err(CoreError::validation(
            "TTS model name must be between 1 and 100 characters",
        ));
    }
    if settings.tts_voice.trim().is_empty() || settings.tts_voice.chars().count() > 160 {
        return Err(CoreError::validation(
            "TTS voice name must be between 1 and 160 characters",
        ));
    }
    if !crate::tts::TTS_FORMATS.contains(&settings.tts_format.as_str()) {
        return Err(CoreError::validation("Unsupported TTS audio format"));
    }
    if !(0.25..=4.0).contains(&settings.tts_speed) {
        return Err(CoreError::validation(
            "TTS speed must be between 0.25 and 4.0",
        ));
    }
    if !(1024..=65535).contains(&settings.local_api_port) {
        return Err(CoreError::validation(
            "Local API port must be between 1,024 and 65,535",
        ));
    }
    if let Some(endpoint) = settings
        .update_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_update_endpoint(endpoint)?;
    }
    Ok(())
}

pub fn validate_update_endpoint(value: &str) -> Result<Url> {
    if value.chars().count() > 2048 {
        return Err(CoreError::validation("Update endpoint is too long"));
    }
    let pattern = regex::Regex::new(r"\{\{[^}]*\}\}").expect("static regex");
    let expanded = pattern.replace_all(value, "template");
    validate_public_https_url(&expanded)
}

pub fn validate_http_proxy_url(value: &str) -> Result<Url> {
    if value.chars().count() > 2048 {
        return Err(CoreError::validation("Proxy URL is too long"));
    }
    let url =
        Url::parse(value.trim()).map_err(|_| CoreError::validation("Enter a valid proxy URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::validation("Proxy URL must use http or https"));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(CoreError::validation(
            "Proxy URL must not contain credentials; use the proxy username and keyring password",
        ));
    }
    if url.host_str().is_none() {
        return Err(CoreError::validation("Proxy URL must include a host"));
    }
    if url.fragment().is_some() {
        return Err(CoreError::validation(
            "Proxy URL must not contain a fragment",
        ));
    }
    Ok(url)
}

pub fn validate_ai_endpoint(value: &str, allow_local: bool) -> Result<Url> {
    if value.chars().count() > 2048 {
        return Err(CoreError::validation("AI endpoint is too long"));
    }
    let url = Url::parse(value.trim())
        .map_err(|_| CoreError::validation("Enter a valid AI endpoint URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::validation("AI endpoint must use http or https"));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(CoreError::validation(
            "AI endpoint must not contain credentials",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::validation("AI endpoint must include a host"))?;
    if url.scheme() == "http" && !allow_local {
        return Err(CoreError::validation(
            "Plain HTTP AI endpoints require explicit local-network opt-in",
        ));
    }
    if is_local_or_private_host(host) && !allow_local {
        return Err(CoreError::validation(
            "Local/private AI endpoints require explicit local-network opt-in",
        ));
    }
    if url.fragment().is_some() {
        return Err(CoreError::validation(
            "AI endpoint must not contain a fragment",
        ));
    }
    Ok(url)
}

/// Validates a URL that must be HTTPS, credential-free, and non-local.
pub fn validate_public_https_url(value: &str) -> Result<Url> {
    let url =
        Url::parse(value.trim()).map_err(|_| CoreError::validation("Enter a valid HTTPS URL"))?;
    if url.scheme() != "https" {
        return Err(CoreError::validation("Only HTTPS URLs are allowed here"));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(CoreError::validation("URLs must not contain credentials"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::validation("URL must include a host"))?;
    if is_local_or_private_host(host) {
        return Err(CoreError::validation(
            "Local/private URLs are not allowed here",
        ));
    }
    Ok(url)
}

/// Validates a URL that may contain `{{...}}` template expressions. The
/// template placeholders are replaced with a harmless label before parsing;
/// the runtime still validates the rendered URL and every resolved address.
pub fn validate_templated_https_url(value: &str) -> Result<()> {
    if value.chars().count() > 2048 {
        return Err(CoreError::validation("URL is too long"));
    }
    let pattern = regex::Regex::new(r"\{\{[^}]*\}\}").expect("static regex");
    let expanded = pattern.replace_all(value, "template");
    validate_public_https_url(&expanded)?;
    Ok(())
}

pub fn validate_cron(expression: &str) -> Result<()> {
    let normalized = expression.trim();
    if normalized.is_empty() || normalized.chars().count() > 120 {
        return Err(CoreError::validation(
            "Cron expression is required and must be under 120 characters",
        ));
    }
    cron::Schedule::from_str(normalized)
        .map(|_| ())
        .map_err(|_| CoreError::validation("Invalid cron expression"))
}

pub fn validate_timezone(timezone: &str) -> Result<()> {
    Tz::from_str(timezone.trim())
        .map(|_| ())
        .map_err(|_| CoreError::validation("Unknown IANA timezone"))
}

pub fn validate_schedule(input: &ScheduleInput) -> Result<()> {
    validate_cron(&input.cron)?;
    validate_timezone(&input.timezone)?;
    Ok(())
}

pub fn next_cron_occurrence(
    cron_expr: &str,
    timezone: &str,
    after: chrono::DateTime<Utc>,
) -> Result<String> {
    validate_cron(cron_expr)?;
    validate_timezone(timezone)?;
    let tz =
        Tz::from_str(timezone.trim()).map_err(|_| CoreError::validation("Unknown timezone"))?;
    let local = after.with_timezone(&tz);
    let schedule = cron::Schedule::from_str(cron_expr.trim())
        .map_err(|_| CoreError::validation("Invalid cron expression"))?;
    let next = schedule
        .after(&local)
        .next()
        .ok_or_else(|| CoreError::validation("Cron expression has no future occurrence"))?;
    Ok(next
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

pub fn validate_prompt_input(input: &crate::models::PromptInput) -> Result<()> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(CoreError::validation(
            "Prompt title must be between 1 and 200 characters",
        ));
    }
    if input.prompt.trim().is_empty() || input.prompt.chars().count() > 100_000 {
        return Err(CoreError::validation(
            "Prompt must be between 1 and 100,000 characters",
        ));
    }
    if input.category.chars().count() > 100 || input.category.contains(['\r', '\n', '\0']) {
        return Err(CoreError::validation("Prompt category is invalid"));
    }
    if ![
        "default", "blue", "green", "amber", "violet", "rose", "slate",
    ]
    .contains(&input.card_color.as_str())
    {
        return Err(CoreError::validation("Unsupported prompt card color"));
    }
    Ok(())
}

pub fn validate_workflow_name(name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(CoreError::validation(
            "Workflow name must be between 1 and 100 characters",
        ));
    }
    Ok(())
}

pub fn validate_workflow_input(input: &WorkflowInput) -> Result<()> {
    let bytes = serde_json::to_vec(input)
        .map_err(|_| CoreError::validation("Workflow payload could not be serialized"))?;
    if bytes.len() > MAX_WORKFLOW_BYTES {
        return Err(CoreError::validation(
            "Workflow payload exceeds the 2 MB limit",
        ));
    }
    validate_workflow_name(&input.name)?;
    if input.description.chars().count() > 2000 {
        return Err(CoreError::validation(
            "Description is limited to 2,000 characters",
        ));
    }
    if input.tags.len() > 20 {
        return Err(CoreError::validation("Use at most 20 workflow tags"));
    }
    for tag in &input.tags {
        if tag.trim().is_empty() || tag.chars().count() > 40 {
            return Err(CoreError::validation(
                "Workflow tags must be 1–40 characters",
            ));
        }
    }
    let report = validate_workflow(&input.definition);
    if !report.valid {
        let first = report
            .issues
            .iter()
            .find(|i| i.severity == "error")
            .map(|i| format!("{}: {}", i.path, i.message))
            .unwrap_or_else(|| "Invalid workflow".into());
        return Err(CoreError::validation(first));
    }
    if let Some(schedule) = &input.schedule {
        validate_schedule(schedule)?;
    }
    Ok(())
}

pub fn validate_workflow(definition: &WorkflowDefinition) -> crate::models::ValidationReport {
    let mut issues = Vec::new();
    if definition.schema_version != crate::models::WORKFLOW_SCHEMA_VERSION {
        issues.push(issue(
            "schemaVersion",
            "Unsupported workflow schema version",
        ));
    }
    if definition.nodes.is_empty() {
        issues.push(issue("nodes", "Workflow needs at least one node"));
    }
    if definition.nodes.len() > 200 {
        issues.push(issue(
            "nodes",
            "Workflow cannot contain more than 200 nodes",
        ));
    }

    let mut node_ids = HashSet::new();
    let mut node_map: HashMap<&str, &WorkflowNode> = HashMap::new();
    for (index, node) in definition.nodes.iter().enumerate() {
        let path = format!("nodes[{index}]");
        if node.id.is_empty()
            || node.id.len() > 64
            || !node
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            issues.push(issue(
                format!("{path}.id"),
                "Node ids must be 1–64 characters: letters, numbers, - or _",
            ));
        }
        if !node_ids.insert(node.id.as_str()) {
            issues.push(issue(format!("{path}.id"), "Node ids must be unique"));
        }
        if node.name.trim().is_empty() || node.name.chars().count() > 100 {
            issues.push(issue(
                format!("{path}.name"),
                "Node name must be 1–100 characters",
            ));
        }
        if !NODE_TYPES.contains(&node.node_type.as_str()) {
            issues.push(issue(format!("{path}.type"), "Unsupported node type"));
        }
        node_map.insert(node.id.as_str(), node);
        validate_node_config(node, &path, &mut issues);
    }

    let triggers: Vec<&WorkflowNode> = definition
        .nodes
        .iter()
        .filter(|n| n.node_type.starts_with("trigger."))
        .collect();
    if triggers.len() != 1 {
        issues.push(issue(
            "nodes",
            "Workflow must have exactly one trigger node",
        ));
    }
    if triggers.len() == 1 && triggers[0].node_type == "trigger.schedule" {
        let config = &triggers[0].config;
        if config.get("cron").and_then(|v| v.as_str()).is_none() {
            issues.push(issue(
                format!("nodes.{}.config.cron", triggers[0].id),
                "Schedule trigger requires a cron expression",
            ));
        }
        if config.get("timezone").and_then(|v| v.as_str()).is_none() {
            issues.push(issue(
                format!("nodes.{}.config.timezone", triggers[0].id),
                "Schedule trigger requires a timezone",
            ));
        }
        if let (Some(cron_expr), Some(tz)) = (
            config.get("cron").and_then(|v| v.as_str()),
            config.get("timezone").and_then(|v| v.as_str()),
        ) {
            if let Err(error) = validate_cron(cron_expr) {
                issues.push(issue(
                    format!("nodes.{}.config.cron", triggers[0].id),
                    error.to_string(),
                ));
            }
            if let Err(error) = validate_timezone(tz) {
                issues.push(issue(
                    format!("nodes.{}.config.timezone", triggers[0].id),
                    error.to_string(),
                ));
            }
        }
    }

    let mut edge_ids = HashSet::new();
    let mut outgoing: HashMap<&str, Vec<&WorkflowEdge>> = HashMap::new();
    let mut incoming: HashMap<&str, Vec<&WorkflowEdge>> = HashMap::new();
    for (index, edge) in definition.edges.iter().enumerate() {
        let path = format!("edges[{index}]");
        if edge.id.is_empty() || edge.id.len() > 64 {
            issues.push(issue(
                format!("{path}.id"),
                "Edge id must be 1–64 characters",
            ));
        }
        if !edge_ids.insert(edge.id.as_str()) {
            issues.push(issue(format!("{path}.id"), "Edge ids must be unique"));
        }
        if !node_map.contains_key(edge.from.as_str()) {
            issues.push(issue(
                format!("{path}.from"),
                "Edge source node does not exist",
            ));
        }
        if !node_map.contains_key(edge.to.as_str()) {
            issues.push(issue(
                format!("{path}.to"),
                "Edge target node does not exist",
            ));
        }
        if edge.from == edge.to {
            issues.push(issue(
                path.clone(),
                "Self-referencing edges are not allowed",
            ));
        }
        if let Some(branch) = &edge.branch {
            if !["true", "false"].contains(&branch.as_str()) {
                issues.push(issue(
                    format!("{path}.branch"),
                    "Branch must be true or false",
                ));
            }
        }
        outgoing.entry(edge.from.as_str()).or_default().push(edge);
        incoming.entry(edge.to.as_str()).or_default().push(edge);
    }

    for node in &definition.nodes {
        let outs = outgoing.get(node.id.as_str()).cloned().unwrap_or_default();
        if node.node_type.starts_with("trigger.")
            && !incoming
                .get(node.id.as_str())
                .map(|v| v.is_empty())
                .unwrap_or(true)
        {
            issues.push(issue(
                format!("nodes.{}", node.id),
                "Trigger nodes cannot have incoming edges",
            ));
        }
        if node.node_type == "logic.condition" {
            if outs.len() > 2 {
                issues.push(issue(
                    format!("nodes.{}", node.id),
                    "Condition nodes can have at most two outgoing edges",
                ));
            }
            let mut branches = HashSet::new();
            for edge in &outs {
                let branch = edge.branch.as_deref().unwrap_or("true");
                if !branches.insert(branch) {
                    issues.push(issue(
                        format!("edges.{}", edge.id),
                        "Condition branches must be unique",
                    ));
                }
            }
        } else if outs.len() > 1 {
            issues.push(issue(
                format!("nodes.{}", node.id),
                "Only condition nodes can have multiple outgoing edges",
            ));
        }
    }

    if let Some(trigger) = triggers.first() {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(trigger.id.as_str());
        while let Some(id) = queue.pop_front() {
            if !visited.insert(id) {
                continue;
            }
            if let Some(edges) = outgoing.get(id) {
                for edge in edges {
                    queue.push_back(edge.to.as_str());
                }
            }
        }
        for node in &definition.nodes {
            if !visited.contains(node.id.as_str()) {
                issues.push(warning(
                    format!("nodes.{}", node.id),
                    "Node is not reachable from the trigger",
                ));
            }
        }
        if has_cycle(definition, trigger.id.as_str()) {
            issues.push(issue("edges", "Workflow graph must not contain cycles"));
        }
    }

    validate_templates(definition, &node_map, &mut issues);
    crate::models::ValidationReport::from_issues(issues)
}

fn has_cycle(definition: &WorkflowDefinition, start: &str) -> bool {
    fn visit<'a>(
        id: &'a str,
        edges: &HashMap<&'a str, Vec<&'a WorkflowEdge>>,
        visiting: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> bool {
        if done.contains(id) {
            return false;
        }
        if !visiting.insert(id) {
            return true;
        }
        if let Some(outs) = edges.get(id) {
            for edge in outs {
                if visit(edge.to.as_str(), edges, visiting, done) {
                    return true;
                }
            }
        }
        visiting.remove(id);
        done.insert(id);
        false
    }
    let mut edges: HashMap<&str, Vec<&WorkflowEdge>> = HashMap::new();
    for edge in &definition.edges {
        edges.entry(edge.from.as_str()).or_default().push(edge);
    }
    visit(start, &edges, &mut HashSet::new(), &mut HashSet::new())
}

fn validate_node_config(node: &WorkflowNode, path: &str, issues: &mut Vec<ValidationIssue>) {
    let config = &node.config;
    match node.node_type.as_str() {
        "action.http" => {
            let method = config
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();
            if !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(&method.as_str()) {
                issues.push(issue(
                    format!("{path}.config.method"),
                    "Unsupported HTTP method",
                ));
            }
            match config.get("url").and_then(|v| v.as_str()) {
                Some(url) => {
                    if let Err(error) = validate_http_url(
                        url,
                        config
                            .get("allowLocal")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                    ) {
                        issues.push(issue(format!("{path}.config.url"), error.to_string()));
                    }
                }
                None => issues.push(issue(
                    format!("{path}.config.url"),
                    "HTTP action requires a URL",
                )),
            }
            if let Some(timeout) = config.get("timeoutMs").and_then(|v| v.as_u64()) {
                if !(100..=120_000).contains(&timeout) {
                    issues.push(issue(
                        format!("{path}.config.timeoutMs"),
                        "HTTP timeout must be 100–120,000 ms",
                    ));
                }
            }
            if let Some(headers) = config.get("headers") {
                if !headers.is_object() {
                    issues.push(issue(
                        format!("{path}.config.headers"),
                        "Headers must be an object",
                    ));
                }
            }
        }
        "action.delay" => match config.get("seconds").and_then(|v| v.as_u64()) {
            Some(seconds) if (1..=86_400).contains(&seconds) => {}
            _ => issues.push(issue(
                format!("{path}.config.seconds"),
                "Delay must be 1–86,400 seconds",
            )),
        },
        "action.log" => {
            if config
                .get("message")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().is_empty())
                .unwrap_or(true)
            {
                issues.push(issue(
                    format!("{path}.config.message"),
                    "Log action requires a message",
                ));
            }
        }
        "action.account_check" => {
            if config
                .get("accountId")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().is_empty())
                .unwrap_or(true)
            {
                issues.push(issue(
                    format!("{path}.config.accountId"),
                    "Account check requires an account",
                ));
            }
        }
        "logic.condition" => {
            if config
                .get("left")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().is_empty())
                .unwrap_or(true)
            {
                issues.push(issue(
                    format!("{path}.config.left"),
                    "Condition requires a left value",
                ));
            }
            let operator = config
                .get("operator")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if ![
                "equals",
                "not_equals",
                "contains",
                "not_contains",
                "gt",
                "gte",
                "lt",
                "lte",
                "exists",
                "empty",
            ]
            .contains(&operator)
            {
                issues.push(issue(
                    format!("{path}.config.operator"),
                    "Unsupported condition operator",
                ));
            }
            if !["exists", "empty"].contains(&operator)
                && config.get("right").and_then(|v| v.as_str()).is_none()
            {
                issues.push(issue(
                    format!("{path}.config.right"),
                    "Condition requires a right value",
                ));
            }
        }
        "transform.template" => {
            if config
                .get("template")
                .and_then(|v| v.as_str())
                .map(|v| v.is_empty())
                .unwrap_or(true)
            {
                issues.push(issue(
                    format!("{path}.config.template"),
                    "Transform requires a template",
                ));
            }
            if let Some(format) = config.get("format").and_then(|v| v.as_str()) {
                if !["text", "json"].contains(&format) {
                    issues.push(issue(
                        format!("{path}.config.format"),
                        "Transform format must be text or json",
                    ));
                }
            }
        }
        "error.retry" => {
            if let Some(attempts) = config.get("attempts").and_then(|v| v.as_u64()) {
                if attempts > 5 {
                    issues.push(issue(
                        format!("{path}.config.attempts"),
                        "Retry attempts must be 0–5",
                    ));
                }
            }
            if let Some(delay) = config.get("delayMs").and_then(|v| v.as_u64()) {
                if delay > 60_000 {
                    issues.push(issue(
                        format!("{path}.config.delayMs"),
                        "Retry delay must be under 60,000 ms",
                    ));
                }
            }
        }
        _ => {}
    }
}

pub fn validate_http_url(value: &str, allow_local: bool) -> Result<Url> {
    let url = Url::parse(value.trim()).map_err(|_| CoreError::validation("Enter a valid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::validation(
            "Only http and https URLs are allowed",
        ));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(CoreError::validation("URLs must not contain credentials"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::validation("URL must include a host"))?;
    if !allow_local && is_local_or_private_host(host) {
        return Err(CoreError::validation(
            "Local/private network URLs require explicit opt-in",
        ));
    }
    Ok(url)
}

pub fn is_local_or_private_host(host: &str) -> bool {
    let host = host
        .trim()
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return is_local_or_private_ip(ip);
    }
    false
}

/// Returns true for addresses that must not be reached without an explicit
/// local-network opt-in. This covers loopback, private, link-local, CGNAT,
/// documentation, benchmark, reserved, multicast, and IPv4-mapped IPv6 forms.
pub fn is_local_or_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => is_local_or_private_v4(v4),
        std::net::IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_local_or_private_v4(v4);
            }
            let segments = v6.segments();
            // IPv4-compatible `::a.b.c.d` (deprecated but still routable).
            if segments[..6].iter().all(|segment| *segment == 0) {
                let v4 = std::net::Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                if is_local_or_private_v4(v4) {
                    return true;
                }
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
                || (segments[0] & 0xffc0) == 0xfec0 // deprecated site-local
                || (segments[0] == 0x2001 && segments[1] == 0x0db8) // documentation
                || (segments[0] == 0x0064 && segments[1] == 0xff9b) // NAT64
                || segments[0] == 0x2002 // 6to4
                || (segments[0] == 0x2001 && segments[1] == 0x0000) // Teredo
        }
    }
}

fn is_local_or_private_v4(v4: std::net::Ipv4Addr) -> bool {
    let octets = v4.octets();
    v4.is_private()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        || octets[0] == 0 // 0.0.0.0/8
        || (octets[0] == 100 && (64..=127).contains(&octets[1])) // 100.64.0.0/10
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0) // 192.0.0.0/24
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)) // 198.18.0.0/15
        || octets[0] >= 240 // 240.0.0.0/4 reserved
}

fn validate_templates(
    definition: &WorkflowDefinition,
    node_map: &HashMap<&str, &WorkflowNode>,
    issues: &mut Vec<ValidationIssue>,
) {
    let pattern = regex::Regex::new(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}").expect("static regex");
    for node in &definition.nodes {
        let text = serde_json::to_string(&node.config).unwrap_or_default();
        for capture in pattern.captures_iter(&text) {
            let reference = &capture[1];
            let parts: Vec<&str> = reference.split('.').collect();
            if parts.len() < 2 {
                issues.push(issue(
                    format!("nodes.{}.config", node.id),
                    format!("Invalid template reference {reference}"),
                ));
                continue;
            }
            match parts[0] {
                "input" => {
                    if parts[1].is_empty() {
                        issues.push(issue(
                            format!("nodes.{}.config", node.id),
                            "Invalid input reference",
                        ));
                    }
                }
                "steps" => {
                    if !node_map.contains_key(parts[1]) {
                        issues.push(issue(
                            format!("nodes.{}.config", node.id),
                            format!("Unknown step reference {reference}"),
                        ));
                    }
                }
                "secrets" => {
                    let name = parts[1..].join(".");
                    if name.is_empty()
                        || name.len() > 64
                        || !name
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
                    {
                        issues.push(issue(
                            format!("nodes.{}.config", node.id),
                            "Invalid secret reference",
                        ));
                    }
                }
                _ => issues.push(issue(
                    format!("nodes.{}.config", node.id),
                    format!("Unknown template namespace in {reference}"),
                )),
            }
        }
    }
}

pub fn validate_idempotency_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 128 {
        return Err(CoreError::validation(
            "Idempotency key must be 1–128 characters",
        ));
    }
    Ok(())
}

pub fn validate_secret_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(CoreError::validation(
            "Secret names must be 1–64 characters: letters, numbers, _, -, .",
        ));
    }
    Ok(())
}

pub fn validate_backup_path(path: &std::path::Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Err(CoreError::validation("Backup path is required"));
    }
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if extension != "db" && extension != "sqlite" && extension != "backup" {
        return Err(CoreError::validation(
            "Backup files must end with .db, .sqlite, or .backup",
        ));
    }
    Ok(())
}

pub fn today_utc() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

pub fn validate_iso_timestamp(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_and_special_ip_forms() {
        for host in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "198.18.0.1",
            "240.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "[::ffff:127.0.0.1]",
            "[::ffff:169.254.169.254]",
            "[::127.0.0.1]",
            "[64:ff9b::7f00:1]",
            "[2002:7f00:1::1]",
            "localhost",
            "app.localhost.",
        ] {
            assert!(
                is_local_or_private_host(host),
                "expected {host} to be blocked"
            );
        }
    }

    #[test]
    fn allows_public_addresses_and_names() {
        for host in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "example.com"] {
            assert!(
                !is_local_or_private_host(host),
                "expected {host} to be allowed"
            );
        }
        assert!(validate_http_url("https://example.com/path", false).is_ok());
        assert!(validate_http_url("http://[::ffff:127.0.0.1]/", false).is_err());
        assert!(validate_http_url("http://169.254.169.254/latest", false).is_err());
    }

    #[test]
    fn rejects_oversized_workflow_payloads() {
        let oversized = "x".repeat(MAX_WORKFLOW_BYTES);
        let input = WorkflowInput {
            name: "Large".into(),
            description: String::new(),
            tags: vec![],
            enabled: true,
            definition: WorkflowDefinition {
                schema_version: crate::models::WORKFLOW_SCHEMA_VERSION,
                nodes: vec![WorkflowNode {
                    id: "start".into(),
                    node_type: "trigger.manual".into(),
                    name: "Start".into(),
                    config: serde_json::json!({ "padding": oversized }),
                    position: None,
                }],
                edges: vec![],
            },
            schedule: None,
        };
        let error = validate_workflow_input(&input).unwrap_err();
        assert!(error.to_string().contains("2 MB"));
    }
}
