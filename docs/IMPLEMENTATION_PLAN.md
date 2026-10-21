# BITS AI Video Creator 1.0.0 — Implementation and Verification Plan

This document records the implementation state, verification evidence, and remaining release work
for BITS AI Video Creator 1.0.0. It is deliberately explicit about what has **not** been verified.

## Scope

- Product: BITS AI Video Creator 1.0.0
- Package/bundle identifier: `id.co.bits.aivideocreator`
- Repository: `Banten-IT-Solutions/BITS-AI-Video-Creator` (public, release pending)
- Platforms: Linux x86_64, Windows x86_64, Android arm64-v8a
- Out of scope: iOS, Google Play, Apple Developer Program, hosted services, arbitrary code
  execution nodes, provider DOM automation, payment-gateway integration

## Phase 1 — Rebrand and version reset

| Task | State | Evidence |
|---|---|---|
| Rename product and Rust crates to BITS AI Video Creator | Complete | `Cargo.toml`, `src-tauri/Cargo.toml`, `crates/bits-ai-video-creator-core` |
| Reset version to 1.0.0 | Complete | Cargo, npm, Tauri config, Android version name/code |
| Change identifier/database/service names | Complete | `id.co.bits.aivideocreator`, `bits-ai-video-creator.db` |
| Update license token prefix and env | Complete | `BITS1`, `BITS_LICENSE_PUBKEY` |
| Keep legacy account import | Complete | Plain legacy account-array JSON; no legacy brand aliases |
| Replace icon and platform icon set | Complete | `assets/brand/bits-ai-video-creator-icon-1024.png`; regenerated icons |
| Normalize release artifact names | Complete | Workflow copies `BITS-AI-Video-Creator_*` |

## Phase 2 — Core hardening and studio domain

| Task | State | Evidence |
|---|---|---|
| Durable queue, cancellation, retry, idempotency | Complete | Engine tests |
| Restart recovery | Complete | `recover_interrupted` |
| Missed schedule recording | Complete | Scheduler tests |
| SSRF/private-network rejection | Complete | Runtime tests |
| Path traversal and download-name sanitization | Complete | WebView manager tests |
| Secret redaction | Complete | Core redaction tests |
| Local API bearer/host/origin checks | Complete | Local API tests |
| Import/export/backup/restore | Complete | Import/export tests |
| Storyboard aggregate, validation, exports | Complete | `studio.rs` tests; schema v3 |
| Voiceover request builder and limits | Complete | `tts.rs` tests |
| License plan catalog and verification | Complete | `license.rs` tests; release build embeds public key |
| Issuer CLI | Complete | `license-issuer` generate, issue, and plans subcommands |

## Phase 3 — Desktop UI

| Task | State | Evidence |
|---|---|---|
| Responsive shell and navigation | Complete | Desktop sidebar, mobile drawer/bottom nav |
| Storyboard studio | Complete | `Storyboards.tsx`; create, edit, reorder, duplicate, export |
| Voiceover studio | Complete | `Voiceover.tsx`; speech preview, provider TTS, references |
| Accounts split view | Complete | Responsive list/detail |
| Workflow editor | Complete | Desktop panes, mobile node/inspector sheets |
| Runs, logs, prompts, plugins, settings | Complete | Type-check and production build |
| License activation and plan display | Complete | `LicenseGate.tsx`; exact Rupiah labels |
| Unsaved-change guards | Complete | Storyboard and voiceover draft/navigation guards |
| Mobile limitation messaging | Complete | Dashboard, accounts, tools, settings |
| Safe-area and viewport handling | Complete | `viewport-fit=cover`, CSS env insets |

## Phase 4 — Android

| Task | State | Evidence |
|---|---|---|
| Android project generation | Complete | `src-tauri/gen/android` |
| Android Rust target check | Complete | `cargo check -p bits-ai-video-creator --target aarch64-linux-android` |
| Android secret store | Complete | `android-native-keyring-store` + `keyring-core` |
| Mobile command stubs | Complete | Provider views/tools/profile/updater return explicit errors |
| Responsive Android UI | Complete | Drawer, bottom nav, bottom-sheet editor panels |
| Release signing configuration | Complete | Gradle reads ignored `keystore.properties` |
| Signed APK | Complete locally | Built with `id.co.bits.aivideocreator`; v2 signature verified |
| Signed AAB | Complete locally | Built; `jarsigner -verify` exit 0 |
| Runtime launch/keyring test | **Blocked** | No emulator, KVM, or system image on build host |

Android APK evidence from the local build host:

