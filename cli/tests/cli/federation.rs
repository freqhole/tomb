//! Federation / knock request CLI integration tests
//!
//! a knock request only ever gets created by a real incoming peer connection
//! (there's no CLI command that fabricates one - the CLI only handles the
//! admin side: list, accept, reject, delete). to exercise the admin-side
//! commands under test here, these tests seed a pending knock directly
//! through grimoire's own knock api - the same call a live "peer connects
//! and knocks" event makes - then drive the rest of the lifecycle (list,
//! accept, reject) through the CLI subprocess like every other test in this
//! suite.

use crate::TestContext;
use grimoire::federation::knock::CreateKnockRequest;
use std::time::{SystemTime, UNIX_EPOCH};

/// synthesize a 64-hex-char node id for a knock fixture
fn fake_node_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:0>64x}", nanos)
}

/// seed a pending knock request for `node_id`/`username`, returning its id
async fn seed_pending_knock(node_id: &str, username: &str) -> String {
    grimoire::init_config(Some(std::path::PathBuf::from(
        "tests/fixtures/test-config.toml",
    )))
    .expect("failed to init grimoire config for knock fixture setup");

    let response = grimoire::federation::knock::create_knock(
        node_id,
        CreateKnockRequest {
            username: username.to_string(),
            message: "requesting access".to_string(),
        },
    )
    .await;

    assert!(
        response.success,
        "failed to seed pending knock: {}",
        response.message
    );
    response.data.unwrap().id
}

#[tokio::test]
async fn test_federation_knock_accept_creates_user_with_role() {
    let ctx = TestContext::from_snapshot();

    let username = format!(
        "test_knock_accept_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let node_id = fake_node_id();
    let knock_id = seed_pending_knock(&node_id, &username).await;

    // the seeded knock starts out pending
    let list_result = ctx.run_json(&["federation", "list-knocks"]);
    assert!(
        list_result["success"].as_bool().unwrap(),
        "should list pending knocks"
    );
    let knocks = list_result["data"].as_array().unwrap();
    let seeded = knocks
        .iter()
        .find(|k| k["id"] == knock_id)
        .expect("seeded knock should show up as pending");
    assert_eq!(seeded["status"], "pending");

    // accept it with an explicit username and role
    let accept_result = ctx.run_json(&[
        "federation",
        "accept-knock",
        &knock_id,
        "--username",
        &username,
        "--role",
        "member",
    ]);
    assert!(
        accept_result["success"].as_bool().unwrap(),
        "should accept knock: {:?}",
        accept_result
    );
    assert_eq!(accept_result["data"]["status"], "accepted");

    // a user now exists with that exact username and role
    let users_result = ctx.run_json(&["users", "list", "--limit", "100"]);
    assert!(users_result["success"].as_bool().unwrap());
    let users = users_result["data"]["users"].as_array().unwrap();
    let created_user = users
        .iter()
        .find(|u| u["username"] == username)
        .expect("accepting the knock should have created a user");
    assert_eq!(created_user["role"], "member");

    // clean up: this suite shares one db file across every test run
    let user_id = created_user["id"].as_str().unwrap();
    let _ = ctx.run_json(&["users", "delete", "--user-id", user_id]);
    let _ = ctx.run_json(&["federation", "delete-knock", &knock_id]);
}

#[tokio::test]
async fn test_federation_knock_reject_creates_no_user() {
    let ctx = TestContext::from_snapshot();

    let username = format!(
        "test_knock_reject_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let node_id = fake_node_id();
    let knock_id = seed_pending_knock(&node_id, &username).await;

    let reject_result = ctx.run_json(&["federation", "reject-knock", &knock_id]);
    assert!(
        reject_result["success"].as_bool().unwrap(),
        "should reject knock: {:?}",
        reject_result
    );
    assert_eq!(reject_result["data"]["status"], "rejected");

    // no user should have been created for a rejected knock
    let users_result = ctx.run_json(&["users", "list", "--limit", "100"]);
    assert!(users_result["success"].as_bool().unwrap());
    let users = users_result["data"]["users"].as_array().unwrap();
    assert!(
        !users.iter().any(|u| u["username"] == username),
        "a rejected knock should not create a user"
    );

    // clean up: this suite shares one db file across every test run
    let _ = ctx.run_json(&["federation", "delete-knock", &knock_id]);
}
