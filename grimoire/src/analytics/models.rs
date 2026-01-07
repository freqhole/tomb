//! Core analytics models - domain-agnostic event tracking types

use serde::{Deserialize, Serialize};
use std::fmt;

/// Type of media event being tracked
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaEventType {
    /// User started playing media
    Play,
    /// User paused playback
    Pause,
    /// User resumed playback after pause
    Resume,
    /// User seeked to a different position
    Seek,
    /// Media playback completed to the end
    Complete,
    /// User stopped playback before completion
    Stop,
    /// User rated the media
    Rate,
    /// User favorited the media
    Favorite,
    /// User unfavorited the media
    Unfavorite,
    /// User skipped to next track
    Skip,
    /// Media was added to library
    Add,
}

impl MediaEventType {
    /// Check if this is a play-related event (play, resume)
    pub fn is_play_event(&self) -> bool {
        matches!(self, Self::Play | Self::Resume)
    }

    /// Check if this is a completion event
    pub fn is_completion_event(&self) -> bool {
        matches!(self, Self::Complete)
    }

    /// Check if this is an engagement event (favorite, rate)
    pub fn is_engagement_event(&self) -> bool {
        matches!(self, Self::Favorite | Self::Rate)
    }

    /// Convert to database string value
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Play => "play",
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Seek => "seek",
            Self::Complete => "complete",
            Self::Stop => "stop",
            Self::Rate => "rate",
            Self::Favorite => "favorite",
            Self::Unfavorite => "unfavorite",
            Self::Skip => "skip",
            Self::Add => "add",
        }
    }
}

impl fmt::Display for MediaEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl TryFrom<&str> for MediaEventType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "play" => Ok(Self::Play),
            "pause" => Ok(Self::Pause),
            "resume" => Ok(Self::Resume),
            "seek" => Ok(Self::Seek),
            "complete" => Ok(Self::Complete),
            "stop" => Ok(Self::Stop),
            "rate" => Ok(Self::Rate),
            "favorite" => Ok(Self::Favorite),
            "unfavorite" => Ok(Self::Unfavorite),
            "skip" => Ok(Self::Skip),
            "add" => Ok(Self::Add),
            _ => Err(format!("Invalid event type: {}", value)),
        }
    }
}

/// Media event for analytics tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEvent {
    /// Unique event ID (auto-generated if not provided)
    pub id: Option<String>,
    /// Media blob being interacted with
    pub media_blob_id: String,
    /// User performing the action (nullable)
    pub user_id: Option<String>,
    /// Type of event
    pub event_type: MediaEventType,
    /// Flexible JSON data: position, progress, rating, playlist_id, etc.
    pub event_data: Option<serde_json::Value>,
    /// Session ID to group related events (auto-generated if not provided)
    pub session_id: Option<String>,
    /// User agent string from client
    pub user_agent: Option<String>,
    /// Client application identifier
    pub client_id: Option<String>,
    /// Server-side timestamp (set by database)
    pub created_at: Option<i64>,
    /// Client-side timestamp (unix timestamp)
    pub client_timestamp: Option<i64>,
}

impl MediaEvent {
    /// Create a new media event with required fields
    pub fn new(media_blob_id: String, event_type: MediaEventType) -> Self {
        Self {
            id: None,
            media_blob_id,
            user_id: None,
            event_type,
            event_data: None,
            session_id: None,
            user_agent: None,
            client_id: None,
            created_at: None,
            client_timestamp: None,
        }
    }

    /// Set the user ID
    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Set the event data
    pub fn with_event_data(mut self, data: serde_json::Value) -> Self {
        self.event_data = Some(data);
        self
    }

    /// Set the session ID
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    /// Set the user agent
    pub fn with_user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    /// Set the client ID
    pub fn with_client_id(mut self, client_id: impl Into<String>) -> Self {
        self.client_id = Some(client_id.into());
        self
    }

    /// Set the client timestamp
    pub fn with_client_timestamp(mut self, timestamp: i64) -> Self {
        self.client_timestamp = Some(timestamp);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_type_conversions() {
        assert_eq!(MediaEventType::Play.as_str(), "play");
        assert_eq!(MediaEventType::Favorite.as_str(), "favorite");

        assert_eq!(
            MediaEventType::try_from("play").unwrap(),
            MediaEventType::Play
        );
        assert_eq!(
            MediaEventType::try_from("complete").unwrap(),
            MediaEventType::Complete
        );
        assert!(MediaEventType::try_from("invalid").is_err());
    }

    #[test]
    fn test_event_type_categorization() {
        assert!(MediaEventType::Play.is_play_event());
        assert!(MediaEventType::Resume.is_play_event());
        assert!(!MediaEventType::Pause.is_play_event());

        assert!(MediaEventType::Complete.is_completion_event());
        assert!(!MediaEventType::Play.is_completion_event());

        assert!(MediaEventType::Favorite.is_engagement_event());
        assert!(MediaEventType::Rate.is_engagement_event());
        assert!(!MediaEventType::Play.is_engagement_event());
    }

    #[test]
    fn test_event_builder() {
        let event = MediaEvent::new("blob123".to_string(), MediaEventType::Play)
            .with_user_id("user456")
            .with_session_id("session789")
            .with_client_id("web-app");

        assert_eq!(event.media_blob_id, "blob123");
        assert_eq!(event.event_type, MediaEventType::Play);
        assert_eq!(event.user_id, Some("user456".to_string()));
        assert_eq!(event.session_id, Some("session789".to_string()));
        assert_eq!(event.client_id, Some("web-app".to_string()));
    }
}
