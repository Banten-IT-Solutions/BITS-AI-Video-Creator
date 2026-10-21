//! Declarative plugin packs.
//!
//! A plugin is a strictly validated bundle of HTTP request presets. It does
//! **not** execute code, access the filesystem, or receive secrets. Presets are
//! applied to the normal `action.http` node, so the engine's SSRF, templating,
//! timeout, redaction, and retry rules still apply.

use crate::error::{CoreError, Result};
use crate::models::{PluginManifest, PluginPreset};
use crate::validation;
use std::collections::HashSet;

pub const PLUGIN_SCHEMA_VERSION: u32 = 1;
pub const MAX_PLUGIN_BYTES: usize = 256 * 1024;
pub const MAX_PRESETS: usize = 50;
pub const MAX_BODY_BYTES: usize = 64 * 1024;

pub fn parse_manifest(bytes: &[u8]) -> Result<PluginManifest> {
    if bytes.is_empty() || bytes.len() > MAX_PLUGIN_BYTES {
        return Err(CoreError::validation(
            "Plugin manifest must be between 1 byte and 256 KB",
        ));
    }
    let manifest: PluginManifest = serde_json::from_slice(bytes)
        .map_err(|_| CoreError::validation("Plugin manifest is not valid JSON"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn validate_manifest(manifest: &PluginManifest) -> Result<()> {
    if manifest.schema_version != PLUGIN_SCHEMA_VERSION {
        return Err(CoreError::validation(
            "Unsupported plugin manifest schema version",
        ));
    }
    if !valid_id(&manifest.id) {
        return Err(CoreError::validation(
            "Plugin id must be 3–65 lowercase letters, numbers, dots, underscores, or hyphens",
        ));
    }
    if manifest.name.trim().is_empty() || manifest.name.chars().count() > 100 {
        return Err(CoreError::validation(
            "Plugin name must be between 1 and 100 characters",
        ));
    }
    if manifest.version.trim().is_empty() || manifest.version.chars().count() > 32 {
        return Err(CoreError::validation(
            "Plugin version must be between 1 and 32 characters",
        ));
    }
    if manifest.description.chars().count() > 2000 || manifest.author.chars().count() > 100 {
        return Err(CoreError::validation("Plugin metadata is too long"));
    }
    if let Some(homepage) = &manifest.homepage {
        validation::validate_public_https_url(homepage)?;
    }
    if manifest.presets.is_empty() || manifest.presets.len() > MAX_PRESETS {
        return Err(CoreError::validation(
            "Plugin must contain between 1 and 50 presets",
        ));
    }
    let mut ids = HashSet::new();
    for preset in &manifest.presets {
        validate_preset(preset)?;
        if !ids.insert(preset.id.as_str()) {
            return Err(CoreError::validation("Plugin preset ids must be unique"));
        }
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=65).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn validate_preset(preset: &PluginPreset) -> Result<()> {
    if !valid_preset_id(&preset.id) {
        return Err(CoreError::validation(
            "Preset id must be 2–64 lowercase letters, numbers, underscores, or hyphens",
        ));
    }
    if preset.name.trim().is_empty() || preset.name.chars().count() > 100 {
        return Err(CoreError::validation(
            "Preset name must be between 1 and 100 characters",
        ));
    }
    if preset.description.chars().count() > 500 {
        return Err(CoreError::validation("Preset description is too long"));
    }
    let method = preset.method.trim().to_ascii_uppercase();
    if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err(CoreError::validation("Unsupported preset HTTP method"));
    }
    validation::validate_templated_https_url(&preset.url)?;
    if preset.headers.len() > 30 {
        return Err(CoreError::validation("Preset has too many headers"));
    }
    for (name, value) in &preset.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host" | "content-length" | "transfer-encoding" | "connection"
        ) {
            return Err(CoreError::validation(
                "Preset contains a forbidden transport header",
            ));
        }
        reqwest_header_name(name)?;
        if value.chars().count() > 4096
            || value.contains('\r')
            || value.contains('\n')
            || value.contains('\0')
        {
            return Err(CoreError::validation("Preset header value is invalid"));
        }
    }
    if let Some(body) = &preset.body {
        let bytes = serde_json::to_vec(body)?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(CoreError::validation("Preset body exceeds 64 KB"));
        }
    }
    if let Some(timeout) = preset.timeout_ms {
        if !(1000..=120_000).contains(&timeout) {
            return Err(CoreError::validation(
                "Preset timeout must be between 1,000 and 120,000 ms",
            ));
        }
    }
    Ok(())
}

fn valid_preset_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (2..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn reqwest_header_name(value: &str) -> Result<()> {
    reqwest::header::HeaderName::from_bytes(value.as_bytes())
        .map(|_| ())
        .map_err(|_| CoreError::validation("Preset contains an invalid header name"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PluginPreset;
    use std::collections::BTreeMap;

    fn manifest() -> PluginManifest {
        PluginManifest {
            schema_version: 1,
            id: "com.example.webhooks".into(),
            name: "Example webhooks".into(),
            version: "1.0.0".into(),
            description: "Useful webhook presets".into(),
            author: "Example".into(),
            homepage: Some("https://example.com/plugin".into()),
            presets: vec![PluginPreset {
                id: "post-event".into(),
                name: "Post event".into(),
                description: "Send an event".into(),
                method: "POST".into(),
                url: "https://api.example.com/events/{{input.id}}".into(),
                headers: BTreeMap::from([("content-type".into(), "application/json".into())]),
                body: Some(serde_json::json!({"id": "{{input.id}}"})),
                timeout_ms: Some(30_000),
            }],
        }
    }

    #[test]
    fn accepts_a_safe_declarative_pack() {
        validate_manifest(&manifest()).unwrap();
        let bytes = serde_json::to_vec(&manifest()).unwrap();
        assert_eq!(parse_manifest(&bytes).unwrap().presets.len(), 1);
    }

    #[test]
    fn rejects_plain_http_and_local_targets() {
        let mut item = manifest();
        item.presets[0].url = "http://example.com/hook".into();
        assert!(validate_manifest(&item).is_err());
        item.presets[0].url = "https://127.0.0.1/hook".into();
        assert!(validate_manifest(&item).is_err());
        item.presets[0].url = "https://localhost/hook".into();
        assert!(validate_manifest(&item).is_err());
    }

    #[test]
    fn rejects_transport_headers_and_duplicate_presets() {
        let mut item = manifest();
        item.presets[0]
            .headers
            .insert("host".into(), "evil.example".into());
        assert!(validate_manifest(&item).is_err());
        let mut item = manifest();
        item.presets.push(item.presets[0].clone());
        item.presets[1].id = "post-event".into();
        assert!(validate_manifest(&item).is_err());
    }

    #[test]
    fn rejects_invalid_manifest_ids_and_versions() {
        let mut item = manifest();
        item.id = "../escape".into();
        assert!(validate_manifest(&item).is_err());
        let mut item = manifest();
        item.schema_version = 99;
        assert!(validate_manifest(&item).is_err());
    }
}
