//! Server-anchored licensing for BITS AI Video Creator (BITS License Manager).
//!
//! The desktop app links to a BITS account with a one-time pairing code,
//! exchanges it for a device token (`btk_...`), activates this device on the
//! license server, and receives a short-lived signed token:
//!
//!   `BITS.<base64url(payload JSON)>.<base64url(Ed25519 sig over payload bytes)>`
//!
//! Verification is offline against the Ed25519 public key pinned into the
//! binary at build time via `BITS_LICENSE_PUBKEY` (release CI fetches it from
//! `GET /api/v1/meta/license-pubkey`; the binary never fetches it at runtime).
//! Debug builds without a pinned key run in open mode so `cargo test` and
//! local development stay unlocked; release builds without a key fail closed.
//!
//! Tokens expire after 30 days even for lifetime licenses; the app refreshes
//! them online ahead of expiry and falls back to the cached verified token
//! while offline (`stale-while-offline`).

use crate::db::Database;
use crate::error::{CoreError, Result};
use crate::models::LicenseStatus;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use reqwest::Method;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

pub const LICENSE_TOKEN_PREFIX: &str = "BITS";
pub const LICENSE_TOKEN_META: &str = "license.token";
/// Device bearer token (`btk_...`) obtained from the pairing-code exchange.
pub const LICENSE_DEVICE_TOKEN_META: &str = "license.device_token";
/// Server-side id of the device token, used to revoke the pairing.
pub const LICENSE_DEVICE_TOKEN_ID_META: &str = "license.device_token_id";
pub const LICENSE_SYNCED_META: &str = "license.synced_at";
/// Highest Unix timestamp observed by the license manager. Used to detect a
/// system clock that has been moved backwards to extend an expired token.
pub const LICENSE_CLOCK_META: &str = "license.clock_last_seen";
pub const MAX_LICENSE_TOKEN_BYTES: usize = 16 * 1024;
pub const TOKEN_VERSION: i64 = 2;
pub const PRODUCT_CODE: &str = "bits-ai-video-creator";
pub const DEFAULT_LM_API_URL: &str = "https://license.bits.co.id";
/// Refresh the cached token online once it has less than this much TTL left.
const REFRESH_MARGIN_SECS: i64 = 7 * 86_400;
/// Clock-skew allowance applied to `issued_at`.
const ISSUED_AT_LEEWAY_SECS: i64 = 300;
/// Tolerate small NTP corrections before treating a backwards clock as tampering.
const CLOCK_ROLLBACK_TOLERANCE_SECS: i64 = 86_400;

#[derive(Debug, Error)]
pub enum LicenseError {
    #[error("Format Token Lisensi Tidak Valid")]
    Format,
    #[error("Tanda Tangan Token Lisensi Tidak Valid")]
    Signature,
    #[error("Kunci Publik Lisensi Tidak Tersedia Pada Build Ini")]
    MissingKey,
    #[error("Versi Token Lisensi Tidak Didukung")]
    Version,
    #[error("Produk Pada Token Lisensi Tidak Sesuai")]
    Product,
    #[error("Status Lisensi Tidak Aktif")]
    Inactive,
    #[error("Token Lisensi Tidak Terikat Ke Perangkat Ini")]
    Device,
    #[error("Waktu Terbit Token Lisensi Berada Di Masa Depan")]
    IssuedInFuture,
    #[error("Token Lisensi Sudah Kedaluwarsa")]
    Expired,
    #[error("Lisensi Sudah Kedaluwarsa")]
    LicenseExpired,
    #[error("Isi Token Lisensi Tidak Valid")]
    Payload,
}

impl From<LicenseError> for CoreError {
    fn from(error: LicenseError) -> Self {
        CoreError::validation(error.to_string())
    }
}

/// Claims of a BITS v2 token. Field order mirrors the server payload so
/// re-serialized fixtures sign byte-identical payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitsTokenPayload {
    pub v: i64,
    pub kid: String,
    pub product: String,
    pub license_id: String,
    pub plan: String,
    pub status: String,
    pub subject: String,
    pub device_id: Option<String>,
    pub issued_at: i64,
    pub expires_at: i64,
    pub license_expires_at: Option<i64>,
    #[serde(default)]
    pub entitlements: Vec<String>,
    #[serde(default)]
    pub limits: serde_json::Map<String, Value>,
}

