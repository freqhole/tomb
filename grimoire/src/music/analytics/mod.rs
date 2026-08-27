//! Music-specific analytics module
//!
//! This module provides analytics functionality specific to music playback,
//! including play event tracking, listening history, and play statistics.
//!
//! ## Architecture
//!
//! Music analytics builds on top of the generic analytics system:
//! - Generic `media_eventz` table tracks all events (domain-agnostic)
//! - `play_eventz` table provides denormalized entity_type/entity_id data
//!   (song or video) - this enables fast queries without complex joins
//!
//! ## Usage
//!
//! ```rust,no_run
//! use grimoire::music::analytics::{create_play_event, record_play_event};
//! use serde_json::json;
//!
//! # async fn example() -> grimoire::GrimoireResult<()> {
//! // Create a play event
//! let (media_event, play_event) = create_play_event(
//!     "media_blob_id".to_string(),
//!     "song_id".to_string(),
//!     Some("user_id".to_string()),
//!     Some("session_id".to_string()),
//!     Some(json!({"position": 0, "progress": 0.0})),
//! );
//!
//! // Record the event
//! let (media_id, play_event_id) = record_play_event(&media_event, &play_event).await?;
//! # Ok(())
//! # }
//! ```

pub mod admin;
pub mod api_types;
pub mod events;
pub mod feed;
pub mod feed_events;
pub mod models;
pub mod queries;
pub mod sessions;

// Re-export core types
pub use models::{
    ListeningHistoryItem, PlayAnalytics, PlayEvent, SessionSong, SessionSummary,
};

// Re-export core functions
pub use events::{
    create_complete_event, create_play_event, create_video_play_event, record_play_event,
};

// Re-export query functions
pub use queries::{
    get_album_play_count, get_artist_play_count, get_session_summary, get_song_play_analytics,
    get_song_play_count, get_user_listening_history, get_video_play_count,
};

// Re-export feed types and functions
pub use feed::{get_combined_feed, FeedItem, FeedItemType};

// Re-export feed events (denormalized feed table)
pub use feed_events::{
    create_favorite_feed_event, delete_favorite_feed_event, get_feed_events,
    should_skip_feed_event, upsert_album_feed_event, upsert_artist_feed_event,
    upsert_playlist_feed_event, upsert_rating_feed_event, upsert_session_feed_event,
    DeleteFeedEventRequest, FeedEvent, FeedEventResult, FeedEventType, GenreRef, TagRef,
};

// Re-export admin types and functions
pub use admin::{
    get_all_user_stats, get_overview_stats, get_top_albums, get_top_artists, get_top_songs,
    get_user_stats, OverviewStats, TopAlbum, TopArtist, TopSong, UserStats,
};

// Re-export api request/response types
pub use api_types::{
    FeedRequest, FeedResponse, ListeningHistoryRequest, ListeningHistoryResponse,
    RecordPlayRequest, RecordVideoPlayRequest, SongAnalyticsRequest, TopAlbumsRequest,
    TopArtistsRequest, TopSongsRequest,
};

// Re-export session types and functions
pub use sessions::{
    create_playback_session, delete_playback_session, get_playback_session,
    list_playback_sessions, update_playback_session_items, update_playback_session_progress,
    update_playback_session_status, CreatePlaybackSessionRequest, DeletePlaybackSessionRequest,
    GetPlaybackSessionRequest, ListPlaybackSessionsRequest, ListPlaybackSessionsResponse,
    PlaybackSession, PlaybackSessionStatus, PlaybackSessionType, SessionItem,
    UpdatePlaybackSessionItemsRequest, UpdatePlaybackSessionProgressRequest,
    UpdatePlaybackSessionStatusRequest,
};
