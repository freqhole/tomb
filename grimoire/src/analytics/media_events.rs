//! Media events models for analytics
//!
//! This module contains models for tracking media interactions and events,
//! supporting comprehensive analytics for song plays, user engagement, and
//! listening behavior analysis.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Media event types for analytics tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaEventType {
    // Basic playback events
    Play,
    Pause,
    Resume,
    Stop,
    Complete,
    Seek,
    Skip,

    // User interaction events
    Rate,
    Favorite,
    Unfavorite,
    Tag,
    Untag,

    // Sharing and download events
    Download,
    Share,
    View,
    ThumbnailClick,

    // Playlist events
    PlaylistAdd,
    PlaylistRemove,

    // Player control events
    Repeat,
    Shuffle,
    VolumeChange,
    QualityChange,

    // Video-specific events (future use)
    Fullscreen,
    PictureInPicture,
    Cast,
}

impl MediaEventType {
    /// Check if this event type represents a play action
    pub fn is_play_event(&self) -> bool {
        matches!(self, MediaEventType::Play | MediaEventType::Resume)
    }

    /// Check if this event type represents a completion
    pub fn is_completion_event(&self) -> bool {
        matches!(self, MediaEventType::Complete)
    }

    /// Check if this event type represents user engagement
    pub fn is_engagement_event(&self) -> bool {
        matches!(
            self,
            MediaEventType::Rate
                | MediaEventType::Favorite
                | MediaEventType::Unfavorite
                | MediaEventType::Share
                | MediaEventType::Download
        )
    }
}

impl std::fmt::Display for MediaEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            MediaEventType::Play => "play",
            MediaEventType::Pause => "pause",
            MediaEventType::Resume => "resume",
            MediaEventType::Stop => "stop",
            MediaEventType::Complete => "complete",
            MediaEventType::Seek => "seek",
            MediaEventType::Skip => "skip",
            MediaEventType::Rate => "rate",
            MediaEventType::Favorite => "favorite",
            MediaEventType::Unfavorite => "unfavorite",
            MediaEventType::Tag => "tag",
            MediaEventType::Untag => "untag",
            MediaEventType::Download => "download",
            MediaEventType::Share => "share",
            MediaEventType::View => "view",
            MediaEventType::ThumbnailClick => "thumbnail_click",
            MediaEventType::PlaylistAdd => "playlist_add",
            MediaEventType::PlaylistRemove => "playlist_remove",
            MediaEventType::Repeat => "repeat",
            MediaEventType::Shuffle => "shuffle",
            MediaEventType::VolumeChange => "volume_change",
            MediaEventType::QualityChange => "quality_change",
            MediaEventType::Fullscreen => "fullscreen",
            MediaEventType::PictureInPicture => "picture_in_picture",
            MediaEventType::Cast => "cast",
        };
        write!(f, "{}", s)
    }
}

impl TryFrom<&str> for MediaEventType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "play" => Ok(MediaEventType::Play),
            "pause" => Ok(MediaEventType::Pause),
            "resume" => Ok(MediaEventType::Resume),
            "stop" => Ok(MediaEventType::Stop),
            "complete" => Ok(MediaEventType::Complete),
            "seek" => Ok(MediaEventType::Seek),
            "skip" => Ok(MediaEventType::Skip),
            "rate" => Ok(MediaEventType::Rate),
            "favorite" => Ok(MediaEventType::Favorite),
            "unfavorite" => Ok(MediaEventType::Unfavorite),
            "tag" => Ok(MediaEventType::Tag),
            "untag" => Ok(MediaEventType::Untag),
            "download" => Ok(MediaEventType::Download),
            "share" => Ok(MediaEventType::Share),
            "view" => Ok(MediaEventType::View),
            "thumbnail_click" => Ok(MediaEventType::ThumbnailClick),
            "playlist_add" => Ok(MediaEventType::PlaylistAdd),
            "playlist_remove" => Ok(MediaEventType::PlaylistRemove),
            "repeat" => Ok(MediaEventType::Repeat),
            "shuffle" => Ok(MediaEventType::Shuffle),
            "volume_change" => Ok(MediaEventType::VolumeChange),
            "quality_change" => Ok(MediaEventType::QualityChange),
            "fullscreen" => Ok(MediaEventType::Fullscreen),
            "picture_in_picture" => Ok(MediaEventType::PictureInPicture),
            "cast" => Ok(MediaEventType::Cast),
            _ => Err(format!("Unknown event type: {}", value)),
        }
    }
}

