use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WORKFLOW_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub sign_in_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub email: Option<String>,
    pub external_id: Option<String>,
    pub status: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub notes: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub last_checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub provider: String,
    pub name: String,
    pub email: Option<String>,
    pub external_id: Option<String>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFilter {
    pub query: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCheck {
    pub state: String,
    pub profile_path: String,
    pub file_count: u64,
    pub bytes: u64,
    pub last_modified: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(default)]
    pub config: Value,
    /// Canvas position persisted with the workflow. Optional so imported
    /// workflows without layout data still validate and execute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<NodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}

fn default_schema_version() -> u32 {
    WORKFLOW_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub definition: WorkflowDefinition,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_run_at: Option<String>,
    pub schedule: Option<Schedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub node_count: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_run_at: Option<String>,
    pub schedule: Option<Schedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub definition: WorkflowDefinition,
    #[serde(default)]
    pub schedule: Option<ScheduleInput>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub workflow_id: String,
    pub cron: String,
    pub timezone: String,
    pub enabled: bool,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub missed_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleInput {
    pub cron: String,
    pub timezone: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Missed,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Missed => "missed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "missed" => Some(Self::Missed),
            _ => None,
        }
    }

    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub workflow_id: String,
    pub workflow_name: String,
    pub status: String,
    pub trigger: String,
    pub input: Value,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub idempotency_key: Option<String>,
    pub queued_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub total_steps: i64,
    pub completed_steps: i64,
    pub cancel_requested: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStep {
    pub id: i64,
    pub run_id: String,
    pub node_id: String,
    pub node_type: String,
    pub node_name: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub attempt: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub run: Run,
    pub steps: Vec<RunStep>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFilter {
    pub status: Option<String>,
    pub workflow_id: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: i64,
    pub ts: String,
    pub level: String,
    pub scope: String,
    pub run_id: Option<String>,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilter {
    pub level: Option<String>,
    pub scope: Option<String>,
    pub run_id: Option<String>,
    pub query: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub concurrency: u32,
    pub run_timeout_seconds: u32,
    pub max_retries: u32,
    pub retry_delay_ms: u32,
    pub scheduler_enabled: bool,
    pub log_retention_days: u32,
    pub max_log_rows: u32,
    pub allow_local_network: bool,
    /// Optional explicit HTTP(S) proxy for workflow HTTP nodes and AI drafts.
    /// Proxy credentials are held in the OS keyring, never in this struct.
    pub http_proxy_url: Option<String>,
    pub http_proxy_username: Option<String>,
    /// OpenAI-compatible chat API base, for example `https://api.openai.com/v1`.
    pub ai_endpoint: String,
    pub ai_model: String,
    /// OpenAI-compatible speech API base. Defaults to the chat endpoint family.
    pub tts_endpoint: String,
    pub tts_model: String,
    pub tts_voice: String,
    /// `mp3`, `wav`, `opus`, `aac`, or `flac`.
    pub tts_format: String,
    pub tts_speed: f32,
    /// Opt-in loopback-only HTTP API. The bearer token lives in the OS keyring.
    pub local_api_enabled: bool,
    pub local_api_port: u16,
    /// HTTPS URL of a Tauri updater manifest. Empty/None disables update checks.
    pub update_endpoint: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            concurrency: 3,
            run_timeout_seconds: 300,
            max_retries: 1,
            retry_delay_ms: 1000,
            scheduler_enabled: true,
            log_retention_days: 14,
            max_log_rows: 20_000,
            allow_local_network: false,
            http_proxy_url: None,
            http_proxy_username: None,
            ai_endpoint: "https://api.openai.com/v1".into(),
            ai_model: "gpt-4o-mini".into(),
            tts_endpoint: "https://api.openai.com/v1".into(),
            tts_model: "gpt-4o-mini-tts".into(),
            tts_voice: "alloy".into(),
            tts_format: "mp3".into(),
            tts_speed: 1.0,
            local_api_enabled: false,
            local_api_port: 47821,
            update_endpoint: Some(
                "https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json".into(),
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_accounts: i64,
    pub accounts_by_provider: Vec<CountBucket>,
    pub accounts_by_status: Vec<CountBucket>,
    pub total_storyboards: i64,
    pub total_voiceover_assets: i64,
    pub total_workflows: i64,
    pub enabled_workflows: i64,
    pub queued_runs: i64,
    pub running_runs: i64,
    pub succeeded_runs: i64,
    pub failed_runs: i64,
    pub runs_last_7_days: Vec<DayCount>,
    pub recent_runs: Vec<Run>,
    pub recent_errors: Vec<LogEntry>,
    pub scheduler_enabled: bool,
    pub next_scheduled_run: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountBucket {
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub day: String,
    pub succeeded: i64,
    pub failed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub issues: Vec<ValidationIssue>,
}

impl ValidationReport {
    pub fn ok() -> Self {
        Self {
            valid: true,
            issues: vec![],
        }
    }

    pub fn from_issues(issues: Vec<ValidationIssue>) -> Self {
        Self {
            valid: issues.iter().all(|i| i.severity != "error"),
            issues,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

// ---------- Prompt library ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub category: String,
    pub pinned: bool,
    pub card_color: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptInput {
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_prompt_color")]
    pub card_color: String,
}

fn default_prompt_color() -> String {
    "default".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFilter {
    pub query: Option<String>,
    pub category: Option<String>,
}

// ---------- Declarative plugin packs ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: Option<String>,
    pub presets: Vec<PluginPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub preset_count: usize,
    pub installed_at: String,
    pub updated_at: String,
}

// ---------- License / updates ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// `open` means this build has no license public key and is not gated.
    /// `enforced` means a public key is compiled in and a valid token is required.
    pub mode: String,
    pub licensed: bool,
    pub plan: Option<String>,
    pub plan_name: Option<String>,
    pub subject: Option<String>,
    pub license_id: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub days_remaining: Option<i64>,
    pub device_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LicensePlan {
    pub id: String,
    pub name: String,
    /// Price in Indonesian rupiah.
    pub price_idr: i64,
    /// `monthly`, `yearly`, or `lifetime`.
    pub billing_period: String,
    /// `None` means the license does not expire.
    pub duration_days: Option<u32>,
    pub description: String,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDraft {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub definition: WorkflowDefinition,
    pub validation: ValidationReport,
}

// ---------- Provider web tools ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub account_provider: String,
    pub url: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub kind: String,
    pub schema_version: u32,
    pub total: usize,
    pub valid: usize,
    pub duplicates: usize,
    pub errors: Vec<ValidationIssue>,
    pub items: Vec<ImportPreviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewItem {
    pub key: String,
    pub label: String,
    pub duplicate: bool,
    pub action: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DuplicateStrategy {
    Skip,
    Replace,
    Duplicate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub replaced: usize,
    pub errors: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_dir: String,
    pub database_path: String,
    pub database_bytes: u64,
    pub schema_version: i64,
    pub backup_dir: String,
    pub secret_store: String,
    pub app_version: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub bytes: u64,
    pub created_at: String,
    pub integrity: String,
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
