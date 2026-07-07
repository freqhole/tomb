# haruspex (rust crate)

auth domain logic for the freqhole family: identity, devices, roles/groups, acl evaluation,
webauthn ceremonies, knock protocol, friendz peer protocol. see the repo root README and the
xl-refactor phase 4 doc for the design.

no functional code yet (phase 0 skeleton).

## local dev database

sqlx's compile-time query macros (`query!`, `query_as!`) check queries against a real database
at build time. this crate owns its own db file (`haruspex.db`), separate from grimoire's
`grimoire.db` and reliquary's `reliquary.db` - each library crate carries its own
`DATABASE_URL`.

```bash
# one-time: create + migrate a local dev db for the macros
make db-setup

# or by hand:
export DATABASE_URL="sqlite:$(pwd)/haruspex.db"
cargo sqlx database create
cargo sqlx migrate run --source rust/migrations
```

migrations live under `rust/migrations/` (empty for now - phase 4 adds the first real one;
`sqlx migrate run` against zero migrations is a no-op, so `make db-setup` works fine as-is).
