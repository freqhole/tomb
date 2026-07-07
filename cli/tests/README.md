# grimoire CLI integration tests

integration testz

## QUICK START

```bash
# from the repo root:

# run all CLI integration tests
make test-cli

# run a specific test by name
make test-cli TEST=config_validate

# run tests matching a pattern
make test-cli TEST=playlist
make test-cli TEST=analytics

# list all available tests
make test-cli-list

# generate coverage report (CLI integration tests only)
make test-cli-coverage
open coverage/index.html  # view the HTML report
```

## TEST INFRASTRUCTURE

### TestContext

all tests use `TestContext::from_snapshot()`, which points `run_cli()` / `run_json()` at the
shared snapshot db `data/test.db` (via `cli/tests/fixtures/test-config.toml`). there is no
per-test copy - tests share and mutate that one file, which is why `make test-cli` always runs
with `--test-threads=1`. write new tests with that in mind: don't assume a pristine db, and
don't assume other tests haven't mutated shared rows.

example:

```rust
#[test]
fn test_example() {
    let ctx = TestContext::from_snapshot();
    let result = ctx.run_json(&["command", "arg1", "arg2"]);

    assert_eq!(result["success"], true);
    assert!(result["data"]["field"].is_string());
}
```

### regenerating `data/test.db`

`data/test.db` is a real database built from an actual music library, not a fixture checked
into git (it's large and personal-library-derived). if it's missing or corrupted:

```bash
# one-time interactive setup: scans a music directory you provide and builds data/test.db
cargo test -p cli setup -- --ignored --nocapture

# or, if you have another known-good snapshot around (e.g. data/grimoire-fixture.db):
cp data/grimoire-fixture.db data/test.db
```

`data/test-blobdata.db` is the matching sidecar for blob metadata (copy from
`data/grimoire-fixture-blobdata.db` the same way if needed). it has no `_sqlx_migrations`
table, so it's never affected by the checksum issue below.

### fixing "migration N was previously applied but has been modified"

this means a migration file under `migrations/` was edited _after_ being applied to whatever
db you're pointed at (sqlx checksums each migration file with sha384 and stores it in
`_sqlx_migrations`; editing an already-applied migration invalidates every existing db that
ran the old version, forever, until reconciled). `data/test.db` and `data/grimoire-fixture.db`
are long-lived snapshots, so they're especially exposed to this whenever an old migration gets
touched.

fix by updating the stored checksum to match the corrected file (do this on both
`data/test.db` and `data/grimoire-fixture.db` so the poisoned checksum doesn't come back next
time someone copies the fixture over):

```bash
# 1. compute the correct checksum from the current migration file
shasum -a 384 migrations/0NN_whatever.sql

# 2. write it into the db(s) (sqlite stores the checksum as a BLOB)
sqlite3 data/test.db "UPDATE _sqlx_migrations SET checksum = X'<uppercased hex from step 1>' WHERE version = NN;"
sqlite3 data/grimoire-fixture.db "UPDATE _sqlx_migrations SET checksum = X'<same hex>' WHERE version = NN;"
```

this is only safe when the migration edit was a genuine post-hoc fix to already-correct
behavior (check `git log --follow -- migrations/0NN_whatever.sql` to confirm). if the edit
changed what the migration actually does, the old snapshot's data may be out of sync with the
new migration's intent and reconciling the checksum alone isn't enough - the db needs
re-migrating from scratch instead. avoid editing already-applied migrations going forward; add
a new migration instead.

### JSON Output

all tests use `--json-output` flag for structured assertions:

```rust
let result = ctx.run_json(&["database", "info"]);

// standard response shape:
// {
//   "success": true/false,
//   "message": "...",
//   "data": { ... },
//   "errors": [ ... ]  // only on failure
// }
```

## WRITING NEW TESTS

### BASIC TEST PATTERN

```rust
#[test]
fn test_my_command() {
    let ctx = TestContext::from_snapshot();

    // Run command with JSON output
    let result = ctx.run_json(&["my", "command", "--arg", "value"]);

    // Assert success
    assert_eq!(result["success"], true);

    // Assert data structure
    assert!(result["data"]["id"].is_number());
    assert_eq!(result["data"]["name"], "expected");
}
```

### SEQUENTIAL TEST PATTERN

```rust
#[test]
fn test_workflow() {
    let ctx = TestContext::from_snapshot();

    // Step 1: Create
    let create_result = ctx.run_json(&["create", "item"]);
    let item_id = create_result["data"]["id"].as_i64().unwrap();

    // Step 2: Update (use ID from previous step)
    let update_result = ctx.run_json(&[
        "update",
        &item_id.to_string(),
        "--name",
        "new-name"
    ]);

    // Step 3: Verify
    assert_eq!(update_result["data"]["name"], "new-name");
}
```

### TESTING ERROR CASES

```rust
#[test]
fn test_error_handling() {
    let ctx = TestContext::from_snapshot();

    let result = ctx.run_json(&["get", "nonexistent-id"]);

    assert_eq!(result["success"], false);
    assert!(result["message"].as_str().unwrap().contains("not found"));
}
```

## DEBUGGING TESTS

### run with output

```bash
make test-cli TEST=test_name
```

### run a single test

```bash
make test-cli TEST=playlist_create
```

### run all tests in a module

```bash
make test-cli TEST=analytics
make test-cli TEST=music
```

### check test binary

```bash
# the tests run the rathole binary, make sure it's built:
cargo build --bin rathole
```

## COVERAGE

generate coverage report for CLI integration tests:

```bash
# install cargo-llvm-cov (one-time)
cargo install cargo-llvm-cov

# generate coverage (CLI integration tests only, not unit tests)
make test-cli-coverage

# view HTML report
open coverage/index.html
```

**note:** coverage reports show CLI integration test coverage only (unit tests are not included).
