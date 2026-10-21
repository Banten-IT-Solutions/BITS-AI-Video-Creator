# BITS AI Video Creator 1.0.0 — Release Verification

Status: **published and mechanically verified from GitHub Actions. Windows and Android runtime
behavior remain unverified on real hardware.**

Release: <https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/tag/v1.0.0>
Tag: `v1.0.0` at `bb0d40ed35669e7918711810b82f58c7597d37ec`
Release workflow: [run 39674266933](https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/actions/runs/39674266933)
CI workflow: [run 39674218615](https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/actions/runs/39674218615)
Published: 2026-10-21

## Source verification

Run locally on the final 1.0.0 source tree before the release commit:

| Check | Command | Result |
|---|---|---|
| TypeScript type-check | `npm run check` | Pass |
| Frontend tests | `npm test` | **30/30 passed** in 6 files |
| Frontend production build | `npm run build` | Pass; Vite 7.3.7 |
| Rust formatting | `cargo fmt --all -- --check` | Pass |
| Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | Pass |
| Rust tests | `cargo test --workspace` | **90 passed** (77 core + 13 Tauri) |

The same CI run (`39674218615`) completed successfully for frontend checks, Rust checks, Windows
release compile, and the Android debug build.

The release builds embed
`BITS_LICENSE_PUBKEY=mD6rxHPWOGvBkQWkoyfDUO7/L2iZ7OJ3VYYZCwDlY0U=`. The CI Android native library
contains the key at offset `3340595`. Development builds without the variable intentionally run in
`open` mode and are not the paid release.

## Published assets

All values below are from the published `SHA256SUMS.txt` and the downloaded release assets.

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `BITS-AI-Video-Creator_1.0.0_amd64.AppImage` | 87,988,728 | `dc01db3f16373da5f3abf73595543438591368fdb63d8ba65f1984d81c93ae82` |
| `BITS-AI-Video-Creator_1.0.0_amd64.deb` | 10,464,866 | `63ef880acd105948fb267f787850222d9f7b536b62bdd04543d2ab7bca6f6311` |
| `BITS-AI-Video-Creator_1.0.0_universal.apk` | 26,658,903 | `6693b1b77670c2936ede1dc9e4dbf5c512ed0d8d0de0e060c85c1da515cae1c3` |
| `BITS-AI-Video-Creator_1.0.0_release.aab` | 10,088,453 | `7026a806f8ad614eb3594c7f76cdff032a22adc69c1056a755c7328ee31da925` |
| `BITS-AI-Video-Creator_1.0.0_x64-setup.exe` | 5,466,165 | `9376601db26ab42faa7f27c47b1b1e997ad591809aa2a275e4a1754fbb4ff0be` |
| `latest.json` | 7,470 | `82f2ade8f7e7a471d7377030ccad92d7c67a134cb90e156288c3831fdf4a0bed` |
| `SHA256SUMS.txt` | 1,114 | `078f5a1f6bbd9f4fb5d26205ef3569ee5bb087f1dcda653a9033ef75df48ed2c` |

`sha256sum -c SHA256SUMS.txt` succeeds for every listed asset, signature file, signature report,
and `latest.json`. The checksum file does not hash itself. No keystore, private key,
`keystore.properties`, license private key, or updater private key was uploaded as a release asset.

The public URL
<https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json>
resolves to the published manifest.

## Updater signatures and manifest

All three desktop updater files verify with the embedded minisign public key:

- AppImage — signature verified.
- Debian package — signature verified.
- Windows NSIS installer — signature verified.

The base64 signatures inside `latest.json` also verify for the same three files. The manifest reports
version `1.0.0`, publication date `2026-10-21T21:30:36Z`, and these platform entries:

- `linux-x86_64-appimage`
- `linux-x86_64-deb`
- `windows-x86_64-nsis`

All URLs point to the `v1.0.0` release assets. Windows uses the `x64-setup.exe` signature; the
workflow does not publish or reference a `.nsis.zip` updater bundle.

## Linux runtime smoke

The published AppImage was downloaded, made executable, and run under `dbus-run-session` with Xvfb
at 1440x900:

- Window ID resolved and `xdotool getwindowname` returned
  `BITS AI Video Creator — AI Video Studio`.
- Application data directory: `id.co.bits.aivideocreator`.
- Database: `bits-ai-video-creator.db`.
- `PRAGMA integrity_check` → `ok`.
- `PRAGMA user_version` → `3`.
- Startup log entry: `BITS AI Video Creator started`.
- Default `updateEndpoint`:
  `https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json`.

