//! Music domain notification events and payload types
//!
//! This module defines music-specific event types, payload structures, and
//! convenience functions for creating music domain notifications.

use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{NotificationChannel, NotificationEvent, NotificationPriority};

/// Music-specific event types
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MusicEventType {
    // Song events
    SongCreated,
    SongUpdated,
    SongDeleted,
    SongMetadataExtracted,
    SongThumbnailGenerated,
    SongWaveformGenerated,

    // Playlist events
    PlaylistCreated,
    PlaylistUpdated,
    PlaylistDeleted,
    PlaylistSongAdded,
    PlaylistSongRemoved,
    PlaylistSongReordered,

    // Scanning events
    ScanStarted,
    ScanProgress,
    ScanCompleted,
    ScanFailed,
    ScanPaused,
    ScanResumed,

    // Library events
    LibraryStatsUpdated,
    DuplicateDetected,
    FileNotFound,
}

impl MusicEventType {
    /// Get the event type as a string for notification events
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SongCreated => "song.created",
            Self::SongUpdated => "song.updated",
            Self::SongDeleted => "song.deleted",
            Self::SongMetadataExtracted => "song.metadata_extracted",
            Self::SongThumbnailGenerated => "song.thumbnail_generated",
            Self::SongWaveformGenerated => "song.waveform_generated",

            Self::PlaylistCreated => "playlist.created",
            Self::PlaylistUpdated => "playlist.updated",
            Self::PlaylistDeleted => "playlist.deleted",
            Self::PlaylistSongAdded => "playlist.song_added",
            Self::PlaylistSongRemoved => "playlist.song_removed",
            Self::PlaylistSongReordered => "playlist.song_reordered",

            Self::ScanStarted => "scan.started",
            Self::ScanProgress => "scan.progress",
            Self::ScanCompleted => "scan.completed",
            Self::ScanFailed => "scan.failed",
            Self::ScanPaused => "scan.paused",
            Self::ScanResumed => "scan.resumed",

            Self::LibraryStatsUpdated => "library.stats_updated",
            Self::DuplicateDetected => "library.duplicate_detected",
            Self::FileNotFound => "library.file_not_found",
        }
    }

    /// Get the default priority for this event type
    pub fn default_priority(&self) -> NotificationPriority {
        match self {
            // High priority for real-time UI updates
            Self::SongCreated
            | Self::SongUpdated
            | Self::SongDeleted
            | Self::PlaylistCreated
            | Self::PlaylistUpdated
            | Self::PlaylistDeleted
            | Self::PlaylistSongAdded
            | Self::PlaylistSongRemoved => NotificationPriority::High,

            // Normal priority for progress updates
            Self::ScanProgress | Self::ScanStarted | Self::ScanCompleted => {
                NotificationPriority::Normal
            }

            // Low priority for background processing
            Self::SongMetadataExtracted
            | Self::SongThumbnailGenerated
            | Self::SongWaveformGenerated
            | Self::LibraryStatsUpdated => NotificationPriority::Low,

            // Critical priority for errors
            Self::ScanFailed | Self::FileNotFound => NotificationPriority::Critical,

            // Normal priority for other events
            _ => NotificationPriority::Normal,
        }
    }
}

/// Payload for song-related events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongEventPayload {
    pub song_id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<String>,
    pub file_path: Option<String>,
    pub media_blob_id: Uuid,
    pub thumbnail_blob_id: Option<Uuid>,
    pub waveform_blob_id: Option<Uuid>,
}

/// Payload for playlist-related events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistEventPayload {
    pub playlist_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub song_count: Option<i32>,
    pub thumbnail_blob_id: Option<Uuid>,
    pub is_public: bool,
}

/// Payload for playlist song operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistSongEventPayload {
    pub playlist_id: Uuid,
    pub song_id: Uuid,
    pub position: i32,
    pub playlist_title: String,
    pub song_title: String,
}

/// Payload for scanning progress events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgressPayload {
    pub session_id: Uuid,
    pub base_path: String,
    pub total_files: Option<i32>,
    pub processed_files: i32,
    pub current_file: Option<String>,
    pub percentage: Option<f32>,
    pub estimated_remaining: Option<String>,
}

/// Payload for scan completion events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanCompletedPayload {
    pub session_id: Uuid,
    pub base_path: String,
    pub total_files: i32,
    pub songs_added: i32,
    pub songs_updated: i32,
    pub songs_skipped: i32,
    pub errors_encountered: i32,
    pub duration_seconds: i32,
}

/// Payload for scan failure events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFailedPayload {
    pub session_id: Uuid,
    pub base_path: String,
    pub error_message: String,
    pub files_processed: i32,
    pub last_successful_file: Option<String>,
}

/// Payload for library statistics updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStatsPayload {
    pub total_songs: i32,
    pub total_artists: i32,
    pub total_albums: i32,
    pub total_duration_seconds: i64,
    pub total_size_bytes: i64,
    pub last_updated: OffsetDateTime,
}

