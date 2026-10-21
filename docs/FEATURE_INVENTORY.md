# BITS AI Video Creator 1.0.0 — Feature Inventory

Status vocabulary:

- **Implemented** — code path exists and is covered by automated tests or verified local builds.
- **Built** — artifact compiled; runtime behavior not fully exercised.
- **Desktop only** — intentionally unavailable in the Android build.
- **Unavailable** — not part of 1.0.0.
- **Unverified** — implemented but not exercised on real hardware in this workspace.

This inventory describes the 1.0.0 source tree. It does not claim full production parity across
platforms.

## Shell and platform

| Feature | Desktop | Android | Evidence / notes |
|---|---|---|---|
| Tauri 2 application shell | Implemented | Built | `src-tauri/src/lib.rs`; shared core crate |
| React 18 + Vite + Tailwind UI | Implemented | Built | `npm run check`, `npm test`, `npm run build` |
| Responsive studio navigation | Implemented | Built | Sidebar at `md+`; drawer and bottom navigation below `md` |
| Mobile safe-area handling | Implemented | Unverified | `viewport-fit=cover`; CSS env() insets |
| Single-instance lock | Implemented | Unavailable | Desktop-only plugin; not runtime-tested here |
| System tray / background service | Unavailable | Unavailable | Not implemented |
| iOS build | Unavailable | — | Requires macOS/Xcode and Apple credentials |
| Windows NSIS installer | Built (CI) | — | Published v1.0.0 asset; not executed on this Linux host |
| Linux `.deb` / AppImage | Built and published | — | Published v1.0.0 assets; checksums, signatures, and headless smoke in the release verification doc |
| Android APK | — | Built locally and in CI | Published signed arm64 APK; runtime not verified here |
| Android AAB | — | Built locally and in CI | Published signed arm64 AAB; runtime not verified here |
| Android runtime launch | — | Unverified | No emulator/KVM/system image reported on this host |

## Studio — storyboards

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Storyboard list/search | Implemented | Built | SQLite list, denormalized scene/shot/runtime counts |
| Create/read/update/delete | Implemented | Built | Core CRUD and DB tests |
| Duplicate storyboard | Implemented | Built | Independent copy of the aggregate |
| Scene editor | Implemented | Built | Title, direction, location, time of day |
| Nested shots | Implemented | Built | Description, prompt, camera, dialogue, transition, duration |
| Reorder scenes/shots | Implemented | Built | Explicit up/down controls |
| Runtime totals | Implemented | Built | Sum of shot durations, shown in list/editor |
| Aspect ratios | Implemented | Built | `16:9`, `9:16`, `1:1`, `4:5`, `21:9` |
| Validation | Implemented | Built | Bounds, IDs, text limits, voice ranges |
| Unsaved-change guard | Implemented | Built | Router/beforeunload confirmation |
| Markdown export | Implemented | Built | Scene/shot/voiceover production brief |
| JSON export | Implemented | Built | Schema-versioned snapshot |
| Import storyboard JSON | Unavailable | Unavailable | Export only in 1.0.0; full DB restore covers local data |
| Render/video file generation | Unavailable | Unavailable | The app plans and prompts; it is not a render farm |

## Studio — voiceover and TTS

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| One voiceover script per scene | Implemented | Built | Stored in the storyboard aggregate |
| Browser speech preview | Implemented | Built | `speechSynthesis`; no file/network |
| Voice selection | Implemented | Built | System voices; availability varies by WebView |
| Rate/pitch/volume controls | Implemented | Built | Persisted with the scene |
| Provider TTS request builder | Implemented | Built | OpenAI-compatible `/audio/speech` |
| Provider key resolution | Implemented | Built | `tts.api_key`, fallback `ai.api_key` |
| Audio format/speed settings | Implemented | Built | `mp3`, `wav`, `opus`, `aac`, `flac`; 0.25–4.0 |
| Generation limits | Implemented | Built | 4,096 chars, 25 MB response |
| Save dialog and extension check | Implemented | Built | User-selected destination |
| Audio reference list/open/delete | Implemented | Built | File remains on disk when reference is removed |
| Offline TTS engine | Unavailable | Unavailable | Browser speech is preview only; no bundled neural TTS |
| Background audio rendering | Unavailable | Unavailable | Generation runs while the app is alive |

