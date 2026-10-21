use crate::error::{CoreError, Result};
use crate::models::{now_rfc3339, AccountInput};
use crate::providers;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyAccount {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub provider: Option<String>,
    pub favorite: bool,
    pub order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImport {
    pub accounts: Vec<AccountInput>,
    pub warnings: Vec<String>,
}

pub fn parse_legacy_accounts(raw: &str) -> Result<LegacyImport> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| CoreError::validation("Legacy account file is not valid JSON"))?;
    let array = if let Some(items) = value.as_array() {
        items.clone()
    } else if let Some(items) = value.get("accounts").and_then(|v| v.as_array()) {
        items.clone()
    } else {
        return Err(CoreError::validation(
            "Legacy account file must contain an array of accounts",
        ));
    };
    if array.len() > 5_000 {
        return Err(CoreError::validation("Legacy account file is too large"));
    }
    let mut accounts = Vec::with_capacity(array.len());
    let mut warnings = Vec::new();
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for (index, item) in array.iter().enumerate() {
        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if name.is_empty() || name.chars().count() > 80 {
            warnings.push(format!("Skipped legacy account #{index}: invalid name"));
            continue;
        }
        let provider_raw = item
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("google-flow");
        let provider = match provider_raw {
            "google-flow" | "dola" | "leonardo" | "chatgpt" | "migoo" | "gemini" => provider_raw,
            other => {
                warnings.push(format!("Legacy account '{name}' used unsupported provider '{other}', mapped to Google Flow"));
                "google-flow"
            }
        };
        let email = item
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let favorite = item
            .get("favorite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let order = item
            .get("order")
            .and_then(|v| v.as_i64())
            .unwrap_or(index as i64)
            .max(0);
        let dedupe = format!("{}:{}", provider, crate::validation::normalize_name(name));
        if !names.insert(dedupe) {
            warnings.push(format!("Skipped duplicate legacy account '{name}'"));
            continue;
        }
        let normalized_id = if !id.is_empty() && ids.insert(id.to_string()) && id.len() <= 128 {
            id.to_string()
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        accounts.push(AccountInput {
            provider: provider.to_string(),
            name: name.to_string(),
            email,
            external_id: Some(format!("legacy:{normalized_id}")),
            status: Some("needs_login".into()),
            favorite: Some(favorite),
            tags: Some(vec!["imported".into(), "legacy-1.x".into()]),
            notes: Some(
                "Imported from BITS AI Video Creator 1.x. Verify the provider sign-in in the webview.".into(),
            ),
            sort_order: Some(order),
        });
    }
    if accounts.is_empty() && !array.is_empty() {
        return Err(CoreError::validation(
            "No valid accounts were found in the legacy file",
        ));
    }
    Ok(LegacyImport { accounts, warnings })
}

pub fn legacy_export_shape(name: &str, provider: &str) -> Value {
    serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "name": name,
        "email": null,
        "provider": provider,
        "avatar": "NF",
        "avatarUrl": null,
        "favorite": false,
        "order": 0,
        "importedAt": now_rfc3339(),
    })
}

pub fn is_supported_provider(provider: &str) -> bool {
    providers::is_supported(provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_v12_and_v13_shapes() {
        let raw = r#"[
          {"id":"main","name":"Flow Main","email":null,"avatarUrl":null,"avatar":"YK","favorite":true,"order":0},
          {"id":"g","name":"Gemini One","email":null,"provider":"gemini","avatar":"G","favorite":false,"order":1}
        ]"#;
        let parsed = parse_legacy_accounts(raw).unwrap();
        assert_eq!(parsed.accounts.len(), 2);
        assert_eq!(parsed.accounts[0].provider, "google-flow");
        assert_eq!(parsed.accounts[1].provider, "gemini");
        assert!(parsed.accounts[0].favorite.unwrap());
    }

    #[test]
    fn rejects_invalid_payloads() {
        assert!(parse_legacy_accounts("{}").is_err());
        assert!(parse_legacy_accounts("not json").is_err());
    }

    #[test]
    fn skips_duplicate_names() {
        let raw = r#"[{"id":"a","name":"Same","order":0},{"id":"b","name":" same ","order":1}]"#;
        let parsed = parse_legacy_accounts(raw).unwrap();
        assert_eq!(parsed.accounts.len(), 1);
        assert!(!parsed.warnings.is_empty());
    }
}
