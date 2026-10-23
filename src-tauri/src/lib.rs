mod local_api;
#[cfg(not(target_os = "android"))]
mod updater;
#[cfg(not(target_os = "android"))]
mod webview_manager;

use bits_ai_video_creator_core::db::Database;
use bits_ai_video_creator_core::engine::{Engine, RunExecutor, PROXY_PASSWORD_SECRET};
use bits_ai_video_creator_core::error::{CoreError, Result as CoreResult};
use bits_ai_video_creator_core::import_export;
use bits_ai_video_creator_core::license::LicenseManager;
use bits_ai_video_creator_core::models::*;
use bits_ai_video_creator_core::plugins;
use bits_ai_video_creator_core::provider_tools;
use bits_ai_video_creator_core::providers;
use bits_ai_video_creator_core::scheduler::Scheduler;
use bits_ai_video_creator_core::secrets::{SecretStore, SecretVault, KEYRING_SERVICE};
use bits_ai_video_creator_core::studio::{
    self, Storyboard, StoryboardInput, StoryboardSummary, VoiceoverAsset,
};
use bits_ai_video_creator_core::tts;
use bits_ai_video_creator_core::validation;
use local_api::LocalApi;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;
#[cfg(not(target_os = "android"))]
use webview_manager::ProviderViewManager;

#[cfg(not(target_os = "android"))]
struct KeyringSecretStore;

#[cfg(not(target_os = "android"))]
fn keyring_entry(name: &str) -> CoreResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, name)
        .map_err(|error| CoreError::Secret(format!("OS credential store is unavailable: {error}")))
}

#[cfg(not(target_os = "android"))]
fn keyring_error(error: keyring::Error) -> CoreError {
    CoreError::Secret(format!("OS credential store error: {error}"))
}

