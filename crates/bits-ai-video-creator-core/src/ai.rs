//! AI-assisted workflow drafting using any OpenAI-compatible chat endpoint.
//!
//! The model is treated as untrusted input. Its output is parsed, structurally
//! validated, and returned as a draft; it is never saved or executed here. The
//! API key is supplied by the caller from the OS keyring and is never logged.

use crate::engine::{build_http_client, ProxyConfig};
use crate::error::{CoreError, Result};
use crate::models::{ValidationReport, WorkflowDefinition, WorkflowDraft, WORKFLOW_SCHEMA_VERSION};
use crate::validation;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const MAX_DRAFT_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_DESCRIPTION_CHARS: usize = 4_000;

#[derive(Clone)]
pub struct AiDraftConfig {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    pub allow_local_network: bool,
    pub proxy: Option<ProxyConfig>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Value,
}

#[derive(Debug, Deserialize)]
struct DraftPayload {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    tags: Vec<String>,
    definition: WorkflowDefinition,
}

pub async fn generate_workflow_draft(
    config: &AiDraftConfig,
    description: &str,
) -> Result<WorkflowDraft> {
    let description = description.trim();
    if description.is_empty() || description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(CoreError::validation(
            "Describe the workflow in 1–4,000 characters",
        ));
    }
    if config.api_key.trim().is_empty() {
        return Err(CoreError::validation(
            "Configure an AI API key in Settings before generating a draft",
        ));
    }
    if config.model.trim().is_empty() || config.model.chars().count() > 100 {
        return Err(CoreError::validation("AI model name is invalid"));
    }
    let base = validation::validate_ai_endpoint(&config.endpoint, config.allow_local_network)?;
    if base.query().is_some() {
        return Err(CoreError::validation(
            "AI endpoint must not contain a query string",
        ));
    }
    let endpoint = format!("{}/chat/completions", base.as_str().trim_end_matches('/'));
    validation::validate_ai_endpoint(&endpoint, config.allow_local_network)?;

    let client = build_http_client(config.allow_local_network, config.proxy.as_ref())?;
    let body = json!({
        "model": config.model.trim(),
        "temperature": 0.2,
        "stream": false,
        "messages": [
            {"role": "system", "content": system_prompt()},
            {"role": "user", "content": description}
        ]
    });
    let mut response = client
        .post(endpoint)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .timeout(Duration::from_secs(90))
        .send()
        .await
        .map_err(|_| CoreError::Http("AI endpoint request failed".into()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CoreError::Http(format!(
            "AI endpoint returned HTTP {}",
            status.as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DRAFT_RESPONSE_BYTES as u64)
    {
        return Err(CoreError::Http(
            "AI response exceeded the 2 MB limit".into(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CoreError::Http("AI response could not be read".into()))?
    {
        if bytes.len() + chunk.len() > MAX_DRAFT_RESPONSE_BYTES {
            return Err(CoreError::Http(
                "AI response exceeded the 2 MB limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let chat: ChatResponse = serde_json::from_slice(&bytes)
        .map_err(|_| CoreError::Http("AI endpoint returned an unexpected response".into()))?;
    let content = chat
        .choices
        .first()
        .and_then(|choice| content_text(&choice.message.content))
        .ok_or_else(|| CoreError::Http("AI response did not contain text".into()))?;
    parse_draft(&content, description)
}

pub fn parse_draft(content: &str, fallback_name: &str) -> Result<WorkflowDraft> {
    let json_text = extract_json(content)
        .ok_or_else(|| CoreError::Http("AI response did not contain a JSON object".into()))?;
    let mut payload: DraftPayload = serde_json::from_str(json_text).map_err(|_| {
        CoreError::Http("AI response JSON did not match the workflow format".into())
    })?;
    if payload.definition.schema_version == 0 {
        payload.definition.schema_version = WORKFLOW_SCHEMA_VERSION;
    }
    let name = payload.name.trim();
    let name = if name.is_empty() {
        fallback_name.trim().chars().take(100).collect::<String>()
    } else {
        name.chars().take(100).collect::<String>()
    };
    let description: String = payload.description.trim().chars().take(2000).collect();
    let tags = validation::clean_tags(&payload.tags);
    let validation_report: ValidationReport = validation::validate_workflow(&payload.definition);
    Ok(WorkflowDraft {
        name,
        description,
        tags,
        definition: payload.definition,
        validation: validation_report,
    })
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let parts = content.as_array()?;
    let mut text = String::new();
    for part in parts {
        if part.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(value) = part.get("text").and_then(Value::as_str) {
                text.push_str(value);
            }
        }
    }
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn extract_json(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    let without_fence = if let Some(rest) = trimmed.strip_prefix("```") {
        let rest = rest
            .strip_prefix("json")
            .or_else(|| rest.strip_prefix("JSON"))
            .unwrap_or(rest);
        rest.trim_start().strip_suffix("```").unwrap_or(rest).trim()
    } else {
        trimmed
    };
    let start = without_fence.find('{')?;
    let end = without_fence.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&without_fence[start..=end])
}

fn system_prompt() -> &'static str {
    r#"You design BITS AI Video Creator workflow drafts. Return ONLY one JSON object, no markdown.
The object must have this shape:
{"name":"...", "description":"...", "tags":["..."], "definition":{"schemaVersion":1,"nodes":[...],"edges":[...]}}
Allowed node types are exactly: trigger.manual, trigger.schedule, action.http, action.delay, action.log, action.account_check, logic.condition, transform.template, error.retry.
Each node has {"id":"unique-id","type":"...","name":"...","config":{},"position":{"x":0,"y":0}}.
Each edge has {"id":"unique-edge","from":"node-id","to":"node-id"} and optionally "branch":"true" or "false" for a logic.condition.
Use exactly one trigger, unique ids, a connected acyclic graph, and only real config fields:
- trigger.schedule: cron, timezone
- action.http: method, url, headers, body, timeoutMs (HTTPS only; never use localhost/private addresses)
- action.delay: seconds
- action.log: message
- action.account_check: accountId
- logic.condition: left, operator (equals|not_equals|contains|not_contains|gt|gte|lt|lte|exists|empty), right
- transform.template: template, format (text|json)
- error.retry: attempts, delayMs
Use {{input.field}}, {{steps.node-id.field}}, and {{secrets.name}} templates where appropriate. Never invent secret values. Keep it small and practical."#
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_definition() -> WorkflowDefinition {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "nodes": [
                {"id":"start","type":"trigger.manual","name":"Start","config":{}},
                {"id":"log","type":"action.log","name":"Log","config":{"message":"Hello"}}
            ],
            "edges": [{"id":"e1","from":"start","to":"log"}]
        }))
        .unwrap()
    }

    #[test]
    fn extracts_fenced_json_and_validates_a_draft() {
        let definition = valid_definition();
        let content = format!(
            "```json\n{}\n```",
            json!({
                "name": "Hello world",
                "description": "A small draft",
                "tags": ["demo", "demo"],
                "definition": definition
            })
        );
        let draft = parse_draft(&content, "Fallback").unwrap();
        assert_eq!(draft.name, "Hello world");
        assert_eq!(draft.tags, vec!["demo"]);
        assert!(draft.validation.valid);
    }

    #[test]
    fn accepts_openai_content_parts() {
        let content = json!([
            {"type": "text", "text": "{\"name\":\"Parts\",\"definition\":"},
            {"type": "text", "text": "{\"schemaVersion\":1,\"nodes\":[],\"edges\":[]}}"}
        ]);
        assert!(content_text(&content).unwrap().contains("Parts"));
        assert!(content_text(&json!(null)).is_none());
    }

    #[test]
    fn rejects_text_without_json() {
        assert!(parse_draft("I cannot help with that", "Fallback").is_err());
    }

    #[test]
    fn reports_invalid_graphs_without_hiding_them() {
        let mut definition = valid_definition();
        definition.edges.clear();
        let content = json!({
            "name": "Disconnected",
            "definition": definition
        })
        .to_string();
        let draft = parse_draft(&content, "Fallback").unwrap();
        assert!(draft.validation.valid, "unreachable nodes are warnings");
        definition.nodes.clear();
        let content = json!({"name": "Empty", "definition": definition}).to_string();
        let draft = parse_draft(&content, "Fallback").unwrap();
        assert!(!draft.validation.valid);
    }

    #[test]
    fn endpoint_requires_https_unless_local_is_allowed() {
        assert!(validation::validate_ai_endpoint("http://api.example.com/v1", false).is_err());
        assert!(validation::validate_ai_endpoint("https://api.example.com/v1", false).is_ok());
        assert!(validation::validate_ai_endpoint("http://127.0.0.1:11434/v1", true).is_ok());
    }
}
