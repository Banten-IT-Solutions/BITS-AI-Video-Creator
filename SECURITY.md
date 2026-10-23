# Security Policy

## Supported versions

BITS AI Video Creator 1.0.x receives security fixes on the `main` branch and in tagged releases. Older
pre-release or renamed builds are not supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

1. Open the repository **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version, platform, reproduction steps, and impact.

Do not open a public issue for a vulnerability. Do not include real provider passwords, session
cookies, license private keys, updater keys, Android keystore material, or real license tokens in a
report. Use synthetic values and redact logs.

If private reporting is unavailable, open a minimal public issue asking the maintainer to establish
a private channel; do not disclose the vulnerability details in that issue.

## Threat model

BITS AI Video Creator is a local single-user application. The security boundary is the operating-system user
account and the platform credential vault. It does not defend against:

- malware running as the same OS user;
- a compromised operating system, kernel, WebView, or credential vault;
- providers changing their pages, terms, or access controls;
- users deliberately exporting secrets, license tokens, or generated media outside BITS AI Video Creator;
- network attackers who can already intercept TLS or modify the local machine;
- a user who shares a device-bound license token and device identifier.

The design mitigates:

- accidental secret disclosure through logs, exports, and the local API;
- arbitrary code execution through workflow definitions and plugin packs;
- SSRF against loopback, private, link-local, and IPv4-mapped loopback addresses by default;
- path traversal in download names and provider profile paths;
- unauthenticated access to the opt-in local API;
- unsigned updater artifacts on desktop;
- accidental release builds without the license public key when the release workflow is used.

## Secret handling

- Secrets are stored in the OS credential vault. The database stores only names and timestamps.
- Android uses an Android Keystore-backed store.
- Secret values are write-only over IPC after creation.
- Logs and exports redact secret values.
- There is no plaintext fallback when the vault is unavailable; secret-backed operations fail.
- TTS provider credentials are read from the vault at request time. Storyboard text is sent to the
  configured TTS endpoint; it is not sent anywhere else by the app.

## Licensing

- Release builds fetch the Ed25519 public key from BITS License Manager
  (`/api/v1/meta/license-pubkey`), pin it via `BITS_LICENSE_PUBKEY`, and verify `BITS` v2 tokens
  locally. Private license keys never ship with the app; release builds without a pinned key fail
  closed.
- Development and CI builds without that variable run in `open` mode. Do not publish such a build
  as the paid release.
- License tokens are signed, not encrypted. Treat the token and the device token (`btk_…`) as
  bearer credentials and do not post them publicly. Device binding (one device per license)
  limits reuse, and the pairing can be revoked from the BITS License Manager dashboard.
- The app contacts only BITS License Manager for licensing (pairing exchange, activation, token
  refresh). It does not process card data or call a payment gateway; payment and order handling
  are external at <https://bits.co.id>.

## Local API

The API is disabled by default. When enabled it binds to `127.0.0.1`, requires a bearer token from
the OS vault, validates the `Host` header, rejects browser `Origin`/`Referer` requests, disables
CORS, and caps request size. Rotate the token if it may have been exposed. Tokens use the `bits_`
prefix.

## Updates and signing

- Desktop updater artifacts are signed with the Tauri minisign key. The public key is embedded in
  the application.
- The updater manifest is fetched over HTTPS from the public GitHub Releases endpoint.
- Android APK/AAB artifacts are signed with the release keystore. Verify the certificate
  fingerprint published with the release. The 1.0.0 certificate SHA-256 is
  `A6:43:CF:05:B6:1D:E4:F3:07:60:1F:CD:47:34:D8:60:9F:C1:BB:57:8B:11:72:8B:31:6F:AF:B1:A7:DF:0F:30`.
- Windows installers are currently **unsigned** with Authenticode. Treat SmartScreen warnings as
  expected for unsigned builds and verify the SHA-256 checksum before running an installer.

## Release credentials

Release credentials are never committed:

- `.secrets/` is ignored;
- GitHub Actions secrets hold the updater key, Android keystore, and passwords;
- CI recreates the ignored Android `keystore.properties` at build time;
- private license keys are not part of the application, repository, or CI;
- release builds receive only the public license key.

If a release credential is exposed, rotate it immediately. Rotating the updater key requires
publishing a new build with the new public key. Rotating the Android keystore changes the signing
identity; Android will reject in-place updates signed by a different key.

## Known dependency advisories

### glib 0.18 (GHSA-wrw7-89jp-8q8g, moderate)

The Linux desktop build uses Tauri 2.12.4, which pins the GTK 0.18 / `glib` 0.18.5 stack. The
advisory is fixed in `glib` 0.20.0, which is not source-compatible with GTK 0.18. BITS AI Video Creator does not
call the affected `VariantStrIter` API directly; the advisory is retained as an open upstream
tracking item rather than dismissed. It does not affect Windows or Android builds. Remove this note
after Tauri upgrades to a GTK stack that permits `glib` 0.20 or later.

## Dependency and build hygiene

- `Cargo.lock` and `package-lock.json` are committed.
- CI runs `cargo fmt --check`, `cargo clippy -D warnings`, Rust tests, TypeScript checks, frontend
  tests, and production builds.
- Workflow and plugin inputs are validated before persistence.
- External network destinations are validated at execution time, including redirects.
- Release builds must set `BITS_LICENSE_PUBKEY`; verify the compiled key before publishing.