#[cfg(not(target_os = "android"))]
impl SecretStore for KeyringSecretStore {
    fn get(&self, name: &str) -> CoreResult<Option<String>> {
        let entry = keyring_entry(name)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn set(&self, name: &str, value: &str) -> CoreResult<()> {
        let entry = keyring_entry(name)?;
        entry.set_password(value).map_err(keyring_error)
    }

    fn delete(&self, name: &str) -> CoreResult<()> {
        let entry = keyring_entry(name)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

#[cfg(target_os = "android")]
struct AndroidSecretStore;

#[cfg(target_os = "android")]
fn init_android_secret_store() -> CoreResult<()> {
    let store = android_native_keyring_store::Store::new()
        .map_err(|error| CoreError::Secret(format!("Android Keystore is unavailable: {error}")))?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(target_os = "android")]
fn android_keyring_entry(name: &str) -> CoreResult<keyring_core::Entry> {
    keyring_core::Entry::new(KEYRING_SERVICE, name)
        .map_err(|error| CoreError::Secret(format!("Android Keystore is unavailable: {error}")))
}

#[cfg(target_os = "android")]
fn android_keyring_error(error: keyring_core::Error) -> CoreError {
    CoreError::Secret(format!("Android Keystore error: {error}"))
}

#[cfg(target_os = "android")]
impl SecretStore for AndroidSecretStore {
    fn get(&self, name: &str) -> CoreResult<Option<String>> {
        let entry = android_keyring_entry(name)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(android_keyring_error(error)),
        }
    }

    fn set(&self, name: &str, value: &str) -> CoreResult<()> {
        let entry = android_keyring_entry(name)?;
        entry.set_password(value).map_err(android_keyring_error)
    }

    fn delete(&self, name: &str) -> CoreResult<()> {
        let entry = android_keyring_entry(name)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(android_keyring_error(error)),
        }
    }
}

struct AppState {
    db: Database,
    secrets: SecretVault,
    license: LicenseManager,
    engine: Engine,
    executor: RunExecutor,
    scheduler: Scheduler,
    local_api: LocalApi,
    data_dir: PathBuf,
    db_path: PathBuf,
    app_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretStoreStatus {
    available: bool,
    backend: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResult {
    deleted: bool,
    cleaned_up: bool,
}

fn log(state: &AppState, level: &str, scope: &str, message: &str) {
    let _ = state.db.insert_log(level, scope, None, message, None);
}

// ---------- Read-only app data ----------

#[tauri::command]
fn get_providers() -> Vec<ProviderInfo> {
    providers::providers()
}

#[tauri::command]
fn get_provider_tools() -> Vec<ProviderTool> {
    provider_tools::tools()
}

#[tauri::command]
fn get_dashboard(state: State<'_, AppState>) -> CoreResult<DashboardStats> {
    state.db.dashboard()
}

#[tauri::command]
fn get_storage_info(state: State<'_, AppState>) -> CoreResult<StorageInfo> {
    let database_bytes = std::fs::metadata(&state.db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(StorageInfo {
        data_dir: state.data_dir.to_string_lossy().to_string(),
        database_path: state.db_path.to_string_lossy().to_string(),
        database_bytes,
        schema_version: state.db.schema_version()?,
        backup_dir: state.data_dir.join("backups").to_string_lossy().to_string(),
        secret_store: "OS credential store".into(),
        app_version: state.app_version.clone(),
        platform: std::env::consts::OS.to_string(),
    })
}

#[tauri::command]
fn get_secret_store_status(state: State<'_, AppState>) -> SecretStoreStatus {
    match state.secrets.get("__bits-ai-video-creator_healthcheck__") {
        Ok(_) => SecretStoreStatus {
            available: true,
            backend: "OS credential store".into(),
            message: "Secrets are stored in the operating system credential vault.".into(),
        },
        Err(error) => SecretStoreStatus {
            available: false,
            backend: "OS credential store".into(),
            message: error.to_string(),
        },
    }
}

// ---------- Accounts ----------

#[tauri::command]
fn list_accounts(
    state: State<'_, AppState>,
    filter: Option<AccountFilter>,
) -> CoreResult<Vec<Account>> {
    state.db.list_accounts(&filter.unwrap_or_default())
}

#[tauri::command]
fn get_account(state: State<'_, AppState>, id: String) -> CoreResult<Account> {
    state.db.get_account(&id)
}

#[tauri::command]
fn create_account(state: State<'_, AppState>, input: AccountInput) -> CoreResult<Account> {
    let account = state.db.create_account(&input)?;
    log(
        &state,
        "info",
        "accounts",
        &format!("Added account '{}'", account.name),
    );
    Ok(account)
}

#[tauri::command]
fn update_account(
    state: State<'_, AppState>,
    id: String,
    input: AccountInput,
) -> CoreResult<Account> {
    state.db.update_account(&id, &input)
}

#[tauri::command]
fn set_account_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> CoreResult<Account> {
    state.db.set_account_favorite(&id, favorite)
}

#[tauri::command]
fn set_account_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> CoreResult<Account> {
    state.db.set_account_status(&id, &status)
}

#[tauri::command]
#[allow(unused_variables)]
fn delete_account(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    confirm_name: String,
) -> CoreResult<DeleteResult> {
    let account = state.db.get_account(&id)?;
    if !account
        .name
        .trim()
        .eq_ignore_ascii_case(confirm_name.trim())
    {
        return Err(CoreError::validation(
            "Type the account name to confirm deletion",
        ));
    }
    state.db.delete_account(&id)?;
    #[cfg(not(target_os = "android"))]
    let cleaned_up = match webview_manager::remove_account(&app, &state.data_dir, &id) {
        Ok(value) => value,
        Err(error) => {
            log(
                &state,
                "warn",
                "accounts",
                &format!("Provider profile cleanup failed: {error}"),
            );
            false
        }
    };
    #[cfg(target_os = "android")]
    let cleaned_up = true;
    log(
        &state,
        "info",
        "accounts",
        &format!("Deleted account '{}'", account.name),
    );
    Ok(DeleteResult {
        deleted: true,
        cleaned_up,
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn check_account_profile(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<ProfileCheck, String> {
    webview_manager::profile_check(&state.data_dir, &account_id)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn check_account_profile(
    _state: State<'_, AppState>,
    _account_id: String,
) -> Result<ProfileCheck, String> {
    Ok(ProfileCheck {
        state: "unavailable".into(),
        profile_path: String::new(),
        file_count: 0,
        bytes: 0,
        last_modified: None,
        message: "Isolated provider webviews are not available in the Android build yet. Use the provider URL in your system browser.".into(),
    })
}

// ---------- Provider views ----------

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn open_provider_view(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    bounds: webview_manager::Bounds,
) -> Result<webview_manager::ProviderViewInfo, String> {
    webview_manager::open(&app, &state.db, &state.data_dir, &account_id, bounds)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn open_provider_view(
    _app: AppHandle,
    _state: State<'_, AppState>,
    _account_id: String,
    _bounds: serde_json::Value,
) -> Result<(), String> {
    Err("Isolated provider webviews are not available in the Android build. Open the provider URL in your system browser.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn open_provider_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    tool_id: String,
    bounds: webview_manager::Bounds,
) -> Result<webview_manager::ProviderViewInfo, String> {
    webview_manager::open_tool(
        &app,
        &state.db,
        &state.data_dir,
        &account_id,
        &tool_id,
        bounds,
    )
}

#[cfg(target_os = "android")]
#[tauri::command]
fn open_provider_tool(
    _app: AppHandle,
    _state: State<'_, AppState>,
    _account_id: String,
    _tool_id: String,
    _bounds: serde_json::Value,
) -> Result<(), String> {
    Err("Isolated provider webviews are not available in the Android build. Open the provider URL in your system browser.".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn close_provider_view(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<ProviderViewManager>();
    webview_manager::close(&app, &manager)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn close_provider_view(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn resize_provider_view(app: AppHandle, bounds: webview_manager::Bounds) -> Result<(), String> {
    let manager = app.state::<ProviderViewManager>();
    webview_manager::resize(&app, &manager, bounds)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn resize_provider_view(_app: AppHandle, _bounds: serde_json::Value) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn reload_provider_view(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<ProviderViewManager>();
    webview_manager::reload(&app, &manager)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn reload_provider_view(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn get_provider_view(app: AppHandle) -> Option<webview_manager::ProviderViewInfo> {
    app.state::<ProviderViewManager>().active_info()
}

#[cfg(target_os = "android")]
#[tauri::command]
fn get_provider_view(_app: AppHandle) -> Option<serde_json::Value> {
    None
}

// ---------- Workflows ----------

#[tauri::command]
fn list_workflows(state: State<'_, AppState>) -> CoreResult<Vec<WorkflowSummary>> {
    state.db.list_workflows()
}

#[tauri::command]
fn get_workflow(state: State<'_, AppState>, id: String) -> CoreResult<Workflow> {
    state.db.get_workflow(&id)
}

#[tauri::command]
fn create_workflow(state: State<'_, AppState>, input: WorkflowInput) -> CoreResult<Workflow> {
    let workflow = state.db.create_workflow(&input)?;
    log(
        &state,
        "info",
        "workflows",
        &format!("Created workflow '{}'", workflow.name),
    );
    Ok(workflow)
}

#[tauri::command]
fn update_workflow(
    state: State<'_, AppState>,
    id: String,
    input: WorkflowInput,
) -> CoreResult<Workflow> {
    let workflow = state.db.update_workflow(&id, &input)?;
    log(
        &state,
        "info",
        "workflows",
        &format!(
            "Updated workflow '{}' to version {}",
            workflow.name, workflow.version
        ),
    );
    Ok(workflow)
}

#[tauri::command]
fn duplicate_workflow(state: State<'_, AppState>, id: String) -> CoreResult<Workflow> {
    let workflow = state.db.duplicate_workflow(&id)?;
    log(
        &state,
        "info",
        "workflows",
        &format!("Duplicated workflow '{}'", workflow.name),
    );
    Ok(workflow)
}

#[tauri::command]
fn delete_workflow(
    state: State<'_, AppState>,
    id: String,
    confirm_name: String,
) -> CoreResult<DeleteResult> {
    let workflow = state.db.get_workflow(&id)?;
    if !workflow
        .name
        .trim()
        .eq_ignore_ascii_case(confirm_name.trim())
    {
        return Err(CoreError::validation(
            "Type the workflow name to confirm deletion",
        ));
    }
    state.db.delete_workflow(&id)?;
    log(
        &state,
        "info",
        "workflows",
        &format!("Deleted workflow '{}'", workflow.name),
    );
    Ok(DeleteResult {
        deleted: true,
        cleaned_up: true,
    })
}

#[tauri::command]
fn set_workflow_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> CoreResult<()> {
    state.db.set_workflow_enabled(&id, enabled)
}

#[tauri::command]
fn validate_workflow_definition(definition: WorkflowDefinition) -> ValidationReport {
    validation::validate_workflow(&definition)
}

#[tauri::command]
fn list_schedules(state: State<'_, AppState>) -> CoreResult<Vec<Schedule>> {
    state.db.list_schedules()
}

// ---------- Runs ----------

#[tauri::command]
fn run_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
    input: Option<Value>,
    idempotency_key: Option<String>,
) -> CoreResult<Run> {
    state.license.require()?;
    let input = input.unwrap_or_else(|| json!({}));
    if serde_json::to_vec(&input)?.len() > 262_144 {
        return Err(CoreError::validation("Run input is limited to 256 KB"));
    }
    let key = idempotency_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    let run = state.db.create_run(&workflow_id, "manual", &input, key)?;
    state.executor.wake();
    Ok(run)
}

#[tauri::command]
fn cancel_run(state: State<'_, AppState>, id: String) -> CoreResult<bool> {
    let cancelled = state.engine.cancel(&id)?;
    if cancelled {
        log(
            &state,
            "warn",
            "workflow",
            &format!("Cancellation requested for run {id}"),
        );
    }
    Ok(cancelled)
}

#[tauri::command]
fn retry_run(state: State<'_, AppState>, id: String) -> CoreResult<Run> {
    state.license.require()?;
    let run = state.db.retry_run(&id)?;
    state.executor.wake();
    Ok(run)
}

#[tauri::command]
fn list_runs(state: State<'_, AppState>, filter: Option<RunFilter>) -> CoreResult<Vec<Run>> {
    state.db.list_runs(&filter.unwrap_or_default())
}

#[tauri::command]
fn get_run(state: State<'_, AppState>, id: String) -> CoreResult<RunDetail> {
    state.db.get_run_detail(&id)
}

#[tauri::command]
fn list_logs(state: State<'_, AppState>, filter: Option<LogFilter>) -> CoreResult<Vec<LogEntry>> {
    state.db.list_logs(&filter.unwrap_or_default())
}

#[tauri::command]
fn clear_logs(state: State<'_, AppState>, confirm: bool) -> CoreResult<usize> {
    if !confirm {
        return Err(CoreError::validation(
            "Confirm log deletion before continuing",
        ));
    }
    state.db.clear_logs()
}

// ---------- Settings and secrets ----------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> CoreResult<Settings> {
    state.db.get_settings()
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, settings: Settings) -> CoreResult<Settings> {
    let updated = state.db.update_settings(&settings)?;
    state.engine.apply_settings(&updated);
    state.local_api.reconfigure(&updated);
    log(&state, "info", "settings", "Application settings updated");
    Ok(updated)
}

#[tauri::command]
fn list_secrets(state: State<'_, AppState>) -> CoreResult<Vec<SecretRef>> {
    state.secrets.list()
}

#[tauri::command]
fn set_secret(state: State<'_, AppState>, name: String, value: String) -> CoreResult<SecretRef> {
    let reference = state.secrets.set(&name, &value)?;
    log(
        &state,
        "info",
        "secrets",
        &format!("Stored secret '{}'", reference.name),
    );
    Ok(reference)
}

#[tauri::command]
fn delete_secret(state: State<'_, AppState>, name: String, confirm_name: String) -> CoreResult<()> {
    if name != confirm_name {
        return Err(CoreError::validation(
            "Type the secret name to confirm deletion",
        ));
    }
    state.secrets.delete(&name)?;
    log(
        &state,
        "info",
        "secrets",
        &format!("Deleted secret '{name}'"),
    );
    Ok(())
}

#[tauri::command]
fn set_proxy_password(state: State<'_, AppState>, password: Option<String>) -> CoreResult<()> {
    match password
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            state.secrets.set(PROXY_PASSWORD_SECRET, &value)?;
            log(&state, "info", "settings", "Proxy credentials updated");
        }
        None => {
            state.secrets.delete(PROXY_PASSWORD_SECRET)?;
            log(&state, "info", "settings", "Proxy credentials removed");
        }
    }
    let settings = state.db.get_settings()?;
    state.engine.apply_settings(&settings);
    state.local_api.reconfigure(&settings);
    Ok(())
}

#[tauri::command]
async fn generate_workflow_draft(
    state: State<'_, AppState>,
    description: String,
) -> CoreResult<WorkflowDraft> {
    state.license.require()?;
    let settings = state.db.get_settings()?;
    let api_key = state
        .secrets
        .get("ai.api_key")?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CoreError::validation("Configure an AI API key named ai.api_key in Settings first")
        })?;
    let config = bits_ai_video_creator_core::ai::AiDraftConfig {
        endpoint: settings.ai_endpoint,
        model: settings.ai_model,
        api_key,
        allow_local_network: settings.allow_local_network,
        proxy: state.engine.settings().proxy,
    };
    bits_ai_video_creator_core::ai::generate_workflow_draft(&config, &description).await
}

// ---------- License ----------

#[tauri::command]
fn license_state(state: State<'_, AppState>) -> LicenseStatus {
    state.license.status()
}

#[tauri::command]
async fn license_link_code(
    state: State<'_, AppState>,
    code: String,
) -> CoreResult<LicenseStatus> {
    let status = state.license.link_code(&code).await?;
    let settings = state.db.get_settings()?;
    state.local_api.reconfigure(&settings);
    log(
        &state,
        "info",
        "license",
        &format!("License linked ({})", status.license_id.clone().unwrap_or_default()),
    );
    Ok(status)
}

#[tauri::command]
async fn license_refresh(state: State<'_, AppState>) -> CoreResult<LicenseStatus> {
    let status = state.license.refresh().await?;
    let settings = state.db.get_settings()?;
    state.local_api.reconfigure(&settings);
    log(&state, "info", "license", "License refreshed");
    Ok(status)
}

#[tauri::command]
async fn license_unlink(state: State<'_, AppState>) -> CoreResult<LicenseStatus> {
    let status = state.license.unlink().await?;
    let settings = state.db.get_settings()?;
    state.local_api.reconfigure(&settings);
    log(&state, "info", "license", "License unlinked");
    Ok(status)
}

// ---------- Native storyboard studio ----------

#[tauri::command]
fn list_storyboards(state: State<'_, AppState>) -> CoreResult<Vec<StoryboardSummary>> {
    state.db.list_storyboards()
}

#[tauri::command]
fn get_storyboard(state: State<'_, AppState>, id: String) -> CoreResult<Storyboard> {
    state.db.get_storyboard(&id)
}

#[tauri::command]
fn create_storyboard(state: State<'_, AppState>, input: StoryboardInput) -> CoreResult<Storyboard> {
    state.license.require()?;
    let storyboard = state.db.create_storyboard(&input)?;
    log(
        &state,
        "info",
        "storyboard",
        &format!("Created storyboard '{}'", storyboard.title),
    );
    Ok(storyboard)
}

#[tauri::command]
fn update_storyboard(
    state: State<'_, AppState>,
    id: String,
    input: StoryboardInput,
) -> CoreResult<Storyboard> {
    state.license.require()?;
    let storyboard = state.db.update_storyboard(&id, &input)?;
    log(
        &state,
        "info",
        "storyboard",
        &format!("Updated storyboard '{}'", storyboard.title),
    );
    Ok(storyboard)
}

#[tauri::command]
fn delete_storyboard(state: State<'_, AppState>, id: String) -> CoreResult<()> {
    state.license.require()?;
    state.db.delete_storyboard(&id)?;
    log(&state, "info", "storyboard", "Deleted a storyboard");
    Ok(())
}

#[tauri::command]
fn duplicate_storyboard(state: State<'_, AppState>, id: String) -> CoreResult<Storyboard> {
    state.license.require()?;
    let storyboard = state.db.duplicate_storyboard(&id)?;
    log(
        &state,
        "info",
        "storyboard",
        &format!("Duplicated storyboard '{}'", storyboard.title),
    );
    Ok(storyboard)
}

#[tauri::command]
fn export_storyboard(
    state: State<'_, AppState>,
    id: String,
    path: String,
    format: String,
) -> CoreResult<u64> {
    state.license.require()?;
    let storyboard = state.db.get_storyboard(&id)?;
    let format = format.trim().to_ascii_lowercase();
    let (content, expected_extension) = match format.as_str() {
        "markdown" | "md" => (studio::storyboard_to_markdown(&storyboard), "md"),
        "json" => (studio::storyboard_to_json(&storyboard)?, "json"),
        _ => {
            return Err(CoreError::validation(
                "Storyboard export format must be markdown or json",
            ))
        }
    };
    let path_ref = Path::new(&path);
    let extension = path_ref
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != expected_extension {
        return Err(CoreError::validation(format!(
            "Storyboard export must use the .{expected_extension} extension"
        )));
    }
    let bytes = content.as_bytes();
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(CoreError::validation("Storyboard export is too large"));
    }
    std::fs::write(path_ref, bytes)?;
    log(
        &state,
        "info",
        "storyboard",
        &format!("Exported storyboard '{}' as {format}", storyboard.title),
    );
    Ok(bytes.len() as u64)
}

#[tauri::command]
fn list_voiceover_assets(
    state: State<'_, AppState>,
    storyboard_id: Option<String>,
) -> CoreResult<Vec<VoiceoverAsset>> {
    state.db.list_voiceover_assets(storyboard_id.as_deref())
}

#[tauri::command]
fn delete_voiceover_asset(state: State<'_, AppState>, id: String) -> CoreResult<()> {
    state.db.delete_voiceover_asset(&id)?;
    Ok(())
}

#[tauri::command]
async fn synthesize_voiceover(
    state: State<'_, AppState>,
    text: String,
    path: String,
    storyboard_id: Option<String>,
    scene_id: Option<String>,
) -> CoreResult<VoiceoverAsset> {
    state.license.require()?;
    let settings = state.db.get_settings()?;
    let api_key = state
        .secrets
        .get("tts.api_key")?
        .or(state.secrets.get("ai.api_key")?)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CoreError::validation(
                "Configure a TTS API key named tts.api_key or ai.api_key in Settings first",
            )
        })?;
    let config = tts::TtsConfig {
        endpoint: settings.tts_endpoint.clone(),
        model: settings.tts_model.clone(),
        voice: settings.tts_voice.clone(),
        format: settings.tts_format.clone(),
        speed: settings.tts_speed,
        api_key,
        allow_local_network: settings.allow_local_network,
        proxy: state.engine.settings().proxy,
    };
    let audio = tts::synthesize(&config, &text).await?;
    let path_ref = Path::new(&path);
    let extension = path_ref
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != config.format {
        return Err(CoreError::validation(format!(
            "Voiceover file must use the .{} extension",
            config.format
        )));
    }
    std::fs::write(path_ref, &audio)?;
    let bytes = audio.len() as i64;
    let asset = match (storyboard_id, scene_id) {
        (Some(storyboard_id), Some(scene_id)) => state.db.insert_voiceover_asset(
            &storyboard_id,
            &scene_id,
            &path,
            &config.format,
            bytes,
            &config.voice,
        )?,
        _ => VoiceoverAsset {
            id: uuid::Uuid::new_v4().to_string(),
            storyboard_id: String::new(),
            scene_id: String::new(),
            path: path.clone(),
            format: config.format.clone(),
            bytes,
            voice: config.voice.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    };
    log(
        &state,
        "info",
        "voiceover",
        &format!("Generated {bytes} bytes of voiceover audio"),
    );
    Ok(asset)
}

// ---------- Prompt library ----------

#[tauri::command]
fn list_prompts(
    state: State<'_, AppState>,
    filter: Option<PromptFilter>,
) -> CoreResult<Vec<Prompt>> {
    state.db.list_prompts(&filter.unwrap_or_default())
}

#[tauri::command]
fn create_prompt(state: State<'_, AppState>, input: PromptInput) -> CoreResult<Prompt> {
    let prompt = state.db.create_prompt(&input)?;
    log(&state, "info", "prompts", "Created a prompt");
    Ok(prompt)
}

#[tauri::command]
fn update_prompt(state: State<'_, AppState>, id: String, input: PromptInput) -> CoreResult<Prompt> {
    let prompt = state.db.update_prompt(&id, &input)?;
    log(&state, "info", "prompts", "Updated a prompt");
    Ok(prompt)
}

#[tauri::command]
fn delete_prompt(state: State<'_, AppState>, id: String) -> CoreResult<()> {
    state.db.delete_prompt(&id)?;
    log(&state, "info", "prompts", "Deleted a prompt");
    Ok(())
}

#[tauri::command]
fn set_prompt_pinned(state: State<'_, AppState>, id: String, pinned: bool) -> CoreResult<Prompt> {
    state.db.set_prompt_pinned(&id, pinned)
}

// ---------- Declarative plugin packs ----------

#[tauri::command]
fn list_plugins(state: State<'_, AppState>) -> CoreResult<Vec<PluginSummary>> {
    state.db.list_plugins()
}

#[tauri::command]
fn install_plugin(state: State<'_, AppState>, path: String) -> CoreResult<PluginSummary> {
    let path = Path::new(&path);
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > plugins::MAX_PLUGIN_BYTES as u64 {
        return Err(CoreError::validation(
            "Plugin manifest exceeds the 256 KB limit",
        ));
    }
    let bytes = std::fs::read(path)?;
    let manifest = plugins::parse_manifest(&bytes)?;
    let plugin = state.db.install_plugin(&manifest)?;
    log(
        &state,
        "info",
        "plugins",
        &format!("Installed plugin '{}'", plugin.name),
    );
    Ok(plugin)
}

#[tauri::command]
fn get_plugin_manifest(state: State<'_, AppState>, id: String) -> CoreResult<PluginManifest> {
    state.db.get_plugin_manifest(&id)
}

#[tauri::command]
fn set_plugin_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CoreResult<PluginSummary> {
    state.db.set_plugin_enabled(&id, enabled)
}

#[tauri::command]
fn delete_plugin(state: State<'_, AppState>, id: String, confirm_id: String) -> CoreResult<()> {
    if id != confirm_id {
        return Err(CoreError::validation(
            "Type the plugin id to confirm removal",
        ));
    }
    state.db.delete_plugin(&id)?;
    log(&state, "info", "plugins", "Removed a plugin pack");
    Ok(())
}

// ---------- Local HTTP API ----------

#[tauri::command]
fn get_local_api_status(state: State<'_, AppState>) -> local_api::LocalApiStatus {
    state.local_api.status()
}

#[tauri::command]
fn reveal_local_api_token(state: State<'_, AppState>) -> CoreResult<String> {
    state.local_api.reveal_token()
}

#[tauri::command]
fn rotate_local_api_token(state: State<'_, AppState>) -> CoreResult<String> {
    let token = state.local_api.rotate_token()?;
    log(&state, "info", "api", "Local API token rotated");
    Ok(token)
}

// ---------- Updates ----------

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn check_for_updates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CoreResult<Option<updater::UpdateInfo>> {
    updater::check(&app, state.inner()).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn check_for_updates(
    _app: AppHandle,
    _state: State<'_, AppState>,
) -> CoreResult<Option<serde_json::Value>> {
    Err(CoreError::validation(
        "In-app updates are not available on Android. Install a newer signed APK from GitHub Releases.",
    ))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, AppState>) -> CoreResult<()> {
    updater::install(&app, state.inner()).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn install_update(_app: AppHandle, _state: State<'_, AppState>) -> CoreResult<()> {
    Err(CoreError::validation(
        "In-app updates are not available on Android. Install a newer signed APK.",
    ))
}

// ---------- Import / export / backup ----------

#[tauri::command]
fn import_preview(
    state: State<'_, AppState>,
    path: String,
    strategy: DuplicateStrategy,
) -> CoreResult<ImportPreview> {
    let parsed = import_export::read_import_file(Path::new(&path))?;
    import_export::preview_import(&state.db, &parsed, strategy)
}

#[tauri::command]
fn import_apply(
    state: State<'_, AppState>,
    path: String,
    strategy: DuplicateStrategy,
) -> CoreResult<ImportResult> {
    let parsed = import_export::read_import_file(Path::new(&path))?;
    let result = import_export::apply_import(&state.db, &parsed, strategy)?;
    log(
        &state,
        "info",
        "import",
        &format!(
            "Import completed: {} imported, {} replaced, {} skipped, {} errors",
            result.imported,
            result.replaced,
            result.skipped,
            result
                .errors
                .iter()
                .filter(|issue| issue.severity == "error")
                .count()
        ),
    );
    Ok(result)
}

#[tauri::command]
fn export_data(state: State<'_, AppState>, path: String) -> CoreResult<u64> {
    let bytes = import_export::export_to_path(&state.db, &state.app_version, Path::new(&path))?;
    log(
        &state,
        "info",
        "export",
        &format!("Exported data to {path}"),
    );
    Ok(bytes)
}

#[tauri::command]
fn create_backup(state: State<'_, AppState>) -> CoreResult<BackupInfo> {
    let info = import_export::create_backup(&state.db, &state.data_dir.join("backups"))?;
    log(
        &state,
        "info",
        "backup",
        &format!("Created backup at {}", info.path),
    );
    Ok(info)
}

#[tauri::command]
fn list_backups(state: State<'_, AppState>) -> CoreResult<Vec<BackupInfo>> {
    import_export::list_backups(&state.data_dir.join("backups"))
}

#[tauri::command]
fn verify_backup(path: String) -> CoreResult<String> {
    import_export::verify_sqlite_database(Path::new(&path))
}

#[tauri::command]
fn stage_restore(state: State<'_, AppState>, path: String) -> CoreResult<String> {
    let staged = import_export::stage_restore(Path::new(&path), &state.data_dir)?;
    log(
        &state,
        "warn",
        "backup",
        "A database restore was staged. Restart BITS AI Video Creator to apply it.",
    );
    Ok(staged.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(
        tauri_plugin_updater::Builder::new()
            .pubkey(updater::UPDATER_PUBKEY)
            .build(),
    );

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("bits-ai-video-creator.db");

            let mut restore_message: Option<String> = None;
            match import_export::apply_pending_restore(&data_dir, &db_path) {
                Ok(true) => restore_message = Some("Database restored from staged backup".into()),
                Ok(false) => {}
                Err(error) => {
                    let staged = import_export::pending_restore_path(&data_dir);
                    if staged.exists() {
                        let rejected = data_dir.join(format!(
                            "bits-ai-video-creator-restore-rejected-{}.db",
                            chrono::Utc::now().format("%Y%m%d-%H%M%S")
                        ));
                        let _ = std::fs::rename(&staged, rejected);
                    }
                    restore_message = Some(format!("Staged restore was rejected: {error}"));
                }
            }

            let db = Database::open(&db_path)?;
            let recovered = db.recover_interrupted()?;
            let settings = db.get_settings()?;
            let _ = db.cleanup_logs(settings.log_retention_days, settings.max_log_rows);
            #[cfg(not(target_os = "android"))]
            let orphan_profiles_removed = {
                let account_ids = db
                    .list_accounts(&AccountFilter::default())
                    .unwrap_or_default()
                    .into_iter()
                    .map(|account| account.id)
                    .collect::<std::collections::HashSet<_>>();
                webview_manager::cleanup_orphan_profiles(&data_dir, &account_ids)
            };
            #[cfg(target_os = "android")]
            let orphan_profiles_removed = 0usize;

            #[cfg(not(target_os = "android"))]
            let store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore);
            #[cfg(target_os = "android")]
            let store: Arc<dyn SecretStore> = {
                init_android_secret_store()?;
                Arc::new(AndroidSecretStore)
            };
            let secrets = SecretVault::new(db.clone(), store.clone());
            let license = LicenseManager::new(db.clone())?;
            let engine = Engine::new(db.clone(), secrets.clone())?;
            let wake = Arc::new(Notify::new());
            let executor = RunExecutor::new(engine.clone(), db.clone(), wake.clone())
                .with_license(license.clone());
            let scheduler = Scheduler::new(db.clone(), wake);
            let local_api = LocalApi::new(db.clone(), executor.clone(), license.clone(), store);
            let app_version = app.package_info().version.to_string();

            for worker in 0..settings.concurrency as usize {
                let executor = executor.clone();
                tauri::async_runtime::spawn(async move { executor.run_worker(worker).await });
            }
            {
                let scheduler = scheduler.clone();
                tauri::async_runtime::spawn(async move {
                    scheduler.run_loop(Duration::from_secs(15)).await
                });
            }

            let _ = db.insert_log(
                "info",
                "app",
                None,
                "BITS AI Video Creator started",
                Some(&json!({
                    "version": app_version,
                    "platform": std::env::consts::OS,
                    "schemaVersion": db.schema_version().unwrap_or(0),
                    "orphanProfilesRemoved": orphan_profiles_removed,
                })),
            );
            if recovered > 0 {
                let _ = db.insert_log(
                    "warn",
                    "app",
                    None,
                    &format!("{recovered} interrupted run(s) were marked failed after restart"),
                    None,
                );
            }
            if let Some(message) = &restore_message {
                let _ = db.insert_log(
                    if message.contains("rejected") {
                        "error"
                    } else {
                        "info"
                    },
                    "backup",
                    None,
                    message,
                    None,
                );
            }

            #[cfg(not(target_os = "android"))]
            app.manage(ProviderViewManager::default());
            app.manage(AppState {
                db,
                secrets,
                license,
                engine,
                executor,
                scheduler,
                local_api,
                data_dir,
                db_path,
                app_version,
            });
            let state = app.state::<AppState>();
            state.local_api.reconfigure(&state.db.get_settings()?);
            {
                // Launch-time license sync; keeps the cached verified token
                // fresh (stale-while-offline) without blocking startup.
                let license = state.license.clone();
                let db = state.db.clone();
                tauri::async_runtime::spawn(async move {
                    let (level, message) = match license.ensure_fresh().await {
                        Ok(status) => ("info", status.message),
                        Err(error) => ("warn", error.to_string()),
                    };
                    let _ = db.insert_log(&level, "license", None, &message, None);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_providers,
            get_provider_tools,
            get_dashboard,
            get_storage_info,
            get_secret_store_status,
            list_accounts,
            get_account,
            create_account,
            update_account,
            set_account_favorite,
            set_account_status,
            delete_account,
            check_account_profile,
            open_provider_view,
            open_provider_tool,
            close_provider_view,
            resize_provider_view,
            reload_provider_view,
            get_provider_view,
            list_workflows,
            get_workflow,
            create_workflow,
            update_workflow,
            duplicate_workflow,
            delete_workflow,
            set_workflow_enabled,
            validate_workflow_definition,
            list_schedules,
            run_workflow,
            cancel_run,
            retry_run,
            list_runs,
            get_run,
            list_logs,
            clear_logs,
            get_settings,
            update_settings,
            list_secrets,
            set_secret,
            delete_secret,
            set_proxy_password,
            generate_workflow_draft,
            license_state,
            license_link_code,
            license_refresh,
            license_unlink,            list_storyboards,
            get_storyboard,
            create_storyboard,
            update_storyboard,
            delete_storyboard,
            duplicate_storyboard,
            export_storyboard,
            list_voiceover_assets,
            delete_voiceover_asset,
            synthesize_voiceover,
            list_prompts,
            create_prompt,
            update_prompt,
            delete_prompt,
            set_prompt_pinned,
            list_plugins,
            install_plugin,
            get_plugin_manifest,
            set_plugin_enabled,
            delete_plugin,
            get_local_api_status,
            reveal_local_api_token,
            rotate_local_api_token,
            check_for_updates,
            install_update,
            import_preview,
            import_apply,
            export_data,
            create_backup,
            list_backups,
            verify_backup,
            stage_restore,
        ]);

    // `unstable` is enabled for child webviews; builder is finalized below.
    builder
        .build(tauri::generate_context!())
        .expect("error while building BITS AI Video Creator")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                let state = app_handle.state::<AppState>();
                state.local_api.shutdown();
                state.executor.shutdown();
                state.scheduler.shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_service_is_stable() {
        assert_eq!(KEYRING_SERVICE, "id.co.bits.aivideocreator");
    }
}
