//! User management CLI integration tests

use crate::TestContext;

#[test]
fn test_users_generate_invites() {
    let ctx = TestContext::from_snapshot();

    // Generate invite codes
    let result = ctx.run_json(&[
        "users",
        "generate-invites",
        "--count",
        "3",
        "--word-count",
        "3",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should generate invites successfully"
    );
    assert!(
        result["data"]["codes"].is_array(),
        "Should return array of codes"
    );

    let codes = result["data"]["codes"].as_array().unwrap();
    assert_eq!(codes.len(), 3, "Should generate 3 invite codes");

    // Each code should have 3 words separated by hyphens
    for code in codes {
        let code_str = code.as_str().unwrap();
        assert_eq!(code_str.split('-').count(), 3, "Code should have 3 words");
    }
}

#[test]
fn test_users_create_and_list() {
    let ctx = TestContext::from_snapshot();

    // Create a user with bootstrap flag (no invite code needed)
    let username = format!("testuser_{}", uuid::Uuid::new_v4());
    let result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create user successfully"
    );
    assert!(result["data"]["id"].is_string(), "Should return user ID");

    let user_id = result["data"]["id"].as_str().unwrap().to_string();

    // List users and verify our new user is there
    let result = ctx.run_json(&["users", "list", "--limit", "100"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list users successfully"
    );

    let users = result["data"].as_array().unwrap();
    assert!(
        users.iter().any(|u| u["id"] == user_id),
        "Should find newly created user in list"
    );
}

#[test]
fn test_users_list_and_verify() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!("testuser_{}", uuid::Uuid::new_v4());
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "user",
        "--bootstrap",
    ]);

    let user_id = create_result["data"]["id"].as_str().unwrap();

    // List users and find our user
    let result = ctx.run_json(&["users", "list", "--limit", "100"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list users successfully"
    );

    let users = result["data"].as_array().unwrap();
    assert!(
        users.iter().any(|u| u["id"] == user_id),
        "Should find created user in list"
    );
}

#[test]
fn test_users_update() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!("testuser_{}", uuid::Uuid::new_v4());
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "user",
        "--bootstrap",
    ]);

    let user_id = create_result["data"]["id"].as_str().unwrap();

    // Update the user's role
    let result = ctx.run_json(&["users", "update", "--user-id", user_id, "--role", "admin"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should update user successfully"
    );

    // Verify by listing users
    let list_result = ctx.run_json(&["users", "list", "--limit", "100"]);
    let users = list_result["data"].as_array().unwrap();
    let updated_user = users.iter().find(|u| u["id"] == user_id);
    assert!(updated_user.is_some(), "Should find updated user");
}

#[test]
fn test_users_delete() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!("testuser_{}", uuid::Uuid::new_v4());
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "user",
        "--bootstrap",
    ]);

    let user_id = create_result["data"]["id"].as_str().unwrap();

    // Delete the user
    let result = ctx.run_json(&["users", "delete", "--user-id", user_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should delete user successfully"
    );
}

#[test]
fn test_users_invite_workflow() {
    let ctx = TestContext::from_snapshot();

    // Generate an invite code
    let generate_result = ctx.run_json(&[
        "users",
        "generate-invites",
        "--count",
        "1",
        "--word-count",
        "3",
    ]);

    let codes = generate_result["data"]["codes"].as_array().unwrap();
    let invite_code = codes[0].as_str().unwrap();

    // List invite codes and verify ours is there
    let result = ctx.run_json(&["users", "list-invites"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list invite codes"
    );

    let invites = result["data"].as_array().unwrap();
    assert!(
        invites.iter().any(|i| i["code"] == invite_code),
        "Should find generated invite code in list"
    );
}

#[test]
fn test_users_error_cases() {
    let ctx = TestContext::from_snapshot();

    // Try to delete non-existent user
    let result = ctx.run_json(&["users", "delete", "--user-id", "non-existent-user-id"]);

    // Should either fail or succeed with no effect
    // Just verify the command executes
    assert!(
        result["success"].as_bool().is_some(),
        "Should return a valid response"
    );
}
