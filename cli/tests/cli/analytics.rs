//! Analytics CLI integration tests

use crate::TestContext;

#[test]
fn test_analytics_record_play() {
    let ctx = TestContext::from_snapshot();

    // Get a song and user to record a play event
    let songs = ctx.run_json(&["music", "query-songs", "--limit", "1"]);
    if songs["data"]["items"].as_array().unwrap().is_empty() {
        return; // Skip if no songs
    }

    let song_id = songs["data"]["items"][0]["song"]["id"].as_str().unwrap();

    // Create a user for the play event
    let username = format!(
        "test_analytics_play_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);

    let user_id = user["data"]["id"].as_str().unwrap();

    // Record a play event
    let result = ctx.run_json(&[
        "analytics",
        "record-play",
        "--song-id",
        song_id,
        "--user-id",
        user_id,
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should record play event successfully"
    );
}

#[test]
fn test_analytics_song_stats() {
    let ctx = TestContext::from_snapshot();

    // Get a song ID
    let songs = ctx.run_json(&["music", "query-songs", "--limit", "1"]);
    if songs["data"]["items"].as_array().unwrap().is_empty() {
        return; // Skip if no songs
    }

    let song_id = songs["data"]["items"][0]["song"]["id"].as_str().unwrap();

    // Get song statistics
    let result = ctx.run_json(&["analytics", "song-stats", song_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get song stats successfully"
    );
}

#[test]
fn test_analytics_user_history() {
    let ctx = TestContext::from_snapshot();

    // Create a user
    let username = format!(
        "test_analytics_hist_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user["data"]["id"].as_str().unwrap();

    // Get user history
    let result = ctx.run_json(&["analytics", "user-history", user_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get user history successfully"
    );
}

#[test]
fn test_analytics_session() {
    let ctx = TestContext::from_snapshot();

    // Create a user
    let username = format!(
        "test_analytics_sess_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let _user = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);

    // Get session summary - using a non-existent session ID, expect failure
    let result = ctx.run_json(&["analytics", "session", "session-id-does-not-exist"]);

    // Should fail because session doesn't exist
    assert!(
        !result["success"].as_bool().unwrap(),
        "Should fail with non-existent session ID"
    );
}

#[test]
fn test_analytics_counts() {
    let ctx = TestContext::from_snapshot();

    // Get a song ID
    let songs = ctx.run_json(&["music", "query-songs", "--limit", "1"]);
    if songs["data"]["items"].as_array().unwrap().is_empty() {
        return; // Skip if no songs
    }

    let song_id = songs["data"]["items"][0]["song"]["id"].as_str().unwrap();

    // Get event counts
    let result = ctx.run_json(&["analytics", "counts", "song", song_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get event counts successfully"
    );
}

#[test]
fn test_analytics_recent_listens() {
    let ctx = TestContext::from_snapshot();

    // Get recent listens across all users
    let result = ctx.run_json(&["analytics", "recent-listens", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get recent listens successfully"
    );
}

#[test]
fn test_analytics_recent_favorites() {
    let ctx = TestContext::from_snapshot();

    // Get recent favorites
    let result = ctx.run_json(&["analytics", "recent-favorites", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get recent favorites successfully"
    );
}

#[test]
fn test_analytics_recent_albums() {
    let ctx = TestContext::from_snapshot();

    // Get recently played albums
    let result = ctx.run_json(&["analytics", "recent-albums", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get recent albums successfully"
    );
}

#[test]
fn test_analytics_feed() {
    let ctx = TestContext::from_snapshot();

    // Get combined activity feed
    let result = ctx.run_json(&["analytics", "feed", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get activity feed successfully"
    );
}

#[test]
fn test_analytics_admin_overview() {
    let ctx = TestContext::from_snapshot();

    // Get admin system overview
    let result = ctx.run_json(&["analytics", "admin-overview"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get admin overview successfully"
    );
}

#[test]
fn test_analytics_top_songs() {
    let ctx = TestContext::from_snapshot();

    // Get top songs by play count
    let result = ctx.run_json(&["analytics", "top-songs", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get top songs successfully"
    );
}

#[test]
fn test_analytics_top_albums() {
    let ctx = TestContext::from_snapshot();

    // Get top albums by play count
    let result = ctx.run_json(&["analytics", "top-albums", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get top albums successfully"
    );
}

#[test]
fn test_analytics_top_artists() {
    let ctx = TestContext::from_snapshot();

    // Get top artists by play count
    let result = ctx.run_json(&["analytics", "top-artists", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get top artists successfully"
    );
}

#[test]
fn test_analytics_user_stats() {
    let ctx = TestContext::from_snapshot();

    // Create a user
    let username = format!(
        "test_analytics_stat_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user["data"]["id"].as_str().unwrap();

    // Get user statistics
    let result = ctx.run_json(&["analytics", "user-stats", user_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get user stats successfully"
    );
}

#[test]
fn test_analytics_all_user_stats() {
    let ctx = TestContext::from_snapshot();

    // Get statistics for all users
    let result = ctx.run_json(&["analytics", "all-user-stats"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get all user stats successfully"
    );
}

#[test]
fn test_play_count_increments_on_song_view() {
    let ctx = TestContext::from_snapshot();

    // pick first song
    let songs = ctx.run_json(&["music", "query-songs", "--limit", "1"]);
    let items = songs["data"]["items"].as_array().unwrap();
    if items.is_empty() {
        return;
    }
    let song_id = items[0]["song"]["id"].as_str().unwrap().to_string();

    // baseline play count via analytics song-stats
    let baseline = ctx.run_json(&["analytics", "song-stats", &song_id]);
    let baseline_count = baseline["data"]["total_plays"].as_i64().unwrap_or(0);

    // create a user to attribute the plays to
    let username = format!(
        "test_play_count_inc_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user["data"]["id"].as_str().unwrap();

    // record three plays
    for _ in 0..3 {
        let res = ctx.run_json(&[
            "analytics",
            "record-play",
            "--song-id",
            &song_id,
            "--user-id",
            user_id,
        ]);
        assert!(
            res["success"].as_bool().unwrap(),
            "record-play should succeed"
        );
    }

    // verify total_plays increased by exactly 3
    let after = ctx.run_json(&["analytics", "song-stats", &song_id]);
    let new_count = after["data"]["total_plays"].as_i64().unwrap_or(0);
    assert_eq!(
        new_count,
        baseline_count + 3,
        "total_plays should increment by 3 (was {}, now {})",
        baseline_count,
        new_count
    );
}
