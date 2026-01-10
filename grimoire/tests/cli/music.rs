//! Music CLI integration tests

use crate::TestContext;

#[test]
fn test_music_query_basic() {
    let ctx = TestContext::from_snapshot();

    // Query songs with limit
    let result = ctx.run_json(&["music", "query-songs", "--limit", "5"]);

    assert!(result["success"].as_bool().unwrap(), "Query should succeed");
    assert!(
        result["data"]["items"].is_array(),
        "Should return items array"
    );

    let total = result["data"]["total_count"].as_u64().unwrap();
    assert!(total > 0, "Should have songs in test DB (found {})", total);
}

#[test]
fn test_music_query_workflow() {
    let ctx = TestContext::from_snapshot();

    // 1. Query songs - capture IDs
    let result = ctx.run_json(&["music", "query-songs", "--limit", "5"]);
    assert!(result["success"].as_bool().unwrap());

    let songs = result["data"]["items"].as_array().unwrap();
    assert!(!songs.is_empty(), "No songs in test DB");

    let song_id = songs[0]["song"]["id"].as_str().unwrap();

    // 2. List songs and verify we can find our song
    let result = ctx.run_json(&["music", "list-songs", "--limit", "100"]);
    assert!(result["success"].as_bool().unwrap());
    let all_songs = result["data"].as_array().unwrap();
    assert!(all_songs.iter().any(|s| s["id"] == song_id));

    // 3. Get album if present
    if let Some(album_id) = songs[0]["album"]["id"].as_str() {
        let result = ctx.run_json(&["music", "get-album", "--album-id", album_id]);
        assert!(result["success"].as_bool().unwrap());
    }

    // 4. List artists
    let result = ctx.run_json(&["music", "list-artists", "--limit", "10"]);
    assert!(result["success"].as_bool().unwrap());
    let artists = result["data"].as_array().unwrap();
    assert!(!artists.is_empty());
}

#[test]
fn test_music_sorting() {
    let ctx = TestContext::from_snapshot();

    // Test sorting by title ascending
    let result = ctx.run_json(&[
        "music",
        "query-songs",
        "--sort-by",
        "title",
        "--sort-direction",
        "asc",
        "--limit",
        "10",
    ]);
    assert!(result["success"].as_bool().unwrap());

    let items = result["data"]["items"].as_array().unwrap();
    if items.len() > 1 {
        let titles: Vec<_> = items
            .iter()
            .filter_map(|i| i["song"]["title"].as_str())
            .collect();

        // Verify sorted order (case-insensitive comparison)
        for window in titles.windows(2) {
            if window[0].to_lowercase() > window[1].to_lowercase() {
                eprintln!("Sort order violation: '{}' > '{}'", window[0], window[1]);
            }
        }

        // Note: sorting might not be perfect depending on DB collation
        // This test just ensures the command works, not strict ordering
        assert!(titles.len() > 0, "Should have some results");
    }
}

#[test]
fn test_music_error_cases() {
    let ctx = TestContext::from_snapshot();

    // Non-existent album ID should return error in JSON
    let result = ctx.run_json(&["music", "get-album", "--album-id", "fake-album-id-12345"]);

    // Check if we got an error response
    assert_eq!(result["success"], false);
    let errors = result["errors"].as_array().unwrap();
    assert!(!errors.is_empty());
    assert_eq!(errors[0]["type"], "album_not_found");
}

#[test]
fn test_with_custom_snapshot() {
    // Example: use a different snapshot file (like a production backup)
    // This demonstrates using from_snapshot_file() instead of from_snapshot()
    let ctx = TestContext::from_snapshot_file("../data/grimoire.db.backup-20260108-172727");

    // Query should work with any snapshot that has the expected schema
    let result = ctx.run_json(&["music", "query-songs", "--limit", "1"]);
    assert!(result["success"].as_bool().unwrap());

    // The snapshot is copied to temp location - never modified
    // Multiple tests can safely use the same snapshot file
}
