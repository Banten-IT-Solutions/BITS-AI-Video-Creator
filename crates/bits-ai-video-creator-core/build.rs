//! Build-time sanity check for the pinned license public key.
//!
//! Release CI embeds the key with `BITS_LICENSE_PUBKEY` (fetched from
//! `GET /api/v1/meta/license-pubkey` on the BITS License Manager). A bad value
//! must be caught here, not silently produce a gated-off release.

fn main() {
    use base64::Engine as _;
    println!("cargo:rerun-if-env-changed=BITS_LICENSE_PUBKEY");
    let Ok(value) = std::env::var("BITS_LICENSE_PUBKEY") else {
        return;
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(trimmed));
    match decoded {
        Ok(key) if key.len() == 32 => {}
        _ => println!(
            "cargo:warning=BITS_LICENSE_PUBKEY is set but does not decode to a 32-byte Ed25519 public key (base64 std or url)"
        ),
    }
}
