//! Database CLI integration tests

use crate::TestContext;

#[test]
fn test_database_test_connection() {
    let ctx = TestContext::from_snapshot();

    // Test database connection
    let result = ctx.run_json(&["database", "test"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should test database connection successfully"
    );
    assert!(
        result["data"]["connection_ok"].as_bool().unwrap(),
        "Database should be connected"
    );
}

#[test]
fn test_database_info() {
    let ctx = TestContext::from_snapshot();

    // Get database information
    let result = ctx.run_json(&["database", "info"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get database info successfully"
    );

    let data = &result["data"];
    assert!(
        data["database_file"].is_string(),
        "Should have database file path"
    );
    assert!(
        data["file_size_mb"].is_number(),
        "Should have database size"
    );
    assert!(
        data["file_exists"].as_bool().is_some(),
        "Should have file exists flag"
    );
}
