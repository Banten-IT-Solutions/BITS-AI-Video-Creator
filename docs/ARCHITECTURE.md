# BITS AI Video Creator Architecture

BITS AI Video Creator 1.0.0 is a local-first Tauri 2 application with a pure Rust core and a React 18
interface. The desktop shell and the Android shell share the same core crate and web UI; platform
modules are gated at compile time.

## System overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ Tauri shell (Rust)                                                   │
│  src-tauri/src/lib.rs                                                │
│  ├─ desktop: single instance, updater, keyring, provider webviews    │
│  ├─ Android: Keystore secret store, mobile command stubs             │
│  ├─ SQLite database (bits-ai-video-creator.db, WAL, schema v3)       │
│  ├─ Engine + scheduler + local API + license gate                    │
│  └─ Tauri commands → React UI                                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ IPC (invoke)
┌──────────────────────────────▼───────────────────────────────────────┐
│ React 18 + TypeScript + Vite                                         │
│  Studio: Dashboard, Storyboards, Voiceover, Prompt library           │
│  Providers: Accounts, Provider tools                                 │
│  Automation: Automations, Runs, Logs                                 │
│  System: Plugins, Settings                                           │
│  TanStack Query, React Flow, Tailwind CSS, lucide-react              │
└──────────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│ bits-ai-video-creator-core (pure Rust)                               │
│  studio, tts, models, validation, engine, scheduler, secrets,        │
│  import/export, providers, provider tools, plugins, AI drafts,       │
│  license, redaction                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend never opens SQLite, reads a secret, or executes a workflow directly. All mutations go
through typed Tauri commands. The core crate has no Tauri dependency and is unit-tested in
isolation.

## Repository layout

| Path | Responsibility |
|---|---|
| `src/` | React application, routes, pages, components, API wrapper, platform helpers |
| `src/pages/Storyboards.tsx` | Native scene/shot editor, validation, exports, dirty-state guard |
| `src/pages/Voiceover.tsx` | Browser speech preview, per-scene voice settings, provider TTS generation |
| `src/lib/studio.ts` | Frontend storyboard draft helpers, defaults, counts, runtime formatting |
| `src-tauri/src/lib.rs` | Command surface, application bootstrap, desktop/mobile wiring |
| `src-tauri/src/webview_manager.rs` | Desktop isolated provider WebView profiles and download bridge |
| `src-tauri/src/local_api.rs` | Opt-in loopback HTTP API |
| `src-tauri/src/updater.rs` | Desktop updater endpoint and update installation |
| `crates/bits-ai-video-creator-core/src/studio.rs` | Storyboard aggregate, normalization, export, prompt composition |
| `crates/bits-ai-video-creator-core/src/tts.rs` | OpenAI-compatible speech request, limits, response handling |
| `crates/bits-ai-video-creator-core/migrations/` | Versioned SQLite schema (currently schema version 3) |
| `src-tauri/gen/android/` | Generated Android project; build output ignored |
| `docs/` | Architecture, feature inventory, implementation evidence |
| `.github/workflows/` | CI and release pipelines |

## Application bootstrap

`run()` builds the Tauri app. Desktop-only plugins (single instance, updater) are compiled only for
`cfg(not(target_os = "android"))`. In `setup`:

1. Resolve `app_local_data_dir()` and create it.
2. Apply a staged database restore, if present; reject and quarantine invalid restores.
3. Open SQLite in WAL mode, run migrations, recover interrupted runs, seed settings.
4. Clean up orphaned provider profiles on desktop.
5. Initialise the platform secret store:
   - desktop: `keyring` v3 with native backends;
   - Android: `keyring-core` with `android-native-keyring-store` and Android Keystore.
6. Construct `LicenseManager`, `Engine`, `RunExecutor`, `Scheduler`, and `LocalApi`.
7. Spawn engine workers and the scheduler loop.
8. Register application state and commands.

The Android secret store is initialised before any command can access secrets. If the Android
Keystore is unavailable, the command returns an explicit error; there is no plaintext fallback.

## Studio domain

A storyboard is a local aggregate:

```text
Storyboard
├─ title, logline, style, aspect_ratio
├─ timestamps, schema_version
└─ scenes[]
   ├─ title, description, location, time_of_day
   ├─ voiceover { text, voice, rate, pitch, volume }
   └─ shots[]
      ├─ description, prompt, camera, dialogue, transition
      └─ duration_seconds
```

The full aggregate is normalized before persistence:

- IDs are trimmed, generated when missing, and checked for uniqueness across the storyboard.
- Text is trimmed and bounded: 500-character logline, 2,000-character scene fields, 4,000-character
  shot fields, 8,000-character voiceover.
- At most 100 scenes, 50 shots per scene, and 600 seconds per shot.
- Aspect ratios are restricted to `16:9`, `9:16`, `1:1`, `4:5`, and `21:9`.
- Voiceover rate is `0.5–2.0`, pitch `0–2.0`, volume `0–1.0`.

