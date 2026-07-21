# haruspex (rust crate)

freqhole auth domain logic: identity, devices, roles/groups, acl evaluation,
webauthn ceremonies, knock protocol, friendz peer protocol. see the repo root README and the
xl-refactor phase 4 doc for the design.

no functional code yet (phase 0 skeleton).

## local dev database

this crate uses sqlx's runtime-checked query api (`query`/`query_as`/`query_scalar`), never
the compile-time `query!`/`query_as!` macros - see the doc comment on `rust/src/sqlite/mod.rs`
for why. compiling the crate needs no database and no `DATABASE_URL` at all.

a real sqlite db is still needed at runtime to run tests, examples, or anything else that
actually connects to a database (this crate owns its own db file, `haruspex.db`, separate from
grimoire's `grimoire.db` and reliquary's `reliquary.db`):

```bash
# one-time: create + migrate a local dev db
make db-setup

# or by hand:
export DATABASE_URL="sqlite:$(pwd)/haruspex.db"
cargo sqlx database create
cargo sqlx migrate run --source rust/migrations
```

migrations live under `rust/migrations/`.