## Providers

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Create/read/update/delete accounts | Implemented | Built | Core CRUD tests |
| Favorite, status, tags, notes | Implemented | Built | Validated inputs |
| Search/filter/sort | Implemented | Built | SQL filters |
| Duplicate detection | Implemented | Built | Core validation; case-normalized names |
| Import/export account metadata | Implemented | Built | Versioned envelope; secrets excluded |
| Isolated provider WebView | Implemented | Unavailable | Desktop `webview_manager`; Android returns explicit error |
| Per-account profile cleanup | Implemented | Unavailable | Desktop-only |
| Provider download bridge | Implemented | Unavailable | Sanitized filenames; desktop only |
| Provider profile inspection | Implemented | Unavailable | Android shows `unavailable` |
| Android system-browser provider sign-in | — | Implemented | `openUrl` via opener plugin |
| Provider list (Google Flow, Dola, Leonardo AI, ChatGPT, Migoo, Gemini) | Implemented | Built | Static core provider registry |
| Hosted Google Flow storyboard page | Desktop WebView | System browser | Explicitly separate from native storyboards |
| Hosted Gemini TTS page | Desktop WebView | System browser | Explicitly a web page, not an API |

## Automation (supporting module)

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Visual React Flow editor | Implemented | Built | Desktop three-pane; mobile sheets |
| JSON definition editor | Implemented | Built | Validated before save |
| Create/update/duplicate/delete | Implemented | Built | Core CRUD tests |
| Enable/disable | Implemented | Built | Persisted flag |
| Validation | Implemented | Built | Trigger count, edge integrity, cycles, node config, URL safety |
| Manual trigger | Implemented | Built | Creates durable queued run |
| Schedule trigger | Implemented | Built | Cron + IANA timezone |
| HTTP action | Implemented | Built | Method/URL/header/body validation; SSRF controls |
| Delay action | Implemented | Built | Bounded |
| Log action | Implemented | Built | Redacted structured log |
| Account-check action | Implemented | Built | Reads local account status |
| Condition branch | Implemented | Built | `true`/`false` edges |
| Template transform | Implemented | Built | Variable interpolation |
| Retry policy node | Implemented | Built | Attempt/backoff bounds |
| Workflow export | Implemented | Built | JSON |
| Node palette / inspector | Implemented | Built | Mobile sheets for both |
| Undo/redo | Unavailable | Unavailable | Not implemented |
| Arbitrary code/shell nodes | Unavailable | Unavailable | Deliberately excluded |

## Execution engine and scheduler

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Durable run queue | Implemented | Built | SQLite `runs`/`run_steps` |
| Configurable worker count | Implemented | Built | Settings-driven |
| Cooperative cancellation | Implemented | Built | Tested in core |
| Per-run timeout | Implemented | Built | Tested |
| Retry/backoff | Implemented | Built | Tested with transient HTTP failure |
| Idempotency keys | Implemented | Built | Active-run unique index |
| Restart recovery | Implemented | Built | `recover_interrupted` |
| Step output persistence | Implemented | Built | Bounded |
| Cron scheduling | Implemented | Built | Core scheduler tests |
| Missed-run recording | Implemented | Built | Tested; no silent replay |
| Background execution while app closed | Unavailable | Unavailable | Android process limits; desktop app must run |
| Distributed workers | Unavailable | Unavailable | Single local process |

## Runs, logs, and observability

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Run list with filters | Implemented | Built | Status/workflow/time filters |
| Run detail and step timeline | Implemented | Built | Per-step output/error |
| Retry run | Implemented | Built | New durable run |
| Cancel run | Implemented | Built | Cooperative flag |
| Structured redacted logs | Implemented | Built | Secret/token redaction |
| Log filtering/export | Implemented | Built | User-selected file |
| Retention cleanup | Implemented | Built | Settings-driven |
| Remote telemetry | Unavailable | Unavailable | No analytics or crash upload |

