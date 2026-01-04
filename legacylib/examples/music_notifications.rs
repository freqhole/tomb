//! Example demonstrating music domain notifications
//!
//! This example shows how to create and work with music-specific notification events,
//! including songs, playlists, and scanning operations.
//!
//! Run with: cargo run -p grimoire --example music_notifications

use legacylib::notifications::{
    LibraryStatsPayload, NotificationEvent, PlaylistEventPayload, ScanCompletedPayload,
    ScanProgressPayload, SongEventPayload,
};
#[cfg(test)]
use legacylib::NotificationChannel;
#[cfg(test)]
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Music Notifications Example");
    println!("==============================\n");

    // Demonstrate song events
    demonstrate_song_events()?;
    println!();

    // Demonstrate playlist events
    demonstrate_playlist_events()?;
    println!();

    // Demonstrate scanning events
    demonstrate_scanning_events()?;
    println!();

    // Demonstrate library events
    demonstrate_library_events()?;
    println!();

    println!("✅ Music notifications example completed!");
    Ok(())
}

fn demonstrate_song_events() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎼 Song Events:");

    let song_id = Uuid::new_v4();
    let media_blob_id = Uuid::new_v4();
    let thumbnail_blob_id = Uuid::new_v4();

    // Create a song created event
    let song_payload = SongEventPayload {
        song_id,
        title: "Bohemian Rhapsody".to_string(),
        artist: Some("Queen".to_string()),
        album: Some("A Night at the Opera".to_string()),
        duration: Some("5:55".to_string()),
        file_path: Some(
            "/music/Queen/A Night at the Opera/01 - Bohemian Rhapsody.flac".to_string(),
        ),
        media_blob_id,
        thumbnail_blob_id: Some(thumbnail_blob_id),
        waveform_blob_id: None,
    };

    let song_created_event = NotificationEvent::song_created(song_payload.clone());

    println!("  📝 Song Created Event:");
    println!("    Channel: {:?}", song_created_event.channel);
    println!("    Type: {}", song_created_event.event_type);
    println!("    Priority: {:?}", song_created_event.priority);
    println!(
        "    Song: {} by {}",
        song_payload.title,
        song_payload.artist.as_deref().unwrap_or("Unknown")
    );

    // Create a song updated event
    let mut updated_payload = song_payload.clone();
    updated_payload.waveform_blob_id = Some(Uuid::new_v4());

    let _song_updated_event = NotificationEvent::song_updated(updated_payload);
    println!(
        "  🔄 Song Updated Event: {} (waveform generated)",
        song_payload.title
    );

    // Create a song deleted event
    let _song_deleted_event = NotificationEvent::song_deleted(song_id, song_payload.title.clone());
    println!("  🗑️  Song Deleted Event: {}", song_payload.title);

    Ok(())
}

fn demonstrate_playlist_events() -> Result<(), Box<dyn std::error::Error>> {
    println!("📋 Playlist Events:");

    let playlist_id = Uuid::new_v4();
    let thumbnail_blob_id = Uuid::new_v4();

    // Create a playlist
    let playlist_payload = PlaylistEventPayload {
        playlist_id,
        title: "Rock Classics".to_string(),
        description: Some("The best rock songs of all time".to_string()),
        song_count: Some(25),
        thumbnail_blob_id: Some(thumbnail_blob_id),
        is_public: true,
    };

    let _playlist_created_event = NotificationEvent::playlist_created(playlist_payload.clone());

    println!("  📝 Playlist Created Event:");
    println!("    Playlist: {}", playlist_payload.title);
    println!(
        "    Description: {}",
        playlist_payload.description.as_deref().unwrap_or("None")
    );
    println!("    Songs: {}", playlist_payload.song_count.unwrap_or(0));
    println!("    Public: {}", playlist_payload.is_public);

    // Update playlist
    let mut updated_playlist = playlist_payload.clone();
    updated_playlist.song_count = Some(26);

    let _playlist_updated_event = NotificationEvent::playlist_updated(updated_playlist);
    println!(
        "  🔄 Playlist Updated Event: {} (song added)",
        playlist_payload.title
    );

    // Delete playlist
    let _playlist_deleted_event =
        NotificationEvent::playlist_deleted(playlist_id, playlist_payload.title.clone());
    println!("  🗑️  Playlist Deleted Event: {}", playlist_payload.title);

    Ok(())
}

