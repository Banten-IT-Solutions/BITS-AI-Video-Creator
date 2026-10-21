//! Optional provider-backed text-to-speech.
//!
//! The desktop UI can always preview a scene with the browser's local speech
//! engine. This module adds an explicit, opt-in path for generating an audio
//! file through any OpenAI-compatible `/audio/speech` endpoint. Credentials are
//! supplied by the caller from the OS keyring and are never logged.

use crate::engine::{build_http_client, ProxyConfig};
use crate::error::{CoreError, Result};
use crate::validation;
use serde_json::{json, Value};
use std::time::Duration;

pub const MAX_TTS_INPUT_CHARS: usize = 4_096;
pub const MAX_TTS_AUDIO_BYTES: usize = 25 * 1024 * 1024;
pub const TTS_FORMATS: &[&str] = &["mp3", "wav", "opus", "aac", "flac"];
pub const DEFAULT_TTS_FORMAT: &str = "mp3";
pub const DEFAULT_TTS_MODEL: &str = "gpt-4o-mini-tts";
pub const DEFAULT_TTS_VOICE: &str = "alloy";

#[derive(Clone)]
pub struct TtsConfig {
    pub endpoint: String,
    pub model: String,
    pub voice: String,
    pub format: String,
    pub speed: f32,
    pub api_key: String,
    pub allow_local_network: bool,
    pub proxy: Option<ProxyConfig>,
}

pub async fn synthesize(config: &TtsConfig, text: &str) -> Result<Vec<u8>> {
    let body = request_body(config, text)?;
    let base = validation::validate_ai_endpoint(&config.endpoint, config.allow_local_network)?;
    if base.query().is_some() {
        return Err(CoreError::validation(
            "TTS endpoint must not contain a query string",
        ));
    }
    let endpoint = format!("{}/audio/speech", base.as_str().trim_end_matches('/'));
    validation::validate_ai_endpoint(&endpoint, config.allow_local_network)?;

    let client = build_http_client(config.allow_local_network, config.proxy.as_ref())?;
    let mut response = client
        .post(endpoint)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|_| CoreError::Http("TTS endpoint request failed".into()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CoreError::Http(format!(
            "TTS endpoint returned HTTP {}",
            status.as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_TTS_AUDIO_BYTES as u64)
    {
        return Err(CoreError::Http(
            "Generated audio exceeded the 25 MB limit".into(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CoreError::Http("Generated audio could not be read".into()))?
    {
        if bytes.len() + chunk.len() > MAX_TTS_AUDIO_BYTES {
            return Err(CoreError::Http(
                "Generated audio exceeded the 25 MB limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(CoreError::Http(
            "TTS endpoint returned an empty audio response".into(),
        ));
    }
    Ok(bytes)
}

pub fn request_body(config: &TtsConfig, text: &str) -> Result<Value> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > MAX_TTS_INPUT_CHARS {
        return Err(CoreError::validation(
            "Voiceover text must be between 1 and 4,096 characters",
        ));
    }
    if config.api_key.trim().is_empty() {
        return Err(CoreError::validation(
            "Configure a TTS API key before generating audio",
        ));
    }
    if config.model.trim().is_empty() || config.model.chars().count() > 100 {
        return Err(CoreError::validation("TTS model name is invalid"));
    }
    if config.voice.trim().is_empty() || config.voice.chars().count() > 160 {
        return Err(CoreError::validation("TTS voice name is invalid"));
    }
    let format = config.format.trim().to_ascii_lowercase();
    if !TTS_FORMATS.contains(&format.as_str()) {
        return Err(CoreError::validation("Unsupported TTS audio format"));
    }
    if !(0.25..=4.0).contains(&config.speed) {
        return Err(CoreError::validation(
            "TTS speed must be between 0.25 and 4.0",
        ));
    }
    Ok(json!({
        "model": config.model.trim(),
        "input": text,
        "voice": config.voice.trim(),
        "response_format": format,
        "speed": config.speed,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> TtsConfig {
        TtsConfig {
            endpoint: "https://api.example.com/v1".into(),
            model: DEFAULT_TTS_MODEL.into(),
            voice: DEFAULT_TTS_VOICE.into(),
            format: DEFAULT_TTS_FORMAT.into(),
            speed: 1.0,
            api_key: "test-key".into(),
            allow_local_network: false,
            proxy: None,
        }
    }

    #[test]
    fn builds_an_openai_compatible_request_body() {
        let body = request_body(&config(), "  Welcome to the studio.  ").unwrap();
        assert_eq!(body["input"], "Welcome to the studio.");
        assert_eq!(body["response_format"], "mp3");
        assert_eq!(body["voice"], "alloy");
    }

    #[test]
    fn validates_text_key_and_format() {
        let mut value = config();
        assert!(request_body(&value, " ").is_err());
        value.api_key.clear();
        assert!(request_body(&value, "Hello").is_err());
        let mut value = config();
        value.format = "exe".into();
        assert!(request_body(&value, "Hello").is_err());
    }

    #[test]
    fn rejects_unsafe_or_plain_http_endpoints_without_local_opt_in() {
        assert!(validation::validate_ai_endpoint("http://api.example.com/v1", false).is_err());
        assert!(validation::validate_ai_endpoint("http://127.0.0.1:8880/v1", true).is_ok());
    }

    #[test]
    fn enforces_the_input_limit() {
        let value = config();
        let text = "a".repeat(MAX_TTS_INPUT_CHARS + 1);
        assert!(request_body(&value, &text).is_err());
    }
}
