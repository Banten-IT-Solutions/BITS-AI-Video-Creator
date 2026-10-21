use crate::Database;
use bits_ai_video_creator_core::models::ProfileCheck;
use bits_ai_video_creator_core::provider_tools;
use bits_ai_video_creator_core::providers;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri_plugin_dialog::DialogExt;

const MAX_CACHED_VIEWS: usize = 8;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderViewInfo {
    pub account_id: String,
    pub provider: String,
    pub label: String,
}

#[derive(Debug, Clone)]
struct ActiveView {
    account_id: String,
    provider: String,
    label: String,
    url: String,
}

#[derive(Default)]
pub struct ProviderViewManager {
    active: Mutex<Option<ActiveView>>,
    cached: Mutex<HashMap<String, u64>>,
    counter: Mutex<u64>,
    operation: Mutex<()>,
}

fn validate_account_id(account_id: &str) -> Result<(), String> {
    if account_id.is_empty()
        || account_id.len() > 64
        || !account_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Invalid account id".into());
    }
    Ok(())
}

fn validate_bounds(bounds: Bounds) -> Result<(), String> {
    let values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if !values.iter().all(|value| value.is_finite())
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 50.0
        || bounds.height < 50.0
        || bounds.width > 10_000.0
        || bounds.height > 10_000.0
    {
        return Err("Invalid provider view bounds".into());
    }
    Ok(())
}

fn profile_root(data_dir: &Path, account_id: &str) -> Result<PathBuf, String> {
    validate_account_id(account_id)?;
    let root = data_dir.join("webview-profiles");
    let profile = root.join(account_id);
    if profile.parent() != Some(root.as_path()) {
        return Err("Invalid profile path".into());
    }
    Ok(profile)
}

fn view_label(account_id: &str, provider: &str) -> String {
    format!("provider-{account_id}-{provider}")
}

fn touch(manager: &ProviderViewManager, label: &str) {
    if let Ok(mut counter) = manager.counter.lock() {
        *counter = counter.wrapping_add(1);
        if let Ok(mut cached) = manager.cached.lock() {
            cached.insert(label.to_string(), *counter);
        }
    }
}

fn apply_bounds(webview: &tauri::Webview, bounds: Bounds) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn open(
    app: &AppHandle,
    db: &Database,
    data_dir: &Path,
    account_id: &str,
    bounds: Bounds,
) -> Result<ProviderViewInfo, String> {
    validate_account_id(account_id)?;
    validate_bounds(bounds)?;
    let account = db
        .get_account(account_id)
        .map_err(|error| error.to_string())?;
    let provider =
        providers::provider(&account.provider).ok_or_else(|| "Unsupported provider".to_string())?;
    open_target(
        app,
        db,
        data_dir,
        account_id,
        &account.provider,
        &provider.url,
        bounds,
    )
}

pub fn open_tool(
    app: &AppHandle,
    db: &Database,
    data_dir: &Path,
    account_id: &str,
    tool_id: &str,
    bounds: Bounds,
) -> Result<ProviderViewInfo, String> {
    validate_account_id(account_id)?;
    validate_bounds(bounds)?;
    let account = db
        .get_account(account_id)
        .map_err(|error| error.to_string())?;
    let tool = provider_tools::tool(tool_id).ok_or_else(|| "Unknown provider tool".to_string())?;
    if account.provider != tool.account_provider {
        return Err(format!(
            "{} requires a {} account",
            tool.name, tool.account_provider
        ));
    }
    open_target(app, db, data_dir, account_id, &tool.id, &tool.url, bounds)
}

