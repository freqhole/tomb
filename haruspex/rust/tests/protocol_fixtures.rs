//! protocol codec round-trip fixtures - shared with the ts package (phase 5
//! consumes these same json files to validate its zod schemas match the
//! rust wire types byte-for-byte). see PHASE_4_HARUSPEX_RUST.md's "tests"
//! section: "protocol codec round-trips (json fixtures shared with the ts
//! package - commit the fixtures, phase 5 consumes them)".
//!
//! each fixture is deserialized into a `FriendzMessage`, reserialized, and
//! compared back against the original as a `serde_json::Value` (object key
//! order does not affect `serde_json::Value` equality, so this is a real
//! wire-shape guard, not a brittle string comparison).

use std::fs;
use std::path::PathBuf;

use haruspex::protocol::FriendzMessage;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/protocol")
}

fn load(name: &str) -> serde_json::Value {
    let path = fixtures_dir().join(name);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("fixture {name} is not valid json: {e}"))
}

/// deserialize a fixture into `FriendzMessage`, reserialize it, and assert
/// the round trip is byte-for-byte equivalent (as parsed json values) to
/// the original fixture.
fn assert_round_trips(name: &str) {
    let original = load(name);
    let msg: FriendzMessage = serde_json::from_value(original.clone()).unwrap_or_else(|e| {
        panic!("fixture {name} failed to deserialize into FriendzMessage: {e}")
    });
    let round_tripped = serde_json::to_value(&msg)
        .unwrap_or_else(|e| panic!("fixture {name} failed to reserialize: {e}"));
    assert_eq!(
        original, round_tripped,
        "fixture {name} did not round-trip byte-for-byte"
    );
}

#[test]
fn profile_request_fixture_round_trips() {
    assert_round_trips("profile-request.json");
}

#[test]
fn profile_response_fixture_round_trips() {
    assert_round_trips("profile-response.json");
}

#[test]
fn friend_request_fixture_round_trips() {
    assert_round_trips("friend-request.json");
}

#[test]
fn friend_accept_fixture_round_trips() {
    assert_round_trips("friend-accept.json");
}

#[test]
fn friend_accept_ack_fixture_round_trips() {
    assert_round_trips("friend-accept-ack.json");
}

#[test]
fn friend_reject_fixture_round_trips() {
    assert_round_trips("friend-reject.json");
}

#[test]
fn heartbeat_fixture_round_trips() {
    assert_round_trips("heartbeat.json");
}

#[test]
fn offline_announcement_fixture_round_trips() {
    assert_round_trips("offline-announcement.json");
}

#[test]
fn hello_fixture_round_trips() {
    assert_round_trips("hello.json");
}

#[test]
fn hello_ok_fixture_round_trips() {
    assert_round_trips("hello-ok.json");
}

#[test]
fn knock_request_fixture_round_trips() {
    assert_round_trips("knock-request.json");
}

#[test]
fn knock_ack_fixture_round_trips() {
    assert_round_trips("knock-ack.json");
}

#[test]
fn knock_outcome_fixture_round_trips() {
    assert_round_trips("knock-outcome.json");
}

#[test]
fn identity_update_fixture_round_trips() {
    assert_round_trips("identity-update.json");
}

#[test]
fn acl_change_fixture_round_trips() {
    assert_round_trips("acl-change.json");
}

#[test]
fn gossip_digest_fixture_round_trips() {
    assert_round_trips("gossip-digest.json");
}

#[test]
fn blob_seek_fixture_round_trips() {
    assert_round_trips("blob-seek.json");
}

#[test]
fn blob_offer_fixture_round_trips() {
    assert_round_trips("blob-offer.json");
}

#[test]
fn error_fixture_round_trips() {
    assert_round_trips("error.json");
}

#[test]
fn app_extension_fixture_round_trips_and_is_untyped_by_haruspex() {
    let name = "app-extension-skein-canvas-invite.json";
    assert_round_trips(name);

    let original = load(name);
    let msg: FriendzMessage = serde_json::from_value(original).unwrap();
    match &msg {
        FriendzMessage::AppExtension { message_type, .. } => {
            assert_eq!(message_type, "skein:canvas-invite");
        }
        other => panic!("expected AppExtension, got {other:?}"),
    }
    assert_eq!(msg.message_type(), "skein:canvas-invite");
}

/// every fixture file present on disk is exercised by a named test above -
/// this catches a fixture being added without a corresponding test (or
/// vice versa going stale) by cross-checking the directory listing.
#[test]
fn every_fixture_file_is_covered_by_a_named_test() {
    let covered = [
        "profile-request.json",
        "profile-response.json",
        "friend-request.json",
        "friend-accept.json",
        "friend-accept-ack.json",
        "friend-reject.json",
        "heartbeat.json",
        "offline-announcement.json",
        "hello.json",
        "hello-ok.json",
        "knock-request.json",
        "knock-ack.json",
        "knock-outcome.json",
        "identity-update.json",
        "acl-change.json",
        "gossip-digest.json",
        "blob-seek.json",
        "blob-offer.json",
        "error.json",
        "app-extension-skein-canvas-invite.json",
    ];

    let mut on_disk: Vec<String> = fs::read_dir(fixtures_dir())
        .expect("fixtures/protocol directory should exist")
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".json"))
        .collect();
    on_disk.sort();

    let mut expected: Vec<String> = covered.iter().map(|s| s.to_string()).collect();
    expected.sort();

    assert_eq!(
        on_disk, expected,
        "fixtures/protocol has drifted from this test file's coverage list"
    );
}
