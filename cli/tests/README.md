# Grimoire CLI Integration Tests

This directory contains comprehensive integration tests for all Grimoire CLI commands.

## Quick Start

```bash
# From the grimoire/ directory:

# Run all CLI integration tests
make test-cli

# Run a specific test by name
make test-cli TEST=config_validate

# Run tests matching a pattern
make test-cli TEST=playlist
make test-cli TEST=analytics

# List all available tests
make test-cli-list

# Generate coverage report (CLI integration tests only)
make test-cli-coverage
open coverage/index.html  # View the HTML report
```

## Test Status

**76 tests total, 73 passing (96% success rate, 1 ignored, 2 known issues)**

### Coverage by Module

- ✅ **Config** (1 test) - Configuration validation
- ✅ **Database** (2 tests) - Database info and connectivity
- ✅ **Jobs** (5 tests) - Job listing, scanning, processing, stats
- ✅ **Users** (7 tests) - User CRUD, invite codes
- ✅ **Maintenance** (5 tests) - Cleanup operations
- ✅ **Analytics** (15 tests) - All analytics commands
- ✅ **Wordlist** (4 tests) - Wordlist operations
- ✅ **Playlists** (12 tests) - Playlist CRUD and search
- ✅ **Music** (24 tests) - Music queries, CRUD, search

## Test Structure

```
tests/
├── README.md              # This file
├── mod.rs                 # TestContext and shared utilities
├── fixtures/
│   ├── test-config.jsonc  # Test configuration
│   └── test.db            # SQLite snapshot (copied per test)
└── cli/
    ├── mod.rs
    ├── analytics.rs       # Analytics command tests
    ├── config.rs          # Config command tests
    ├── database.rs        # Database command tests
    ├── jobs.rs            # Job command tests
    ├── maintenance.rs     # Maintenance command tests
    ├── music.rs           # Music command tests
    ├── playlists.rs       # Playlist command tests
    ├── users.rs           # User command tests
    └── wordlist.rs        # Wordlist command tests
```

## Test Infrastructure

### TestContext

All tests use `TestContext::from_snapshot()` which:

1. Copies `fixtures/test.db` to a temporary location
2. Provides `run_cli()` and `run_json()` methods
3. Automatically cleans up temp files on drop

Example:

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

All tests use `--json-output` flag for structured assertions:

```rust
let result = ctx.run_json(&["database", "info"]);

// Standard response shape:
// {
//   "success": true/false,
//   "message": "...",
//   "data": { ... },
//   "errors": [ ... ]  // only on failure
// }
```

## Writing New Tests

### Basic Test Pattern

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

### Sequential Test Pattern

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

### Testing Error Cases

```rust
#[test]
fn test_error_handling() {
    let ctx = TestContext::from_snapshot();

    let result = ctx.run_json(&["get", "nonexistent-id"]);

    assert_eq!(result["success"], false);
    assert!(result["message"].as_str().unwrap().contains("not found"));
}
```

## Test Guidelines

### DO ✅

- Use `TestContext::from_snapshot()` for isolation
- Use `--json-output` for structured assertions
- Test both success and error cases
- Use meaningful test data
- Clean up after destructive operations (if needed)
- Use timestamps for unique usernames/codes

### DON'T ❌

- Share state between tests
- Hardcode IDs or paths
- Test implementation details
- Skip error case testing
- Use long UUIDs in usernames (50 char limit)

## Debugging Tests

### Run with output

```bash
make test-cli TEST=test_name
```

### Run single test

```bash
make test-cli TEST=playlist_create
```

### Run all tests in a module

```bash
make test-cli TEST=analytics
make test-cli TEST=music
```

### Check test binary

```bash
# The tests run the grimoire binary, make sure it's built:
cargo build --bin grimoire
```

## Common Issues

### "Binary not found"

Make sure the grimoire binary is built:

```bash
cargo build --bin grimoire
```

### "Database locked"

Tests must run with `--test-threads=1`:

```bash
cargo test --test '*' -- --test-threads=1
```

### "Username too long"

Use timestamps instead of UUIDs:

```rust
let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
let username = format!("user{}", timestamp);
```

### JSON parsing errors

Check that no logging is going to stdout. Logs should go to stderr or be disabled in test config:

```jsonc
"logging": {
  "level": "warn"  // or "error"
}
```

## Coverage

Generate coverage report for CLI integration tests:

```bash
# Install cargo-llvm-cov (one-time)
cargo install cargo-llvm-cov

# Generate coverage (CLI integration tests only, not unit tests)
make test-cli-coverage

# View HTML report
open coverage/index.html
```

**Important:** Coverage reports show CLI integration test coverage only. Unit tests are not included.

## Local Development

All tests run locally with Makefile commands. No CI setup required for development.

## Documentation

For detailed testing strategy and patterns, see:

- [docs/cli-plumbing-plan4-testing.md](../../docs/cli-plumbing-plan4-testing.md)

## Contributing

When adding new CLI commands:

1. Add at least a stub test that verifies the command runs
2. Test both success and error cases
3. Use `TestContext::from_snapshot()` for isolation
4. Update this README if you add new test patterns

## Questions?

See the main testing documentation or ask in the project Discord/Slack.
