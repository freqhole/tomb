//! Music-specific analytics models

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// A generalized play event - tracks a single play/watch of a song or video
///
/// This is denormalized for query performance - stores a direct
/// `entity_type`/`entity_id` reference rather than requiring joins through
/// relationship tables. supersedes the song-only `MusicPlayEvent` shape
/// (see `play_eventz` migration) - "keep differences between listening and
/// watching" happens one level up, in domain-specific constructors
/// (`new_song`/`new_video`) and query functions, not in this shared row shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayEvent {
    /// Unique event ID (auto-generated if not provided)
    pub id: Option<String>,
    /// Reference to the core media event (optional - radio/playlist-initiated
    /// marker rows have no backing media event)
    pub media_event_id: Option<String>,
    /// kind of entity played ("song" or "video") - None for context-only
    /// marker rows (e.g. playlist-initiated play with no specific song/video)
    pub entity_type: Option<String>,
    /// the song or video that was played (optional - playlist-initiated and
    /// radio-only marker rows may not credit a specific entity)
    pub entity_id: Option<String>,
    /// Playlist the entity was played from (if applicable)
    pub playlist_id: Option<String>,
    /// Radio station the song was broadcast on (if applicable)
    pub radio_station_id: Option<String>,
    /// User who played the entity
    pub user_id: Option<String>,
    /// Session ID to group related play events
    pub session_id: Option<String>,
    /// Timestamp (set by database)
    pub created_at: Option<i64>,
}

impl PlayEvent {
    /// Create a new play event for a song
    pub fn new_song(song_id: String) -> Self {
        Self {
            id: None,
            media_event_id: None,
            entity_type: Some("song".to_string()),
            entity_id: Some(song_id),
            playlist_id: None,
            radio_station_id: None,
            user_id: None,
            session_id: None,
            created_at: None,
        }
    }

    /// Create a new play event for a video
    pub fn new_video(video_id: String) -> Self {
        Self {
            id: None,
            media_event_id: None,
            entity_type: Some("video".to_string()),
            entity_id: Some(video_id),
            playlist_id: None,
            radio_station_id: None,
            user_id: None,
            session_id: None,
            created_at: None,
        }
    }

    /// create a marker row not tied to a specific song/video (e.g.
    /// playlist-initiated play, radio tune-in for non-library content)
    pub fn marker() -> Self {
        Self {
            id: None,
            media_event_id: None,
            entity_type: None,
            entity_id: None,
            playlist_id: None,
            radio_station_id: None,
            user_id: None,
            session_id: None,
            created_at: None,
        }
    }

    /// Set the playlist ID
    pub fn with_playlist_id(mut self, playlist_id: impl Into<String>) -> Self {
        self.playlist_id = Some(playlist_id.into());
        self
    }

    /// Set the radio station ID
    pub fn with_radio_station_id(mut self, station_id: impl Into<String>) -> Self {
        self.radio_station_id = Some(station_id.into());
        self
    }

    /// Set the user ID
    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Set the session ID
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }
}

/// Aggregated play analytics for a song
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlayAnalytics {
    /// Song ID
    pub song_id: String,
    /// Total number of play events
    pub total_plays: i64,
    /// Number of complete plays (reached end)
    pub complete_plays: i64,
    /// Number of partial plays (stopped before end)
    pub partial_plays: i64,
    /// Number of unique users who played this song
    pub unique_users: i64,
    /// Number of unique sessions
    pub unique_sessions: i64,
    /// Completion rate (complete_plays / total_plays)
    pub completion_rate: f64,
    /// Average play time in seconds
    pub avg_play_time_seconds: f64,
    /// Total play time in seconds
    pub total_play_time_seconds: i64,
    /// First time this song was played
    pub first_played_at: Option<i64>,
    /// Most recent play time
    pub last_played_at: Option<i64>,
}

/// Listening history item with enriched song metadata
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListeningHistoryItem {
    /// Play event ID
    pub id: String,
    /// Media event ID
    pub media_event_id: String,
    /// Song ID
    pub song_id: String,
    /// Song title
    pub title: String,
    /// Artist name
    pub artist: Option<String>,
    /// Album title
    pub album: Option<String>,
    /// Track number
    pub track_number: Option<i32>,
    /// Disc number
    pub disc_number: Option<i32>,
    /// Duration in seconds
    pub duration: Option<i32>,
    /// Genre
    pub genre: Option<String>,
    /// Playlist ID if played from playlist
    pub playlist_id: Option<String>,
    /// Playlist name if played from playlist
    pub playlist_name: Option<String>,
    /// User ID who played it
    pub user_id: Option<String>,
    /// Username
    pub username: Option<String>,
    /// Session ID
    pub session_id: Option<String>,
    /// When this was played
    pub created_at: i64,
    /// Event data (position, progress, etc.)
    pub event_data: Option<serde_json::Value>,
}

/// Summary of a listening session
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SessionSummary {
    /// Session ID
    pub session_id: String,
    /// User ID
    pub user_id: Option<String>,
    /// Username
    pub username: Option<String>,
    /// Songs played in this session
    pub songs: Vec<SessionSong>,
    /// Total session duration in seconds
    pub total_duration: i64,
    /// Session start time
    pub session_start: i64,
    /// Session end time
    pub session_end: i64,
    /// Number of songs played
    pub song_count: i64,
}

/// Song played in a session
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SessionSong {
    /// Song ID
    pub song_id: String,
    /// Song title
    pub title: String,
    /// Artist name
    pub artist: Option<String>,
    /// Album title
    pub album: Option<String>,
    /// Images for this song
    pub images: Option<Vec<crate::music::crud::ImageMetadata>>,
    /// When played in session
    pub played_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_play_event_builder() {
        let event = PlayEvent::new_song("song123".to_string())
            .with_user_id("user000")
            .with_playlist_id("playlist111")
            .with_session_id("session222");

        assert_eq!(event.entity_type, Some("song".to_string()));
        assert_eq!(event.entity_id, Some("song123".to_string()));
        assert_eq!(event.user_id, Some("user000".to_string()));
        assert_eq!(event.playlist_id, Some("playlist111".to_string()));
        assert_eq!(event.session_id, Some("session222".to_string()));
    }

    #[test]
    fn test_play_event_builder_video() {
        let event = PlayEvent::new_video("video123".to_string());

        assert_eq!(event.entity_type, Some("video".to_string()));
        assert_eq!(event.entity_id, Some("video123".to_string()));
    }
}