fn open_target(
    app: &AppHandle,
    db: &Database,
    data_dir: &Path,
    account_id: &str,
    target_id: &str,
    target_url: &str,
    bounds: Bounds,
) -> Result<ProviderViewInfo, String> {
    validate_account_id(account_id)?;
    if target_id.is_empty()
        || target_id.len() > 64
        || !target_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Invalid provider target".into());
    }
    validate_bounds(bounds)?;
    let label = view_label(account_id, target_id);
    let manager = app.state::<ProviderViewManager>();
    let _operation = manager
        .operation
        .lock()
        .map_err(|_| "Provider view state unavailable")?;

    if let Some(active) = manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")?
        .clone()
    {
        if active.label != label {
            if let Some(webview) = app.get_webview(&active.label) {
                let _ = webview.hide();
            }
        }
    }

    if let Some(webview) = app.get_webview(&label) {
        apply_bounds(&webview, bounds)?;
        webview.show().map_err(|error| error.to_string())?;
        let _ = webview.set_focus();
        touch(&manager, &label);
        *manager
            .active
            .lock()
            .map_err(|_| "Provider view state unavailable")? = Some(ActiveView {
            account_id: account_id.to_string(),
            provider: target_id.to_string(),
            label: label.clone(),
            url: target_url.to_string(),
        });
        let _ = db.touch_account(account_id, true);
        return Ok(ProviderViewInfo {
            account_id: account_id.to_string(),
            provider: target_id.to_string(),
            label,
        });
    }

    evict_if_needed(app, &manager, &label)?;

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let profile = profile_root(data_dir, account_id)?;
    std::fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    let url = target_url
        .parse::<url::Url>()
        .map_err(|_| "Provider URL is invalid".to_string())?;
    if url.scheme() != "https" {
        return Err("Provider tools require HTTPS".into());
    }
    let download_app = app.clone();

    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url))
        .data_directory(profile)
        .on_navigation(|url| url.scheme() == "https")
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .on_download(move |_webview, event| handle_download(&download_app, event));

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    let _ = webview.set_focus();
    touch(&manager, &label);
    *manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")? = Some(ActiveView {
        account_id: account_id.to_string(),
        provider: target_id.to_string(),
        label: label.clone(),
        url: target_url.to_string(),
    });
    let _ = db.touch_account(account_id, true);
    Ok(ProviderViewInfo {
        account_id: account_id.to_string(),
        provider: target_id.to_string(),
        label,
    })
}

fn safe_download_name(value: &str) -> String {
    let basename = Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("bits-ai-video-creator-download");
    let mut cleaned: String = basename
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
            {
                '_'
            } else {
                character
            }
        })
        .take(180)
        .collect();
    cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "bits-ai-video-creator-download".into()
    } else {
        cleaned
    }
}

fn handle_download(app: &AppHandle, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            // Only HTTPS downloads from provider sessions are accepted. The
            // user chooses the final destination; no provider-supplied path is
            // trusted. Existing files are handled by the native save dialog.
            if url.scheme() != "https" {
                return false;
            }
            let suggested = destination
                .file_name()
                .and_then(|name| name.to_str())
                .map(safe_download_name)
                .unwrap_or_else(|| "bits-ai-video-creator-download".into());
            let Some(selected) = app
                .dialog()
                .file()
                .set_file_name(suggested)
                .blocking_save_file()
            else {
                return false;
            };
            let Ok(path) = selected.into_path() else {
                return false;
            };
            if !path.is_absolute() {
                return false;
            }
            if let Some(parent) = path.parent() {
                if !parent.exists() {
                    return false;
                }
            }
            *destination = path;
            true
        }
        DownloadEvent::Finished { success, .. } => {
            if !success {
                eprintln!("provider download failed");
            }
            true
        }
        _ => true,
    }
}

fn evict_if_needed(
    app: &AppHandle,
    manager: &ProviderViewManager,
    keep: &str,
) -> Result<(), String> {
    let mut cached = manager
        .cached
        .lock()
        .map_err(|_| "Provider view state unavailable")?;
    if cached.len() < MAX_CACHED_VIEWS {
        return Ok(());
    }
    let active_label = manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")?
        .as_ref()
        .map(|active| active.label.clone());
    let eviction = cached
        .iter()
        .filter(|(label, _)| {
            label.as_str() != keep && Some(label.as_str()) != active_label.as_deref()
        })
        .min_by_key(|(_, used)| **used)
        .map(|(label, _)| label.clone());
    if let Some(label) = eviction {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
        }
        cached.remove(&label);
    }
    Ok(())
}

