# reliquary (rust crate)

media blob storage domain logic for the freqhole family: content-addressed blob stores,
iroh-blobs wrappers, the snatch replication engine, blob acl gating, media helpers. see the
repo root README and the xl-refactor phase 2 doc for the design.

no functional code yet (phase 0 skeleton).

## local dev database

sqlx's compile-time query macros (`query!`, `query_as!`) check queries against a real database
at build time. this crate owns its own db file (`reliquary.db`), separate from grimoire's
`grimoire.db` and haruspex's `haruspex.db` - each library crate carries its own
`DATABASE_URL`.

```bash
# one-time: create + migrate a local dev db for the macros
make db-setup

# or by hand:
export DATABASE_URL="sqlite:$(pwd)/reliquary.db"
cargo sqlx database create
cargo sqlx migrate run --source rust/migrations
```

migrations live under `rust/migrations/` (empty for now - phase 2 adds the first real one;
`sqlx migrate run` against zero migrations is a no-op, so `make db-setup` works fine as-is).
