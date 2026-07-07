# haruspex

everything auth for the freqhole family of apps (tomb, skein, playlistz): webauthn passkeys,
knock access requests, user identity, multi-device node ids, roles + groups, api keys +
invite codes, acl primitives, and the friendz peer protocol. rust crate `haruspex` +
npm package `@freqhole/haruspex`.

part of the [xl-refactor plan](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/OVERVIEW.md).
see [PHASE_4_HARUSPEX_RUST.md](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/PHASE_4_HARUSPEX_RUST.md)
and [PHASE_5_HARUSPEX_TS.md](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/PHASE_5_HARUSPEX_TS.md)
for the full design and extraction plan.

this repo is currently an empty skeleton (phase 0). no functional code yet - phase 4 (rust)
and phase 5 (ts) fill the crate/package in.

## structure

```
Cargo.toml         workspace root
rust/               crate: haruspex
ts/                 npm package: @freqhole/haruspex
docs/
```

## development

rust: `cargo test` (workspace). the crate owns its own sqlite db (`haruspex.db`); see
[rust/README.md](rust/README.md) for the local `DATABASE_URL` setup needed by sqlx's
compile-time query macros.

ts: `cd ts && npm install && npm test`.
