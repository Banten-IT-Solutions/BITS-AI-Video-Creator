# BITS AI Video Creator 1.0.0

BITS AI Video Creator is a local-first AI video studio for storyboards, shot planning, scene
voiceover, and the provider/automation work that supports production. It combines a Tauri 2 desktop
shell, a React 18 interface, a Rust core, and a local SQLite database. The Android build reuses the
same core and interface.

The studio is **not** a credential extractor, anti-detection tool, hosted render farm, or a vendor
API client. Storyboards, voiceover scripts, provider-account metadata, and automation definitions
stay on the device. Provider passwords and provider session cookies are never written to the BITS AI
Video Creator database.

[![CI](https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/actions/workflows/ci.yml/badge.svg)](https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-56e5a3.svg)](LICENSE)

## What is inside

### Studio

- **Storyboards** — create a scene plan with nested scenes and shots, camera notes, transitions,
  dialogue, generation prompts, visual style, aspect ratio, and runtime totals. Scenes and shots can
  be reordered; a dirty-state guard protects unsaved edits.
- **Voiceover studio** — one script per scene with local system-speech preview, voice/rate/pitch/
  volume controls, and optional provider-generated audio. Generated files are referenced in the
  storyboard and can be opened or removed without deleting the file.
- **Exports** — write a clean Markdown production brief or a complete JSON snapshot from any
  storyboard.

### Providers

- Local account metadata with favorites, tags, search, duplicate detection, and import/export.
- Isolated desktop provider WebViews with per-account profiles and a sanitized download bridge.
- Provider-hosted storyboard and speech pages, clearly separated from the native studio.
- Android opens provider pages in the system browser; embedded provider sessions are desktop-only.

### Automation (supporting module)

- Visual workflow editor with manual and scheduled triggers, HTTP, delay, log, account-check,
  condition, template, and retry nodes.
- Durable execution engine with bounded concurrency, cancellation, timeouts, retries, idempotency
  keys, step history, and restart recovery.
- Cron scheduler with IANA time zones and explicit missed-run recording.
- Run history, redacted structured logs, retention controls, prompt library, and declarative plugin
  packs limited to HTTPS HTTP presets.
- Optional loopback-only local API with bearer authentication.

## Plans and licensing

BITS AI Video Creator is licensed through [BITS License Manager](https://license.bits.co.id).
Plans are purchased there; entitlements follow the plan's feature codes and device binding is
one device per license.

Licensing flow: log in on the BITS License Manager web dashboard, open **Hubungkan Aplikasi**,
and paste the 8-character pairing code into the app's activation screen. The app exchanges the
code for a device token, activates this device, and receives a short-lived license token
(`BITS.<payload>.<signature>`, Ed25519, 30-day refresh TTL even for lifetime licenses) that is
verified offline against the public key pinned at build time via `BITS_LICENSE_PUBKEY`. The
token is refreshed online ahead of expiry; a still-valid cached token keeps the app usable
while offline. Local development builds without a pinned key run in `open` mode; release
builds without one fail closed. Fees, taxes, refunds, and fulfillment remain the
responsibility of the seller.

## Platform support

| Platform | Architecture | Distribution | Status in this workspace |
|---|---|---|---|
| Linux | x86_64 | `.deb`, AppImage | Built and headless-smoke-tested; interactive desktop UI is not automated |
| Windows | x86_64 | NSIS installer | Built and published by CI; **not runtime-verified** on the Linux build host |
| Android | arm64-v8a | Signed APK / AAB (sideload / GitHub Releases) | Built and signature-verified locally and in CI; runtime not verified without a device or emulator |
| iOS | — | — | Not supported in 1.0.0 |

Linux desktop requires WebKitGTK 4.1 and a Secret Service implementation (GNOME Keyring, KWallet
with the Secret Service bridge, or a compatible vault). Windows requires Windows 10/11 and the
WebView2 runtime. Android requires Android 7.0 (API 24) or newer.

### Windows and Android status

This repository does not claim production runtime verification for Windows or Android. The Linux
build host cannot execute Windows binaries, and no Android emulator, KVM device, or system image is
assumed. CI compiles and signs the release artifacts and verifies what can be verified
mechanically. The Android APK/AAB were also built and signature-verified locally on the Linux host.
The published asset hashes, signatures, and smoke results are recorded in
[docs/RELEASE_VERIFICATION_1.0.0.md](docs/RELEASE_VERIFICATION_1.0.0.md). Install and smoke-test the
artifacts on real hardware before relying on them in production.

Windows installers are **unsigned** until a trusted Authenticode code-signing certificate is
configured. SmartScreen warnings are expected. Updater artifacts are separately signed with the
Tauri minisign key; that is not Authenticode signing.

Android APKs/AABs are signed with the BITS AI Video Creator release keystore. The keystore and
passwords belong in GitHub Actions secrets and are never committed.

## Security model

- Secrets use the operating-system credential vault through the `keyring` crate on desktop and an
  Android Keystore-backed store on Android. There is no plaintext fallback.
- Storyboards and voiceover scripts are local SQLite data. Generated audio bytes are written only to
  a user-selected path and are not uploaded by the app.
- Secret values are write-only across the Tauri IPC boundary after creation. Logs redact secret
  names and values.
- HTTP workflow nodes validate destinations and block loopback, private, link-local, and
  IPv4-mapped loopback ranges by default. Private-network access requires an explicit setting.
- Workflows cannot execute shell commands, load native libraries, or run arbitrary code.
- The CSP denies remote scripts, objects, frames, and forms. The local API has no CORS support.
- Destructive account, workflow, plugin, secret, log, restore, and storyboard actions require
  confirmation.
- Release credentials (license private key, updater key, Android keystore) live outside the
  repository and are injected only into CI.

See [SECURITY.md](SECURITY.md) for reporting and operational guidance.

## Install

Download the latest artifacts from
[GitHub Releases](https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases).

### Linux

```bash
# Debian / Ubuntu
sudo apt install ./BITS-AI-Video-Creator_1.0.0_amd64.deb

# AppImage
chmod +x BITS-AI-Video-Creator_1.0.0_amd64.AppImage
./BITS-AI-Video-Creator_1.0.0_amd64.AppImage
```

### Windows

Run the NSIS installer from the release. It is unsigned until a trusted Authenticode certificate is
configured. WebView2 is installed by the bootstrapper when missing.

### Android

The release contains a signed universal APK for `arm64-v8a` and an AAB for private distribution.
Install the APK with `adb install` or by opening it on the device and allowing installation from the
selected source. BITS AI Video Creator does not use Google Play in 1.0.0.

Verify the signing certificate before installing:

```bash
apksigner verify --print-certs BITS-AI-Video-Creator_1.0.0_universal.apk
```

### Android limitations in 1.0.0

- Embedded isolated provider sessions and provider tools are desktop-only. Android opens provider
  URLs in the system browser.
- In-app updates are desktop-only. Install a newer signed APK from GitHub Releases.
- Workflows and schedules run only while the Android app process is alive. Android background
  execution limits apply; BITS AI Video Creator does not claim background reliability.
- The desktop single-instance guard, native download bridge, and provider profile management are
  not present in the Android build.

## Build from source

Prerequisites:

- Node.js 20.19+ (or 22.12+) and npm
- Rust stable
- Tauri 2 prerequisites for the target platform

```bash
npm ci
npm run check
npm test
cargo test --workspace
npm run tauri build
```

Release builds fetch the license public key from BITS License Manager and pin it at build time,
then sign updater artifacts:

```bash
export BITS_LICENSE_PUBKEY="$(curl -fsSL https://license.bits.co.id/api/v1/meta/license-pubkey | jq -r .data.publicKey)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat .secrets/bits-ai-video-creator-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat .secrets/updater-password-new.txt)"
npm run tauri build -- --bundles deb,appimage
```

Do not put private keys in shell history on a shared machine. The `.secrets/` directory is ignored.

### Linux requirements

```bash
sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Android build

Install Android SDK platform/build tools (API 36), NDK 29 (or 28.2), and the Rust Android target. Then:

```bash
NDK_ROOT=$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)
export NDK_BIN="$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin"
export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC_aarch64_linux_android"
export BITS_LICENSE_PUBKEY="$(cat .secrets/bits-ai-video-creator-license.pub)"

