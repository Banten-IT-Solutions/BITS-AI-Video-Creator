# BITS AI Video Creator 1.0.0

BITS AI Video Creator 1.0.0 is the first public release of the local-first AI video studio: native
storyboard and voiceover planning, provider-account workspaces, and supporting declarative
automation, all running on the device.

## Highlights

- **Studio-first workflow** — a native storyboard editor for scenes and shots, with camera,
  dialogue, transition, generation-prompt, aspect-ratio, and runtime planning. Export a Markdown
  production brief or a complete JSON snapshot.
- **Voiceover studio** — one script per scene, local system-speech preview, per-scene voice/rate/
  pitch/volume settings, and optional provider-generated audio through an OpenAI-compatible
  `/audio/speech` endpoint. Generated audio is written only to a user-selected file.
- **Paid plans** — offline Ed25519 activation for **Rp20.000/bulan**, **Rp200.000/tahun**, and
  **Rp500.000/lifetime**. Activation tokens can be device-bound. Payment is handled externally at
  <https://bits.co.id>.
- **Provider workspaces** — local account metadata, favorites, tags, duplicate detection,
  import/export, and isolated desktop provider WebViews with a sanitized download bridge.
- **Automation as a supporting module** — visual workflows, durable execution, cancellation,
  retries, timeouts, idempotency keys, restart recovery, cron schedules with missed-run recording,
  redacted logs, prompts, and HTTPS-only plugin presets.
- **Local-first data** — SQLite at `bits-ai-video-creator.db`; secrets remain in the OS credential
  vault or Android Keystore-backed storage.

## Plans and activation

| Plan | Price | Term |
|---|---:|---|
| Bulanan | **Rp20.000** | 30 days |
| Tahunan | **Rp200.000** | 365 days |
| Lifetime | **Rp500.000** | No expiry |

Purchase and fulfillment are external. After payment is confirmed, the seller signs a `BITS1`
license token; paste it into the activation screen. The app verifies the token locally and does not
contact a license server or process card data. Release builds embed the matching public key.

## Downloads

| Platform | Artifact |
|---|---|
| Linux Debian/Ubuntu | `BITS-AI-Video-Creator_1.0.0_amd64.deb` |
| Linux AppImage | `BITS-AI-Video-Creator_1.0.0_amd64.AppImage` |
| Windows x64 | `BITS-AI-Video-Creator_1.0.0_x64-setup.exe` |
| Android arm64 | `BITS-AI-Video-Creator_1.0.0_universal.apk` |
| Android AAB | `BITS-AI-Video-Creator_1.0.0_release.aab` |

`SHA256SUMS.txt` contains checksums for the published assets. `latest.json` is the signed Tauri
updater manifest for desktop builds.

## Verification status

- **Linux:** `.deb` and AppImage built locally with the release license public key and signed
  updater key. The AppImage passed a headless startup smoke test: window rendered, data directory
  created, SQLite integrity `ok`, schema version `3`, and updater endpoint seeded correctly.
  Interactive desktop automation and a real Secret Service desktop session were not exercised.
- **Windows:** the NSIS installer is produced by the release workflow on `windows-latest`; it has
  **not** been runtime-tested on the Linux build host. It is **not Authenticode-signed**.
  SmartScreen warnings are expected.
- **Android:** a signed universal arm64 APK and AAB were built and mechanically verified. APK
  Signature Scheme v2 verifies; the AAB JAR signature verifies. Runtime UI and Android Keystore
  behavior were not verified without a physical device or emulator.

Do not treat Windows or Android as production-verified until the artifact has been installed and
exercised on real hardware.

## Android signing certificate

```text
SHA-256: A6:43:CF:05:B6:1D:E4:F3:07:60:1F:CD:47:34:D8:60:9F:C1:BB:57:8B:11:72:8B:31:6F:AF:B1:A7:DF:0F:30
```

Verify it with `apksigner verify --print-certs` before installing.

## Android limitations

- Embedded provider sessions and provider tools are desktop-only; Android opens provider URLs in
  the system browser.
- In-app updates are desktop-only. Install newer signed APKs manually.
- Workflows and schedules run only while the app process is alive. Android background limits apply.
- Single-instance handling, the native download bridge, and provider profile management are not
  present on Android.

## Known limitations

- Payment processing and automatic license issuance are not implemented in the app. The seller
  issues tokens manually after confirming payment.
- Provider TTS requires a compatible endpoint and key; chat-only endpoints fail explicitly.
  Browser speech is a preview and may be unavailable in some Linux WebViews.
- Windows installers are unsigned until an Authenticode certificate is configured.
- iOS is not supported in 1.0.0.
- The `glib` 0.18 advisory documented in [SECURITY.md](../SECURITY.md) remains an upstream
  Tauri/GTK tracking item.

## Upgrade notes

This is the first BITS AI Video Creator release. Databases created by pre-1.0 builds are not migrated in place;
use BITS AI Video Creator import for plain legacy account-array JSON. New data uses
`bits-ai-video-creator.db` and the `id.co.bits.aivideocreator` application identifier. Legacy file
extensions and legacy envelope kinds are not accepted; import is detected structurally.

## License

MIT © 2026 Banten IT Solutions (bitscoid). See [LICENSE](../LICENSE).
