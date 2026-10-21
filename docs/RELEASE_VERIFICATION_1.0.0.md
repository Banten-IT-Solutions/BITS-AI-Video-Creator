# BITS AI Video Creator 1.0.0 — Release Verification

Status: **local release-candidate verification complete; GitHub Actions release run pending.** This
document records only evidence produced in this workspace. It does not claim a published GitHub
Release yet. The CI section is updated after the tag workflow finishes.

Verification date: 2026-10-21
Host: Linux x86_64 (container), Xvfb for headless UI checks
Source state: final 1.0.0 working tree before the release commit
Tag: `v1.0.0` (not pushed at the time of the local checks)
Repository: `Banten-IT-Solutions/BITS-AI-Video-Creator`

## Source verification

| Check | Command | Result |
|---|---|---|
| TypeScript type-check | `npm run check` | Pass |
| Frontend tests | `npm test` | **30/30 passed** in 6 files |
| Frontend production build | `npm run build` | Pass; Vite 7.3.7 |
| Rust formatting | `cargo fmt --all -- --check` | Pass |
| Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | Pass |
| Rust tests | `cargo test --workspace` | **90 passed** (77 core + 13 Tauri) |

The Linux and Android release binaries were built with
`BITS_LICENSE_PUBKEY=mD6rxHPWOGvBkQWkoyfDUO7/L2iZ7OJ3VYYZCwDlY0U=`. The key is present in the
release binary at offset `4184709` and in the packaged Android native library at offset `3336723`.
Development builds without this variable intentionally run in `open` mode and are not the paid
release.

## Local Linux artifacts

These are the final local bundles after the last UI pass. The release workflow copies them to
hyphenated asset names.

| Local file | Bytes | SHA-256 |
|---|---:|---|
| `BITS AI Video Creator_1.0.0_amd64.deb` | 10,503,504 | `cc185075539df6e986ca83074c7866de72c07e03629d2d53aa7a35402970adf5` |
| `BITS AI Video Creator_1.0.0_amd64.AppImage` | 115,214,840 | `47b4a83fc085b0988a74c9edfc361f4bcfbd272367911a6befd4ea7ac84250f0` |

