//! Playlist CLI integration tests

use crate::TestContext;

#[test]
fn test_playlists_create() {
    let ctx = TestContext::from_snapshot();

    // Create a user first (playlists need a creator)
    let username = format!(
        "test_pl_create_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);

    let user_id = user_result["data"]["id"].as_str().unwrap();

    // Create a playlist
    let result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "Test Playlist",
        "--description",
        "Created by integration test",
        "--created-by-id",
        user_id,
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should create playlist successfully"
    );
    assert!(
        result["data"]["id"].is_string(),
        "Should return playlist ID"
    );
    assert_eq!(
        result["data"]["title"], "Test Playlist",
        "Title should match"
    );
}

#[test]
fn test_playlists_query() {
    let ctx = TestContext::from_snapshot();

    // Query playlists
    let result = ctx.run_json(&["music", "query-playlists", "--limit", "10"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should query playlists successfully"
    );
    assert!(
        result["data"]["items"].is_array(),
        "Should return items array"
    );
    assert!(
        result["data"]["total_count"].is_number(),
        "Should have total count"
    );
}

#[test]
fn test_playlists_list() {
    let ctx = TestContext::from_snapshot();

    // query all playlists
    let result = ctx.run_json(&["music", "query-playlists", "--limit", "100"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list playlists successfully"
    );
    assert!(
        result["data"]["items"].is_array(),
        "Should return array of playlists"
    );
}

#[test]
fn test_playlists_add_songs() {
    let ctx = TestContext::from_snapshot();

    // Create user and playlist
    let username = format!(
        "test_pl_addsong_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user_result["data"]["id"].as_str().unwrap();

    let playlist_result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "Test Playlist for Songs",
        "--created-by-id",
        user_id,
    ]);
    let playlist_id = playlist_result["data"]["id"].as_str().unwrap();

    // Get some song IDs
    let songs_result = ctx.run_json(&["music", "query-songs", "--limit", "3"]);
    let songs = songs_result["data"]["items"].as_array().unwrap();

    if songs.is_empty() {
        // Skip test if no songs available
        return;
    }

    let song_ids: Vec<String> = songs
        .iter()
        .map(|s| s["song"]["id"].as_str().unwrap().to_string())
        .collect();

    // Add songs to playlist
    let result = ctx.run_json(&[
        "music",
        "add-songs-to-playlist",
        "--playlist-id",
        playlist_id,
        "--song-ids",
        &song_ids.join(","),
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should add songs to playlist successfully"
    );
    // Command returns () as data, which serializes to null - just check success
}

#[test]
fn test_playlists_query_songs() {
    let ctx = TestContext::from_snapshot();

    // first, try to find a playlist with songs
    let playlists_result = ctx.run_json(&["music", "query-playlists", "--limit", "100"]);
    let playlists = playlists_result["data"]["items"].as_array().unwrap();

    if playlists.is_empty() {
        // Skip test if no playlists
        return;
    }

    let playlist_id = playlists[0]["playlist"]["id"].as_str().unwrap();

    // Query songs in the playlist
    let result = ctx.run_json(&[
        "music",
        "query-playlist-songs",
        "--playlist-id",
        playlist_id,
        "--limit",
        "10",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should query playlist songs successfully"
    );
    assert!(
        result["data"]["items"].is_array(),
        "Should return items array"
    );
    assert!(
        result["data"]["total_count"].is_number(),
        "Should have total count"
    );
}

#[test]
fn test_playlists_update() {
    let ctx = TestContext::from_snapshot();

    // Create user and playlist
    let username = format!(
        "test_pl_update_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user_result["data"]["id"].as_str().unwrap();

    let playlist_result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "Original Title",
        "--created-by-id",
        user_id,
    ]);
    let playlist_id = playlist_result["data"]["id"].as_str().unwrap();

    // Update the playlist
    let result = ctx.run_json(&[
        "music",
        "update-playlist",
        "--playlist-id",
        playlist_id,
        "--title",
        "Updated Title",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should update playlist successfully"
    );
    assert_eq!(
        result["data"]["title"], "Updated Title",
        "Title should be updated"
    );
}

#[test]
fn test_playlists_delete() {
    let ctx = TestContext::from_snapshot();

    // Create user and playlist
    let username = format!(
        "test_pl_delete_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user_result["data"]["id"].as_str().unwrap();

    let playlist_result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "Playlist to Delete",
        "--created-by-id",
        user_id,
    ]);
    let playlist_id = playlist_result["data"]["id"].as_str().unwrap();

    // Delete the playlist
    let result = ctx.run_json(&["music", "delete-playlist", "--playlist-id", playlist_id]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should delete playlist successfully"
    );
}

#[test]
fn test_playlists_search() {
    let ctx = TestContext::from_snapshot();

    // Search for playlists
    let result = ctx.run_json(&[
        "music",
        "search-playlists",
        "--query",
        "test",
        "--limit",
        "10",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should search playlists successfully"
    );
    assert!(
        result["data"]["items"].is_array(),
        "Should return array of playlists"
    );
}

#[test]
fn test_playlists_user_list() {
    let ctx = TestContext::from_snapshot();

    // Create user and playlist
    let username = format!(
        "test_pl_usrlist_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user_result["data"]["id"].as_str().unwrap();

    let _playlist_result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "User Playlist",
        "--created-by-id",
        user_id,
    ]);

    // List user's playlists
    let result = ctx.run_json(&[
        "music",
        "list-user-playlists",
        "--user-id",
        user_id,
        "--limit",
        "10",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should list user playlists successfully"
    );
    assert!(
        result["data"]["items"].is_array(),
        "Should return array of playlists"
    );
}

#[test]
fn test_playlists_complete_workflow() {
    let ctx = TestContext::from_snapshot();

    // 1. Create user
    let username = format!(
        "test_pl_workflow_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let user_result = ctx.run_json(&[
        "users",
        "create",
        "--username",
        &username,
        "--role",
        "admin",
        "--bootstrap",
    ]);
    let user_id = user_result["data"]["id"].as_str().unwrap();

    // 2. Create playlist
    let playlist_result = ctx.run_json(&[
        "music",
        "create-playlist",
        "--title",
        "Complete Workflow Test",
        "--description",
        "Testing complete workflow",
        "--created-by-id",
        user_id,
    ]);
    assert!(playlist_result["success"].as_bool().unwrap());
    let playlist_id = playlist_result["data"]["id"].as_str().unwrap();

    // 3. Get songs
    let songs_result = ctx.run_json(&["music", "query-songs", "--limit", "3"]);
    let songs = songs_result["data"]["items"].as_array().unwrap();

    if !songs.is_empty() {
        let song_ids: Vec<String> = songs
            .iter()
            .map(|s| s["song"]["id"].as_str().unwrap().to_string())
            .collect();

        // 4. Add songs to playlist
        let add_result = ctx.run_json(&[
            "music",
            "add-songs-to-playlist",
            "--playlist-id",
            playlist_id,
            "--song-ids",
            &song_ids.join(","),
        ]);
        assert!(add_result["success"].as_bool().unwrap());

        // 5. Query playlist songs
        let query_result = ctx.run_json(&[
            "music",
            "query-playlist-songs",
            "--playlist-id",
            playlist_id,
            "--limit",
            "10",
        ]);
        assert!(query_result["success"].as_bool().unwrap());
        assert_eq!(
            query_result["data"]["total_count"],
            song_ids.len() as i64,
            "Should have correct number of songs"
        );
    }

    // 6. Update playlist
    let update_result = ctx.run_json(&[
        "music",
        "update-playlist",
        "--playlist-id",
        playlist_id,
        "--title",
        "Updated Workflow Test",
    ]);
    assert!(update_result["success"].as_bool().unwrap());

    // 7. Delete playlist
    let delete_result = ctx.run_json(&["music", "delete-playlist", "--playlist-id", playlist_id]);
    assert!(delete_result["success"].as_bool().unwrap());

    // 8. verify deletion
    let list_result = ctx.run_json(&["music", "query-playlists", "--limit", "100"]);
    let playlists = list_result["data"]["items"].as_array().unwrap();
    assert!(
        !playlists.iter().any(|p| p["playlist"]["id"] == playlist_id),
        "Playlist should be deleted"
    );
}

#[test]
fn test_playlists_error_cases() {
    let ctx = TestContext::from_snapshot();

    // Try to query songs for non-existent playlist
    let result = ctx.run_json(&[
        "music",
        "query-playlist-songs",
        "--playlist-id",
        "non-existent-playlist-id",
        "--limit",
        "10",
    ]);

    // Should either error or return empty results
    // The specific behavior depends on implementation
    assert!(
        !result["success"].as_bool().unwrap_or(true)
            || result["data"]["total_count"].as_i64().unwrap_or(0) == 0,
        "Should handle non-existent playlist gracefully"
    );
}
