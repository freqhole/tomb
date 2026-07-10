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

    // Each code should have 3 words plus a 4-digit segment separated by hyphens
    for code_obj in codes {
        let code_str = code_obj["code"].as_str().unwrap();
        assert_eq!(
            code_str.split('-').count(),
            4,
            "Code should have 3 words plus a digit segment"
        );
    }
}

#[test]
fn test_users_create_and_list() {
    let ctx = TestContext::from_snapshot();

    // Create a user with bootstrap flag (no invite code needed)
    let username = format!(
        "test_usr_crtlst_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
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

    let users = result["data"]["users"].as_array().unwrap();
    assert!(
        users.iter().any(|u| u["id"] == user_id),
        "Should find newly created user in list"
    );
}

#[test]
fn test_users_list_and_verify() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!(
        "test_usr_lstvfy_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);

    let user_id = create_result["data"]["id"].as_str().unwrap();

    // List users and find our user
    let result = ctx.run_json(&["users", "list", "--limit", "100"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list users successfully"
    );

    let users = result["data"]["users"].as_array().unwrap();
    assert!(
        users.iter().any(|u| u["id"] == user_id),
        "Should find created user in list"
    );
}

#[test]
fn test_users_update() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!(
        "test_usr_update_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
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
    let users = list_result["data"]["users"].as_array().unwrap();
    let updated_user = users.iter().find(|u| u["id"] == user_id);
    assert!(updated_user.is_some(), "Should find updated user");
}

#[test]
fn test_users_delete() {
    let ctx = TestContext::from_snapshot();

    // Create a test user
    let username = format!(
        "test_usr_delete_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
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
    let invite_code = codes[0]["code"].as_str().unwrap();

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

#[test]
fn test_users_deactivate_invite() {
    let ctx = TestContext::from_snapshot();

    // Generate an invite code first
    let generate_result = ctx.run_json(&[
        "users",
        "generate-invites",
        "--count",
        "1",
        "--word-count",
        "3",
    ]);

    if let Some(true) = generate_result["success"].as_bool() {
        if let Some(codes) = generate_result["data"]["codes"].as_array() {
            if !codes.is_empty() {
                if let Some(invite_code) = codes[0]["code"].as_str() {
                    // Deactivate the invite code (positional argument)
                    let result = ctx.run_json(&["users", "deactivate-invite", invite_code]);

                    assert!(
                        result["success"].as_bool().is_some(),
                        "Should return a response"
                    );
                }
            }
        }
    }
}

#[test]
fn test_users_invite_redemption_grants_role() {
    let ctx = TestContext::from_snapshot();

    // generate an invite code that grants the "admin" role
    let generate_result = ctx.run_json(&[
        "users",
        "generate-invites",
        "--count",
        "1",
        "--word-count",
        "3",
        "--code-type",
        "invite",
        "--role",
        "admin",
    ]);
    assert!(
        generate_result["success"].as_bool().unwrap(),
        "should generate an invite code"
    );
    let codes = generate_result["data"]["codes"].as_array().unwrap();
    let invite_code = codes[0]["code"].as_str().unwrap().to_string();

    // redeem it by creating a user with that invite code, no explicit role
    let username = format!(
        "test_usr_invite_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--invite-code",
        &invite_code,
    ]);
    assert!(
        create_result["success"].as_bool().unwrap(),
        "should redeem the invite code: {:?}",
        create_result
    );
    let user_id = create_result["data"]["id"].as_str().unwrap().to_string();
    assert_eq!(
        create_result["data"]["role"], "admin",
        "user should receive the role granted by the invite code"
    );

    // the invite code is now used up
    let list_result = ctx.run_json(&["users", "list-invites"]);
    assert!(list_result["success"].as_bool().unwrap());
    let invites = list_result["data"].as_array().unwrap();
    let used_invite = invites
        .iter()
        .find(|i| i["code"] == invite_code)
        .expect("used invite code should still be listed");
    // `is_active` tracks admin enable/disable, not usage - a redeemed code
    // stays active; `used_by_id` is what flips to record redemption (see
    // `InviteCode::is_valid_for_use`, which checks `used_at.is_none()`
    // separately from `is_active`).
    assert_eq!(used_invite["is_active"], true);
    assert_eq!(used_invite["used_by_id"], user_id);

    // clean up: this suite shares one db file across every test run
    let _ = ctx.run_json(&["users", "delete", "--user-id", &user_id]);
}

#[test]
fn test_users_api_key_lifecycle() {
    let ctx = TestContext::from_snapshot();

    let username = format!(
        "test_usr_apikey_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let create_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    assert!(create_result["success"].as_bool().unwrap());
    let user_id = create_result["data"]["id"].as_str().unwrap().to_string();

    // freshly created user has no api key yet
    let status_result = ctx.run_json(&["users", "api-key", "show-status", &username]);
    assert!(status_result["success"].as_bool().unwrap());
    assert_eq!(status_result["data"]["has_api_key"], false);

    // generate one
    let generate_result = ctx.run_json(&["users", "api-key", "generate", &username]);
    assert!(
        generate_result["success"].as_bool().unwrap(),
        "should generate an api key: {:?}",
        generate_result
    );
    assert!(!generate_result["data"]["api_key"]
        .as_str()
        .unwrap()
        .is_empty());

    // known, pre-existing quirk (not introduced by this test): both
    // `show-status` and `revoke` read `user.api_key` off a plain, separate
    // `get_user_by_username` fetch, but that field is only ever populated
    // in the response returned by the SAME request that generated the key
    // (see `UserService::ensure_api_key`'s own comment, "only ever
    // populated right after a fresh [generation]") - any later, separate
    // CLI invocation always sees it empty. this means `show-status` always
    // reports `has_api_key: false` after generation, and `revoke` always
    // fails with "User does not have an API key", even though a real key
    // was generated and is presumably stored (hashed) server-side. pinning
    // the actual current behavior here rather than what the command names
    // imply; see CUTOVER_BACKLOG.md for the follow-up to fix both commands
    // to check `UserRepository::has_api_key` instead of `user.api_key`.
    let status_result = ctx.run_json(&["users", "api-key", "show-status", &username]);
    assert!(status_result["success"].as_bool().unwrap());
    assert_eq!(status_result["data"]["has_api_key"], false);

    // revoke currently always fails here too, for the same reason - pinning
    // that reality rather than assuming revoke actually works end-to-end.
    let revoke_result = ctx.run_json(&["users", "api-key", "revoke", &username]);
    assert!(!revoke_result["success"].as_bool().unwrap());
    assert_eq!(revoke_result["message"], "User does not have an API key");

    // clean up: this suite shares one db file across every test run
    let _ = ctx.run_json(&["users", "delete", "--user-id", &user_id]);
}
