# reliquary

everything media blob file storage for the freqhole family of apps (tomb, skein, playlistz):
content-addressed blob stores (sqlite-native and indexeddb/opfs-browser), iroh-blobs wrappers
(fs store lifecycle, gc protection, verified transfer), the snatch engine (proactive blob
replication), blob acl gating, media helpers (image resize, thumbnails), shared browser utils
(workers, image/hash/log helpers). rust crate `reliquary` + npm package `@freqhole/reliquary`.

part of the [xl-refactor plan](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/OVERVIEW.md).
see [PHASE_2_RELIQUARY_RUST.md](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md)
and [PHASE_3_RELIQUARY_TS.md](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/PHASE_3_RELIQUARY_TS.md)
for the full design and extraction plan.

this repo is currently an empty skeleton (phase 0). no functional code yet - phase 2 (rust)
and phase 3 (ts) fill the crate/package in.

## structure

```
Cargo.toml         workspace root
rust/               crate: reliquary
ts/                 npm package: @freqhole/reliquary
docs/
```

## development

rust: `cargo test` (workspace) - no `DATABASE_URL` needed, queries are runtime-checked (see
[rust/README.md](rust/README.md)). the crate owns its own sqlite db (`reliquary.db`) at
runtime, separate from any consuming app's db.

ts: `cd ts && npm install && npm test`.
