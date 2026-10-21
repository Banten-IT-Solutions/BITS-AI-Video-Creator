use crate::models::ProviderTool;

/// Provider-hosted tools are intentionally webview-only. They are not vendor
/// APIs and their availability/terms are controlled by the provider.
pub const PROVIDER_TOOLS: &[(&str, &str, &str, &str, &str, &str)] = &[
    (
        "storyboard",
        "Storyboard",
        "Open the hosted Google Flow storyboard tool with an existing Google Flow session.",
        "google-flow",
        "https://flow.google.com/shared/tool/c66ec783-8729-4035-9934-b7f48907365c",
        "Hosted provider page, not the native storyboard editor. Uses the selected Google Flow profile; provider UI changes can break it.",
    ),
    (
        "gemini-tts",
        "Gemini TTS",
        "Open the hosted Gemini text-to-speech share with an existing Gemini session.",
        "gemini",
        "https://share.gemini.google/jLVZLHqihx0e",
        "Hosted provider page, not the native Voiceover studio. It is a web tool, not a Gemini TTS API.",
    ),
];

pub fn tools() -> Vec<ProviderTool> {
    PROVIDER_TOOLS
        .iter()
        .map(
            |(id, name, description, account_provider, url, hint)| ProviderTool {
                id: (*id).to_string(),
                name: (*name).to_string(),
                description: (*description).to_string(),
                account_provider: (*account_provider).to_string(),
                url: (*url).to_string(),
                hint: (*hint).to_string(),
            },
        )
        .collect()
}

pub fn tool(id: &str) -> Option<ProviderTool> {
    PROVIDER_TOOLS
        .iter()
        .find(|(tool_id, ..)| *tool_id == id)
        .map(
            |(id, name, description, account_provider, url, hint)| ProviderTool {
                id: (*id).to_string(),
                name: (*name).to_string(),
                description: (*description).to_string(),
                account_provider: (*account_provider).to_string(),
                url: (*url).to_string(),
                hint: (*hint).to_string(),
            },
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_tools_are_https_and_bound_to_supported_accounts() {
        for tool in tools() {
            assert!(tool.url.starts_with("https://"));
            assert!(crate::providers::is_supported(&tool.account_provider));
            assert!(tool.id.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        }
    }

    #[test]
    fn unknown_tool_is_rejected() {
        assert!(tool("does-not-exist").is_none());
        assert!(tool("storyboard").is_some());
    }
}
