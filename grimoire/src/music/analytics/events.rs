//! Music/video analytics event recording
//!
//! This module handles recording play events, which creates both:
//! 1. A generic media event in `media_eventz`
//! 2. A generalized play event in `play_eventz` with a denormalized entity_type/entity_id

use crate::analytics::{record_event_with_conn, MediaEvent, MediaEventType};
use crate::database;
use crate::GrimoireResponse;
use sqlx::SqliteConnection;

use super::models::PlayEvent;

/// Record a play event
///
/// This creates both a generic media event and a denormalized play event record.
/// The media event contains the raw playback data, while the play event
/// provides a denormalized entity_type/entity_id reference for efficient queries.
///
/// Returns a tuple of (media_event_id, play_event_id)
pub async fn record_play_event(
    media_event: &MediaEvent,
    play_event: &PlayEvent,
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

    // Then record the denormalized play event with the media_event_id
    let play_event_id =
        match record_play_event_with_conn(&mut tx, &media_event_id, play_event).await {
            Ok(id) => id,
            Err(e) => {
                return GrimoireResponse::failure("Failed to record play event", vec![e.into()])
            }
        };

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure("Failed to commit transaction", vec![e.into()]);
    }

    // note: individual play events don't create feed events
    // playback sessions (via playback_sessionz) handle feed visibility

    GrimoireResponse::success(
        "Play event recorded successfully",
        (media_event_id, play_event_id),
    )
}

/// Record a play event using an existing connection/transaction
///
/// This is useful when you need to record an event as part of a larger transaction.
/// The media_event_id should already exist (you must call record_event_with_conn first).
async fn record_play_event_with_conn(
    conn: &mut SqliteConnection,
    media_event_id: &str,
    event: &PlayEvent,
) -> Result<String, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        INSERT INTO play_eventz (
            media_event_id,
            entity_type,
            entity_id,
            playlist_id,
            radio_station_id,
            user_id,
            session_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
        media_event_id,
        event.entity_type,
        event.entity_id,
        event.playlist_id,
        event.radio_station_id,
        event.user_id,
        event.session_id
    )
    .fetch_one(conn)
    .await?;

    Ok(result.id)
}

/// record N anonymous play rows for a song broadcast on a radio station.
///
/// called from the broadcaster's track-end hook: every listener tuned in at
/// track end gets credited with one row in `play_eventz`. these rows have
/// no `media_event_id` (no per-listener device info) and no `user_id` (we don't
/// track listener identity on the broadcaster side).
///
/// returns the number of rows inserted.
pub async fn record_radio_plays(
    song_id: &str,
    station_id: &str,
    listener_count: u32,
) -> crate::GrimoireResult<u32> {
    if listener_count == 0 {
        return Ok(0);
    }

    let pool = database::connect().await?;
    let entity_type = "song";

    // single transaction, N inserts. for typical small listener counts this is
    // fast enough; if it ever becomes hot we can switch to a single multi-row
    // VALUES insert.
    let mut tx = pool.begin().await?;
    for _ in 0..listener_count {
        sqlx::query!(
            r#"
            INSERT INTO play_eventz (entity_type, entity_id, radio_station_id)
            VALUES (?, ?, ?)
            "#,
            entity_type,
            song_id,
            station_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(listener_count)
}

/// record a "playlist initiated play" marker row.
///
/// inserted when a user clicks play on a playlist (the playlist-level play
/// button, not individual song play buttons). the row has `playlist_id` set,
/// `entity_type`/`entity_id` = NULL, and no backing `media_event_id`. counted
/// by `playlist_query_view.playlist_play_count`.
pub async fn record_playlist_initiated_play(
    playlist_id: &str,
    user_id: &str,
) -> crate::GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"
        INSERT INTO play_eventz (playlist_id, user_id)
        VALUES (?, ?)
        "#,
        playlist_id,
        user_id,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// Helper to create a song play event from common parameters
///
/// This is a convenience function that constructs both the MediaEvent and PlayEvent
/// from typical play event data.
pub fn create_play_event(
    media_blob_id: String,
    song_id: String,
    user_id: Option<String>,
    session_id: Option<String>,
    event_data: Option<serde_json::Value>,
) -> (MediaEvent, PlayEvent) {
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

    let mut play_event = PlayEvent::new_song(song_id);

    if let Some(uid) = user_id {
        play_event = play_event.with_user_id(uid);
    }

    if let Some(sid) = session_id {
        play_event = play_event.with_session_id(sid);
    }

    (media_event, play_event)
}

/// Helper to create a video play event from common parameters - mirrors
/// `create_play_event`, kept as its own named function (rather than a
/// shared `entity_type` parameter) so callers read naturally as "recording
/// a song play" vs "recording a video play".
pub fn create_video_play_event(
    media_blob_id: String,
    video_id: String,
    user_id: Option<String>,
    session_id: Option<String>,
    event_data: Option<serde_json::Value>,
) -> (MediaEvent, PlayEvent) {
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

    let mut play_event = PlayEvent::new_video(video_id);

    if let Some(uid) = user_id {
        play_event = play_event.with_user_id(uid);
    }

    if let Some(sid) = session_id {
        play_event = play_event.with_session_id(sid);
    }

    (media_event, play_event)
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
) -> (MediaEvent, PlayEvent) {
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

    let mut play_event = PlayEvent::new_song(song_id);

    if let Some(uid) = user_id {
        play_event = play_event.with_user_id(uid);
    }

    if let Some(sid) = session_id {
        play_event = play_event.with_session_id(sid);
    }

    (media_event, play_event)
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_create_play_event() {
        let (media_event, play_event) = create_play_event(
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

        assert_eq!(play_event.entity_type, Some("song".to_string()));
        assert_eq!(play_event.entity_id, Some("song456".to_string()));
        assert_eq!(play_event.user_id, Some("user789".to_string()));
        assert_eq!(play_event.session_id, Some("session000".to_string()));
    }

    #[test]
    fn test_create_complete_event() {
        let (media_event, play_event) = create_complete_event(
            "blob123".to_string(),
            "song456".to_string(),
            Some("user789".to_string()),
            Some("session000".to_string()),
            Some(json!({"position": 240, "progress": 1.0})),
        );

        assert_eq!(media_event.event_type, MediaEventType::Complete);
        assert_eq!(play_event.entity_id, Some("song456".to_string()));
    }

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_record_play_event() {
        let (media_event, play_event) = create_play_event(
            "test_blob".to_string(),
            "test_song".to_string(),
            Some("test_user".to_string()),
            Some("test_session".to_string()),
            Some(json!({"position": 0})),
        );

        let response = record_play_event(&media_event, &play_event).await;
        assert!(response.success);

        let (media_id, play_event_id) = response.data.unwrap();
        assert!(!media_id.is_empty());
        assert!(!play_event_id.is_empty());
    }
}
