//! Music analytics event recording
//!
//! This module handles recording music-specific play events, which creates both:
//! 1. A generic media event in `media_eventz`
//! 2. A music-specific play event in `music_play_eventz` with denormalized song/album/artist IDs

use crate::analytics::{record_event_with_conn, MediaEvent, MediaEventType};
use crate::database;
use crate::GrimoireResponse;
use sqlx::SqliteConnection;

use super::models::MusicPlayEvent;

/// Record a music play event
///
/// This creates both a generic media event and a music-specific play event record.
/// The media event contains the raw playback data, while the music play event
/// provides denormalized song/album/artist references for efficient queries.
///
/// Returns a tuple of (media_event_id, music_play_event_id)
pub async fn record_play_event(
    media_event: &MediaEvent,
    music_event: &MusicPlayEvent,
) -> GrimoireResponse<(String, String)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => return GrimoireResponse::failure("Failed to begin transaction", vec![e.into()]),
    };

    // First record the generic media event
    let media_event_id = match record_event_with_conn(&mut tx, media_event).await {
        Ok(id) => id,
        Err(e) => return GrimoireResponse::failure("Failed to record media event", vec![e.into()]),
    };

    // Then record the music-specific play event with the media_event_id
    let music_event_id =
        match record_music_play_event_with_conn(&mut tx, &media_event_id, music_event).await {
            Ok(id) => id,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to record music play event",
                    vec![e.into()],
                )
            }
        };

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure("Failed to commit transaction", vec![e.into()]);
    }

    GrimoireResponse::success(
        "Play event recorded successfully",
        (media_event_id, music_event_id),
    )
}

/// Record a music play event using an existing connection/transaction
///
/// This is useful when you need to record an event as part of a larger transaction.
/// The media_event_id should already exist (you must call record_event_with_conn first).
async fn record_music_play_event_with_conn(
    conn: &mut SqliteConnection,
    media_event_id: &str,
    event: &MusicPlayEvent,
) -> Result<String, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        INSERT INTO music_play_eventz (
            media_event_id,
            song_id,
            album_id,
            artist_id,
            playlist_id,
            user_id,
            session_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
        media_event_id,
        event.song_id,
        event.album_id,
        event.artist_id,
        event.playlist_id,
        event.user_id,
        event.session_id
    )
    .fetch_one(conn)
    .await?;

    Ok(result.id)
}

/// Helper to create a play event from common parameters
///
/// This is a convenience function that constructs both the MediaEvent and MusicPlayEvent
/// from typical play event data.
pub fn create_play_event(
    media_blob_id: String,
    song_id: String,
    user_id: Option<String>,
    session_id: Option<String>,
    event_data: Option<serde_json::Value>,
) -> (MediaEvent, MusicPlayEvent) {
    let mut media_event = MediaEvent::new(media_blob_id, MediaEventType::Play);

    if let Some(uid) = &user_id {
        media_event = media_event.with_user_id(uid);
    }

    if let Some(sid) = &session_id {
        media_event = media_event.with_session_id(sid);
    }

    if let Some(data) = event_data {
        media_event = media_event.with_event_data(data);
    }

    let mut music_event = MusicPlayEvent::new(song_id);

    if let Some(uid) = user_id {
        music_event = music_event.with_user_id(uid);
    }

    if let Some(sid) = session_id {
        music_event = music_event.with_session_id(sid);
    }

    (media_event, music_event)
}

/// Helper to create a complete event from common parameters
///
/// Similar to create_play_event but for completion events
pub fn create_complete_event(
    media_blob_id: String,
    song_id: String,
    user_id: Option<String>,
    session_id: Option<String>,
    event_data: Option<serde_json::Value>,
) -> (MediaEvent, MusicPlayEvent) {
    let mut media_event = MediaEvent::new(media_blob_id, MediaEventType::Complete);

    if let Some(uid) = &user_id {
        media_event = media_event.with_user_id(uid);
    }

    if let Some(sid) = &session_id {
        media_event = media_event.with_session_id(sid);
    }

    if let Some(data) = event_data {
        media_event = media_event.with_event_data(data);
    }

    let mut music_event = MusicPlayEvent::new(song_id);

    if let Some(uid) = user_id {
        music_event = music_event.with_user_id(uid);
    }

    if let Some(sid) = session_id {
        music_event = music_event.with_session_id(sid);
    }

    (media_event, music_event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_create_play_event() {
        let (media_event, music_event) = create_play_event(
            "blob123".to_string(),
            "song456".to_string(),
            Some("user789".to_string()),
            Some("session000".to_string()),
            Some(json!({"position": 0, "progress": 0.0})),
        );

        assert_eq!(media_event.media_blob_id, "blob123");
        assert_eq!(media_event.event_type, MediaEventType::Play);
        assert_eq!(media_event.user_id, Some("user789".to_string()));
        assert_eq!(media_event.session_id, Some("session000".to_string()));
        assert!(media_event.event_data.is_some());

        assert_eq!(music_event.song_id, "song456");
        assert_eq!(music_event.user_id, Some("user789".to_string()));
        assert_eq!(music_event.session_id, Some("session000".to_string()));
    }

    #[test]
    fn test_create_complete_event() {
        let (media_event, music_event) = create_complete_event(
            "blob123".to_string(),
            "song456".to_string(),
            Some("user789".to_string()),
            Some("session000".to_string()),
            Some(json!({"position": 240, "progress": 1.0})),
        );

        assert_eq!(media_event.event_type, MediaEventType::Complete);
        assert_eq!(music_event.song_id, "song456");
    }

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_record_play_event() {
        let (media_event, music_event) = create_play_event(
            "test_blob".to_string(),
            "test_song".to_string(),
            Some("test_user".to_string()),
            Some("test_session".to_string()),
            Some(json!({"position": 0})),
        );

        let response = record_play_event(&media_event, &music_event).await;
        assert!(response.success);

        let (media_id, music_id) = response.data.unwrap();
        assert!(!media_id.is_empty());
        assert!(!music_id.is_empty());
    }
}
