//! Integration test infrastructure for Grimoire CLI
//!
//! These tests validate the CLI by invoking the `freqhole` binary as a subprocess
//! and verifying its output. This approach provides true end-to-end testing.
//!
//! ## Test Database
//!
//! Tests use the shared `../data/test.db` file. Since tests run sequentially
//! (`--test-threads=1`), there are no conflicts even when tests mutate data.
//!
//! ## Code Coverage
//!
//! When running with `cargo llvm-cov`, tests automatically use the instrumented
//! binary from `target/llvm-cov-target/` and pass through coverage environment
//! variables to capture execution data from subprocesses.
//!
//! Run coverage with: `make test-cli-coverage`

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
    /// Verifies that `../data/test.db` exists before running tests.
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

        let bin_path = Self::find_binary();

        let mut cmd = Command::new(&bin_path);
        cmd.args(&full_args);

        // Pass through LLVM coverage env vars for subprocess coverage collection
        if let Ok(profile_file) = std::env::var("LLVM_PROFILE_FILE") {
            cmd.env("LLVM_PROFILE_FILE", profile_file);
        }

        let output = cmd.output().expect("Failed to execute CLI");

        TestOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            status: output.status.code(),
        }
    }

    /// Run CLI command with --json-output, parse result as JSON
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

    /// Find the freqhole binary to execute
    ///
    /// Search order:
    /// 1. CARGO_BIN_EXE_freqhole env var (set by cargo test)
    /// 2. Instrumented binary at target/llvm-cov-target/debug/freqhole (for coverage)
    /// 3. Regular debug binary at target/debug/freqhole
    fn find_binary() -> String {
        if let Ok(path) = std::env::var("CARGO_BIN_EXE_freqhole") {
            return path;
        }

        // Check for instrumented binary (when running with cargo-llvm-cov)
        let mut coverage_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        coverage_path.pop();
        coverage_path.push("target/llvm-cov-target/debug/freqhole");

        if coverage_path.exists() {
            return coverage_path.to_string_lossy().to_string();
        }

        // Fallback: regular debug binary
        let mut debug_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        debug_path.pop();
        debug_path.push("target/debug/freqhole");
        debug_path.to_string_lossy().to_string()
    }
}

/// One-time setup: create test database from music directory
///
/// This test is marked `#[ignore]` and must be run explicitly:
/// ```
/// cargo test setup -- --ignored --nocapture
/// ```
///
/// It will:
/// 1. Prompt for a music directory path
/// 2. Scan the directory for audio files
/// 3. Process the files and create `../data/test.db`
#[test]
#[ignore]
fn setup() {
    println!("\n=== Grimoire Test Database Setup ===");
    println!("This will create ../data/test.db for integration tests.");
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

    // Create data directory if needed
    std::fs::create_dir_all("../data").expect("Failed to create data directory");

    let test_db_path = PathBuf::from("../data/test.db");

    // Remove existing test DB if present
    if test_db_path.exists() {
        println!("\nRemoving existing test.db...");
        std::fs::remove_file(&test_db_path).expect("Failed to remove existing test.db");
    }

    println!("\nCreating test database...");

    let test_config_path = PathBuf::from("tests/fixtures/test-config.jsonc");

    // Helper to run CLI commands during setup
    let run_setup_command = |args: &[&str]| -> Value {
        let mut full_args = vec!["--config", test_config_path.to_str().unwrap()];
        full_args.extend_from_slice(args);
        full_args.push("--json-output");

        let bin_path = TestContext::find_binary();

        let output = Command::new(&bin_path)
            .args(&full_args)
            .output()
            .expect("Failed to execute CLI");

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        serde_json::from_str(&stdout)
            .unwrap_or_else(|e| panic!("Invalid JSON response:\n{}\nError: {}", stdout, e))
    };

    // Scan directory for music files
    println!("Scanning directory: {}", music_path);
    let result = run_setup_command(&["jobs", "scan", music_path]);

    if !result["success"].as_bool().unwrap_or(false) {
        panic!("Scan failed: {:?}", result);
    }

    println!("Scan job created: {}", result["data"]["job_id"]);

    // Process all jobs
    println!("\nProcessing jobs...");
    let result = run_setup_command(&["jobs", "run-processor", "--once", "--max-jobs", "1000"]);

    if !result["success"].as_bool().unwrap_or(false) {
        panic!("Processing failed: {:?}", result);
    }

    println!("Processing complete");

    // Verify data was loaded
    println!("\nVerifying loaded data...");
    let result = run_setup_command(&["music", "query-songs", "--limit", "1"]);
    let count = result["data"]["total_count"].as_u64().unwrap();

    if count == 0 {
        panic!("No songs were loaded!");
    }

    println!("Total songs loaded: {}", count);
    println!("\nSnapshot saved to: {:?}", test_db_path);
    println!("\nSetup complete! Run tests with: cargo test");
}