Scenes and shots are stored as JSON inside `storyboards.scenes`. `scene_count`, `shot_count`, and
`total_duration_seconds` are denormalized for list and dashboard queries. Export uses pure
functions:

- Markdown: a readable production brief with scenes, shots, prompts, and voiceover.
- JSON: a complete schema-versioned snapshot of the storyboard.

The UI keeps an explicit draft. Selecting another storyboard or navigating away with unsaved changes
asks for confirmation. Saving replaces the aggregate and recomputes the denormalized counts in the
same statement.

## Voiceover and TTS

Voiceover has two deliberately separate paths:

1. **Browser speech preview** — `window.speechSynthesis` reads the scene script with local voice,
   rate, pitch, and volume settings. No file is written and no network request is made. Some Linux
   WebViews do not expose speech synthesis; the UI reports that instead of silently failing.
2. **Provider audio generation** — the Rust core builds an OpenAI-compatible request for
   `POST {endpoint}/audio/speech` using `tts_endpoint`, `tts_model`, `tts_voice`, `tts_format`, and
   `tts_speed`. The key is read from `tts.api_key`, falling back to `ai.api_key`. The provider must
   support the route; the app does not pretend that every OpenAI-compatible chat endpoint does.

Generation limits:

- 4,096 input characters;
- 25 MB maximum audio response;
- `mp3`, `wav`, `opus`, `aac`, or `flac`;
- speed `0.25–4.0`;
- non-success HTTP statuses and empty responses become explicit errors.

The user chooses the destination with a native save dialog. The file extension must match the
configured format. A successful generation writes the bytes and stores a `voiceover_assets`
reference. Removing the reference deliberately leaves the file on disk.

## Persistence

SQLite schema version 3 contains:

| Table | Purpose |
|---|---|
| `accounts` | Provider identity metadata, status, tags, notes, ordering |
| `workflows` | Definition JSON, enabled flag, version, timestamps |
| `schedules` | Cron, time zone, next run, missed count |
| `runs` | Durable run state, trigger, idempotency key, timings, cancellation |
| `run_steps` | Per-node attempts, output, error, duration |
| `logs` | Redacted structured application/run logs |
| `settings` | Typed key/value application settings, including TTS and updater configuration |
| `secret_refs` | Names and timestamps only; secret values live in the OS vault |
| `prompts` | Local prompt library |
| `plugins` | Declarative plugin manifests and enabled state |
| `storyboards` | Storyboard aggregate JSON plus denormalized counts/runtime |
| `voiceover_assets` | Paths and metadata for generated speech files |
| `app_meta` | Device ID and other non-secret metadata |

WAL mode and `busy_timeout` allow the scheduler, executor, local API, and UI commands to share the
connection behind a mutex. Foreign keys are enabled. Migrations are applied transactionally and
tracked with `PRAGMA user_version`. `voiceover_assets` cascades when its storyboard is deleted; the
audio file itself is not deleted.

## Execution model (supporting automation)

A workflow definition is a versioned JSON graph with typed nodes. Supported node types include:

- `action.http` — validated HTTP request with optional retry policy;
- `action.delay` — bounded delay;
- `action.account_check` — local account-state check;
- `logic.condition` — branch selection;
- `transform.template` — string/template transform;
- `action.log` — redacted log entry;
- `error.retry` — bounded retry policy;
- `trigger.manual` / `trigger.schedule` — exactly one trigger per workflow.

`run_workflow` validates the definition, creates a `queued` run, and notifies the executor. Workers
claim queued runs with `cancel_requested = 0`, mark them `running`, execute steps sequentially, and
persist each step attempt. Cancellation is cooperative: the executor checks the database flag
between steps and while waiting. A run timeout bounds the whole execution.

Runs are durable. On restart, `recover_interrupted()` marks runs that were `running` as failed or
recoverable according to the stored state; queued runs remain eligible. Idempotency keys prevent
duplicate active runs.

Retries use bounded attempts and backoff. Network access is validated:

- loopback, private, link-local, multicast, unspecified, and IPv4-mapped loopback destinations are
  rejected unless the explicit private-network setting is enabled;
- redirects are bounded and revalidated;
- request bodies, headers, and timeouts are capped;
- response bodies are bounded before they are persisted.

Workflow nodes cannot invoke a shell, load a shared library, or execute arbitrary code.

## Scheduler

Each workflow has at most one schedule (`workflow_id` is unique). Cron expressions are parsed in the
core crate with an IANA time zone. The scheduler wakes every 15 seconds and:

1. Finds enabled schedules whose `next_run_at` is due.
2. Computes the next occurrence.
3. Creates a run with trigger `schedule`.
4. Records missed schedules explicitly (`status = missed`) instead of silently replaying them.