Both artifacts were built with `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Their `.sig` files were verified with the matching minisign
public key:

```text
Signature and comment signature verified
Trusted comment: timestamp:1792614891  file:BITS AI Video Creator_1.0.0_amd64.deb  version:1.0.0
Signature and comment signature verified
Trusted comment: timestamp:1792614891  file:BITS AI Video Creator_1.0.0_amd64.AppImage  version:1.0.0
```

Package metadata:

```text
Package: bits-ai-video-creator
Version: 1.0.0
Architecture: amd64
Description: Storyboard, voiceover, and AI video production studio
```

The desktop entry uses `Name=BITS AI Video Creator`, `Exec=bits-ai-video-creator`, and
`Icon=bits-ai-video-creator`.

## Linux runtime smoke

The final AppImage was run under `dbus-run-session` with Xvfb at 1440x900:

- Window ID resolved and `xdotool getwindowname` returned
  `BITS AI Video Creator — AI Video Studio`.
- Renderer screenshot captured successfully.
- Application data directory: `id.co.bits.aivideocreator`.
- Database: `bits-ai-video-creator.db`.
- `PRAGMA integrity_check` → `ok`.
- `PRAGMA user_version` → `3`.
- Startup log entry: `BITS AI Video Creator started`.
- Default `updateEndpoint`:
  `https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json`.

Interactive checks against the final bundle:

- The license gate rendered the exact plans: **Rp20.000/bulan**, **Rp200.000/tahun**, and
  **Rp500.000/lifetime**, with the expected Indonesian term/description copy.
- A locally issued lifetime token with the release device ID activated the workspace and loaded the
  dashboard.
- The Storyboards page rendered its empty state; a storyboard titled
  `The Last Light Over Banten` was created through the UI. The persisted row reports one scene, one
  shot, and 5 seconds total runtime.
- The Voiceover page rendered the scene list, script editor, preview controls, and provider TTS
  panel. Full provider audio generation was not exercised because no provider endpoint/key was
  configured.

The smoke used the release AppImage, not a debug build. The container session has no real Secret
Service; vault-backed secret operations were not exercised end to end here. The app was terminated
by the test timeout after the checks.

## Android artifacts

Built locally with the release keystore, package `id.co.bits.aivideocreator`:

| Local file | Bytes | SHA-256 |
|---|---:|---|
| `app-universal-release.apk` | 26,648,743 | `61c0e5878fb46875f410241240a7e411a9c24239a2c1a9b2aec4f7006013dc56` |
| `app-universal-release.aab` | 10,086,274 | `6a17791ba67181156bc02a7b1599af96a851f199139746395ad03d212a8862a6` |

APK:

- Package: `id.co.bits.aivideocreator`
- Version name: `1.0.0`; version code: `1000000`
- minSdk: 24; targetSdk/compileSdk: 36
- Native ABI: `arm64-v8a`
- Native library packaged: `libbits_ai_video_creator_lib.so` only
- APK Signature Scheme v2: valid
- Certificate DN:
  `CN=BITS AI Video Creator, OU=BITS, O=Banten IT Solutions, L=Serang, ST=Banten, C=ID`
- Certificate SHA-256:
  `A6:43:CF:05:B6:1D:E4:F3:07:60:1F:CD:47:34:D8:60:9F:C1:BB:57:8B:11:72:8B:31:6F:AF:B1:A7:DF:0F:30`

AAB:

- `jarsigner -verify` exit code `0`.
- Certificate SHA-256 matches the APK certificate.
- The release certificate is self-signed, as expected for private/sideloaded Android distribution.
  `jarsigner -strict` will report certificate-path and timestamp warnings for a self-signed
  certificate; it is not used as the release gate.

Android runtime UI, Android Keystore behavior, and installation were **not** verified: no physical
device, emulator, KVM, or system image is available on this host. The APK/AAB checks above are
mechanical build and signature checks only.

## Release-engineering dry run

The release workflow YAML parses successfully. A clean checkout materialized from the staged index
(tracked files only) built an Android debug APK successfully; the only tracked generated Android
source was `TauriActivity.kt`, and Tauri regenerated the remaining generated Kotlin/Wry files. This
confirms the Android CI job does not depend on ignored local build state.

The `latest.json` generation logic was exercised in a local staging directory with the final Linux
assets and a placeholder Windows installer/signature. It produced the expected
`linux-x86_64-appimage`, `linux-x86_64-deb`, and `windows-x86_64-nsis` entries and a checksum file
that did not hash itself. Real Windows signatures and the actual GitHub Release remain pending CI.

## Brand audit

The final Linux AppImage, Debian package, APK, and AAB were extracted and scanned for the former
product name and identifier variants. No matches were found. The APK contains only
`libbits_ai_video_creator_lib.so`; a stale former-brand native library found during an earlier local
Android build was removed before the final APK/AAB were rebuilt. The Windows installer must be
scanned after the CI run because it cannot be produced on this Linux host.

See [BRAND_AUDIT_1.0.0.md](BRAND_AUDIT_1.0.0.md) for the command list and scope.

## CI release verification

**Pending.** The release workflow has not run yet. When it completes, record here:

- workflow run ID and URL;
- tag commit SHA;
- published asset names, sizes, and SHA-256 values from `SHA256SUMS.txt`;
- `latest.json` contents and signature checks for all three desktop updater targets;
- Windows installer size/hash and signature verification;
- Android CI APK/AAB hashes and certificate fingerprint;
- confirmation that no private keys, keystore files, or `keystore.properties` were uploaded.

The release workflow builds Linux, Windows, and Android artifacts independently, then publishes a
single GitHub Release with `latest.json`, `SHA256SUMS.txt`, signature files, and signature reports.
A release is not considered production-verified until the Windows and Android artifacts have also
been installed and exercised on real hardware.

## Not verified

- Windows installer runtime behavior: built by CI, not executable on this Linux host.
- Windows Authenticode: not configured; the installer is unsigned and SmartScreen warnings are
  expected.
- Android runtime UI, provider WebViews, Android Keystore, and background execution: no device or
  emulator.
- End-to-end in-app update: local manifest/signature paths are tested, but no update has been
  applied through the UI.
- Real desktop Secret Service: the headless container session is not a user desktop keyring.
- Payment processing or automatic license issuance: intentionally external at
  <https://bits.co.id>; the app verifies signed tokens only.
- Provider TTS audio generation: needs a user-configured endpoint and key; request construction and
  validation are covered by tests.
- iOS: not supported in 1.0.0.

These limitations are also reflected in the README, release notes, feature inventory, security
policy, and implementation plan.
