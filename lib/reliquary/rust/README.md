# reliquary (rust crate)

freqhole media blob storage domain: content-addressed blob stores,
iroh-blobs wrappers, the snatch replication engine, blob acl gating, media helpers. see the
repo root README and the xl-refactor phase 2 doc for the design.

no functional code yet (phase 0 skeleton).

## local dev database

this crate never uses sqlx's compile-time query macros (see the design-rule doc comment atop
`src/lib.rs`) - queries are runtime-checked, so compiling this crate needs no `DATABASE_URL`
at all. `make db-setup` is an optional convenience for poking at a persistent local db by hand
(`reliquary.db`, separate from grimoire's `grimoire.db` and haruspex's `haruspex.db`) - it's
not required to build or test.

```bash
# optional: create + migrate a local dev db to poke at by hand
make db-setup

# or by hand:
cargo sqlx database create --database-url "sqlite:$(pwd)/reliquary.db"
cargo sqlx migrate run --source rust/migrations --database-url "sqlite:$(pwd)/reliquary.db"
```

migrations live under `rust/migrations/`.
