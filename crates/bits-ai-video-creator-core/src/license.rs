//! Offline, signed license support for BITS AI Video Creator.
//!
//! A license token is `BITS1.<base64url(payload JSON)>.<base64url(Ed25519 sig)>`.
//! Verification is entirely local; no license server is required. The public
//! key is compiled into the application with `BITS_LICENSE_PUBKEY`.
//! When that variable is absent the build is intentionally **not** gated (for
//! local development and CI). Release builds must embed the public key.
//!
//! Plans are monthly, yearly, and lifetime. Payment is handled outside the app
//! (QRIS / transfer / storefront); the product owner runs `license-issuer` to
//! sign a token after payment. The private key never ships with the app.

use crate::db::Database;
use crate::error::{CoreError, Result};
use crate::models::{LicensePlan, LicenseStatus};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const LICENSE_TOKEN_PREFIX: &str = "BITS1";
pub const LICENSE_TOKEN_META: &str = "license.token";
pub const MAX_LICENSE_TOKEN_BYTES: usize = 16 * 1024;
pub const MONTHLY_MAX_DAYS: i64 = 31;
pub const YEARLY_MAX_DAYS: i64 = 366;

pub const PLAN_MONTHLY: &str = "monthly";
pub const PLAN_YEARLY: &str = "yearly";
pub const PLAN_LIFETIME: &str = "lifetime";

pub fn license_plans() -> Vec<LicensePlan> {
    vec![
        LicensePlan {
            id: PLAN_MONTHLY.into(),
            name: "Bulanan".into(),
            price_idr: 20_000,
            billing_period: "monthly".into(),
            duration_days: Some(30),
            description: "Untuk eksplorasi dan proyek jangka pendek.".into(),
            features: plan_features(),
        },
        LicensePlan {
            id: PLAN_YEARLY.into(),
            name: "Tahunan".into(),
            price_idr: 200_000,
            billing_period: "yearly".into(),
            duration_days: Some(365),
            description: "Hemat dua bulan untuk produksi rutin.".into(),
            features: plan_features(),
        },
        LicensePlan {
            id: PLAN_LIFETIME.into(),
            name: "Lifetime".into(),
            price_idr: 500_000,
            billing_period: "lifetime".into(),
            duration_days: None,
            description: "Sekali bayar, pakai selama aplikasi didukung.".into(),
            features: plan_features(),
        },
    ]
}

fn plan_features() -> Vec<String> {
    vec![
        "storyboard".into(),
        "voiceover".into(),
        "provider-workspaces".into(),
        "automation".into(),
        "local-api".into(),
        "updates".into(),
    ]
}

