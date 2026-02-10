# grimoire CLI integration tests

integration testz

## QUICK START

```bash
# From the grimoire/ directory:

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

all tests use `TestContext::from_snapshot()` which:

1. copies `fixtures/test.db` to a temporary location
2. provides `run_cli()` and `run_json()` methods
3. automatically cleans up temp files on drop

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
# The tests run the grimoire binary, make sure it's built:
cargo build --bin grimoire
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
