# Contributing to BITS AI Video Creator

## Prerequisites

- Node.js 20.19+ (or 22.12+) and npm
- Rust stable with `rustfmt` and `clippy`
- Tauri 2 system dependencies for your platform
- For Android: Android SDK platform 36, build-tools 36, NDK 29 (or 28.2), Java 21, and the
  `aarch64-linux-android` Rust target

## Setup

```bash
npm ci
npm run check
npm test
cargo test --workspace
npm run tauri dev
```

Do not commit `node_modules/`, `dist/`, `target/`, `.secrets/`, Android build output, databases,
provider profiles, generated signing properties, or license tokens.

## Required checks

Before opening a pull request:

```bash
npm run check
npm test
npm run build

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

If you change Android code or the mobile UI, also build a debug APK:

```bash
npx tauri android build --debug --apk --target aarch64 --ci
```

If you change packaging or updater configuration, build the affected desktop bundle and verify the
signature when a key is available. Release builds require `BITS_LICENSE_PUBKEY`; local builds
without it are intentionally open and must not be represented as the paid release.

Android project generation files under `src-tauri/gen/android/app/src/main/**/generated/` are
ignored, with the exception of the tracked `TauriActivity.kt` template shim needed by CI. Do not
delete or rename that tracked file without checking a clean Android build.

## Code standards

- Rust: `cargo fmt`, no clippy warnings, typed `CoreError` errors, no `unwrap` in request paths.
- TypeScript: strict type-checking, functional components, TanStack Query for server state.
- SQL: additive migrations; never rewrite an existing migration after release.
- Security: validate all external input, redact secrets, reject private/loopback destinations by
  default, and confirm destructive UI actions.
- Platform gates: use `cfg(target_os = "android")` for Android-specific code and surface honest
  limitations instead of silently degrading.
- UI: preserve keyboard/focus behavior, visible focus rings, and the existing design tokens.
- Licensing: never log or export activation tokens; never add a private license key to the
  repository, CI, or application bundle.

## Tests

- Add core tests for storyboard aggregation, validation, TTS request building, licensing, and
  persistence changes.
- Add frontend tests for draft conversion, pricing/term rendering, and dirty-state behavior.
- Do not claim Windows, Android, iOS, payment, or updater runtime verification without evidence
  from the corresponding platform.

## Commits and pull requests

- Keep commits focused and explain user-visible behavior.
- Include tests for core logic changes.
- State which platforms you built or tested. Do not claim Windows, Android, or iOS runtime testing
  without evidence.
- Link related issues and include screenshots for UI changes when possible.
- Do not include credentials, real account data, provider cookies, or license tokens in commits,
  logs, issues, or screenshots.

## Security reports

Follow [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT License.