fn demonstrate_scanning_events() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔍 Scanning Events:");

    let session_id = Uuid::new_v4();
    let base_path = "/Users/music/iTunes Music Library".to_string();

    // Scan started
    let _scan_started_event = NotificationEvent::scan_started(session_id, base_path.clone());
    println!("  🚀 Scan Started Event:");
    println!("    Session: {}", session_id);
    println!("    Path: {}", base_path);

    // Scan progress
    let progress_payload = ScanProgressPayload {
        session_id,
        base_path: base_path.clone(),
        total_files: Some(2500),
        processed_files: 750,
        current_file: Some(
            "/Users/music/iTunes Music Library/Beatles/Abbey Road/01 - Come Together.mp3"
                .to_string(),
        ),
        percentage: Some(30.0),
        estimated_remaining: Some("12 minutes".to_string()),
    };

    let _scan_progress_event = NotificationEvent::scan_progress(progress_payload);
    println!("  📊 Scan Progress Event:");
    println!("    Progress: 750/2500 files (30.0%)");
    println!("    Current: Beatles/Abbey Road/01 - Come Together.mp3");
    println!("    Remaining: ~12 minutes");

    // Scan completed
    let completed_payload = ScanCompletedPayload {
        session_id,
        base_path: base_path.clone(),
        total_files: 2500,
        songs_added: 2350,
        songs_updated: 50,
        songs_skipped: 100,
        errors_encountered: 0,
        duration_seconds: 720, // 12 minutes
    };

    let _scan_completed_event = NotificationEvent::scan_completed(completed_payload);
    println!("  ✅ Scan Completed Event:");
    println!("    Total files: 2,500");
    println!("    Songs added: 2,350");
    println!("    Songs updated: 50");
    println!("    Songs skipped: 100");
    println!("    Duration: 12 minutes");

    Ok(())
}

fn demonstrate_library_events() -> Result<(), Box<dyn std::error::Error>> {
    println!("📚 Library Events:");

    // Library statistics updated
    let stats_payload = LibraryStatsPayload {
        total_songs: 15_842,
        total_artists: 1_205,
        total_albums: 2_156,
        total_duration_seconds: 3_456_789, // ~960 hours
        total_size_bytes: 67_890_123_456,  // ~63 GB
        last_updated: OffsetDateTime::now_utc(),
    };

    let _stats_event = NotificationEvent::library_stats_updated(stats_payload);
    println!("  📈 Library Stats Updated Event:");
    println!("    Songs: 15,842");
    println!("    Artists: 1,205");
    println!("    Albums: 2,156");
    println!("    Duration: ~960 hours");
    println!("    Size: ~63 GB");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example_runs_without_panic() {
        // This test ensures the example can run without panicking
        main().expect("Example should run successfully");
    }

    #[test]
    fn test_song_event_structure() {
        let song_id = Uuid::new_v4();
        let media_blob_id = Uuid::new_v4();

        let payload = SongEventPayload {
            song_id,
            title: "Test Song".to_string(),
            artist: Some("Test Artist".to_string()),
            album: None,
            duration: Some("3:30".to_string()),
            file_path: Some("/test/song.mp3".to_string()),
            media_blob_id,
            thumbnail_blob_id: None,
            waveform_blob_id: None,
        };

        let event = NotificationEvent::song_created(payload);

        assert_eq!(event.channel, NotificationChannel::Music);
        assert_eq!(event.event_type, "song.created");

        let payload_data = event.payload_value();
        assert_eq!(payload_data["song_id"], json!(song_id));
        assert_eq!(payload_data["title"], json!("Test Song"));
        assert_eq!(payload_data["artist"], json!("Test Artist"));
    }

    #[test]
    fn test_scan_events_correlation() {
        let session_id = Uuid::new_v4();
        let base_path = "/test/music".to_string();

        // Create scan started event
        let started_event = NotificationEvent::scan_started(session_id, base_path.clone());

        // Create scan progress event
        let progress_payload = ScanProgressPayload {
            session_id,
            base_path: base_path.clone(),
            total_files: Some(100),
            processed_files: 50,
            current_file: Some("/test/music/song.mp3".to_string()),
            percentage: Some(50.0),
            estimated_remaining: Some("2 minutes".to_string()),
        };
        let progress_event = NotificationEvent::scan_progress(progress_payload);

        // Both events should have the same session_id for correlation
        let started_payload = started_event.payload_value();
        let progress_payload = progress_event.payload_value();

        assert_eq!(started_payload["session_id"], json!(session_id));
        assert_eq!(progress_payload["session_id"], json!(session_id));
        assert_eq!(started_payload["base_path"], progress_payload["base_path"]);
    }
}