/// Domain types for media events
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DomainType {
    Song,
    Photo,
    Video,
    Book,
    Document,
    Playlist,
}

impl std::fmt::Display for DomainType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            DomainType::Song => "song",
            DomainType::Photo => "photo",
            DomainType::Video => "video",
            DomainType::Book => "book",
            DomainType::Document => "document",
            DomainType::Playlist => "playlist",
        };
        write!(f, "{}", s)
    }
}

impl TryFrom<&str> for DomainType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "song" => Ok(DomainType::Song),
            "photo" => Ok(DomainType::Photo),
            "video" => Ok(DomainType::Video),
            "book" => Ok(DomainType::Book),
            "document" => Ok(DomainType::Document),
            "playlist" => Ok(DomainType::Playlist),
            _ => Err(format!("Unknown domain type: {}", value)),
        }
    }
}

/// Media event data structures for different event types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MediaEventData {
    /// Playback position data
    Position {
        /// Current position in the media (e.g., "00:02:30" for audio/video)
        position: String,
        /// Playback progress as percentage (0.0 to 1.0)
        progress: Option<f64>,
        /// Media quality (e.g., "320kbps", "1080p")
        quality: Option<String>,
    },

    /// Rating data
    Rating {
        /// Rating value (1-5 stars)
        rating: i32,
        /// Previous rating if this is an update
        previous_rating: Option<i32>,
    },

    /// Volume control data
    Volume {
        /// Volume level (0.0 to 1.0)
        volume: f64,
        /// Previous volume level
        previous_volume: Option<f64>,
    },

    /// Seek operation data
    Seek {
        /// Position seeked from
        from_position: String,
        /// Position seeked to
        to_position: String,
        /// Seek distance in seconds
        seek_distance: f64,
    },

    /// Share event data
    Share {
        /// Platform shared to (e.g., "twitter", "facebook", "link")
        platform: String,
        /// Additional context
        context: Option<String>,
    },

    /// Tag operation data
    Tag {
        /// Tag that was added or removed
        tag: String,
        /// Operation type
        operation: String, // "add" or "remove"
    },

    /// Generic event data for flexible use
    Generic {
        /// Arbitrary JSON data
        #[serde(flatten)]
        data: serde_json::Map<String, serde_json::Value>,
    },

    /// Empty data for events that don't need additional information
    Empty,
}

impl Default for MediaEventData {
    fn default() -> Self {
        MediaEventData::Empty
    }
}

/// Complete media event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEvent {
    pub id: Uuid,
    pub media_blob_id: String,
    pub user_id: Option<Uuid>,
    pub event_type: MediaEventType,
    pub event_data: MediaEventData,
    pub session_id: Option<Uuid>,
    pub user_agent: Option<String>,
    pub client_id: Option<String>,
    pub domain_type: Option<DomainType>,
    pub domain_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

