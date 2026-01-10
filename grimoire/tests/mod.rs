//! Integration test infrastructure for Grimoire CLI
//!
//! This module provides utilities for testing the CLI by running commands
//! against a real database snapshot.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

pub mod cli;

/// Test context for running CLI commands
pub struct TestContext {
    pub test_config_path: PathBuf,
    pub test_db_path: PathBuf,
}

/// Output from a CLI command
pub struct TestOutput {
    pub stdout: String,
    pub stderr: String,
    pub status: Option<i32>,
}

impl TestContext {
    /// Create new test context from snapshot
    /// Copies test.db to a temporary location for this test
    pub fn from_snapshot() -> Self {
        Self::from_snapshot_file("../data/test.db")
    }

    /// Create new test context from a specific snapshot file
    /// Useful for testing with different data sets or production snapshots
    ///
    /// The snapshot file is ALWAYS copied - never modified directly
    pub fn from_snapshot_file(snapshot_path: &str) -> Self {
        let test_config_path = PathBuf::from("tests/fixtures/test-config.jsonc");
        let source_db = PathBuf::from(snapshot_path);

        if !source_db.exists() {
            panic!(
                "Snapshot DB not found at {:?}. \n\
                For default test.db, run: cargo test setup -- --ignored --nocapture\n\
                Or copy an existing DB: cp ../data/grimoire.db ../data/test.db",
                source_db
            );
        }

        // Create a unique temp DB for this test (ensures snapshot is never modified)
        let temp_db =
            std::env::temp_dir().join(format!("grimoire-test-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(&source_db, &temp_db)
            .unwrap_or_else(|e| panic!("Failed to copy snapshot {:?}: {}", source_db, e));

        Self {
            test_config_path,
            test_db_path: temp_db,
        }
    }

    /// Run CLI command with test config, return raw output
    pub fn run_cli(&self, args: &[&str]) -> TestOutput {
        let mut full_args = vec!["--config", self.test_config_path.to_str().unwrap()];
        full_args.extend_from_slice(args);

        let output = Command::new(env!("CARGO_BIN_EXE_grimoire"))
            .args(&full_args)
            .output()
            .expect("Failed to execute CLI");

        TestOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            status: output.status.code(),
        }
    }

    /// Run CLI command with --json-output, parse result
    pub fn run_json(&self, args: &[&str]) -> Value {
        let mut json_args = args.to_vec();
        json_args.push("--json-output");

        let output = self.run_cli(&json_args);
        serde_json::from_str(&output.stdout).unwrap_or_else(|e| {
            panic!(
                "Invalid JSON response:\nSTDOUT:\n{}\n\nSTDERR:\n{}\n\nError: {}",
                output.stdout, output.stderr, e
            )
        })
    }
}

impl Drop for TestContext {
    fn drop(&mut self) {
        // Cleanup temp DB copy
        let _ = std::fs::remove_file(&self.test_db_path);
    }
}

/// One-time setup: scan music and create test DB
///
/// Run this manually when you first set up testing:
/// ```
/// cargo test setup -- --ignored --nocapture
/// ```
///
/// The `--ignored` flag means this test is normally skipped (marked with #[ignore])
/// The `--nocapture` flag shows the println! output (cargo normally captures it)
#[test]
#[ignore]
fn setup() {
    println!("\n=== Grimoire Test Database Setup ===");
    println!("This will create data/test.db for integration tests.");
    println!("\nEnter path to music directory:");

    let mut input = String::new();
    std::io::stdin()
        .read_line(&mut input)
        .expect("Failed to read input");
    let music_path = input.trim();

    if music_path.is_empty() {
        panic!("No path provided");
    }

    if !std::path::Path::new(music_path).exists() {
        panic!("Path does not exist: {}", music_path);
    }

    // Create data directory if it doesn't exist
    std::fs::create_dir_all("../data").expect("Failed to create data directory");

    let test_db_path = PathBuf::from("../data/test.db");

    // Remove existing test DB if present
    if test_db_path.exists() {
        println!("\nRemoving existing test.db...");
        std::fs::remove_file(&test_db_path).expect("Failed to remove existing test.db");
    }

    println!("\nCreating test database...");

    // Create a temporary DB for setup
    let temp_db = std::env::temp_dir().join(format!("grimoire-setup-{}.db", uuid::Uuid::new_v4()));

    let test_config_path = PathBuf::from("tests/fixtures/test-config.jsonc");

    // Helper to run commands during setup
    let run_setup_command = |args: &[&str]| -> Value {
        let mut full_args = vec!["--config", test_config_path.to_str().unwrap()];
        full_args.extend_from_slice(args);
        full_args.push("--json-output");

        let output = Command::new(env!("CARGO_BIN_EXE_grimoire"))
            .args(&full_args)
            .output()
            .expect("Failed to execute CLI");

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        serde_json::from_str(&stdout)
            .unwrap_or_else(|e| panic!("Invalid JSON response:\n{}\nError: {}", stdout, e))
    };

    // Scan directory
    println!("Scanning directory: {}", music_path);
    let result = run_setup_command(&["jobs", "scan", music_path]);

    if !result["success"].as_bool().unwrap_or(false) {
        panic!("Scan failed: {:?}", result);
    }

    println!("Scan job created: {}", result["data"]["job_id"]);

    // Process jobs
    println!("\nProcessing jobs...");
    let result = run_setup_command(&["jobs", "run-processor", "--once", "--max-jobs", "1000"]);

    if !result["success"].as_bool().unwrap_or(false) {
        panic!("Processing failed: {:?}", result);
    }

    println!("Processing complete");

    // Verify data loaded
    println!("\nVerifying loaded data...");
    let result = run_setup_command(&["music", "query-songs", "--limit", "1"]);
    let count = result["data"]["total_count"].as_u64().unwrap();

    if count == 0 {
        panic!("No songs were loaded!");
    }

    println!("Total songs loaded: {}", count);

    // Copy temp DB to permanent test DB location
    std::fs::copy(&temp_db, &test_db_path).expect("Failed to save test DB");

    // Clean up temp DB
    let _ = std::fs::remove_file(&temp_db);

    println!("\nSnapshot saved to: {:?}", test_db_path);
    println!("\nSetup complete! Now you can run tests with: cargo test");
}
