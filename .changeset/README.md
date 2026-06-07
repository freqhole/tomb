# changesets

this folder is managed by [changesets](https://github.com/changesets/changesets).
it drives version bumps + release notes for freqhole.

## adding a changeset (do this in every PR that should ship)

```bash
npx changeset
```

pick the bump type (patch / minor / major) for `freqhole-release` and write a
short human-readable summary. this creates a markdown file in `.changeset/` that
you commit with your PR. the summary lands in the release notes.

## what happens on merge to main

1. the `changesets` workflow opens (or updates) a "Version Packages" PR.
2. that PR runs `npm run version`, which:
   - runs `changeset version` (bumps the root `package.json`, regenerates
     `CHANGELOG.md`, deletes consumed changeset files), then
   - runs `node scripts/bump-version.mjs`, propagating the new version into
     `Cargo.toml`, midden, tauri config, every `package.json`, the `version.ts`
     constants, `freqhole-config.toml`, and the charnel about page (same as
     `make bump-version`).
3. merging the Version Packages PR tags `v$VERSION`, which triggers the
   `release` workflow: a draft github release plus the per-platform build jobs
   that upload artifacts.
4. verify the draft release assets, then publish it.
