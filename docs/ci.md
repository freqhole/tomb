# ci + release

roughly:

- **signing in ci**: mac + android artifacts are signed/notarized in ci using
  secrets. jobs try to skip signing gracefully when secrets are absent (forks / dry runs).
- **runners**: github-hosted by default, but every job's `runs-on` reads a repo
  variable with a hosted fallback so any platform can be redirected to a
  self-hosted runner without editing yaml (budget control).
- **android**: ship both the universal apk and the arm64-only apk.
- **pi32 (armv7)**: best-effort, needs more testing...
- **changesets bridge**: so there's a private root `package.json` (🥺) whose `version` script
  runs `make bump-version`, so the canonical version in `Cargo.toml` (and spume /
  charnel / codegen package.json, version.ts files, config) _hopefully_ will stay in sync.
- **release artifacts**: uploaded as assets on a **draft** github release. the
  heavy platform builds run while the changesets "chore: version packages" PR is open
  (each push to that PR re-clobbers the draft's assets), so build problems get
  worked out before merge. each platform job is independent + individually
  re-runnable + non-blocking. merging the version PR simply **publishes** the
  already-built draft release - no production builds run on merge.

## runner variables

set these as repo/org **variables** (Settings -> Variables) to override the
hosted defaults with self-hosted labels. unset = hosted default.

| variable              | default            | used by                                            |
| --------------------- | ------------------ | -------------------------------------------------- |
| `MACOS_ARM64_RUNNER`  | `macos-14`         | mac arm cli + charnel dmg                          |
| `MACOS_X86_64_RUNNER` | `macos-14`         | mac intel cli + charnel dmg                        |
| `LINUX_X86_64_RUNNER` | `ubuntu-24.04`     | linux cli, charnel deb/rpm, flatpak, android, pi32 |
| `LINUX_ARM64_RUNNER`  | `ubuntu-24.04-arm` | linux arm64 cli, charnel deb/rpm, flatpak          |

## required secrets

| secret                         | purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `APPLE_CERTIFICATE_P12_BASE64` | base64 of Developer ID Application .p12        |
| `APPLE_CERTIFICATE_PASSWORD`   | password for the .p12                          |
| `APPLE_SIGNING_IDENTITY`       | e.g. `Developer ID Application: name (TEAMID)` |
| `APPLE_ID`                     | apple id email (notarization)                  |
| `APPLE_PASSWORD`               | app-specific password (notarization)           |
| `APPLE_TEAM_ID`                | apple team id                                  |
| `ANDROID_KEYSTORE_BASE64`      | base64 of release .keystore                    |
| `ANDROID_KEYSTORE_PASSWORD`    | keystore password                              |
| `ANDROID_KEY_ALIAS`            | key alias                                      |
| `ANDROID_KEY_PASSWORD`         | key password                                   |

## build split (release pipeline)

`release.yml` runs while the changesets "chore: version packages" PR is open. it is
triggered (no PAT) by: a push to `changeset-release/main`, the version PR being
reopened or synchronized (close+reopen it, or push a commit to it), or
`workflow_dispatch`. the changesets bot's own push uses `GITHUB_TOKEN`, which
github's recursion guard stops from auto-starting workflows - so the first build
is kicked off by one of those user-driven levers.

`create-release` runs first (draft release, version read from root
`package.json`); every platform job `needs` it and uploads its own assets. jobs
are otherwise independent. re-triggering re-clobbers the assets.

| job              | runner var   | artifacts                                                    |
| ---------------- | ------------ | ------------------------------------------------------------ |
| `mac-arm64`      | MACOS_ARM64  | `rathole_*_darwin-aarch64`, `freqhole_charnel_*_aarch64.dmg` |
| `mac-intel`      | MACOS_X86_64 | `rathole_*_darwin-x86_64`, `freqhole_charnel_*_x86_64.dmg`   |
| `linux-x86_64`   | LINUX_X86_64 | `rathole_*_linux-x86_64`, charnel `x86_64.deb`/`.rpm`        |
| `linux-arm64`    | LINUX_ARM64  | `rathole_*_linux-aarch64`, charnel `aarch64.deb`/`.rpm`      |
| `flatpak-x86_64` | LINUX_X86_64 | `*_x86_64.flatpak` (needs x86_64 deb from release)           |
| `flatpak-arm64`  | LINUX_ARM64  | `*_aarch64.flatpak` (needs arm64 deb from release)           |
| `android`        | LINUX_X86_64 | `*_android-universal.apk`, `*_android-arm64.apk`             |
| `pi32`           | LINUX_X86_64 | `rathole_*_linux-armv7` (best-effort)                        |

notes:

- flatpak jobs `needs` their matching linux job (ordering) and also
  `gh release download` the deb from the draft release so a lone re-run works.
- sqlx is offline in docker builds; ci runs `make db-prepare` first to generate
  the gitignored `.sqlx` cache (needs sqlx-cli + sqlite + migrations).

## pr checks (every non-release PR)

- `rust-check`: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo check`
  (workspace), unit tests (`cargo test`). sqlite db + migrations seeded so online
  sqlx macros compile.
- `web-check`: build midden wasm + codegen client, then spume `typecheck` +
  `vitest` + `lint`.
- `changeset-check`: `changeset status` — comments / fails when a PR adds no
  changeset (skipped for the changesets release PR itself).

## changesets flow

1. contributor adds a changeset (`make changes`) in their PR. `changeset-check`
   shows a green or red status check.
2. on merge to `main`, `changesets.yml` runs `changesets/action`:
   - changesets pending -> open/update the "chore: version packages" PR on branch
     `changeset-release/main` (runs `make bump-version` via the `version`
     script, regenerates `CHANGELOG.md`). kick off `release.yml` by pushing a
     commit to that branch or closing+reopening the PR (the bot's own push is
     suppressed by github's recursion guard, so it won't auto-build). builds
     every platform and uploads to a draft release `v$VERSION`. fix + re-trigger
     until the builds are green.
   - no changesets pending (version PR merged) -> the `publish` script
     (`release:publish`) flips that draft release to published, creating the
     `v$VERSION` tag at main HEAD and marking it latest. no builds run.
3. release notes = github autogenerated notes + the changesets `CHANGELOG`
   section. verify the draft's assets on the PR before merging.

## how the release PR is detected

the `changesets/action` inspects whether any changeset
files (`.changeset/*.md`) remain on `main`:

- changeset files present -> run the `version` script and open/update the
  "chore: version packages" PR (on branch `changeset-release/main`).
- no changeset files present -> run the `publish` script.

when the version PR is created, `changeset version` consumes (deletes) the
changeset files on that branch. merging the version PR therefore lands a `main`
with zero changesets, so the next `changesets.yml` run publishes the draft.
