# Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/). Every push to
`main` is analyzed, the next semantic version is computed from commit messages, and the version,
changelog, tag, GitHub release, and platform artifacts are produced without a manual version bump.

## Commit messages drive the version

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Commit                                                       | Release |
| ------------------------------------------------------------ | ------- |
| `fix: correct the scheduler retry window`                     | patch   |
| `perf: avoid a full table scan on run listing`                | patch   |
| `feat: add storyboard narration tracks`                       | minor   |
| `feat!: replace the offline license format`                   | major   |
| `chore(deps): bump rusqlite`                                  | patch   |
| `docs:`, `style:`, `refactor:`, `test:`, `ci:`                | none    |

A `BREAKING CHANGE:` footer also triggers a major release. Keep the subject imperative and under
about 72 characters; put details in the body.

## What happens on merge to `main`

1. The `Semantic Release` workflow runs `semantic-release`.
2. `@semantic-release/commit-analyzer` determines the next version from commits since the last tag.
3. `@semantic-release/changelog` prepends the generated entry to `CHANGELOG.md`.
4. `scripts/set-release-version.mjs` writes the version to `package.json`, `package-lock.json`,
   `Cargo.toml`, `Cargo.lock`, and `src-tauri/tauri.conf.json`.
5. `@semantic-release/git` commits those files as
   `chore(release): <version> [skip ci]` and pushes to `main`.
6. `@semantic-release/github` creates the `<version>` tag and GitHub release with generated notes.
7. The workflow dispatches `release.yml` with the new tag. That workflow validates the tag, runs
   tests and audits, builds Linux, Windows, and Android artifacts, and uploads them to the release.

The `[skip ci]` marker prevents the version commit from re-running CI. Tags created with the workflow
`GITHUB_TOKEN` do not trigger `on: push: tags`, which is why the release workflow is dispatched
explicitly instead.

## Manual release

A tag pushed by a maintainer still triggers `release.yml` directly:

```bash
git tag 1.2.3
git push bits 1.2.3
```

You can also run `release.yml` from the Actions tab with the `tag` input. The job verifies that the
tag exists and that the checked-out commit matches it before building anything.

## Local dry run

```bash
GITHUB_TOKEN=... npm run release:dry
```

The dry run computes the next version and prints the release notes without writing files, committing,
tagging, or publishing. A token is required because the GitHub plugin verifies repository access.

## Tag format

Tags are bare versions such as `1.2.3`, without a `v` prefix. The historical `v1.0.0` tag is kept
because published asset and updater URLs point at it. A lightweight `1.0.0` alias tag on the same
commit gives semantic-release its baseline. This is a one-time transition step: push the alias tag
**before** the first push of `main` that enables the workflow.

```bash
git tag 1.0.0 bb0d40e
git push bits 1.0.0
```

`release.yml` detects the existing `v1.0.0` release and skips rebuilding the alias tag, so no
duplicate 1.0.0 artifacts are published. Do not create `v`-prefixed tags for new releases.

## First automated release

`1.0.0` (aliased from the historical `v1.0.0`) is the baseline. Since then, `main` contains the
breaking commit `feat!: full BITS License Manager integration, remove BITS1 offline scheme`, so the
first automated release is expected to be **2.0.0**. If a minor release is preferred instead, map
breaking changes to `minor` in the `releaseRules` section of `.releaserc.json` before enabling the
workflow.

## Requirements and rollback

- `main` must allow the workflow token to push the release commit and tag. If branch protection is
  enabled, allow the GitHub Actions bot to bypass it or the `@semantic-release/git` step will fail.
- `GITHUB_TOKEN` must keep `contents: write`, `issues: write`, `pull-requests: write`, and
  `actions: write` (see `.github/workflows/semantic-release.yml`).
- To undo a release, delete the GitHub release and tag, then revert the release commit:

  ```bash
  gh release delete 2.0.0 --yes --cleanup-tag
  git revert <release-commit>
  ```

  The next push recomputes the version from the remaining commits.

## Dependency advisory note

`semantic-release` depends on `@semantic-release/npm`, which bundles the `npm` library and its
`ip-address` 10.7.2 dependency. `npm audit` reports a moderate advisory for that bundled copy. The
npm plugin is not part of this project's release configuration, the dependency is development-only,
and it is not shipped in the application. CI audits fail on high and critical advisories.