impl MediaEvent {
    /// Create a new media event with minimal required fields
    pub fn new(media_blob_id: String, event_type: MediaEventType, user_id: Option<Uuid>) -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id,
            user_id,
            event_type,
            event_data: MediaEventData::Empty,
            session_id: None,
            user_agent: None,
            client_id: None,
            domain_type: None,
            domain_id: None,
            created_at: OffsetDateTime::now_utc(),
        }
    }

    /// Create a play event with position data
    pub fn play_event(
        media_blob_id: String,
        user_id: Option<Uuid>,
        position: String,
        progress: Option<f64>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id,
            user_id,
            event_type: MediaEventType::Play,
            event_data: MediaEventData::Position {
                position,
                progress,
                quality: None,
            },
            session_id: None,
            user_agent: None,
            client_id: None,
            domain_type: Some(DomainType::Song),
            domain_id: None,
            created_at: OffsetDateTime::now_utc(),
        }
    }

    /// Create a completion event
    pub fn completion_event(
        media_blob_id: String,
        user_id: Option<Uuid>,
        final_position: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id,
            user_id,
            event_type: MediaEventType::Complete,
            event_data: MediaEventData::Position {
                position: final_position,
                progress: Some(1.0),
                quality: None,
            },
            session_id: None,
            user_agent: None,
            client_id: None,
            domain_type: Some(DomainType::Song),
            domain_id: None,
            created_at: OffsetDateTime::now_utc(),
        }
    }

    /// Create a rating event
    pub fn rating_event(
        media_blob_id: String,
        user_id: Option<Uuid>,
        rating: i32,
        previous_rating: Option<i32>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id,
            user_id,
            event_type: MediaEventType::Rate,
            event_data: MediaEventData::Rating {
                rating,
                previous_rating,
            },
            session_id: None,
            user_agent: None,
            client_id: None,
            domain_type: Some(DomainType::Song),
            domain_id: None,
            created_at: OffsetDateTime::now_utc(),
        }
    }

    /// Set session information
    pub fn with_session(mut self, session_id: Option<Uuid>) -> Self {
        self.session_id = session_id;
        self
    }

    /// Set client information
    pub fn with_client_info(
        mut self,
        user_agent: Option<String>,
        client_id: Option<String>,
    ) -> Self {
        self.user_agent = user_agent;
        self.client_id = client_id;
        self
    }

    /// Set domain context
    pub fn with_domain(mut self, domain_type: DomainType, domain_id: Option<Uuid>) -> Self {
        self.domain_type = Some(domain_type);
        self.domain_id = domain_id;
        self
    }

    /// Check if this event represents a meaningful play
    /// (used for analytics aggregation)
    pub fn is_meaningful_play(&self) -> bool {
        match &self.event_data {
            MediaEventData::Position { progress, .. } => {
                // Consider it meaningful if progress >= 10% or event is completion
                progress.map_or(false, |p| p >= 0.1) || self.event_type.is_completion_event()
            }
            _ => self.event_type.is_play_event() || self.event_type.is_completion_event(),
        }
    }

    /// Check if this event represents a complete play (90%+ completion)
    pub fn is_complete_play(&self) -> bool {
        match &self.event_data {
            MediaEventData::Position { progress, .. } => {
                progress.map_or(false, |p| p >= 0.9) || self.event_type.is_completion_event()
            }
            _ => self.event_type.is_completion_event(),
        }
    }
}

/// Analytics errors specific to media events
#[derive(Debug, thiserror::Error)]
pub enum MediaAnalyticsError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Invalid event data: {0}")]
    InvalidEventData(String),
    #[error("Media blob not found: {0}")]
    MediaBlobNotFound(String),
    #[error("User not found: {0}")]
    UserNotFound(Uuid),
    #[error("Session not found: {0}")]
    SessionNotFound(Uuid),
    #[error("Invalid event type: {0}")]
    InvalidEventType(String),
}

/// Request/response types for the API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEventRequest {
    pub media_blob_id: String,
    pub event_type: MediaEventType,
    pub event_data: Option<MediaEventData>,
    pub session_id: Option<Uuid>,
    pub domain_type: Option<DomainType>,
    pub domain_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEventBatchRequest {
    pub events: Vec<MediaEventRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEventResponse {
    pub id: Uuid,
    pub created_at: OffsetDateTime,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEventBatchResponse {
    pub processed: usize,
    pub failed: usize,
    pub events: Vec<MediaEventResponse>,
    pub errors: Vec<String>,
}

/// Play analytics summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayAnalytics {
    pub media_blob_id: String,
    pub total_plays: i64,
    pub complete_plays: i64,
    pub partial_plays: i64,
    pub unique_users: i64,
    pub unique_sessions: i64,
    pub avg_completion_rate: f64,
    pub total_play_time_seconds: i64,
    pub avg_play_time_seconds: f64,
    pub last_played_at: Option<OffsetDateTime>,
    pub first_played_at: Option<OffsetDateTime>,
    pub play_count_last_24h: i64,
    pub play_count_last_7d: i64,
    pub play_count_last_30d: i64,
}

/// User listening history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserListeningHistory {
    pub media_blob_id: String,
    pub event_type: MediaEventType,
    pub event_data: MediaEventData,
    pub domain_type: Option<DomainType>,
    pub domain_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

/// Trending song analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendingSong {
    pub media_blob_id: String,
    pub domain_id: Option<Uuid>,
    pub current_period_plays: i64,
    pub previous_period_plays: i64,
    pub trend_score: f64,
    pub velocity_score: f64,
    pub unique_users: i64,
    pub completion_rate: f64,
}

