//! Maintenance CLI integration tests

use crate::TestContext;

#[test]
fn test_maintenance_cleanup_orphaned_tags() {
    let ctx = TestContext::from_snapshot();

    // Cleanup orphaned tags
    let result = ctx.run_json(&["maintenance", "cleanup-orphaned-tags"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should cleanup orphaned tags successfully"
    );

    let data = &result["data"];
    assert!(
        data["tags_deleted"].is_number(),
        "Should have deletion count"
    );
}

#[test]
fn test_maintenance_cleanup_orphaned_genres() {
    let ctx = TestContext::from_snapshot();

    // Cleanup orphaned genres
    let result = ctx.run_json(&["maintenance", "cleanup-orphaned-genres"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should cleanup orphaned genres successfully"
    );

    let data = &result["data"];
    assert!(
        data["genres_deleted"].is_number(),
        "Should have deletion count"
    );
}

#[test]
fn test_maintenance_cleanup_all() {
    let ctx = TestContext::from_snapshot();

    // Run all cleanup operations
    let result = ctx.run_json(&["maintenance", "cleanup-all"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should run all cleanup operations successfully"
    );

    let data = &result["data"];
    // Should have summary of all cleanup operations
    assert!(
        data["tags_deleted"].is_number()
            || data["genres_deleted"].is_number()
            || data["total_deleted"].is_number(),
        "Should have cleanup summary"
    );
}

#[test]
fn test_maintenance_cleanup_all_individual() {
    let ctx = TestContext::from_snapshot();

    // Run cleanup-all which runs all cleanup operations
    let result = ctx.run_json(&["maintenance", "cleanup-all"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should run cleanup-all successfully"
    );

    // Should return some data about what was cleaned
    assert!(
        result["data"].is_object() || result["data"].is_null(),
        "Should return cleanup data"
    );
}
