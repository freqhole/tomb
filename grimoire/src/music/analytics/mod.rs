//! Music-specific analytics module
//!
//! This module provides analytics functionality specific to music playback,
//! including play event tracking, listening history, and play statistics.
//!
//! ## Architecture
//!
//! Music analytics builds on top of the generic analytics system:
//! - Generic `media_eventz` table tracks all events (domain-agnostic)
//! - `music_play_eventz` table provides denormalized music-specific data
//! - This denormalization enables fast queries without complex joins
//!
//! ## Usage
//!
//! ```rust,no_run
//! use grimoire::music::analytics::{create_play_event, record_play_event};
//! use serde_json::json;
//!
//! # async fn example() -> grimoire::GrimoireResult<()> {
//! // Create a play event
//! let (media_event, music_event) = create_play_event(
//!     "media_blob_id".to_string(),
//!     "song_id".to_string(),
//!     Some("user_id".to_string()),
//!     Some("session_id".to_string()),
//!     Some(json!({"position": 0, "progress": 0.0})),
//! );
//!
//! // Record the event
//! let (media_id, music_id) = record_play_event(&media_event, &music_event).await?;
//! # Ok(())
//! # }
//! ```

pub mod events;
pub mod models;
pub mod queries;

// Re-export core types
pub use models::{
    ListeningHistoryItem, MusicPlayEvent, PlayAnalytics, SessionSong, SessionSummary,
};

// Re-export core functions
pub use events::{create_complete_event, create_play_event, record_play_event};

// Re-export query functions
pub use queries::{
    get_album_play_count, get_artist_play_count, get_session_summary, get_song_play_analytics,
    get_song_play_count, get_user_listening_history,
};
