//! Integration test infrastructure for Grimoire CLI
//!
//! This module provides utilities for testing the CLI by running commands
//! against a real database snapshot.
//!
//! Tests use the shared ../data/test.db file and run sequentially
//! (--test-threads=1) to avoid conflicts.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

pub mod cli;

/// Test context for running CLI commands
pub struct TestContext {
    pub test_config_path: PathBuf,
}

/// Output from a CLI command
pub struct TestOutput {
    pub stdout: String,
    pub stderr: String,
    pub status: Option<i32>,
}

impl TestContext {
    /// Create new test context using shared test database
    ///
    /// Tests use the shared ../data/test.db file.
    /// Since tests run sequentially (--test-threads=1), mutations don't cause conflicts.
    pub fn from_snapshot() -> Self {
        let test_config_path = PathBuf::from("tests/fixtures/test-config.jsonc");

        // Verify snapshot exists
        let snapshot_path = PathBuf::from("../data/test.db");
        if !snapshot_path.exists() {
            panic!(
                "Snapshot DB not found at {:?}. \n\
                Create it with: cargo test setup -- --ignored --nocapture\n\
                Or copy existing: cp ../data/grimoire.db ../data/test.db",
                snapshot_path
            );
        }

        Self { test_config_path }
    }

    /// Run CLI command with test config, return raw output
    pub fn run_cli(&self, args: &[&str]) -> TestOutput {
        let mut full_args = vec!["--config", self.test_config_path.to_str().unwrap()];
        full_args.extend_from_slice(args);

        // Find the binary - cargo sets CARGO_BIN_EXE_<name> for each binary
        let bin_path = if let Ok(path) = std::env::var("CARGO_BIN_EXE_freqhole") {
            path
        } else {
            // Fallback: look in target/debug
            let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.pop(); // Go to workspace root
            path.push("target/debug/freqhole");
            path.to_string_lossy().to_string()
        };

        let output = Command::new(&bin_path)
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
        // Insert --json-output after the command name (first arg)
        // e.g., ["database", "info"] -> ["database", "--json-output", "info"]
        let mut json_args = Vec::new();
        if !args.is_empty() {
            json_args.push(args[0]);
            json_args.push("--json-output");
            json_args.extend_from_slice(&args[1..]);
        }

        let output = self.run_cli(&json_args);
        serde_json::from_str(&output.stdout).unwrap_or_else(|e| {
            panic!(
                "Invalid JSON response:\nSTDOUT:\n{}\n\nSTDERR:\n{}\n\nError: {}",
                output.stdout, output.stderr, e
            )
        })
    }
}

/// One-time setup: scan music and create test DB
///
/// Run this manually when you first set up testing:
/// ```
/// cargo test setup -- --ignored --nocapture
/// ```
///
/// Helper function to set up test database with real music data
/// Run with: cargo test setup -- --nocapture --include-ignored
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

    let test_config_path = PathBuf::from("tests/fixtures/test-config.jsonc");

    // Helper to run commands during setup
    let run_setup_command = |args: &[&str]| -> Value {
        let mut full_args = vec!["--config", test_config_path.to_str().unwrap()];
        full_args.extend_from_slice(args);
        full_args.push("--json-output");

        // Use same binary path logic as run_cli
        let bin_path = if let Ok(path) = std::env::var("CARGO_BIN_EXE_freqhole") {
            path
        } else {
            let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.pop();
            path.push("target/debug/freqhole");
            path.to_string_lossy().to_string()
        };

        let output = Command::new(&bin_path)
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
    println!("\nSnapshot saved to: {:?}", test_db_path);
    println!("\nSetup complete! Now you can run tests with: cargo test");
}