/// User listening streak analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserListeningStreaks {
    pub user_id: Uuid,
    pub current_streak_days: i32,
    pub longest_streak_days: i32,
    pub total_listening_days: i32,
    pub avg_daily_plays: f64,
    pub favorite_listening_hour: i32,
    pub most_played_day_of_week: i32,
    pub total_unique_songs: i64,
    pub completion_rate: f64,
}

/// Genre listening pattern analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreListeningPattern {
    pub genre: String,
    pub total_plays: i64,
    pub unique_users: i64,
    pub unique_songs: i64,
    pub avg_completion_rate: f64,
    pub trend_direction: String,
    pub popularity_rank: i32,
}

/// User listening time by period
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningTimePeriod {
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub total_listening_seconds: i64,
    pub unique_songs_played: i64,
    pub total_play_events: i64,
    pub avg_session_length_minutes: f64,
}

/// Popular song metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopularSong {
    pub media_blob_id: String,
    pub domain_id: Option<Uuid>,
    pub play_count: i64,
    pub unique_users: i64,
    pub completion_rate: f64,
    pub momentum_score: f64,
    pub first_play_at: OffsetDateTime,
    pub latest_play_at: OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_event_creation() {
        let event = MediaEvent::new(
            "test_blob_123".to_string(),
            MediaEventType::Play,
            Some(Uuid::new_v4()),
        );

        assert_eq!(event.media_blob_id, "test_blob_123");
        assert_eq!(event.event_type, MediaEventType::Play);
        assert!(event.user_id.is_some());
    }

    #[test]
    fn test_play_event_creation() {
        let event = MediaEvent::play_event(
            "test_blob_123".to_string(),
            Some(Uuid::new_v4()),
            "00:01:30".to_string(),
            Some(0.25),
        );

        assert_eq!(event.event_type, MediaEventType::Play);
        assert!(event.is_meaningful_play());
        assert!(!event.is_complete_play());

        match &event.event_data {
            MediaEventData::Position {
                position, progress, ..
            } => {
                assert_eq!(position, "00:01:30");
                assert_eq!(progress, &Some(0.25));
            }
            _ => panic!("Expected position data"),
        }
    }

    #[test]
    fn test_completion_event() {
        let event = MediaEvent::completion_event(
            "test_blob_123".to_string(),
            Some(Uuid::new_v4()),
            "00:03:45".to_string(),
        );

        assert_eq!(event.event_type, MediaEventType::Complete);
        assert!(event.is_meaningful_play());
        assert!(event.is_complete_play());
    }

    #[test]
    fn test_event_type_categorization() {
        assert!(MediaEventType::Play.is_play_event());
        assert!(MediaEventType::Resume.is_play_event());
        assert!(!MediaEventType::Pause.is_play_event());

        assert!(MediaEventType::Complete.is_completion_event());
        assert!(!MediaEventType::Play.is_completion_event());

        assert!(MediaEventType::Rate.is_engagement_event());
        assert!(MediaEventType::Favorite.is_engagement_event());
        assert!(!MediaEventType::Play.is_engagement_event());
    }

    #[test]
    fn test_event_builder_pattern() {
        let session_id = Uuid::new_v4();
        let domain_id = Uuid::new_v4();

        let event = MediaEvent::new(
            "test_blob_123".to_string(),
            MediaEventType::Play,
            Some(Uuid::new_v4()),
        )
        .with_session(Some(session_id))
        .with_client_info(
            Some("Mozilla/5.0".to_string()),
            Some("web_player".to_string()),
        )
        .with_domain(DomainType::Song, Some(domain_id));

        assert_eq!(event.session_id, Some(session_id));
        assert_eq!(event.user_agent, Some("Mozilla/5.0".to_string()));
        assert_eq!(event.client_id, Some("web_player".to_string()));
        assert_eq!(event.domain_type, Some(DomainType::Song));
        assert_eq!(event.domain_id, Some(domain_id));
    }
}
