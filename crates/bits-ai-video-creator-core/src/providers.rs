use crate::models::ProviderInfo;

pub const PROVIDERS: &[(&str, &str, &str, &str)] = &[
    (
        "google-flow",
        "Google Flow",
        "https://flow.google/",
        "Sign in inside the Google Flow webview. BITS AI Video Creator never asks for your Google password.",
    ),
    (
        "dola",
        "Dola",
        "https://www.dola.com/chat/",
        "Sign in inside the Dola webview. Only account metadata is stored locally.",
    ),
    (
        "leonardo",
        "Leonardo AI",
        "https://app.leonardo.ai/",
        "Sign in inside the Leonardo AI webview. Sessions stay in the isolated profile.",
    ),
    (
        "chatgpt",
        "ChatGPT",
        "https://chatgpt.com/",
        "Sign in inside the ChatGPT webview. Session cookies remain in the provider profile.",
    ),
    (
        "migoo",
        "Migoo",
        "https://migoo.ai/",
        "Sign in inside the Migoo webview. Only account metadata is stored locally.",
    ),
    (
        "gemini",
        "Gemini",
        "https://gemini.google.com/app",
        "Sign in inside the Gemini webview. BITS AI Video Creator never reads your credentials.",
    ),
];

pub fn providers() -> Vec<ProviderInfo> {
    PROVIDERS
        .iter()
        .map(|(id, name, url, hint)| ProviderInfo {
            id: (*id).to_string(),
            name: (*name).to_string(),
            url: (*url).to_string(),
            sign_in_hint: (*hint).to_string(),
        })
        .collect()
}

pub fn provider(id: &str) -> Option<ProviderInfo> {
    PROVIDERS
        .iter()
        .find(|p| p.0 == id)
        .map(|(id, name, url, hint)| ProviderInfo {
            id: (*id).to_string(),
            name: (*name).to_string(),
            url: (*url).to_string(),
            sign_in_hint: (*hint).to_string(),
        })
}

pub fn is_supported(id: &str) -> bool {
    PROVIDERS.iter().any(|p| p.0 == id)
}

pub fn provider_name(id: &str) -> &str {
    PROVIDERS
        .iter()
        .find(|p| p.0 == id)
        .map(|p| p.1)
        .unwrap_or("Other")
}
