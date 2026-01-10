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
    assert!(data["total"].is_number(), "Should have total count");
    assert!(data["pending"].is_number(), "Should have pending count");
    assert!(data["completed"].is_number(), "Should have completed count");
}

#[test]
fn test_jobs_scan() {
    let ctx = TestContext::from_snapshot();

    // Create a temporary directory for testing
    let temp_dir =
        std::env::temp_dir().join(format!("grimoire-test-scan-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    // Create a dummy file
    std::fs::write(temp_dir.join("test.txt"), "test content").unwrap();

    // Scan the directory
    let result = ctx.run_json(&["jobs", "scan", temp_dir.to_str().unwrap()]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create scan job successfully"
    );
    assert!(result["data"]["job_id"].is_string(), "Should return job ID");

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_jobs_scan_with_options() {
    let ctx = TestContext::from_snapshot();

    let temp_dir =
        std::env::temp_dir().join(format!("grimoire-test-scan-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    // Scan with recursive option
    let result = ctx.run_json(&[
        "jobs",
        "scan",
        temp_dir.to_str().unwrap(),
        "--recursive",
        "true",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create scan job with options"
    );

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
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
    assert!(data["processed"].is_number(), "Should have processed count");
}
