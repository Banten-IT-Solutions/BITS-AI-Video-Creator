use crate::db::Database;
use crate::error::{CoreError, Result};
use crate::models::SecretRef;
use crate::validation;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

/// Service name used by the desktop keyring adapter. Kept here so the CLI,
/// desktop shell and tests agree on the namespace.
pub const KEYRING_SERVICE: &str = "id.co.bits.aivideocreator";
pub const MAX_SECRET_BYTES: usize = 16 * 1024;

/// Storage backend for secret values. Implementations must never log or return
/// values through error messages.
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>>;
    fn set(&self, name: &str, value: &str) -> Result<()>;
    fn delete(&self, name: &str) -> Result<()>;
}

/// In-memory store used by tests and by the headless preview build. Values are
/// zeroized when removed or when the store is dropped.
#[derive(Default)]
pub struct MemorySecretStore {
    values: Mutex<HashMap<String, Zeroizing<String>>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn get(&self, name: &str) -> Result<Option<String>> {
        let values = self
            .values
            .lock()
            .map_err(|_| CoreError::Secret("secret store lock poisoned".into()))?;
        Ok(values.get(name).map(|value| value.to_string()))
    }

    fn set(&self, name: &str, value: &str) -> Result<()> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| CoreError::Secret("secret store lock poisoned".into()))?;
        values.insert(name.to_string(), Zeroizing::new(value.to_string()));
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<()> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| CoreError::Secret("secret store lock poisoned".into()))?;
        values.remove(name);
        Ok(())
    }
}

/// Write-only secret facade. The desktop IPC layer must never expose `get`;
/// only the workflow engine may read values.
#[derive(Clone)]
pub struct SecretVault {
    store: Arc<dyn SecretStore>,
    db: Database,
}

impl SecretVault {
    pub fn new(db: Database, store: Arc<dyn SecretStore>) -> Self {
        Self { store, db }
    }

    pub fn memory(db: Database) -> Self {
        Self::new(db, Arc::new(MemorySecretStore::new()))
    }

    pub fn backend_name(&self) -> &'static str {
        "system"
    }

    pub fn list(&self) -> Result<Vec<SecretRef>> {
        self.db.list_secret_refs()
    }

    pub fn set(&self, name: &str, value: &str) -> Result<SecretRef> {
        let name = name.trim();
        validation::validate_secret_name(name)?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(CoreError::validation("Secret value cannot be empty"));
        }
        if trimmed.len() > MAX_SECRET_BYTES {
            return Err(CoreError::validation(
                "Secret value is too large (16 KB maximum)",
            ));
        }
        if trimmed.contains('\0') {
            return Err(CoreError::validation(
                "Secret value contains an invalid character",
            ));
        }
        self.store.set(name, trimmed)?;
        // Metadata is written only after the value is safely stored so a failed
        // keyring write cannot leave a phantom secret reference.
        if let Err(error) = self.db.upsert_secret_ref(name) {
            let _ = self.store.delete(name);
            return Err(error);
        }
        let refs = self.db.list_secret_refs()?;
        refs.into_iter()
            .find(|item| item.name == name)
            .ok_or_else(|| CoreError::internal("Secret metadata was not persisted"))
    }

    pub fn delete(&self, name: &str) -> Result<()> {
        let name = name.trim();
        validation::validate_secret_name(name)?;
        self.store.delete(name)?;
        self.db.delete_secret_ref(name)
    }

    /// Internal engine accessor. Deliberately not exposed as a Tauri command.
    pub fn get(&self, name: &str) -> Result<Option<String>> {
        validation::validate_secret_name(name)?;
        self.store.get(name)
    }

    /// Returns referenced names that are missing from the secret store.
    pub fn missing(&self, names: &[String]) -> Result<Vec<String>> {
        let mut missing = Vec::new();
        for name in names {
            if self.get(name)?.is_none() {
                missing.push(name.clone());
            }
        }
        Ok(missing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> SecretVault {
        SecretVault::memory(Database::open_in_memory().unwrap())
    }

    #[test]
    fn stores_values_and_metadata() {
        let vault = vault();
        let reference = vault.set("provider.token", "abc123").unwrap();
        assert_eq!(reference.name, "provider.token");
        assert_eq!(
            vault.get("provider.token").unwrap().as_deref(),
            Some("abc123")
        );
        assert_eq!(vault.list().unwrap().len(), 1);
    }

    #[test]
    fn rejects_unsafe_names_and_empty_values() {
        let vault = vault();
        assert!(vault.set("../escape", "value").is_err());
        assert!(vault.set("valid", "   ").is_err());
        assert!(vault
            .set("valid", &"x".repeat(MAX_SECRET_BYTES + 1))
            .is_err());
    }

    #[test]
    fn delete_removes_value_and_metadata() {
        let vault = vault();
        vault.set("api_key", "value").unwrap();
        vault.delete("api_key").unwrap();
        assert!(vault.get("api_key").unwrap().is_none());
        assert!(vault.list().unwrap().is_empty());
    }

    #[test]
    fn reports_missing_references_without_leaking_values() {
        let vault = vault();
        vault.set("present", "value").unwrap();
        let missing = vault.missing(&["present".into(), "absent".into()]).unwrap();
        assert_eq!(missing, vec!["absent"]);
    }
}