The license gate rendered the exact plans: **Rp20.000/bulan**, **Rp200.000/tahun**, and
**Rp500.000/lifetime**. The published build is license-enforced (`Mode: enforced`) and displays the
device id for optional binding. The published AppImage was then launched with the runtime device id
and a locally issued lifetime token stored in its local app metadata; the workspace dashboard loaded
successfully.

Earlier local-only checks on the pre-release build also confirmed:

- The Storyboards page rendered its empty state; a storyboard titled
  `The Last Light Over Banten` was created through the UI. The persisted row reported one scene, one
  shot, and 5 seconds total runtime.
- The Voiceover page rendered the scene list, script editor, preview controls, and provider TTS
  panel. Provider audio generation was not exercised because no provider endpoint/key was
  configured.

The smoke used the published release AppImage. The container session has no real Secret Service;
vault-backed secret operations were not exercised end to end. The app was terminated by the test
timeout after the checks.

## Android artifacts

Built and signed by the release workflow with the release keystore:

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
- The certificate is self-signed, as expected for private/sideloaded distribution. `jarsigner
  -strict` reports certificate-path and timestamp warnings for that self-signed certificate; it is
  not used as the release gate.

Android runtime UI, Android Keystore behavior, and installation were **not** verified: no physical
device, emulator, KVM, or system image is available on this Linux host. The APK/AAB checks are
mechanical build and signature checks only.

## Windows installer

The release workflow produced a 5,466,165-byte PE32 NSIS installer on `windows-latest`. Its
minisign signature verifies. It is **not Authenticode-signed**, so SmartScreen warnings are expected.

The Windows installer has not been run on this Linux build host. Runtime behavior, WebView2
installation, upgrade handling, and shortcut/uninstaller behavior remain unverified.

## Brand audit

The published AppImage, Debian package, APK, AAB, and Windows installer were downloaded and searched
for the former product name and identifier variants. No matches were found. The APK contains only
`libbits_ai_video_creator_lib.so`. A stale former-brand native library found during an earlier local
Android build was removed before the final APK/AAB were rebuilt.

See [BRAND_AUDIT_1.0.0.md](BRAND_AUDIT_1.0.0.md) for the audit scope.

## Release-engineering checks

- The release workflow YAML parses successfully.
- A clean checkout materialized from the staged index built an Android debug APK successfully; the
  only tracked generated Android source was `TauriActivity.kt`, and Tauri regenerated the remaining
  generated Kotlin/Wry files. This confirmed the Android CI job does not depend on ignored local
  build state.
- The `latest.json` generation logic was exercised locally with the final Linux assets and a
  placeholder Windows installer/signature before the actual release run. The real manifest was
  then generated by the release workflow and verified against the published files.
- The release asset listings contained no keystore, private-key, or signing-secret files.

## Local pre-release build evidence

Before the release workflow, the same source tree was built locally on the Linux host:

| Local artifact | Bytes | SHA-256 |
|---|---:|---|
| `BITS AI Video Creator_1.0.0_amd64.deb` | 10,503,504 | `cc185075539df6e986ca83074c7866de72c07e03629d2d53aa7a35402970adf5` |
| `BITS AI Video Creator_1.0.0_amd64.AppImage` | 115,214,840 | `47b4a83fc085b0988a74c9edfc361f4bcfbd272367911a6befd4ea7ac84250f0` |
| `app-universal-release.apk` | 26,648,743 | `61c0e5878fb46875f410241240a7e411a9c24239a2c1a9b2aec4f7006013dc56` |
| `app-universal-release.aab` | 10,086,274 | `6a17791ba67181156bc02a7b1599af96a851f199139746395ad03d212a8862a6` |

These local hashes are not the published hashes; CI runners produce different bundle sizes and
signatures. The published artifacts in the table above are authoritative.

## Not verified

- Windows installer runtime behavior and Authenticode signing.
- Android runtime UI, provider WebViews, Android Keystore, and background execution.
- End-to-end in-app update: manifest and signatures are verified, but no update has been applied
  through the UI.
- Real desktop Secret Service: the headless container session is not a user desktop keyring.
- Payment processing or automatic license issuance: intentionally external at
  <https://bits.co.id>; the app verifies signed tokens only.
- Provider TTS audio generation: needs a user-configured endpoint and key; request construction and
  validation are covered by tests.
- iOS: not supported in 1.0.0.

These limitations are also reflected in the README, release notes, feature inventory, security
policy, and implementation plan.