pub fn api_base_url() -> String {
    std::env::var("BITS_LM_API_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_LM_API_URL.to_string())
}

fn device_name() -> String {
    format!("BITS Desktop ({})", std::env::consts::OS)
}

fn now_ts() -> i64 {
    Utc::now().timestamp()
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

#[derive(Deserialize)]
struct Envelope<T> {
    ok: bool,
    data: Option<T>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct DeviceExchange {
    token: String,
    #[serde(rename = "tokenId", default)]
    token_id: Option<String>,
}

#[derive(Deserialize)]
struct ServerProduct {
    #[serde(default)]
    code: String,
}

#[derive(Deserialize)]
struct ServerLicense {
    id: String,
    status: String,
    product: ServerProduct,
    #[allow(dead_code)]
    license_expires_at: Option<String>,
    #[allow(dead_code)]
    device_id: Option<String>,
}

#[derive(Deserialize)]
struct LicensesData {
    #[serde(default)]
    licenses: Vec<ServerLicense>,
}

/// Both `/activate` and `/token` return the minted token in `data.token`.
#[derive(Deserialize)]
struct MintedData {
    #[serde(default)]
    token: Option<String>,
}

#[derive(Clone)]
pub struct LicenseManager {
    db: Database,
    public_key: Option<Arc<[u8]>>,
    public_key_error: Option<String>,
    /// Debug builds without a pinned key are not gated.
    open_mode: bool,
    device_id: String,
    http: reqwest::Client,
}

impl LicenseManager {
    pub fn new(db: Database) -> Result<Self> {
        let raw = option_env!("BITS_LICENSE_PUBKEY");
        Self::from_raw_key_flag(db, raw, cfg!(debug_assertions))
    }

    pub fn from_raw_key(db: Database, raw: Option<&str>) -> Result<Self> {
        Self::from_raw_key_flag(db, raw, cfg!(debug_assertions))
    }

    fn from_raw_key_flag(db: Database, raw: Option<&str>, allow_open: bool) -> Result<Self> {
        let device_id = db.device_id()?;
        let mut public_key_error = None;
        let raw_key = raw.map(str::trim).filter(|value| !value.is_empty());
        let public_key = match raw_key {
            None => None,
            Some(value) => match decode_public_key(value) {
                Ok(bytes) => Some(Arc::from(bytes.into_boxed_slice())),
                Err(error) => {
                    public_key_error = Some(error.to_string());
                    None
                }
            },
        };
        let open_mode = public_key.is_none() && public_key_error.is_none() && allow_open;
        let http = reqwest::Client::builder()
            .user_agent(concat!("BITS-AI-Video-Creator/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| CoreError::Http(error.to_string()))?;
        Ok(Self {
            db,
            public_key,
            public_key_error,
            open_mode,
            device_id,
            http,
        })
    }

    #[cfg(test)]
    pub fn with_public_key(db: Database, public_key: Vec<u8>) -> Result<Self> {
        let device_id = db.device_id()?;
        let http = reqwest::Client::new();
        Ok(Self {
            db,
            public_key: Some(Arc::from(public_key.into_boxed_slice())),
            public_key_error: None,
            open_mode: false,
            device_id,
            http,
        })
    }

    pub fn mode(&self) -> &'static str {
        if self.open_mode {
            "open"
        } else {
            "enforced"
        }
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Returns the last-seen timestamp when the system clock moved backwards
    /// beyond the tolerance. Also advances the watermark as time moves forward.
    fn detect_clock_rollback(&self) -> Option<i64> {
        let last_seen = self
            .db
            .get_meta(LICENSE_CLOCK_META)
            .ok()
            .flatten()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let now = now_ts();
        if last_seen > 0 && now + CLOCK_ROLLBACK_TOLERANCE_SECS < last_seen {
            return Some(last_seen);
        }
        // Throttle writes: status() is called for every gated operation.
        if now > last_seen + 300 {
            let _ = self.db.set_meta(LICENSE_CLOCK_META, &now.to_string());
        }
        None
    }

    pub fn status(&self) -> LicenseStatus {
        if self.open_mode {
            return self.status_with(
                "licensed",
                true,
                None,
                "Build pengembangan ini tidak digerbang lisensi.",
            );
        }
        if let Some(error) = &self.public_key_error {
            return self.status_with(
                "error",
                false,
                None,
                &format!("Kunci Publik Lisensi Tidak Valid: {error}"),
            );
        }
        if let Some(last_seen) = self.detect_clock_rollback() {
            return self.status_with(
                "error",
                false,
                None,
                &format!(
                    "Waktu Sistem Tidak Valid: Jam Sistem Bergerak Mundur (terakhir terlihat {last_seen}). Aktifkan sinkronisasi waktu otomatis lalu coba lagi."
                ),
            );
        }
        let linked = self
            .db
            .get_meta(LICENSE_DEVICE_TOKEN_META)
            .unwrap_or_default()
            .is_some();
        let token = self.db.get_meta(LICENSE_TOKEN_META).unwrap_or_default();
        let Some(token) = token else {
            let message = if linked {
                "Perangkat Ditautkan, Menunggu Sinkronisasi Lisensi."
            } else {
                "Tautkan Lisensi Dengan Kode Paring Dari Akun BITS."
            };
            return self.status_with("unlinked", false, None, message);
        };
        match self.verify_token(&token) {
            Ok(payload) => self.status_with("licensed", true, Some(&payload), "Lisensi Valid."),
            Err(LicenseError::Expired | LicenseError::LicenseExpired) => {
                let detail = self.verify_token_claims_only(&token).ok();
                self.status_with(
                    "expired",
                    false,
                    detail.as_ref(),
                    "Lisensi Sudah Kedaluwarsa.",
                )
            }
            Err(error) => self.status_with("error", false, None, &error.to_string()),
        }
    }

    /// Store an already-verified token (used by tests and legacy flows).
    pub fn activate(&self, token: &str) -> Result<LicenseStatus> {
        let payload = self.verify_token(token.trim())?;
        self.db.set_meta(LICENSE_TOKEN_META, token.trim())?;
        Ok(self.status_with("licensed", true, Some(&payload), "Lisensi Diaktifkan."))
    }

    /// Enforces the license for operations that create or execute work.
    pub fn require(&self) -> Result<()> {
        if self.open_mode || self.status().licensed {
            return Ok(());
        }
        Err(CoreError::validation(
            "Lisensi Aktif Dibutuhkan Untuk Operasi Ini",
        ))
    }

    /// Feature gate: `storyboard`, `voiceover`, `provider-workspaces`,
    /// `automation`, `local-api`, `updates`. Unknown entitlements are simply
    /// absent for older licenses.
    pub fn has_entitlement(&self, code: &str) -> bool {
        if self.open_mode {
            return true;
        }
        let status = self.status();
        status.licensed && status.entitlements.iter().any(|item| item == code)
    }

    /// Pair this device with a BITS account using a one-time code, then sync.
    pub async fn link_code(&self, code: &str) -> Result<LicenseStatus> {
        let code = code.trim().to_uppercase();
        if code.is_empty() || code.len() > 32 {
            return Err(CoreError::validation("Kode Paring Tidak Valid"));
        }
        let exchange: DeviceExchange = self
            .request(
                Method::POST,
                "/api/v1/auth/device/exchange",
                Some(json!({ "code": code })),
                None,
            )
            .await?;
        self.db
            .set_meta(LICENSE_DEVICE_TOKEN_META, &exchange.token)?;
        if let Some(token_id) = exchange.token_id {
            self.db.set_meta(LICENSE_DEVICE_TOKEN_ID_META, &token_id)?;
        }
        self.sync().await
    }

    /// Force an online sync: re-activate this device and mint a fresh token.
    /// On transport failure, a still-valid cached token keeps the app licensed.
    pub async fn refresh(&self) -> Result<LicenseStatus> {
        match self.sync().await {
            Ok(status) => Ok(status),
            Err(error) => {
                if matches!(error, CoreError::Http(_)) {
                    if let Some(token) = self.db.get_meta(LICENSE_TOKEN_META)? {
                        if let Ok(payload) = self.verify_token(&token) {
                            return Ok(self.status_with(
                                "licensed",
                                true,
                                Some(&payload),
                                "Mode Offline: Memakai Lisensi Tersimpan.",
                            ));
                        }
                    }
                }
                Err(error)
            }
        }
    }

    /// Sync on launch: skip the network round-trip while the cached token has
    /// plenty of TTL left.
    pub async fn ensure_fresh(&self) -> Result<LicenseStatus> {
        if self.db.get_meta(LICENSE_DEVICE_TOKEN_META)?.is_none() {
            return Ok(self.status());
        }
        if let Some(token) = self.db.get_meta(LICENSE_TOKEN_META)? {
            if let Ok(payload) = self.verify_token(&token) {
                if payload.expires_at > now_ts() + REFRESH_MARGIN_SECS {
                    return Ok(self.status_with(
                        "licensed",
                        true,
                        Some(&payload),
                        "Lisensi Masih Berlaku.",
                    ));
                }
            }
        }
        self.refresh().await
    }

    /// Revoke server-side (best effort) and clear all local license state.
    pub async fn unlink(&self) -> Result<LicenseStatus> {
        let device_token = self.db.get_meta(LICENSE_DEVICE_TOKEN_META)?;
        let token_id = self.db.get_meta(LICENSE_DEVICE_TOKEN_ID_META)?;
        if let (Some(device_token), Some(token_id)) = (device_token, token_id) {
            // tokenId comes from the exchange response; revoking our own
            // pairing. Worst case (older servers without tokenId) this 404s
            // and the pairing stays until revoked from the BITS web
            // dashboard; local state is always cleared.
            let body = json!({ "tokenId": token_id });
            let _ = self
                .request::<Value>(
                    Method::POST,
                    "/api/v1/auth/device/revoke",
                    Some(body),
                    Some(&device_token),
                )
                .await;
        }
        self.unlink_local()
    }

    fn unlink_local(&self) -> Result<LicenseStatus> {
        self.db.delete_meta(LICENSE_DEVICE_TOKEN_META)?;
        self.db.delete_meta(LICENSE_DEVICE_TOKEN_ID_META)?;
        self.db.delete_meta(LICENSE_TOKEN_META)?;
        self.db.delete_meta(LICENSE_SYNCED_META)?;
        Ok(self.status())
    }

    async fn sync(&self) -> Result<LicenseStatus> {
        let device_token = self
            .db
            .get_meta(LICENSE_DEVICE_TOKEN_META)?
            .ok_or_else(|| CoreError::validation("Perangkat Belum Ditautkan Ke Akun BITS"))?;
        let list: LicensesData = self
            .request(Method::GET, "/api/v1/licenses", None, Some(&device_token))
            .await?;
        let license = list
            .licenses
            .into_iter()
            .find(|row| row.product.code == PRODUCT_CODE && row.status == "active")
            .ok_or_else(|| CoreError::validation("Tidak Ada Lisensi Aktif Untuk Produk Ini"))?;
        // Always (re-)activate this device before minting; the server refuses
        // to mint for an unbound or foreign device.
        let activation: MintedData = self
            .request(
                Method::POST,
                &format!("/api/v1/licenses/{}/activate", license.id),
                Some(json!({
                    "device_id": self.device_id,
                    "device_name": device_name(),
                })),
                Some(&device_token),
            )
            .await?;
        let token = match activation.token {
            Some(token) => token,
            None => {
                let minted: MintedData = self
                    .request(
                        Method::GET,
                        &format!("/api/v1/licenses/{}/token", license.id),
                        None,
                        Some(&device_token),
                    )
                    .await?;
                minted
                    .token
                    .ok_or_else(|| CoreError::Http("Server Tidak Mengembalikan Token".into()))?
            }
        };
        let payload = self.verify_token(token.trim())?;
        self.db.set_meta(LICENSE_TOKEN_META, token.trim())?;
        self.db
            .set_meta(LICENSE_SYNCED_META, &Utc::now().to_rfc3339())?;
        Ok(self.status_with(
            "licensed",
            true,
            Some(&payload),
            "Lisensi Berhasil Disinkronkan.",
        ))
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        bearer: Option<&str>,
    ) -> Result<T> {
        let url = format!("{}{}", api_base_url(), path);
        let mut request = self.http.request(method, &url);
        if let Some(token) = bearer {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|error| {
            CoreError::Http(format!("Server Lisensi Tidak Bisa Dihubungi: {error}"))
        })?;
        let envelope: Envelope<T> = response.json().await.map_err(|error| {
            CoreError::Http(format!("Respon Server Lisensi Tidak Valid: {error}"))
        })?;
        if !envelope.ok {
            return Err(CoreError::validation(
                envelope
                    .message
                    .unwrap_or_else(|| "Permintaan Ke Server Lisensi Ditolak".into()),
            ));
        }
        envelope
            .data
            .ok_or_else(|| CoreError::Http("Respon Server Lisensi Tidak Lengkap".into()))
    }

    fn verify_token(&self, token: &str) -> std::result::Result<BitsTokenPayload, LicenseError> {
        let payload = self.verify_token_claims_only(token)?;
        let now = now_ts();
        if payload.expires_at <= now {
            return Err(LicenseError::Expired);
        }
        if let Some(license_expires_at) = payload.license_expires_at {
            if license_expires_at <= now {
                return Err(LicenseError::LicenseExpired);
            }
        }
        Ok(payload)
    }

    fn verify_token_claims_only(
        &self,
        token: &str,
    ) -> std::result::Result<BitsTokenPayload, LicenseError> {
        let token = token.trim();
        if token.len() > MAX_LICENSE_TOKEN_BYTES {
            return Err(LicenseError::Format);
        }
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 || parts[0] != LICENSE_TOKEN_PREFIX {
            return Err(LicenseError::Format);
        }
        let payload_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| LicenseError::Format)?;
        let signature = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| LicenseError::Format)?;
        let key = self.public_key.as_ref().ok_or(LicenseError::MissingKey)?;
        UnparsedPublicKey::new(&ED25519, key.as_ref())
            .verify(&payload_bytes, &signature)
            .map_err(|_| LicenseError::Signature)?;
        let payload: BitsTokenPayload =
            serde_json::from_slice(&payload_bytes).map_err(|_| LicenseError::Payload)?;
        if payload.v != TOKEN_VERSION {
            return Err(LicenseError::Version);
        }
        if payload.product != PRODUCT_CODE {
            return Err(LicenseError::Product);
        }
        if payload.license_id.trim().is_empty()
            || payload.kid.trim().is_empty()
            || payload.plan.trim().is_empty()
            || payload.subject.trim().is_empty()
        {
            return Err(LicenseError::Payload);
        }
        if payload.status != "active" {
            return Err(LicenseError::Inactive);
        }
        let device_id = payload.device_id.clone().ok_or(LicenseError::Device)?;
        if device_id != self.device_id {
            return Err(LicenseError::Device);
        }
        if payload.issued_at > now_ts() + ISSUED_AT_LEEWAY_SECS {
            return Err(LicenseError::IssuedInFuture);
        }
        Ok(payload)
    }

    fn status_with(
        &self,
        state: &str,
        licensed: bool,
        payload: Option<&BitsTokenPayload>,
        message: &str,
    ) -> LicenseStatus {
        let days_remaining =
            payload.map(|item| ((item.expires_at - now_ts()).max(0) + 86_399) / 86_400);
        LicenseStatus {
            mode: if self.open_mode { "open" } else { "enforced" }.into(),
            state: state.into(),
            licensed,
            plan: payload.map(|item| item.plan.clone()),
            license_id: payload.map(|item| item.license_id.clone()),
            subject: payload.map(|item| item.subject.clone()),
            kid: payload.map(|item| item.kid.clone()),
            issued_at: payload.map(|item| item.issued_at),
            expires_at: payload.map(|item| item.expires_at),
            license_expires_at: payload.and_then(|item| item.license_expires_at),
            days_remaining,
            entitlements: payload
                .map(|item| item.entitlements.clone())
                .unwrap_or_default(),
            device_id: self.device_id.clone(),
            last_synced_at: self.db.get_meta(LICENSE_SYNCED_META).ok().flatten(),
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    // TEST-ONLY deterministic key material. The public key matches the
    // BITS License Manager test signer (seed = 32 x 0x11); it is never used
    // in production builds.
    const TEST_SEED: [u8; 32] = [0x11; 32];
    const TEST_PUBKEY: &str = "0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc";
    const FIXTURE_DEVICE: &str = "00000000-0000-4000-8000-000000000001";

    fn signer() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&TEST_SEED).unwrap()
    }

    fn sign_payload(payload: &BitsTokenPayload) -> String {
        let json = serde_json::to_vec(payload).unwrap();
        let signature = signer().sign(&json);
        format!(
            "BITS.{}.{}",
            URL_SAFE_NO_PAD.encode(json),
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    /// Exact claims of the shipped test fixture (issued 2026-10-23,
    /// token expires 2030-01-01, lifetime license).
    fn fixture_payload() -> BitsTokenPayload {
        BitsTokenPayload {
            v: 2,
            kid: "aivideo-2026-01".into(),
            product: PRODUCT_CODE.into(),
            license_id: "LIC-TESTFIXTURE01".into(),
            plan: "aivideo_lifetime".into(),
            status: "active".into(),
            subject: "USR-TESTFIXTURE01".into(),
            device_id: Some(FIXTURE_DEVICE.into()),
            issued_at: 1_792_713_600,
            expires_at: 1_893_456_000,
            license_expires_at: None,
            entitlements: [
                "storyboard",
                "voiceover",
                "provider-workspaces",
                "automation",
                "local-api",
                "updates",
            ]
            .iter()
            .map(|code| code.to_string())
            .collect(),
            limits: serde_json::Map::new(),
        }
    }

    fn manager_for(device_id: &str) -> LicenseManager {
        let db = Database::open_in_memory().unwrap();
        db.set_meta("device.id", device_id).unwrap();
        LicenseManager::from_raw_key(db, Some(TEST_PUBKEY)).unwrap()
    }

    fn fixture_manager() -> LicenseManager {
        manager_for(FIXTURE_DEVICE)
    }

    fn mutated(mutate: impl FnOnce(&mut BitsTokenPayload)) -> String {
        let mut payload = fixture_payload();
        mutate(&mut payload);
        sign_payload(&payload)
    }

    #[test]
    fn test_seed_derives_the_pinned_test_public_key() {
        let expected = decode_public_key(TEST_PUBKEY).unwrap();
        assert_eq!(signer().public_key().as_ref(), expected.as_slice());
    }

    #[test]
    fn fixture_token_verifies_and_licenses_the_device() {
        let manager = fixture_manager();
        let token = sign_payload(&fixture_payload());
        let payload = manager.verify_token(&token).unwrap();
        assert_eq!(payload.license_id, "LIC-TESTFIXTURE01");
        assert_eq!(payload.license_expires_at, None);
        manager.activate(&token).unwrap();
        assert!(manager.has_entitlement("local-api"));
        assert!(manager.has_entitlement("updates"));
        assert!(!manager.has_entitlement("nonexistent"));
        let status = manager.status();
        assert!(status.licensed);
        assert_eq!(status.state, "licensed");
        assert_eq!(status.plan.as_deref(), Some("aivideo_lifetime"));
        assert_eq!(status.entitlements.len(), 6);
        assert!(manager.require().is_ok());
    }

    #[test]
    fn clock_rollback_is_rejected() {
        let manager = fixture_manager();
        manager.activate(&sign_payload(&fixture_payload())).unwrap();
        manager
            .db
            .set_meta(LICENSE_CLOCK_META, &(now_ts() + 30 * 86_400).to_string())
            .unwrap();
        let status = manager.status();
        assert_eq!(status.state, "error");
        assert!(!status.licensed);
        assert!(status.message.contains("Jam Sistem Bergerak Mundur"));
    }

    #[test]
    fn license_status_serializes_the_frontend_contract() {
        // The UI adapter in `src/lib/api.ts` maps these exact keys. A rename
        // here must be reflected there and in `BackendLicenseStatus`.
        let manager = fixture_manager();
        manager.activate(&sign_payload(&fixture_payload())).unwrap();
        let value = serde_json::to_value(manager.status()).unwrap();
        let object = value.as_object().unwrap();

        assert_eq!(
            object.get("state").and_then(|item| item.as_str()),
            Some("licensed")
        );
        assert_eq!(
            object.get("licensed").and_then(|item| item.as_bool()),
            Some(true)
        );
        assert!(object.get("message").is_some());
        assert!(object.get("entitlements").unwrap().is_array());
        assert!(object.get("expiresAt").unwrap().is_i64());
        assert!(!object.contains_key("status"));
        assert!(!object.contains_key("error"));
    }

    #[test]
    fn tampered_payload_is_rejected() {
        let manager = fixture_manager();
        let token = sign_payload(&fixture_payload());
        let mut tampered = token.split('.').map(str::to_string).collect::<Vec<_>>();
        tampered[1].push('X');
        let tampered = tampered.join(".");
        assert!(matches!(
            manager.verify_token(&tampered),
            Err(LicenseError::Signature | LicenseError::Format)
        ));
        assert!(manager.activate(&tampered).is_err());
        assert!(!manager.status().licensed);
    }

    #[test]
    fn wrong_signature_is_rejected() {
        let manager = fixture_manager();
        let mut payload = fixture_payload();
        payload.subject = "USR-TESTFIXTURE02".into();
        let other = sign_payload(&payload);
        let valid = sign_payload(&fixture_payload());
        let valid_parts: Vec<&str> = valid.split('.').collect();
        let other_parts: Vec<&str> = other.split('.').collect();
        let mixed = format!("BITS.{}.{}", valid_parts[1], other_parts[2]);
        assert!(matches!(
            manager.verify_token(&mixed),
            Err(LicenseError::Signature)
        ));
    }

    #[test]
    fn expired_token_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.expires_at = now_ts() - 10);
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Expired)
        ));
        assert_eq!(manager.activate(&token).unwrap_err().code(), "validation");
        // A token that was valid when stored keeps reporting `expired` state.
        manager.db.set_meta(LICENSE_TOKEN_META, &token).unwrap();
        assert_eq!(manager.status().state, "expired");
        assert!(!manager.status().licensed);
    }

    #[test]
    fn issued_at_too_far_in_the_future_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.issued_at = now_ts() + 400);
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::IssuedInFuture)
        ));
    }

    #[test]
    fn issued_at_within_skew_is_accepted() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.issued_at = now_ts() + 250);
        assert!(manager.verify_token(&token).is_ok());
    }

    #[test]
    fn device_mismatch_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| {
            payload.device_id = Some("11111111-2222-4333-8444-555555555555".into())
        });
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Device)
        ));
    }

    #[test]
    fn null_device_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.device_id = None);
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Device)
        ));
    }

    #[test]
    fn inactive_status_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.status = "suspended".into());
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Inactive)
        ));
    }

    #[test]
    fn past_license_expires_at_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.license_expires_at = Some(now_ts() - 60));
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::LicenseExpired)
        ));
    }

    #[test]
    fn lifetime_license_with_null_license_expiry_is_accepted() {
        let manager = fixture_manager();
        let token = sign_payload(&fixture_payload());
        let payload = manager.verify_token(&token).unwrap();
        assert_eq!(payload.license_expires_at, None);
    }

    #[test]
    fn wrong_product_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.product = "other-product".into());
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Product)
        ));
    }

    #[test]
    fn unsupported_version_is_rejected() {
        let manager = fixture_manager();
        let token = mutated(|payload| payload.v = 3);
        assert!(matches!(
            manager.verify_token(&token),
            Err(LicenseError::Version)
        ));
    }

    #[test]
    fn dev_build_without_a_key_is_open() {
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key(db, None).unwrap();
        assert_eq!(manager.mode(), "open");
        assert!(manager.status().licensed);
        assert!(manager.has_entitlement("storyboard"));
        assert!(manager.require().is_ok());
    }

    #[test]
    fn release_build_without_a_key_fails_closed() {
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key_flag(db, None, false).unwrap();
        assert_eq!(manager.mode(), "enforced");
        assert!(!manager.status().licensed);
        assert!(matches!(
            manager.verify_token(&sign_payload(&fixture_payload())),
            Err(LicenseError::MissingKey)
        ));
        assert!(manager.require().is_err());
    }

    #[test]
    fn invalid_public_key_fails_closed() {
        let db = Database::open_in_memory().unwrap();
        let manager = LicenseManager::from_raw_key(db, Some("not-a-key")).unwrap();
        assert_eq!(manager.mode(), "enforced");
        assert_eq!(manager.status().state, "error");
        assert!(manager.require().is_err());
    }

    #[test]
    fn unlink_clears_all_local_license_state() {
        let manager = fixture_manager();
        let token = sign_payload(&fixture_payload());
        manager.activate(&token).unwrap();
        manager
            .db
            .set_meta(LICENSE_DEVICE_TOKEN_META, "btk_test")
            .unwrap();
        assert!(manager.status().licensed);
        manager.unlink_local().unwrap();
        assert!(!manager.status().licensed);
        assert_eq!(manager.status().state, "unlinked");
        assert!(manager.db.get_meta(LICENSE_TOKEN_META).unwrap().is_none());
        assert!(manager
            .db
            .get_meta(LICENSE_DEVICE_TOKEN_META)
            .unwrap()
            .is_none());
    }
}