npx tauri android build --apk --target aarch64 --ci
npx tauri android build --aab --target aarch64 --ci
```

Release signing is read from `src-tauri/gen/android/keystore.properties`, which is ignored by Git.
CI recreates it from repository secrets. Without that file the Gradle release variant is unsigned.

## Release engineering

- `.github/workflows/ci.yml` runs frontend checks/tests, Rust formatting/clippy/tests, a Linux
  release compile, a Windows release compile, and an Android debug build.
- `.github/workflows/release.yml` builds Linux bundles, the Windows NSIS installer, and signed
  Android APK/AAB artifacts, then creates a GitHub Release with checksums and `latest.json`.
- Desktop updater artifacts are signed with the Tauri minisign key. The matching public key is
  embedded in `src-tauri/tauri.conf.json` and `src-tauri/src/updater.rs`.
- The updater endpoint points to the public GitHub Releases `latest.json`; the repository must stay
  public for unauthenticated update checks.

Required GitHub Actions secrets:

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater minisign private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release JKS |
| `ANDROID_KEYSTORE_PASSWORD` | JKS store/key password |
| `ANDROID_KEY_ALIAS` | Release key alias (`bits-ai-video-creator`) |

`BITS_LICENSE_PUBKEY` is a public build variable and is committed in the release workflow. Its
matching private key must stay offline and must never be added to the repository or CI.

## Data locations

BITS AI Video Creator uses the Tauri application-local data directory:

- Linux: `~/.local/share/id.co.bits.aivideocreator/`
- Windows: `%LOCALAPPDATA%\id.co.bits.aivideocreator\`
- Android: app-private storage

The SQLite database is `bits-ai-video-creator.db` with WAL sidecars. Desktop provider WebView
profiles live under `webview-profiles/` in the same directory. Storyboards, scenes, shots, and
voiceover scripts live in SQLite. Generated audio files and exports are user-selected files. Secrets
are not in the database; only secret references are.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Feature inventory](docs/FEATURE_INVENTORY.md)
- [Implementation and verification plan](docs/IMPLEMENTATION_PLAN.md)
- [Releasing](docs/RELEASING.md)
- [Brand audit](docs/BRAND_AUDIT_1.0.0.md)
- [Release verification](docs/RELEASE_VERIFICATION_1.0.0.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](NOTICE.md)

## License

MIT © 2026 Banten IT Solutions (bitscoid). See [LICENSE](LICENSE).
