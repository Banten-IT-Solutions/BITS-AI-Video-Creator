# NOTICE

BITS AI Video Creator is an independent, clean-room local-first AI video studio: native storyboard and
voiceover planning, provider-account metadata, and declarative automation. It was informed by the observable
behavior and public documentation of the projects listed below, but does not copy substantial source code,
assets, icons, or proprietary text from them.

## Referenced projects

- An earlier local-first account manager prototype (not included in this repository). No license
  file was present in the inspected tree. It is referenced only for behavioral context and is not
  part of the BITS AI Video Creator product identity.
- **Flow Account Manager** (`sources/flow-account-manager`, tag `v3.0.3`, commit `68fa9b6`).
  The inspected source tree contains only a README. Behavioral references come from public release
  notes and static strings in the published FlowNex 3.0.3 Windows installer
  (SHA-256 `3fed9868a2a4379966792abd0df99cc1b3d5d5f1d0ebb71d11ef0d6ad6fac513`).

No source code, assets, icons, or proprietary text from those projects were copied into this
repository. Product names, provider names, and trademarks belong to their respective owners.
References are for identification and interoperability only and do not imply endorsement.

## New implementation

The architecture, Rust core, SQLite schema, storyboard and TTS domain, execution engine, scheduler,
import/export formats, React UI, Android shell, tests, icons, and release tooling in this repository
were written for BITS AI Video Creator 1.0.0. BITS AI Video Creator is not affiliated with or endorsed by the
authors of the referenced projects.

## Third-party software

Runtime and development dependencies retain their own licenses and notices. Principal components
include:

- Tauri and Tauri plugins (Apache-2.0 / MIT)
- React, React DOM, and React Flow / `@xyflow/react` (MIT)
- TanStack React Query (MIT)
- Tailwind CSS, Vite, TypeScript, Vitest, Testing Library (MIT / Apache-2.0)
- Rust crates including `rusqlite` (MIT), `serde` (MIT/Apache-2.0), `tokio` (MIT),
  `reqwest` (MIT/Apache-2.0), `chrono` / `chrono-tz` (MIT/Apache-2.0), `keyring` (MIT/Apache-2.0),
  `keyring-core` (MIT/Apache-2.0), `android-native-keyring-store` (MIT/Apache-2.0), `ring`
  (ISC-style), `base64` (MIT/Apache-2.0), and `uuid` (Apache-2.0/MIT)

Consult `Cargo.lock` and `package-lock.json` for the exact dependency set and each package's
license. Distributors are responsible for including the license texts required by those
dependencies.

## License

BITS AI Video Creator is released under the MIT License. See `LICENSE`.
