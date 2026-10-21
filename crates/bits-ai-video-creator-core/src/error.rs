use serde::ser::{Serialize, SerializeStruct, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("network error: {0}")]
    Http(String),
    #[error("secret store error: {0}")]
    Secret(String),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("run cancelled")]
    Cancelled,
    #[error("run timed out")]
    Timeout,
    #[error("{0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "validation",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Database(_) => "database",
            Self::Serde(_) => "serialization",
            Self::Http(_) => "network",
            Self::Secret(_) => "secret",
            Self::Io(_) => "io",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Internal(_) => "internal",
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("CoreError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
