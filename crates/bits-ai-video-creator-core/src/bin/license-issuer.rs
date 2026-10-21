//! Offline license issuer for BITS AI Video Creator.
//!
//! This tool is **not** bundled with the desktop application. Keep the private
//! key offline and issue tokens only after payment has been confirmed.
//!
//! Examples:
//!   cargo run -p bits-ai-video-creator-core --bin license-issuer -- generate --out owner
//!   cargo run -p bits-ai-video-creator-core --bin license-issuer -- issue \
//!     --key owner.key --license-id lic_123 --plan yearly --subject "Studio" \
//!     --device-id <device-id> --out license.txt

use base64::{
    engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _,
};
use bits_ai_video_creator_core::license::{
    license_plans, LicensePayload, LICENSE_TOKEN_PREFIX, MONTHLY_MAX_DAYS, PLAN_LIFETIME,
    PLAN_MONTHLY, PLAN_YEARLY, YEARLY_MAX_DAYS,
};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    if let Err(error) = run() {
        eprintln!("license-issuer: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(usage)?;
    let flags = parse_flags(args.collect())?;
    match command.as_str() {
        "generate" => generate(&flags),
        "issue" => issue(&flags),
        "plans" => {
            for plan in license_plans() {
                let duration = plan
                    .duration_days
                    .map(|days| format!("{days} days"))
                    .unwrap_or_else(|| "no expiry".into());
                println!(
                    "{:<9} Rp{:<8} {} ({})",
                    plan.id, plan.price_idr, plan.name, duration
                );
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            println!("{}", usage());
            Ok(())
        }
        other => Err(format!("unknown command '{other}'\n{}", usage())),
    }
}

fn usage() -> String {
    format!(
        r#"BITS AI Video Creator license issuer

  generate --out <prefix>
      Creates <prefix>.key (PKCS#8 private key) and <prefix>.pub (base64 public key).
      Use the public key as BITS_LICENSE_PUBKEY at build time.

  issue --key <private-key> --license-id <id> --plan <plan> [options]
      --subject <name>        Optional display name
      --device-id <id>        Optional device binding
      --expires-days <n>      Optional; defaults to 30 monthly, 365 yearly
      --features <list>       Optional comma-separated feature ids
      --out <file>            Optional output file; otherwise prints to stdout

  plans
      Print the plan catalog and prices.

  Plans: monthly (Rp20.000), yearly (Rp200.000), lifetime (Rp500.000).
  Lifetime tokens must have no expiry. Monthly/yearly tokens are capped at
  {MONTHLY_MAX_DAYS}/{YEARLY_MAX_DAYS} days to prevent plan confusion.
  Tokens use {LICENSE_TOKEN_PREFIX}.<payload>.<signature> (base64url, no padding)."#
    )
}

fn parse_flags(values: Vec<String>) -> Result<HashMap<String, String>, String> {
    let mut flags = HashMap::new();
    let mut index = 0;
    while index < values.len() {
        let key = &values[index];
        if !key.starts_with("--") {
            return Err(format!("unexpected argument '{key}'"));
        }
        let name = key.trim_start_matches("--").to_string();
        let value = values
            .get(index + 1)
            .ok_or_else(|| format!("missing value for --{name}"))?;
        flags.insert(name, value.clone());
        index += 2;
    }
    Ok(flags)
}

fn generate(flags: &HashMap<String, String>) -> Result<(), String> {
    let prefix = flags
        .get("out")
        .ok_or_else(|| "generate requires --out <prefix>".to_string())?;
    let private_path = PathBuf::from(format!("{prefix}.key"));
    let public_path = PathBuf::from(format!("{prefix}.pub"));
    if private_path.exists() || public_path.exists() {
        return Err("refusing to overwrite an existing key; choose a new --out prefix".into());
    }
    let rng = SystemRandom::new();
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng)
        .map_err(|_| "could not generate an Ed25519 key".to_string())?;
    let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref())
        .map_err(|_| "could not load the generated key".to_string())?;
    write_private_key(&private_path, pkcs8.as_ref())?;
    write_public_key(
        &public_path,
        STANDARD.encode(key_pair.public_key().as_ref()).as_bytes(),
    )?;
    println!("private key: {}", private_path.display());
    println!("public key:  {}", public_path.display());
    println!(
        "build env:   BITS_LICENSE_PUBKEY={}",
        STANDARD.encode(key_pair.public_key().as_ref())
    );
    Ok(())
}

fn issue(flags: &HashMap<String, String>) -> Result<(), String> {
    let key_path = flags
        .get("key")
        .ok_or_else(|| "issue requires --key <private-key>".to_string())?;
    let license_id = required(flags, "license-id")?;
    let plan = required(flags, "plan")?;
    if license_id.len() > 128 {
        return Err("license id is too long".into());
    }
    let parsed_plan = match plan {
        PLAN_MONTHLY | PLAN_YEARLY | PLAN_LIFETIME => plan,
        _ => {
            return Err(format!(
                "--plan must be one of: monthly, yearly, lifetime (got '{plan}')"
            ))
        }
    };
    let issued_at = chrono::Utc::now();
    let expires_at = if parsed_plan == PLAN_LIFETIME {
        if flags.contains_key("expires-days") {
            return Err("lifetime licenses must not use --expires-days".into());
        }
        None
    } else {
        let max_days = if parsed_plan == PLAN_MONTHLY {
            MONTHLY_MAX_DAYS
        } else {
            YEARLY_MAX_DAYS
        };
        let default_days = if parsed_plan == PLAN_MONTHLY { 30 } else { 365 };
        let days: i64 = match flags.get("expires-days") {
            Some(value) => value
                .parse()
                .map_err(|_| "--expires-days must be an integer".to_string())?,
            None => default_days,
        };
        if !(1..=max_days).contains(&days) {
            return Err(format!(
                "--expires-days for {parsed_plan} must be between 1 and {max_days}"
            ));
        }
        Some((issued_at + chrono::Duration::days(days)).to_rfc3339())
    };
    let features = flags
        .get("features")
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            license_plans()
                .into_iter()
                .find(|item| item.id == parsed_plan)
                .map(|item| item.features)
                .unwrap_or_default()
        });
    let payload = LicensePayload {
        version: 1,
        license_id: license_id.to_string(),
        plan: parsed_plan.to_string(),
        status: "active".into(),
        subject: flags.get("subject").cloned(),
        device_id: flags.get("device-id").cloned(),
        issued_at: issued_at.to_rfc3339(),
        expires_at,
        features,
    };
    let bytes = fs::read(Path::new(key_path)).map_err(|error| error.to_string())?;
    let key_pair = Ed25519KeyPair::from_pkcs8(&bytes)
        .map_err(|_| "private key is not a PKCS#8 Ed25519 key".to_string())?;
    let payload_json = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    let signature = key_pair.sign(&payload_json);
    let token = format!(
        "{}.{}.{}",
        LICENSE_TOKEN_PREFIX,
        URL_SAFE_NO_PAD.encode(&payload_json),
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    );
    if let Some(output) = flags.get("out") {
        fs::write(output, &token).map_err(|error| error.to_string())?;
        println!("wrote token to {output}");
    } else {
        println!("{token}");
    }
    Ok(())
}

fn required<'a>(flags: &'a HashMap<String, String>, name: &str) -> Result<&'a str, String> {
    flags
        .get(name)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("issue requires --{name}"))
}

fn write_private_key(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())
}

fn write_public_key(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())
}
