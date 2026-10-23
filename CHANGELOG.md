# Changelog

All notable changes to BITS AI Video Creator are documented here. The format follows Keep a Changelog and the
project uses semantic versioning.

## [Unreleased]

### Added

- Dependency auditing in CI and release workflows (`cargo audit`, `npm audit`) plus weekly Dependabot
  updates for npm, Cargo, and GitHub Actions.
- Frontend adapter and contract tests for the Rust license status payload, covering `state`/`message`
  to `status`/`error` mapping and Unix-second timestamps.
- Schema downgrade guard, permanent scheduler idempotency keys (migration 004), and entitlement checks
  for storyboard, voiceover, provider-workspaces, automation, local-api, and updates.
- Periodic license refresh and log-retention loops, system clock-rollback detection, and Unix
  file-permission hardening for the data directory, database, backups, exports, and staged restores.

### Changed

- Upgraded runtime and development dependencies to current majors, including React 19, Vite 8,
  TypeScript 7, reqwest 0.13, rusqlite 0.40, keyring 4, cron 0.17, and Tauri 2.12.
- Import, export, backup, and restore commands now run off the UI thread.
- Dashboard, run, and log polling slows down when no work is active.
- Release workflow validates the tag and checked-out commit, aligns versions before packaging, and
  uses version-specific release notes.

### Fixed

- Deleting a workflow with active runs is refused, and retrying a run whose workflow was deleted now
  reports a clear error.
- Unsaved editor and voiceover changes are protected against back/forward navigation.
- Voiceover cancel/interrupt no longer shows a false error toast; run-detail copied state resets per
  run; provider webviews can be retried after a failure.
- Mobile navigation drawer traps focus, closes on Escape, and locks background scroll.
- Release checksums no longer include a self-referential `SHA256SUMS.txt` entry.

### Security

- Removed the vulnerable `zip` 4.x dependency by disabling the unused v1 compressed-bundle feature of
  `tauri-plugin-updater`.
- Disabled Android backups to keep the local database out of cloud/ADB backup archives.

## [1.0.0] — 2026-10-21

### Added

- BITS AI Video Creator identity, `id.co.bits.aivideocreator` application identifier, new brand assets, and
  the `BITS-AI-Video-Creator` repository and artifact naming.
- Native storyboard studio: scene and shot planning, camera/dialogue/transition notes, generation
  prompts, runtime totals, reordering, duplication, search, and dirty-state protection.
- Storyboard exports as a Markdown production brief or a schema-versioned JSON snapshot.
- Native voiceover workspace with one script per scene, local browser speech preview, voice/rate/
  pitch/volume controls, and optional provider-generated audio.
- OpenAI-compatible `/audio/speech` integration with explicit format, size, duration, and error
  handling. Provider keys are resolved from the credential vault (`tts.api_key`, falling back to
  `ai.api_key`).
- Offline `BITS1` Ed25519 licensing with monthly, yearly, and lifetime plans, optional device
  binding, plan-aware expiry validation, activation UI, and a non-bundled issuer CLI.
- Pricing and plan activation: **Rp20.000/bulan**, **Rp200.000/tahun**, **Rp500.000/lifetime**.
- SQLite schema version 3 with `storyboards` and `voiceover_assets`, denormalized scene/shot/runtime
  counts, and cascade cleanup of audio references.
- Release workflow support for an embedded license public key, normalized Linux/Windows artifact
  names, Android signing, checksums, and signed updater metadata.
- New updater minisign key and Android release signing identity for the BITS product.
- Documentation for architecture, feature inventory, brand audit, release notes, verification,
  security, contribution, and third-party notices.

### Changed

- Rebranded the former product across source, configuration, database, keyring service, exports,
  installer metadata, Android package, icons, tests, and documentation.
- Reframed the application around a studio-first workflow while retaining the existing provider
  account manager and declarative automation as supporting modules.
- Local API bearer tokens now use the `bits_` prefix.
- Export envelopes use `bits-ai-video-creator.export`; the database is `bits-ai-video-creator.db`.
- Linux and Windows release artifacts are copied to hyphenated names so published assets are stable
  regardless of the Tauri bundle’s local filename formatting.
- Updated plan copy and activation details to use exact Rupiah formatting and Indonesian term labels.

### Security

- Release builds embed `BITS_LICENSE_PUBKEY`; local development builds without that variable remain
  intentionally open for development and CI.
- Private license keys, updater keys, and Android keystore material remain outside the repository.
- Secret-backed operations fail explicitly when the platform vault is unavailable; there is no
  plaintext fallback.
- TTS credentials are read from the vault, never persisted in storyboard data or logs.
- Signed updater artifacts and GitHub Release checksums are part of the release process.
- Android releases use a dedicated release keystore and APK Signature Scheme v2.

### Known limitations

- Windows installers are unsigned until a trusted Authenticode certificate is configured, and the
  Windows runtime has not been exercised on the Linux build host.
- Android APK/AAB builds and signatures are verified mechanically; runtime UI, provider WebViews,
  and Android Keystore behavior have not been verified on a physical device or emulator here.
- Android does not support embedded provider sessions, the native download bridge, the in-app
  updater, single-instance handling, or reliable background scheduling.
- Payment processing is external through <https://bits.co.id>. The app verifies signed tokens but
  does not process card data, call a payment gateway, or issue tokens automatically.
- Provider TTS requires a user-configured endpoint that implements `/audio/speech`; browser speech
  is a preview only.
- iOS is not supported in 1.0.0.
- The documented `glib` 0.18 advisory remains an upstream Tauri/GTK tracking item; see
  [SECURITY.md](SECURITY.md).