## Prompts and plugins

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Prompt CRUD | Implemented | Built | Core tests |
| Categories, pinning, colors, search | Implemented | Built | Local only |
| Clipboard copy | Implemented | Built | Browser clipboard API |
| Declarative plugin install | Implemented | Built | HTTPS presets only |
| Plugin enable/disable/remove | Implemented | Built | Stored manifests |
| Plugin code execution | Unavailable | Unavailable | Not supported by design |
| Marketplace/download service | Unavailable | Unavailable | No hosted catalog |

## Security and data

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| OS credential vault | Implemented | Built | `keyring` / Android Keystore-backed store |
| No plaintext secret fallback | Implemented | Implemented | Explicit failure when vault unavailable |
| Secret references only in DB | Implemented | Built | `secret_refs` table |
| Redaction | Implemented | Built | Core redaction tests |
| SSRF/private-network controls | Implemented | Built | Core runtime tests |
| Path traversal/download name sanitization | Implemented | Desktop only | Core tests |
| Request/body/timeout caps | Implemented | Built | Validation and runtime |
| Confirmation for destructive actions | Implemented | Built | UI dialogs |
| Local API loopback + bearer token | Implemented | Built | Core tests; no CORS; `bits_` token prefix |
| Opt-in private network access | Implemented | Built | Setting |
| Proxy support | Implemented | Built | Credentials in vault |
| Import/export without secrets | Implemented | Built | Tests |
| Backup/verify/staged restore | Implemented | Built | Tests |
| Encryption at rest beyond OS/vault | Unavailable | Unavailable | SQLite is not separately encrypted |
| Multi-user accounts/roles | Unavailable | Unavailable | Single local user |

## Licensing and updates

| Feature | Desktop | Android | Notes |
|---|---|---|---|
| Offline Ed25519 license tokens | Implemented | Built | `BITS1` prefix; release builds embed the pubkey; dev/CI builds without it are open |
| Monthly/yearly/lifetime plan semantics | Implemented | Built | Plan tests; expiry caps; lifetime no expiry |
| Device binding | Implemented | Built | Local device ID |
| License gate at launch and work creation | Implemented | Built | Release builds embed public key |
| Issuer CLI | Implemented | — | Not bundled with the app |
| Payment checkout | Unavailable | Unavailable | Payment handled externally via bits.co.id |
| Tauri updater | Implemented | Unavailable | Signed `latest.json`; update flow not runtime-tested |
| In-app update check | Implemented | Unavailable | Android returns explicit error |
| Android APK update by install | — | Documented | Signed APK from GitHub Releases |
| Windows Authenticode signing | Unavailable | — | No trusted certificate available |
| Android release signing | — | Built locally and in CI | Published signed APK/AAB; keystore injection in CI |

## Verification summary

Results recorded for the published `v1.0.0` release are in
`docs/RELEASE_VERIFICATION_1.0.0.md`.

| Check | Result |
|---|---|
| `npm run check` | Pass |
| `npm test` | Pass — 30/30 |
| `npm run build` | Pass |
| `cargo test --workspace` | Pass — 90/90 (77 core + 13 Tauri) |
| `cargo fmt --all -- --check` | Pass |
| `cargo clippy --workspace --all-targets -- -D warnings` | Pass |
| CI run 39674218615 | Pass |
| Release run 39674266933 | Pass |
| Linux `.deb` / AppImage | Built and published; checksums and updater signatures verified; headless smoke pass |
| Android APK/AAB | Built locally and in CI; published signatures verified; runtime not verified |
| Windows NSIS | Built in CI; published updater signature verified; runtime and Authenticode not verified |
| Android runtime UI/keyring | Not verified |

## Legacy compatibility

- Accepts BITS AI Video Creator `.json`/`.bits-ai-video-creator` exports and plain legacy account-array JSON.
- Import detection is structural; legacy file extensions and legacy envelope kinds are rejected.
- Uses `BITS1` license tokens; legacy prefixes are not accepted.
- New data uses `bits-ai-video-creator.db`, `bits-ai-video-creator.export`, and `id.co.bits.aivideocreator`.
