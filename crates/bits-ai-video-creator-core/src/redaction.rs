use crate::models::Settings;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Default)]
pub struct Redactor {
    secrets: Vec<Zeroizing<String>>,
}

impl Redactor {
    pub fn new(values: impl IntoIterator<Item = String>) -> Self {
        let mut unique = HashSet::new();
        let mut secrets = Vec::new();
        for value in values {
            let value = value.trim().to_string();
            if value.len() >= 4 && unique.insert(value.clone()) {
                secrets.push(Zeroizing::new(value));
            }
        }
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        Self { secrets }
    }

    pub fn empty() -> Self {
        Self::default()
    }

    pub fn redact(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        for secret in &self.secrets {
            if !secret.is_empty() {
                redacted = redacted.replace(secret.as_str(), "[REDACTED]");
            }
        }
        redact_patterns(&redacted)
    }

    pub fn redact_value(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.redact(text)),
            Value::Array(items) => {
                Value::Array(items.iter().map(|v| self.redact_value(v)).collect())
            }
            Value::Object(map) => {
                let mut out = serde_json::Map::new();
                for (key, item) in map {
                    if is_sensitive_key(key) {
                        out.insert(key.clone(), Value::String("[REDACTED]".into()));
                    } else {
                        out.insert(key.clone(), self.redact_value(item));
                    }
                }
                Value::Object(out)
            }
            other => other.clone(),
        }
    }
}

pub fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "password",
        "passwd",
        "secret",
        "token",
        "api_key",
        "apikey",
        "authorization",
        "cookie",
        "credential",
        "private_key",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn redact_patterns(text: &str) -> String {
    let mut out = authorization_regex()
        .replace_all(text, "$1[REDACTED]")
        .to_string();
    out = key_value_regex()
        .replace_all(&out, "$1[REDACTED]")
        .to_string();
    out = bearer_regex().replace_all(&out, "$1[REDACTED]").to_string();
    out = cookie_regex().replace_all(&out, "$1[REDACTED]").to_string();
    out
}

fn authorization_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)(authorization\s*:\s*)(?:bearer\s+)?[A-Za-z0-9._~+/=\-]+")
            .expect("static regex")
    })
}

fn key_value_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|cookie)\s*[=:]\s*)([^\s,;&]+)")
            .expect("static regex")
    })
}

fn bearer_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=\-]{8,}").expect("static regex")
    })
}

fn cookie_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)((?:set-)?cookie\s*:\s*)([^\r\n]+)").expect("static regex")
    })
}

pub fn default_settings_redaction(_settings: &Settings) -> bool {
    // Redaction is unconditional. Kept as a named policy hook so future settings
    // cannot accidentally disable it without an explicit security review.
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_known_values_and_headers() {
        let redactor = Redactor::new(vec!["super-secret-token".into()]);
        let text = "Authorization: Bearer abcdefghijklmnop token=super-secret-token";
        let out = redactor.redact(text);
        assert!(!out.contains("super-secret-token"));
        assert!(!out.contains("abcdefghijklmnop"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_sensitive_json_fields() {
        let redactor = Redactor::new(vec![]);
        let value = serde_json::json!({"password":"hunter2","nested":{"api_key":"abc"}});
        let out = redactor.redact_value(&value);
        assert_eq!(out["password"], "[REDACTED]");
        assert_eq!(out["nested"]["api_key"], "[REDACTED]");
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let redactor = Redactor::new(vec!["only-a-secret".into()]);
        assert_eq!(
            redactor.redact("workflow completed in 1200ms"),
            "workflow completed in 1200ms"
        );
    }
}