pub fn plan_for(id: &str) -> Option<LicensePlan> {
    license_plans().into_iter().find(|plan| plan.id == id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub version: u32,
    pub license_id: String,
    pub plan: String,
    pub status: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    pub issued_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub features: Vec<String>,
}

#[derive(Clone)]
pub struct LicenseManager {
    db: Database,
    public_key: Option<Arc<[u8]>>,
    public_key_error: Option<String>,
    device_id: String,
}

impl LicenseManager {
    pub fn new(db: Database) -> Result<Self> {
        let raw = option_env!("BITS_LICENSE_PUBKEY");
        Self::from_raw_key(db, raw)
    }

    pub fn from_raw_key(db: Database, raw: Option<&str>) -> Result<Self> {
        let device_id = db.device_id()?;
        let mut public_key_error = None;
        let public_key = match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => None,
            Some(value) => match decode_public_key(value) {
                Ok(bytes) => Some(Arc::from(bytes.into_boxed_slice())),
                Err(error) => {
                    public_key_error = Some(error.to_string());
                    None
                }
            },
        };
        Ok(Self {
            db,
            public_key,
            public_key_error,
            device_id,
        })
    }

    #[cfg(test)]
    pub fn with_public_key(db: Database, public_key: Vec<u8>) -> Result<Self> {
        let device_id = db.device_id()?;
        Ok(Self {
            db,
            public_key: Some(Arc::from(public_key.into_boxed_slice())),
            public_key_error: None,
            device_id,
        })
    }

    pub fn mode(&self) -> &'static str {
        if self.public_key.is_some() || self.public_key_error.is_some() {
            "enforced"
        } else {
            "open"
        }
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn status(&self) -> LicenseStatus {
        if self.mode() == "open" {
            return LicenseStatus {
                mode: "open".into(),
                licensed: true,
                plan: None,
                plan_name: None,
                subject: None,
                license_id: None,
                issued_at: None,
                expires_at: None,
                days_remaining: None,
                device_id: self.device_id.clone(),
                message: "This development build is not license-gated.".into(),
            };
        }
        if let Some(error) = &self.public_key_error {
            return LicenseStatus {
                mode: "enforced".into(),
                licensed: false,
                plan: None,
                plan_name: None,
                subject: None,
                license_id: None,
                issued_at: None,
                expires_at: None,
                days_remaining: None,
                device_id: self.device_id.clone(),
                message: format!("License public key is invalid: {error}"),
            };
        }
        let token = self.db.get_meta(LICENSE_TOKEN_META).unwrap_or_default();
        let Some(token) = token else {
            return self.unlicensed("Activation required.");
        };
        match self.verify(&token) {
            Ok(payload) => self.licensed_status(&payload, "License is valid."),
            Err(error) => self.unlicensed(format!("Stored license is invalid: {error}")),
        }
    }

    pub fn activate(&self, token: &str) -> Result<LicenseStatus> {
        let payload = self.verify(token.trim()).map_err(CoreError::validation)?;
        self.db.set_meta(LICENSE_TOKEN_META, token.trim())?;
        Ok(self.licensed_status(&payload, "License activated."))
    }

    pub fn deactivate(&self) -> Result<LicenseStatus> {
        self.db.delete_meta(LICENSE_TOKEN_META)?;
        Ok(self.status())
    }

    /// Enforces the license for operations that create or execute work.
    pub fn require(&self) -> Result<()> {
        if self.mode() == "open" || self.status().licensed {
            return Ok(());
        }
        Err(CoreError::validation(
            "A valid BITS AI Video Creator license is required for this operation",
        ))
    }

    fn licensed_status(&self, payload: &LicensePayload, message: &str) -> LicenseStatus {
        let plan = plan_for(&payload.plan);
        let expires_at = payload.expires_at.clone();
        let days_remaining = expires_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|expires| {
                let seconds = (expires.with_timezone(&Utc) - Utc::now()).num_seconds();
                (seconds.max(0) + 86_399) / 86_400
            });
        LicenseStatus {
            mode: "enforced".into(),
            licensed: true,
            plan: Some(payload.plan.clone()),
            plan_name: plan.map(|value| value.name),
            subject: payload.subject.clone(),
            license_id: Some(payload.license_id.clone()),
            issued_at: Some(payload.issued_at.clone()),
            expires_at,
            days_remaining,
            device_id: self.device_id.clone(),
            message: message.into(),
        }
    }

    fn unlicensed(&self, message: impl Into<String>) -> LicenseStatus {
        LicenseStatus {
            mode: "enforced".into(),
            licensed: false,
            plan: None,
            plan_name: None,
            subject: None,
            license_id: None,
            issued_at: None,
            expires_at: None,
            days_remaining: None,
            device_id: self.device_id.clone(),
            message: message.into(),
        }
    }

    fn verify(&self, token: &str) -> std::result::Result<LicensePayload, String> {
        if token.len() > MAX_LICENSE_TOKEN_BYTES {
            return Err("token is too large".into());
        }
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 || parts[0] != LICENSE_TOKEN_PREFIX {
            return Err("token format is not recognized".into());
        }
        let payload_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| "payload encoding is invalid".to_string())?;
        let signature = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| "signature encoding is invalid".to_string())?;
        let key = self
            .public_key
            .as_ref()
            .ok_or_else(|| "this build has no license public key".to_string())?;
        UnparsedPublicKey::new(&ED25519, key.as_ref())
            .verify(&payload_bytes, &signature)
            .map_err(|_| "signature verification failed".to_string())?;
        let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
            .map_err(|_| "payload JSON is invalid".to_string())?;
        if payload.version != 1 {
            return Err("unsupported license version".into());
        }
        if payload.license_id.trim().is_empty() || payload.license_id.chars().count() > 128 {
            return Err("license id is invalid".into());
        }
        let plan = plan_for(payload.plan.trim())
            .ok_or_else(|| "license plan is not recognized".to_string())?;
        if payload.plan != plan.id {
            return Err("license plan is not normalized".into());
        }
        if payload.status != "active" {
            return Err("license is not active".into());
        }
        if let Some(device_id) = &payload.device_id {
            if device_id != &self.device_id {
                return Err("license is bound to a different device".into());
            }
        }
        let issued_at = DateTime::parse_from_rfc3339(&payload.issued_at)
            .map_err(|_| "issued timestamp is invalid".to_string())?
            .with_timezone(&Utc);
        if issued_at > Utc::now() + Duration::minutes(5) {
            return Err("license issue time is in the future".into());
        }
        match plan.id.as_str() {
            PLAN_MONTHLY | PLAN_YEARLY => {
                let expires_at = payload
                    .expires_at
                    .as_deref()
                    .ok_or_else(|| "paid plan license has no expiry".to_string())?;
                let expires = DateTime::parse_from_rfc3339(expires_at)
                    .map_err(|_| "expiry timestamp is invalid".to_string())?
                    .with_timezone(&Utc);
                if expires <= Utc::now() {
                    return Err("license has expired".into());
                }
                if expires <= issued_at {
                    return Err("license expiry precedes issue time".into());
                }
                let max_days = if plan.id == PLAN_MONTHLY {
                    MONTHLY_MAX_DAYS
                } else {
                    YEARLY_MAX_DAYS
                };
                if expires - issued_at > Duration::days(max_days) {
                    return Err("license expiry exceeds the plan duration".into());
                }
            }
            PLAN_LIFETIME => {
                if payload.expires_at.is_some() {
                    return Err("lifetime license must not have an expiry".into());
                }
            }
            _ => return Err("license plan is not recognized".into()),
        }
        Ok(payload)
    }
}

