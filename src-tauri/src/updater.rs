//! Tauri updater integration with an owner-configured HTTPS endpoint.
//!
//! The updater public key is baked into the binary below. The matching private
//! key is intentionally **not** in the repository; release builds must sign
//! artifacts with it. The endpoint is a setting so a fork can point at its own
//! HTTPS manifest without rebuilding the UI.

use crate::AppState;
use bits_ai_video_creator_core::error::{CoreError, Result};
use bits_ai_video_creator_core::validation;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Generated with `tauri signer generate`; this is the public half only.
pub const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAxQUQ3MUU3RjgyNURBOEMKUldTTTJpWDQ1M0d0QVZYTENzOHM3Tm8yMVJpNTVOdU1SUEtjam0xcTJWZWt2VU5reERDWE56MkwK";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub target: String,
}

fn endpoint(settings: &bits_ai_video_creator_core::models::Settings) -> Result<url::Url> {
    let value = settings
        .update_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CoreError::validation(
                "Update endpoint is not configured. Set an HTTPS updater manifest URL in Settings.",
            )
        })?;
    validation::validate_update_endpoint(value)
}

pub async fn check(app: &AppHandle, state: &AppState) -> Result<Option<UpdateInfo>> {
    let settings = state.db.get_settings()?;
    let endpoint = endpoint(&settings)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| CoreError::Http("Update endpoint is invalid".into()))?
        .build()
        .map_err(|_| CoreError::Http("Updater is not configured".into()))?;
    let update = updater
        .check()
        .await
        .map_err(|_| CoreError::Http("Update check failed".into()))?;
    Ok(update.map(|update| UpdateInfo {
        current_version: update.current_version,
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
        target: update.target,
    }))
}

pub async fn install(app: &AppHandle, state: &AppState) -> Result<()> {
    let settings = state.db.get_settings()?;
    let endpoint = endpoint(&settings)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| CoreError::Http("Update endpoint is invalid".into()))?
        .build()
        .map_err(|_| CoreError::Http("Updater is not configured".into()))?;
    let update = updater
        .check()
        .await
        .map_err(|_| CoreError::Http("Update check failed".into()))?
        .ok_or_else(|| CoreError::not_found("No update is available"))?;
    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                let _ = app_handle.emit(
                    "update-progress",
                    serde_json::json!({"downloaded": chunk, "total": total}),
                );
            },
            || {},
        )
        .await
        .map_err(|_| CoreError::Http("Update download or installation failed".into()))?;
    // On Windows the installer owns the restart. On other supported platforms
    // restart explicitly after the bundle has been installed.
    #[cfg(not(windows))]
    {
        app.restart();
    }
    #[cfg(windows)]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_is_present() {
        assert!(UPDATER_PUBKEY.len() > 40);
        assert!(!UPDATER_PUBKEY.contains('\n'));
    }

    #[test]
    fn endpoint_requires_https_and_rejects_empty_settings() {
        let mut settings = bits_ai_video_creator_core::models::Settings::default();
        assert!(endpoint(&settings).is_ok());
        settings.update_endpoint = None;
        assert!(endpoint(&settings).is_err());
        settings.update_endpoint = Some("http://updates.example.com/latest.json".into());
        assert!(endpoint(&settings).is_err());
        settings.update_endpoint = Some("https://updates.example.com/latest.json".into());
        assert!(endpoint(&settings).is_ok());
    }
}
