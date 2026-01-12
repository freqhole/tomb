//! Jobs CLI integration tests

use crate::TestContext;

#[test]
fn test_jobs_list() {
    let ctx = TestContext::from_snapshot();

    // List jobs
    let result = ctx.run_json(&["jobs", "list", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list jobs successfully"
    );
    assert!(result["data"].is_array(), "Should return array of jobs");
}

#[test]
fn test_jobs_stats() {
    let ctx = TestContext::from_snapshot();

    // Get job statistics
    let result = ctx.run_json(&["jobs", "stats"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get job stats successfully"
    );

    // Stats should have counts for different statuses
    let data = &result["data"];
    assert!(data["total_jobs"].is_number(), "Should have total count");
    assert!(
        data["pending_jobs"].is_number(),
        "Should have pending count"
    );
    assert!(
        data["completed_jobs"].is_number(),
        "Should have completed count"
    );
}

#[test]
fn test_jobs_scan() {
    let ctx = TestContext::from_snapshot();

    // Just scan the existing data directory - simple!
    let result = ctx.run_json(&["jobs", "scan", "../data"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create scan job successfully"
    );
    assert!(result["data"]["job_id"].is_string(), "Should return job ID");
}

#[test]
fn test_jobs_scan_with_options() {
    let ctx = TestContext::from_snapshot();

    // Scan the existing data directory with recursive option
    let result = ctx.run_json(&["jobs", "scan", "../data", "--recursive", "true"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create scan job with options"
    );
}

#[test]
fn test_jobs_process() {
    let ctx = TestContext::from_snapshot();

    // Create a process job (this will process any pending jobs)
    let result = ctx.run_json(&["jobs", "run-processor", "--once", "--max-jobs", "1"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should run processor successfully"
    );

    let data = &result["data"];
    assert!(
        data["completed"].as_bool().is_some(),
        "Should have completed status"
    );
}

#[test]
fn test_jobs_process_file() {
    let ctx = TestContext::from_snapshot();

    // Try to process a non-existent file - should fail gracefully
    let result = ctx.run_json(&["jobs", "process-file", "/nonexistent/file.mp3"]);

    // Should return a response (will likely fail since file doesn't exist)
    // Just verify the command doesn't panic
    assert!(
        result["success"].as_bool().is_some(),
        "Command should return a valid response"
    );
}