pub fn close(app: &AppHandle, manager: &ProviderViewManager) -> Result<(), String> {
    let _operation = manager
        .operation
        .lock()
        .map_err(|_| "Provider view state unavailable")?;
    if let Some(active) = manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")?
        .take()
    {
        if let Some(webview) = app.get_webview(&active.label) {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub fn resize(
    app: &AppHandle,
    manager: &ProviderViewManager,
    bounds: Bounds,
) -> Result<(), String> {
    validate_bounds(bounds)?;
    let active = manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")?
        .clone();
    if let Some(active) = active {
        if let Some(webview) = app.get_webview(&active.label) {
            apply_bounds(&webview, bounds)?;
        }
    }
    Ok(())
}

pub fn reload(app: &AppHandle, manager: &ProviderViewManager) -> Result<(), String> {
    let active = manager
        .active
        .lock()
        .map_err(|_| "Provider view state unavailable")?
        .clone();
    if let Some(active) = active {
        if let Some(webview) = app.get_webview(&active.label) {
            let url = active
                .url
                .parse()
                .map_err(|_| "Provider URL is invalid".to_string())?;
            webview.navigate(url).map_err(|error| error.to_string())?;
            webview.show().map_err(|error| error.to_string())?;
            let _ = webview.set_focus();
        }
    }
    Ok(())
}

impl ProviderViewManager {
    pub fn active_info(&self) -> Option<ProviderViewInfo> {
        self.active.lock().ok().and_then(|active| {
            active.as_ref().map(|active| ProviderViewInfo {
                account_id: active.account_id.clone(),
                provider: active.provider.clone(),
                label: active.label.clone(),
            })
        })
    }
}

pub fn remove_account(app: &AppHandle, data_dir: &Path, account_id: &str) -> Result<bool, String> {
    validate_account_id(account_id)?;
    let manager = app.state::<ProviderViewManager>();
    let _operation = manager
        .operation
        .lock()
        .map_err(|_| "Provider view state unavailable")?;
    {
        let mut labels = Vec::new();
        if let Ok(cached) = manager.cached.lock() {
            labels.extend(
                cached
                    .keys()
                    .filter(|label| label.starts_with(&format!("provider-{account_id}-")))
                    .cloned(),
            );
        }
        for label in &labels {
            if let Some(webview) = app.get_webview(label) {
                let _ = webview.close();
            }
        }
        if let Ok(mut cached) = manager.cached.lock() {
            for label in labels {
                cached.remove(&label);
            }
        }
        let mut active = manager
            .active
            .lock()
            .map_err(|_| "Provider view state unavailable")?;
        if active.as_ref().map(|active| active.account_id.as_str()) == Some(account_id) {
            *active = None;
        }
    }
    let profile = profile_root(data_dir, account_id)?;
    if !profile.exists() {
        return Ok(true);
    }
    match std::fs::remove_dir_all(&profile) {
        Ok(()) => Ok(true),
        Err(error) => {
            eprintln!("provider profile cleanup pending account={account_id}: {error}");
            Ok(false)
        }
    }
}

/// Removes profile directories whose account no longer exists. This clears up
/// after a failed immediate cleanup (for example, a locked WebView2 profile on
/// Windows) on the next launch. Unknown or malformed directory names are left
/// untouched.
pub fn cleanup_orphan_profiles(data_dir: &Path, keep: &std::collections::HashSet<String>) -> usize {
    let root = data_dir.join("webview-profiles");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if validate_account_id(&name).is_err() || keep.contains(&name) {
            continue;
        }
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub fn profile_check(data_dir: &Path, account_id: &str) -> Result<ProfileCheck, String> {
    let profile = profile_root(data_dir, account_id)?;
    let path_text = profile.to_string_lossy().to_string();
    if !profile.exists() {
        return Ok(ProfileCheck {
            state: "empty".into(),
            profile_path: path_text,
            file_count: 0,
            bytes: 0,
            last_modified: None,
            message: "No provider session has been created for this account yet.".into(),
        });
    }
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut newest: Option<SystemTime> = None;
    let mut stack = vec![profile.clone()];
    let mut visited = 0usize;
    while let Some(directory) = stack.pop() {
        if visited > 200_000 {
            break;
        }
        let entries = std::fs::read_dir(&directory).map_err(|error| error.to_string())?;
        for entry in entries.flatten() {
            visited += 1;
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                files += 1;
                bytes += metadata.len();
                if let Ok(modified) = metadata.modified() {
                    if newest.map(|current| modified > current).unwrap_or(true) {
                        newest = Some(modified);
                    }
                }
            }
        }
    }
    let last_modified = newest.map(|time| {
        let timestamp = time
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or(0);
        chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp as i64, 0)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    });
    Ok(ProfileCheck {
        state: if files == 0 {
            "empty".into()
        } else {
            "ready".into()
        },
        profile_path: path_text,
        file_count: files,
        bytes,
        last_modified,
        message: if files == 0 {
            "The isolated profile is empty; sign in inside the provider view.".into()
        } else {
            "Isolated provider profile is present. Session cookies never enter the app database."
                .into()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_names_are_sanitized_and_bounded() {
        assert_eq!(safe_download_name("video:name.mp4"), "video_name.mp4");
        assert_eq!(safe_download_name("../../secret.mp4"), "secret.mp4");
        assert_eq!(safe_download_name(""), "bits-ai-video-creator-download");
        assert!(safe_download_name(&"x".repeat(500)).chars().count() <= 180);
    }

    #[test]
    fn provider_view_labels_are_scoped_to_accounts() {
        assert_eq!(view_label("abc", "google-flow"), "provider-abc-google-flow");
        assert_eq!(view_label("abc", "storyboard"), "provider-abc-storyboard");
    }
}