fn decode_public_key(value: &str) -> std::result::Result<Vec<u8>, String> {
    let trimmed = value.trim();
    let decoded = URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(trimmed))
        .map_err(|_| "expected a base64-encoded Ed25519 public key".to_string())?;
    if decoded.len() != 32 {
        return Err("Ed25519 public key must be 32 bytes".into());
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    struct Keys {
        key_pair: Ed25519KeyPair,
        public_key: Vec<u8>,
    }

    fn keys() -> Keys {
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let public_key = key_pair.public_key().as_ref().to_vec();
        Keys {
            key_pair,
            public_key,
        }
    }

    fn token(keys: &Keys, payload: &LicensePayload) -> String {
        let json = serde_json::to_vec(payload).unwrap();
        let signature = keys.key_pair.sign(&json);
        format!(
            "BITS1.{}.{}",
            URL_SAFE_NO_PAD.encode(json),
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    fn payload(plan: &str, device_id: Option<String>) -> LicensePayload {
        let lifetime = plan == PLAN_LIFETIME;
        LicensePayload {
            version: 1,
            license_id: "lic_test".into(),
            plan: plan.into(),
            status: "active".into(),
            subject: Some("Test User".into()),
            device_id,
            issued_at: Utc::now().to_rfc3339(),
            expires_at: if lifetime {
                None
            } else if plan == PLAN_YEARLY {
                Some((Utc::now() + Duration::days(365)).to_rfc3339())
            } else {
                Some((Utc::now() + Duration::days(30)).to_rfc3339())
            },
            features: plan_features(),
        }
    }

    #[test]
    fn plan_catalog_matches_the_published_prices() {
        let plans = license_plans();
        assert_eq!(plans.len(), 3);
        assert_eq!(plans[0].price_idr, 20_000);
        assert_eq!(plans[1].price_idr, 200_000);
        assert_eq!(plans[2].price_idr, 500_000);
        assert_eq!(plans[2].duration_days, None);
    }

    #[test]
    fn base64_public_key_build_accepts_an_issuer_compatible_token() {
        let keys = keys();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&keys.public_key);
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key(db, Some(&encoded)).unwrap();
        let token = token(&keys, &payload(PLAN_MONTHLY, None));
        let status = manager.activate(&token).unwrap();
        assert!(status.licensed);
        assert_eq!(status.plan_name.as_deref(), Some("Bulanan"));
        assert!(status.days_remaining.unwrap_or_default() >= 29);
        assert_eq!(manager.mode(), "enforced");
        assert!(manager.require().is_ok());
    }

    #[test]
    fn valid_device_bound_lifetime_license_is_accepted() {
        let keys = keys();
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::with_public_key(db, keys.public_key.clone()).unwrap();
        let token = token(
            &keys,
            &payload(PLAN_LIFETIME, Some(manager.device_id().to_string())),
        );
        let status = manager.activate(&token).unwrap();
        assert!(status.licensed);
        assert_eq!(status.plan.as_deref(), Some(PLAN_LIFETIME));
        assert_eq!(status.expires_at, None);
        assert!(manager.status().licensed);
        assert!(manager.require().is_ok());
    }

    #[test]
    fn tampered_or_other_device_license_is_rejected() {
        let keys = keys();
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::with_public_key(db, keys.public_key.clone()).unwrap();
        let other_device = token(&keys, &payload(PLAN_MONTHLY, Some("other-device".into())));
        assert!(manager.activate(&other_device).is_err());
        let mut token = token(&keys, &payload(PLAN_MONTHLY, None));
        token.push('x');
        assert!(manager.activate(&token).is_err());
    }

    #[test]
    fn expired_license_is_rejected() {
        let keys = keys();
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::with_public_key(db, keys.public_key.clone()).unwrap();
        let mut item = payload(PLAN_MONTHLY, None);
        item.expires_at = Some((Utc::now() - Duration::days(1)).to_rfc3339());
        let token = token(&keys, &item);
        assert!(manager.activate(&token).is_err());
    }

    #[test]
    fn plan_semantics_are_enforced() {
        let keys = keys();
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::with_public_key(db, keys.public_key.clone()).unwrap();

        let mut monthly = payload(PLAN_MONTHLY, None);
        monthly.expires_at = Some((Utc::now() + Duration::days(90)).to_rfc3339());
        assert!(manager.activate(&token(&keys, &monthly)).is_err());

        let mut lifetime = payload(PLAN_LIFETIME, None);
        lifetime.expires_at = Some((Utc::now() + Duration::days(30)).to_rfc3339());
        assert!(manager.activate(&token(&keys, &lifetime)).is_err());

        let mut unknown = payload(PLAN_MONTHLY, None);
        unknown.plan = "pro".into();
        assert!(manager.activate(&token(&keys, &unknown)).is_err());
    }

    #[test]
    fn no_public_key_means_open_mode() {
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key(db, None).unwrap();
        assert_eq!(manager.mode(), "open");
        assert!(manager.status().licensed);
        assert!(manager.require().is_ok());
    }

    #[test]
    fn invalid_public_key_fails_closed() {
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key(db, Some("not-a-key")).unwrap();
        assert_eq!(manager.mode(), "enforced");
        assert!(!manager.status().licensed);
        assert!(manager.require().is_err());
    }
}