/// Convenience functions for creating music notification events
impl NotificationEvent {
    /// Create a song created event
    pub fn song_created(payload: SongEventPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::SongCreated.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::SongCreated.default_priority())
    }

    /// Create a song updated event
    pub fn song_updated(payload: SongEventPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::SongUpdated.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::SongUpdated.default_priority())
    }

    /// Create a song deleted event
    pub fn song_deleted(song_id: Uuid, title: String) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::SongDeleted.as_str().to_string(),
            json!({
                "song_id": song_id,
                "title": title
            }),
        )
        .with_priority(MusicEventType::SongDeleted.default_priority())
    }

    /// Create a playlist created event
    pub fn playlist_created(payload: PlaylistEventPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::PlaylistCreated.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::PlaylistCreated.default_priority())
    }

    /// Create a playlist updated event
    pub fn playlist_updated(payload: PlaylistEventPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::PlaylistUpdated.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::PlaylistUpdated.default_priority())
    }

    /// Create a playlist deleted event
    pub fn playlist_deleted(playlist_id: Uuid, title: String) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::PlaylistDeleted.as_str().to_string(),
            json!({
                "playlist_id": playlist_id,
                "title": title
            }),
        )
        .with_priority(MusicEventType::PlaylistDeleted.default_priority())
    }

    /// Create a scan started event
    pub fn scan_started(session_id: Uuid, base_path: String) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::ScanStarted.as_str().to_string(),
            json!({
                "session_id": session_id,
                "base_path": base_path,
                "started_at": OffsetDateTime::now_utc()
            }),
        )
        .with_priority(MusicEventType::ScanStarted.default_priority())
    }

    /// Create a scan progress event
    pub fn scan_progress(payload: ScanProgressPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::ScanProgress.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::ScanProgress.default_priority())
    }

    /// Create a scan completed event
    pub fn scan_completed(payload: ScanCompletedPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::ScanCompleted.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::ScanCompleted.default_priority())
    }

    /// Create a scan failed event
    pub fn scan_failed(payload: ScanFailedPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::ScanFailed.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::ScanFailed.default_priority())
    }

    /// Create a library stats updated event
    pub fn library_stats_updated(payload: LibraryStatsPayload) -> Self {
        Self::new(
            NotificationChannel::Music,
            MusicEventType::LibraryStatsUpdated.as_str().to_string(),
            json!(payload),
        )
        .with_priority(MusicEventType::LibraryStatsUpdated.default_priority())
    }

    /// Set priority on an existing event (builder pattern)
    pub fn with_priority(mut self, priority: NotificationPriority) -> Self {
        self.priority = priority;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_music_event_type_strings() {
        assert_eq!(MusicEventType::SongCreated.as_str(), "song.created");
        assert_eq!(MusicEventType::ScanProgress.as_str(), "scan.progress");
        assert_eq!(
            MusicEventType::PlaylistSongAdded.as_str(),
            "playlist.song_added"
        );
    }

    #[test]
    fn test_music_event_priorities() {
        assert_eq!(
            MusicEventType::SongCreated.default_priority(),
            NotificationPriority::High
        );
        assert_eq!(
            MusicEventType::ScanProgress.default_priority(),
            NotificationPriority::Normal
        );
        assert_eq!(
            MusicEventType::ScanFailed.default_priority(),
            NotificationPriority::Critical
        );
        assert_eq!(
            MusicEventType::SongThumbnailGenerated.default_priority(),
            NotificationPriority::Low
        );
    }

    #[test]
    fn test_song_created_event() {
        let song_id = Uuid::new_v4();
        let media_blob_id = Uuid::new_v4();

        let payload = SongEventPayload {
            song_id,
            title: "Test Song".to_string(),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            duration: Some("3:45".to_string()),
            file_path: Some("/music/test.mp3".to_string()),
            media_blob_id,
            thumbnail_blob_id: None,
            waveform_blob_id: None,
        };

        let event = NotificationEvent::song_created(payload);

        assert_eq!(event.channel, NotificationChannel::Music);
        assert_eq!(event.event_type, "song.created");
        assert_eq!(event.priority, NotificationPriority::High);

        // Verify payload structure
        let payload_value = event.payload_value();
        assert_eq!(payload_value["song_id"], json!(song_id));
        assert_eq!(payload_value["title"], json!("Test Song"));
        assert_eq!(payload_value["artist"], json!("Test Artist"));
    }

    #[test]
    fn test_scan_progress_event() {
        let session_id = Uuid::new_v4();

        let payload = ScanProgressPayload {
            session_id,
            base_path: "/music/library".to_string(),
            total_files: Some(1000),
            processed_files: 250,
            current_file: Some("/music/library/artist/album/song.mp3".to_string()),
            percentage: Some(25.0),
            estimated_remaining: Some("15 minutes".to_string()),
        };

        let event = NotificationEvent::scan_progress(payload);

        assert_eq!(event.channel, NotificationChannel::Music);
        assert_eq!(event.event_type, "scan.progress");
        assert_eq!(event.priority, NotificationPriority::Normal);

        let payload_value = event.payload_value();
        assert_eq!(payload_value["session_id"], json!(session_id));
        assert_eq!(payload_value["processed_files"], json!(250));
        assert_eq!(payload_value["percentage"], json!(25.0));
    }

    #[test]
    fn test_playlist_song_operations() {
        let playlist_id = Uuid::new_v4();
        let song_id = Uuid::new_v4();

        let payload = PlaylistSongEventPayload {
            playlist_id,
            song_id,
            position: 3,
            playlist_title: "My Playlist".to_string(),
            song_title: "Great Song".to_string(),
        };

        // Test that the payload can be serialized properly
        let json_payload = json!(payload);
        assert_eq!(json_payload["position"], json!(3));
        assert_eq!(json_payload["playlist_title"], json!("My Playlist"));
    }
}