The scheduler uses the database as its source of truth, so a restart does not lose due work.
Android process lifetime limits mean schedules only advance while the app process is alive; this is
a documented limitation, not a claim of background reliability.

## Secrets

The `SecretStore` trait abstracts the platform vault. `SecretVault` stores only names in
`secret_refs`; values are read from the vault at execution time and redacted from logs and exports.

- Desktop: `keyring` v3 (`apple-native`, `windows-native`, `sync-secret-service`, `crypto-rust`).
- Android: `keyring-core` + `android-native-keyring-store`, backed by Android Keystore and
  app-private preferences.
- Service name: `id.co.bits.aivideocreator`.

If the vault is unavailable, secret-backed nodes fail explicitly. Exports omit secret values.

## Provider sessions (desktop)

On desktop, supported providers open in a child WebView with a per-account profile directory. The
Rust webview manager creates sanitized profile paths, bounds profile sizes, and controls the
download bridge. Account deletion removes the associated profile after confirmation. Passwords and
cookies are not read into the database.

Android does not implement embedded provider webviews in 1.0.0. Mobile commands return a clear
"not available" error, and the UI opens the provider URL in the system browser.

## Local API

The local API is opt-in and binds only to `127.0.0.1`. It requires a bearer token stored in the OS
vault, rejects browser `Origin`/`Referer` requests, validates the `Host` header, caps request and
body sizes, disables CORS, and exposes a narrow read/run surface. Token rotation invalidates the
old token. Tokens use the `bits_` prefix.

## Licensing

`LicenseManager` verifies offline Ed25519 tokens with the prefix `BITS1`. A build receives a public
key through `BITS_LICENSE_PUBKEY`; without a key the license mode is `open`. Release builds set the
public key at compile time. Tokens can bind to the local device ID. The gate is checked at unlock and
again before operations that create or execute work. Private keys are never part of the application
or repository.

The plan catalog is defined in `license.rs`:

| Plan | Price | Duration |
|---|---:|---|
| `monthly` | Rp20.000 | 30 days (verifier cap 31) |
| `yearly` | Rp200.000 | 365 days (verifier cap 366) |
| `lifetime` | Rp500.000 | No expiry; an expiry field is rejected |

Monthly/yearly tokens must carry an expiry after the issue time and no longer than the plan cap.
Lifetime tokens must not carry an expiry. Unknown plans are rejected. The issuer CLI prints the
catalog with `plans` and writes signed tokens with `issue`.

Payment is intentionally outside the app. The owner confirms payment, optionally collects the
device ID shown in the activation screen, and signs a token. The app never processes card data and
does not contact a license server.

## Updates

Desktop builds use `tauri-plugin-updater` with a minisign public key embedded in
`tauri.conf.json` and `src-tauri/src/updater.rs`. The default endpoint is:

```
https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json
```

`latest.json` and the referenced artifacts must be published on a public GitHub Release. Android
does not include the updater plugin; updates are installed as newer signed APKs.

## Security boundaries

- **IPC**: commands validate arguments and return typed errors; secrets are write-only after
  creation.
- **Network**: HTTP nodes, AI drafts, and TTS validate destinations, cap sizes, and revalidate
  redirects. TTS credentials come from the vault.
- **Filesystem**: import/export/audio paths are user-selected; download names are sanitized;
  provider profiles are constrained to the app data directory.
- **Logs**: secret values, tokens, cookies, and proxy passwords are redacted; TTS logs record byte
  counts, not audio or credentials.
- **CSP**: no remote script, frame, object, or form targets.
- **Release**: license private key, updater key, and Android signing key exist only in ignored local
  storage and CI secrets.

## Build and release topology

- `.github/workflows/ci.yml`: frontend checks/tests, Rust fmt/clippy/tests, Linux packaging,
  Windows compilation, Android debug build.
- `.github/workflows/release.yml`: Linux `.deb`/AppImage, Windows NSIS, signed Android APK/AAB,
  checksums, and `latest.json`. Release builds receive `BITS_LICENSE_PUBKEY` from workflow env.
- Linux artifact names: `BITS-AI-Video-Creator_1.0.0_amd64.deb`, `BITS-AI-Video-Creator_1.0.0_amd64.AppImage`.
- Android package: `id.co.bits.aivideocreator`, version code `1000000`, min SDK 24, target SDK 36.
- Windows installers are unsigned unless an Authenticode certificate is supplied separately.

## Known constraints

- Windows runtime is not verified on the Linux build host.
- Android runtime UI/keyring behavior is not verified without an emulator or physical device.
- Android lacks embedded provider sessions, the native download bridge, the in-app updater,
  single-instance handling, and background scheduling reliability.
- iOS is out of scope for 1.0.0.
- Provider TTS requires an endpoint that implements `/audio/speech`; chat-only endpoints will fail
  with an explicit error.
- Full provider DOM interaction is intentionally out of scope; BITS AI Video Creator runs
  HTTP/template/logic workflows and opens provider pages for manual work.
