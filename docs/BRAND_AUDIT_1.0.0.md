# BITS AI Video Creator 1.0.0 — Brand Audit

This record covers the repository-wide brand audit performed before the final 1.0.0 release build.
Its purpose is to make the product identity unambiguous in source, documentation, UI copy, release
metadata, and packaged artifacts.

## Canonical identity

| Item | Value |
|---|---|
| Product name | BITS AI Video Creator |
| Repository | `Banten-IT-Solutions/BITS-AI-Video-Creator` |
| Desktop/Android identifier | `id.co.bits.aivideocreator` |
| Rust crates | `bits-ai-video-creator`, `bits-ai-video-creator-core`, `bits_ai_video_creator_lib` |
| Database | `bits-ai-video-creator.db` |
| Export envelope | `bits-ai-video-creator.export` |
| Keyring service | `id.co.bits.aivideocreator` |
| License token prefix | `BITS1` |
| Local API token prefix | `bits_` |
| Update endpoint | `https://github.com/Banten-IT-Solutions/BITS-AI-Video-Creator/releases/latest/download/latest.json` |

## Audit scope

The audit searched tracked source, configuration, tests, comments, UI copy, documentation, release
metadata, and packaged build inputs for the former product name and its identifiers, including
case-insensitive and separator variants. It also checked file names, Rust/TypeScript identifiers,
CSS class names, Android packages, Tauri metadata, and release asset names.

Ignored local reference checkouts under `sources/`, old build output under `target/`, and old local
artifacts are not part of the product tree and are not published. They were excluded from the
source result and scanned separately only where relevant.

## Changes made

- Removed the former product name from documentation, comments, tests, UI copy, configuration, and
  compatibility copy.
- Renamed the Rust core crate, Tauri library, Android package and Kotlin source paths, database,
  keyring service, local API token prefix, export identifiers, and release artifact names.
- Removed legacy brand extensions and legacy envelope-kind aliases from import/export validation.
  Plain legacy account-array JSON remains importable through structural detection.
- Renamed the legacy import tag from a former-brand tag to `legacy-1.x`.
- Replaced former-brand test fixture values with neutral BITS AI Video Creator values.
- Removed the former product name from the third-party notice while retaining the factual statement
  that an earlier prototype informed the work.
- Rebuilt the Android project after removing a stale former-brand native-library symlink that had
  been packaged by an earlier local build. The final APK/AAB contain only
  `libbits_ai_video_creator_lib.so`.
- Updated the feature inventory, implementation plan, README, release notes, and changelog to the
  canonical BITS AI Video Creator identity and current release state.

## Verification

### Source tree

The tracked tree was searched case-insensitively for the former product token, its separator and
casing variants, and its reverse-domain identifier. File names were checked separately. The literal
search pattern is intentionally omitted from this public document so the retired branding is not
reintroduced into the repository.

Result: no matches in tracked source, configuration, tests, UI copy, documentation, identifiers, or
file names. The former brand is not used as a compatibility alias.

### Local Linux artifacts

The locally built Debian package and AppImage were extracted and their contents were searched for the
same retired tokens and identifier variants.

Result: no matches.

### Local Android artifacts

The signed APK and AAB were extracted and their contents were searched for the same retired tokens
and identifier variants.

Result: no matches. The APK contains one native library,
`lib/arm64-v8a/libbits_ai_video_creator_lib.so`. Both artifacts declare package
`id.co.bits.aivideocreator`.

### Published release artifacts

The release workflow normalizes Linux and Windows artifact names to
`BITS-AI-Video-Creator_*`. The published Linux bundles, Android APK/AAB, and Windows NSIS installer
were downloaded from the `v1.0.0` release and searched for the retired tokens and identifier
variants. No matches were found. The Windows installer is NSIS-compressed, so this is a literal
content scan rather than a full runtime or installer-script review. Exact checksums and signature
results are recorded in [RELEASE_VERIFICATION_1.0.0.md](RELEASE_VERIFICATION_1.0.0.md).

## Non-brand references

Provider names such as Google Flow and Gemini, and third-party project references in `NOTICE.md`,
are external product or attribution references. They are not BITS AI Video Creator branding and are retained
only where required for interoperability or legal notice.

## Limits

This audit proves naming consistency in the repository and the inspected build inputs. Ignored
external reference checkouts under `sources/` are not tracked, built, or shipped and are excluded
from the product audit. This audit does not prove runtime behavior on Windows or Android; those
platforms remain unverified on real hardware, as documented in the README and release notes.