- Package: `id.co.bits.aivideocreator`
- Version name: `1.0.0`
- Version code: `1000000`
- minSdk: 24
- targetSdk/compileSdk: 36
- Native ABI: `arm64-v8a`
- Native library: `libbits_ai_video_creator_lib.so` only
- APK Signature Scheme v2: valid
- Signing certificate SHA-256:
  `A6:43:CF:05:B6:1D:E4:F3:07:60:1F:CD:47:34:D8:60:9F:C1:BB:57:8B:11:72:8B:31:6F:AF:B1:A7:DF:0F:30`
- AAB JAR signature: valid; certificate SHA-256 matches the APK

## Phase 5 — Linux release verification

| Task | State | Evidence |
|---|---|---|
| Frontend type-check | Complete | `npm run check` |
| Frontend tests | Complete | 30/30 |
| Frontend production build | Complete | `npm run build` |
| Rust formatting | Complete | `cargo fmt --all -- --check` |
| Clippy with warnings denied | Complete | `cargo clippy --workspace --all-targets -- -D warnings` |
| Rust tests | Complete | 77 core + 13 Tauri = 90 passed |
| `.deb` and AppImage | Complete | Final bundles in `target/release/bundle/`; hashes in release verification |
| Release key embedded | Complete | `BITS_LICENSE_PUBKEY` present in release binaries |
| Updater signatures | Complete | `.deb.sig`, `.AppImage.sig` verified with minisign |
| Headless startup smoke | Complete | Window title, data directory, schema v3, SQLite integrity `ok` |
| Interactive desktop UI automation | **Not done** | No automated GUI driver configured |
| Real Secret Service desktop session | **Not done** | Headless smoke used a container session |

## Phase 6 — CI and release engineering

| Task | State | Evidence |
|---|---|---|
| CI workflow | Complete | `.github/workflows/ci.yml` |
| Release workflow | Complete | `.github/workflows/release.yml` |
| Android keystore injection | Complete | Base64 secret restored to ignored properties |
| Updater key injection | Complete | Tauri signing environment |
| License public key injection | Complete | `BITS_LICENSE_PUBKEY` workflow env |
| Checksums | Complete | `SHA256SUMS.txt` in release job |
| `latest.json` generation | Implemented; not yet run | Linux + Windows updater entries |
| GitHub repository creation | **Pending** | Target repository does not exist yet |
| Push/tag/release | **Pending** | No commit, push, tag, or workflow run yet |
| Windows CI build | **Pending** | Requires release workflow run |
| Android release CI build | **Pending** | Local signed build complete; CI path prepared |

## Phase 7 — Documentation

| Task | State |
|---|---|
| README with platform status and limitations | Complete |
| MIT license | Complete |
| Security policy | Complete |
| Contributing guide | Complete |
| Architecture | Complete |
| Feature inventory | Complete |
| Implementation plan | Complete |
| Brand audit | Complete |
| Release notes | Complete |
| Release verification | Local evidence recorded; CI results pending |
| Third-party notices | Complete |

## Verification commands

Run from the repository root:

```bash
npm ci
npm run check
npm test
npm run build

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Linux release build (requires the updater key and password):

```bash
export BITS_LICENSE_PUBKEY="$(cat .secrets/bits-ai-video-creator-license.pub)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat .secrets/bits-ai-video-creator-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat .secrets/updater-password-new.txt)"
npm run tauri -- build --bundles deb,appimage
```

Android release build (requires an ignored `keystore.properties`):

```bash
export BITS_LICENSE_PUBKEY="$(cat .secrets/bits-ai-video-creator-license.pub)"
npx tauri android build --apk --target aarch64 --ci
npx tauri android build --aab --target aarch64 --ci
```

## Remaining release checklist

1. Re-run all verification commands after the final UI and documentation pass.
2. Rebuild Linux bundles and rerun the headless smoke, updater signature check, hashes, and brand scan.
3. Create `Banten-IT-Solutions/BITS-AI-Video-Creator` and configure the release secrets.
4. Push a clean orphan `main`, tag `v1.0.0`, and run the release workflow.
5. Verify the CI artifacts, checksums, `latest.json`, and Android signatures.
6. Update the release verification document with actual CI results, then set repository metadata.
7. Test the Linux AppImage on a desktop with a real Secret Service.
8. Install Windows and Android artifacts on real hardware before making production claims.

## Known gaps and risks

- The Windows installer is built by CI; it has not been run on this Linux build host and is not
  Authenticode-signed.
- Android has been compiled and signed but not launched on a device or emulator.
- Android lacks embedded provider sessions, the download bridge, the in-app updater, and reliable
  background execution.
- Release builds embed the license public key; development/CI builds without it intentionally run
  in `open` mode. Do not publish a build without the key as the paid release.
- Payment and automatic token issuance are external/manual. No payment gateway is integrated.
- The updater manifest is generated by the workflow, but the in-app update flow has not been
  runtime-tested end to end.
- No full GUI automation is configured; interactive UI behavior is based on type checks, builds,
  source review, and a startup screenshot.
