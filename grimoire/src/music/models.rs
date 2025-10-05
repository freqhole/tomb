//! Music domain models
//!
//! This module provides data models for songs, playlists, and related entities
//! in the music domain. These models represent the database entities and provide
//! methods for data validation and transformation.

use serde::{Deserialize, Serialize};
use sqlx::postgres::types::PgInterval;
use time::OffsetDateTime;
use uuid::Uuid;

/// A song entity representing a music track
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Song {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub thumbnail_blob_ids: Option<Vec<String>>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub tags: Option<Vec<String>>,
    pub metadata: serde_json::Value,
    pub processing_status: Option<String>,
    pub processing_notes: Option<String>,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

impl Song {
    /// Get a formatted display title for the song
    /// Returns format: "Artist - Title" or just "Title" if no artist
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// Get a detailed display title including album info
    /// Returns format: "Artist - Title (Album)" or variations based on available data
    pub fn detailed_display_title(&self) -> String {
        match (&self.artist, &self.album) {
            (Some(artist), Some(album)) => format!("{} - {} ({})", artist, self.title, album),
            (Some(artist), None) => format!("{} - {}", artist, self.title),
            (None, Some(album)) => format!("{} ({})", self.title, album),
            (None, None) => self.title.clone(),
        }
    }

    /// Get formatted duration as MM:SS string
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d.microseconds / 1_000_000;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// Check if the song is deleted (soft delete)
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

/// A playlist entity for organizing songs
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Playlist {
    pub id: Uuid,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

impl Playlist {
    /// Check if the playlist is deleted (soft delete)
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    /// Get visibility string for display
    pub fn visibility_string(&self) -> &'static str {
        if self.is_public {
            "Public"
        } else {
            "Private"
        }
    }
}

/// A playlist with song count for efficient listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistWithCount {
    #[serde(flatten)]
    pub playlist: Playlist,
    pub song_count: i64,
}

/// A playlist song entry representing the many-to-many relationship
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistSong {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub song_id: Uuid,
    pub position: i32,
    pub created_at: OffsetDateTime,
    pub added_by_client_id: Option<String>,
    pub metadata: serde_json::Value,
}

/// A detailed playlist song with song information joined
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistSongDetail {
    pub position: i32,
    pub song: Song,
    pub added_at: OffsetDateTime,
    pub added_by_client_id: Option<String>,
}

/// Playlist summary from SQL view with aggregated data
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistSummary {
    // Playlist fields
    pub id: Uuid,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    // Summary fields
    pub song_count: i64,
    #[serde(skip)]
    pub total_duration: Option<PgInterval>,
    pub last_modified: Option<OffsetDateTime>,
    pub first_song_titles: Option<String>,
    pub more_songs_indicator: Option<String>,
}

impl PlaylistSummary {
    /// Get formatted total duration as HH:MM:SS string
    pub fn formatted_total_duration(&self) -> Option<String> {
        self.total_duration.map(|d| {
            let total_seconds = d.microseconds / 1_000_000;
            let hours = total_seconds / 3600;
            let minutes = (total_seconds % 3600) / 60;
            let seconds = total_seconds % 60;

            if hours > 0 {
                format!("{}:{:02}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        })
    }

    /// Get preview text showing first few songs
    pub fn song_preview(&self) -> String {
        match (&self.first_song_titles, &self.more_songs_indicator) {
            (Some(titles), Some(more)) if !more.is_empty() => {
                format!("{} {}", titles, more)
            }
            (Some(titles), _) => titles.clone(),
            _ => "Empty playlist".to_string(),
        }
    }

    /// Get visibility string for display
    pub fn visibility_string(&self) -> &'static str {
        if self.is_public {
            "Public"
        } else {
            "Private"
        }
    }

    /// Convert to basic Playlist struct
    pub fn to_playlist(&self) -> Playlist {
        Playlist {
            id: self.id,
            media_blob_id: self.media_blob_id.clone(),
            thumbnail_blob_id: self.thumbnail_blob_id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            client_id: self.client_id.clone(),
            is_public: self.is_public,
            is_collaborative: self.is_collaborative,
            metadata: self.metadata.clone(),
            deleted_at: self.deleted_at,
            deleted_by: self.deleted_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            version: self.version,
        }
    }
}

/// Complete playlist data from SQL view with JSON song details
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistComplete {
    // Playlist fields
    pub id: Uuid,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    // Complete fields
    pub song_count: i64,
    #[serde(skip)]
    pub total_duration: Option<PgInterval>,
    pub last_modified: Option<OffsetDateTime>,
    pub all_song_titles: Option<String>,
    pub songs_json: Option<serde_json::Value>,
}

impl PlaylistComplete {
    /// Get formatted total duration
    pub fn formatted_total_duration(&self) -> Option<String> {
        self.total_duration.map(|d| {
            let total_seconds = d.microseconds / 1_000_000;
            let hours = total_seconds / 3600;
            let minutes = (total_seconds % 3600) / 60;
            let seconds = total_seconds % 60;

            if hours > 0 {
                format!("{}:{:02}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        })
    }

    /// Get songs from JSON data
    pub fn get_songs(&self) -> Vec<PlaylistSongFromJson> {
        self.songs_json
            .as_ref()
            .and_then(|json| serde_json::from_value(json.clone()).ok())
            .unwrap_or_default()
    }

    /// Get visibility string for display
    pub fn visibility_string(&self) -> &'static str {
        if self.is_public {
            "Public"
        } else {
            "Private"
        }
    }

    /// Convert to basic Playlist struct
    pub fn to_playlist(&self) -> Playlist {
        Playlist {
            id: self.id,
            media_blob_id: self.media_blob_id.clone(),
            thumbnail_blob_id: self.thumbnail_blob_id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            client_id: self.client_id.clone(),
            is_public: self.is_public,
            is_collaborative: self.is_collaborative,
            metadata: self.metadata.clone(),
            deleted_at: self.deleted_at,
            deleted_by: self.deleted_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            version: self.version,
        }
    }
}

/// Song data from playlist_complete JSON aggregation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistSongFromJson {
    pub song_id: Uuid,
    pub position: i32,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<f64>, // Seconds as float from EXTRACT(EPOCH)
    pub media_blob_id: Uuid,
    pub thumbnail_id: Option<Uuid>,
    pub waveform_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

impl PlaylistSongFromJson {
    /// Get formatted duration as MM:SS string
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d as i64;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// Get display title like "Artist - Title"
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// Get detailed display title like "Artist - Title (Album)"
    pub fn detailed_display_title(&self) -> String {
        match (&self.artist, &self.album) {
            (Some(artist), Some(album)) => format!("{} - {} ({})", artist, self.title, album),
            (Some(artist), None) => format!("{} - {}", artist, self.title),
            (None, Some(album)) => format!("{} ({})", self.title, album),
            (None, None) => self.title.clone(),
        }
    }
}

/// Album summary from SQL view
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AlbumSummary {
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub artist: Option<String>,
    pub track_count: i64,
    pub disc_count: i64,
    #[serde(skip)]
    pub total_duration: Option<PgInterval>,
    pub year: Option<i32>,
    pub genres: Option<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
    pub first_added: OffsetDateTime,
    pub last_modified: OffsetDateTime,
    pub album_thumbnail_id: Option<String>,
}

impl AlbumSummary {
    /// Get formatted total duration
    pub fn formatted_total_duration(&self) -> Option<String> {
        self.total_duration.map(|d| {
            let total_seconds = d.microseconds / 1_000_000;
            let hours = total_seconds / 3600;
            let minutes = (total_seconds % 3600) / 60;
            let seconds = total_seconds % 60;

            if hours > 0 {
                format!("{}:{:02}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        })
    }

    /// Get primary artist name (album_artist or fallback to artist)
    pub fn primary_artist(&self) -> Option<&String> {
        self.album_artist.as_ref().or(self.artist.as_ref())
    }

    /// Get album display name with year if available
    pub fn display_name(&self) -> String {
        match (&self.album, self.year) {
            (Some(album), Some(year)) => format!("{} ({})", album, year),
            (Some(album), None) => album.clone(),
            (None, _) => "Unknown Album".to_string(),
        }
    }
}

/// Song data from get_playlist_songs function
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistSongWithMedia {
    pub song_id: Uuid,
    pub position: i32,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub created_at: OffsetDateTime,
    pub media_blob_id: Uuid,
    pub audio_mime: Option<String>,
    pub audio_size: Option<i64>,
    pub local_path: Option<String>,
    pub thumbnail_id: Option<Uuid>,
    pub thumbnail_mime: Option<String>,
    pub waveform_id: Option<Uuid>,
    pub waveform_mime: Option<String>,
}

/// Individual song with media information for playback
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SongWithMedia {
    pub song_id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub created_at: OffsetDateTime,
    pub media_blob_id: Uuid,
    pub audio_mime: Option<String>,
    pub audio_size: Option<i64>,
    pub local_path: Option<String>,
    pub thumbnail_id: Option<Uuid>,
    pub thumbnail_mime: Option<String>,
    pub waveform_id: Option<Uuid>,
    pub waveform_mime: Option<String>,
}

impl SongWithMedia {
    /// Get formatted duration
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d.microseconds / 1_000_000;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// Get display title
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// Get detailed display title
    pub fn detailed_display_title(&self) -> String {
        match (&self.artist, &self.album) {
            (Some(artist), Some(album)) => format!("{} - {} ({})", artist, self.title, album),
            (Some(artist), None) => format!("{} - {}", artist, self.title),
            (None, Some(album)) => format!("{} ({})", self.title, album),
            (None, None) => self.title.clone(),
        }
    }
}

impl PlaylistSongWithMedia {
    /// Get formatted duration
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d.microseconds / 1_000_000;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// Get display title
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// Get detailed display title
    pub fn detailed_display_title(&self) -> String {
        match (&self.artist, &self.album) {
            (Some(artist), Some(album)) => format!("{} - {} ({})", artist, self.title, album),
            (Some(artist), None) => format!("{} - {}", artist, self.title),
            (None, Some(album)) => format!("{} ({})", self.title, album),
            (None, None) => self.title.clone(),
        }
    }
}

/// Song data from album functions
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AlbumTrack {
    pub song_id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub media_blob_id: String,
    pub thumbnail_id: Option<String>,
    pub waveform_id: Option<String>,
}

impl AlbumTrack {
    /// Get duration in seconds
    pub fn duration_seconds(&self) -> Option<i64> {
        self.duration.map(|d| d.microseconds / 1_000_000)
    }

    /// Get formatted duration
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d.microseconds / 1_000_000;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// Get display title
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// Get track display with number
    pub fn track_display(&self) -> String {
        match (self.disc_number, self.track_number) {
            (Some(disc), Some(track)) if disc > 1 => {
                format!("{}-{:02}. {}", disc, track, self.title)
            }
            (_, Some(track)) => format!("{:02}. {}", track, self.title),
            _ => self.title.clone(),
        }
    }
}

/// Artist album info from get_artist_albums function
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ArtistAlbum {
    pub album: Option<String>,
    pub year: Option<i32>,
    pub track_count: i64,
    #[serde(skip)]
    pub total_duration: Option<PgInterval>,
    pub avg_rating: Option<f64>,
    pub album_thumbnail_id: Option<Uuid>,
}

impl ArtistAlbum {
    /// Get formatted total duration
    pub fn formatted_total_duration(&self) -> Option<String> {
        self.total_duration.map(|d| {
            let total_seconds = d.microseconds / 1_000_000;
            let hours = total_seconds / 3600;
            let minutes = (total_seconds % 3600) / 60;
            let seconds = total_seconds % 60;

            if hours > 0 {
                format!("{}:{:02}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        })
    }

    /// Get album display name with year
    pub fn display_name(&self) -> String {
        match (&self.album, self.year) {
            (Some(album), Some(year)) => format!("{} ({})", album, year),
            (Some(album), None) => album.clone(),
            (None, _) => "Unknown Album".to_string(),
        }
    }
}

impl PlaylistSongDetail {
    /// Get the song's display title
    pub fn display_title(&self) -> String {
        self.song.display_title()
    }

    /// Get the song's detailed display title
    pub fn detailed_display_title(&self) -> String {
        self.song.detailed_display_title()
    }
}

/// Parameters for creating a new song
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSong {
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub metadata: Option<serde_json::Value>,
}

impl CreateSong {
    /// Validate the create song parameters
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() {
            return Err("Title cannot be empty".to_string());
        }

        if let Some(rating) = self.rating {
            if !(1..=5).contains(&rating) {
                return Err("Rating must be between 1 and 5".to_string());
            }
        }

        if let Some(bpm) = self.bpm {
            if bpm <= 0 || bpm > 300 {
                return Err("BPM must be between 1 and 300".to_string());
            }
        }

        Ok(())
    }
}

/// Parameters for creating a new playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylist {
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub metadata: Option<serde_json::Value>,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl CreatePlaylist {
    /// Validate the create playlist parameters
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() {
            return Err("Title cannot be empty".to_string());
        }

        if self.title.len() > 255 {
            return Err("Title cannot be longer than 255 characters".to_string());
        }

        if let Some(ref description) = self.description {
            if description.len() > 1000 {
                return Err("Description cannot be longer than 1000 characters".to_string());
            }
        }

        Ok(())
    }
}

/// Parameters for updating a playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlaylist {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub metadata: Option<serde_json::Value>,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl UpdatePlaylist {
    /// Validate the update playlist parameters
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref title) = self.title {
            if title.trim().is_empty() {
                return Err("Title cannot be empty".to_string());
            }
            if title.len() > 255 {
                return Err("Title cannot be longer than 255 characters".to_string());
            }
        }

        if let Some(ref description) = self.description {
            if description.len() > 1000 {
                return Err("Description cannot be longer than 1000 characters".to_string());
            }
        }

        Ok(())
    }
}

/// Query parameters for searching songs
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SongQuery {
    // Basic filters
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub title_search: Option<String>,

    // Numeric filters
    pub year: Option<i32>,
    pub rating_min: Option<i32>,
    pub rating_max: Option<i32>,
    pub bpm_min: Option<i32>,
    pub bpm_max: Option<i32>,

    // Duration filters (in seconds)
    pub duration_min: Option<i32>,
    pub duration_max: Option<i32>,

    // Boolean filters
    pub favorites_only: Option<bool>,
    pub has_thumbnail: Option<bool>,
    pub has_waveform: Option<bool>,

    // Array filters
    pub tags: Option<Vec<String>>,

    // Date filters
    pub created_after: Option<OffsetDateTime>,
    pub updated_after: Option<OffsetDateTime>,

    // JSONB filters
    pub metadata_filter: Option<serde_json::Value>,

    // Musical filters
    pub key_signature: Option<String>,

    // Media blob filter
    pub media_blob_id: Option<String>,

    // Pagination
    pub limit: Option<i64>,
    pub offset: Option<i64>,

    // Ordering
    pub order_by: Option<String>,
    pub order_direction: Option<String>,
}

impl SongQuery {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limit(limit: i64) -> Self {
        Self {
            limit: Some(limit),
            ..Default::default()
        }
    }

    pub fn with_offset(limit: i64, offset: i64) -> Self {
        Self {
            limit: Some(limit),
            offset: Some(offset),
            ..Default::default()
        }
    }

    pub fn favorites() -> Self {
        Self {
            favorites_only: Some(true),
            ..Default::default()
        }
    }
}

/// Query parameters for searching playlists
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlaylistQuery {
    pub public_only: Option<bool>,
    pub client_id: Option<String>,
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub created_after: Option<OffsetDateTime>,
    pub updated_after: Option<OffsetDateTime>,
}

impl PlaylistQuery {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_limit(limit: i64) -> Self {
        Self {
            limit: Some(limit),
            ..Default::default()
        }
    }

    pub fn public() -> Self {
        Self {
            public_only: Some(true),
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_song_display_title() {
        let song = Song {
            id: Uuid::new_v4(),
            media_blob_id: "abc1234".to_string(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            thumbnail_blob_ids: None,
            title: "Bohemian Rhapsody".to_string(),
            artist: Some("Queen".to_string()),
            album: Some("A Night at the Opera".to_string()),
            album_artist: None,
            track_number: Some(11),
            disc_number: Some(1),
            duration: None,
            genre: Some("Rock".to_string()),
            year: Some(1975),
            bpm: None,
            key_signature: None,
            rating: Some(5),
            is_favorite: true,
            tags: vec![],
            metadata: serde_json::Value::Null,
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        assert_eq!(song.display_title(), "Queen - Bohemian Rhapsody");
        assert_eq!(
            song.detailed_display_title(),
            "Queen - Bohemian Rhapsody (A Night at the Opera)"
        );
    }

    #[test]
    fn test_song_display_title_no_artist() {
        let song = Song {
            id: Uuid::new_v4(),
            media_blob_id: "def5678".to_string(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            thumbnail_blob_ids: None,
            title: "Untitled".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            duration: None,
            genre: None,
            year: None,
            bpm: None,
            key_signature: None,
            rating: None,
            is_favorite: false,
            tags: vec![],
            metadata: serde_json::Value::Null,
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        assert_eq!(song.display_title(), "Untitled");
        assert_eq!(song.detailed_display_title(), "Untitled");
    }

    #[test]
    fn test_create_song_validation() {
        let mut create_song = CreateSong {
            media_blob_id: Uuid::new_v4(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            title: "Test Song".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            duration: None,
            genre: None,
            year: None,
            bpm: None,
            key_signature: None,
            rating: None,
            is_favorite: None,
            tags: None,
            metadata: None,
        };

        // Valid song
        assert!(create_song.validate().is_ok());

        // Empty title
        create_song.title = "".to_string();
        assert!(create_song.validate().is_err());
        create_song.title = "Test Song".to_string();

        // Invalid rating
        create_song.rating = Some(6);
        assert!(create_song.validate().is_err());
        create_song.rating = Some(3);
        assert!(create_song.validate().is_ok());

        // Invalid BPM
        create_song.bpm = Some(400);
        assert!(create_song.validate().is_err());
        create_song.bpm = Some(120);
        assert!(create_song.validate().is_ok());
    }

    #[test]
    fn test_create_playlist_validation() {
        let mut create_playlist = CreatePlaylist {
            title: "My Playlist".to_string(),
            description: None,
            client_id: None,
            is_public: None,
            is_collaborative: None,
            metadata: None,
        };

        // Valid playlist
        assert!(create_playlist.validate().is_ok());

        // Empty title
        create_playlist.title = "".to_string();
        assert!(create_playlist.validate().is_err());

        // Too long title
        create_playlist.title = "a".repeat(256);
        assert!(create_playlist.validate().is_err());

        // Valid title again
        create_playlist.title = "My Playlist".to_string();
        assert!(create_playlist.validate().is_ok());

        // Too long description
        create_playlist.description = Some("a".repeat(1001));
        assert!(create_playlist.validate().is_err());
    }

    #[test]
    fn test_playlist_visibility_string() {
        let public_playlist = Playlist {
            id: Uuid::new_v4(),
            media_blob_id: None,
            thumbnail_blob_id: None,
            title: "Public Playlist".to_string(),
            description: None,
            client_id: None,
            is_public: true,
            is_collaborative: false,
            metadata: serde_json::Value::Null,
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        assert_eq!(public_playlist.visibility_string(), "Public");

        let private_playlist = Playlist {
            is_public: false,
            ..public_playlist
        };

        assert_eq!(private_playlist.visibility_string(), "Private");
    }
}

/// Statistics about the music database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicDatabaseStats {
    pub song_count: i64,
    pub media_blob_count: i64,
    pub thumbnail_blob_count: i64,
    pub scan_session_count: i64,
}

/// Recent song with thumbnail status for debugging
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RecentSongWithThumbnail {
    pub id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl RecentSongWithThumbnail {
    /// Check if this song has a thumbnail
    pub fn has_thumbnail(&self) -> bool {
        self.thumbnail_blob_id.is_some()
    }

    /// Get a formatted display title for the song
    /// Returns format: "Artist - Title" or just "Title" if no artist
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }
}

// user preference models for per-user favorites and ratings

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct UserSongPreference {
    pub id: Uuid,
    pub user_id: Uuid,
    pub song_id: Uuid,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct UserPhotoPreference {
    pub id: Uuid,
    pub user_id: Uuid,
    pub photo_id: Uuid,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct UserVideoPreference {
    pub id: Uuid,
    pub user_id: Uuid,
    pub video_id: Uuid,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

// request models for updating user preferences

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdateUserPreferenceRequest {
    pub is_favorite: Option<bool>,
    pub rating: Option<i32>,
}

// playlist preference models

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct UserPlaylistPreference {
    pub id: Uuid,
    pub user_id: Uuid,
    pub playlist_id: Uuid,
    pub is_favorite: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdateUserPlaylistPreferenceRequest {
    pub is_favorite: bool,
}

impl UpdateUserPlaylistPreferenceRequest {
    pub fn validate(&self) -> Result<(), String> {
        // no additional validation needed for playlist preferences
        Ok(())
    }
}

// playlist ownership models

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct PlaylistOwnership {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub owner_user_id: Uuid,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TransferPlaylistOwnershipRequest {
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
}

impl TransferPlaylistOwnershipRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.from_user_id == self.to_user_id {
            return Err("cannot transfer ownership to the same user".to_string());
        }
        Ok(())
    }
}

// album favorites request models

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BulkFavoriteAlbumRequest {
    pub album: String,
    pub is_favorite: bool,
}

impl BulkFavoriteAlbumRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.album.trim().is_empty() {
            return Err("album name cannot be empty".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AlbumFavoriteStatus {
    pub album: String,
    pub total_songs: u32,
    pub favorited_songs: u32,
    pub is_fully_favorited: bool,
}

// enhanced playlist model with user context

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PlaylistWithUserContext {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub song_count: i64,
    pub total_duration: Option<PgInterval>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    // user preference data
    pub user_is_favorite: bool,
    pub preference_updated_at: Option<OffsetDateTime>,
    // ownership data
    pub is_owned_by_user: bool,
    pub owner_user_id: Option<Uuid>,
    pub ownership_created_at: Option<OffsetDateTime>,
}

impl UpdateUserPreferenceRequest {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(rating) = self.rating {
            if !(1..=5).contains(&rating) {
                return Err("rating must be between 1 and 5".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BulkUpdatePreferencesRequest {
    pub song_ids: Vec<Uuid>,
    pub updates: UpdateUserPreferenceRequest,
}

impl BulkUpdatePreferencesRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.song_ids.is_empty() {
            return Err("song_ids cannot be empty".to_string());
        }
        self.updates.validate()
    }
}

/// Bulk song metadata update models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkUpdateSongsRequest {
    pub song_ids: Vec<Uuid>,
    pub updates: BulkSongUpdates,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkSongUpdates {
    pub tags: Option<BulkTagOperation>,
    // Metadata fields - all optional for partial updates
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    // JSON metadata field for storing additional data like MusicBrainz info
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BulkTagOperation {
    Replace { tags: Vec<String> },
    Add { tags: Vec<String> },
    Remove { tags: Vec<String> },
}

impl BulkUpdateSongsRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.song_ids.is_empty() {
            return Err("song_ids cannot be empty".to_string());
        }
        Ok(())
    }
}

// song models with user context

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct SongWithUserPreferences {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub thumbnail_blob_ids: Option<Vec<String>>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>, // legacy rating for backward compatibility
    pub is_favorite: bool,   // legacy favorite for backward compatibility
    pub tags: Option<Vec<String>>,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    // user-specific preference data
    pub user_is_favorite: bool,
    pub user_rating: Option<i32>,
    pub preference_updated_at: Option<OffsetDateTime>,
}

impl SongWithUserPreferences {
    /// get a formatted display title for the song
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// get a detailed display title including album info
    pub fn detailed_display_title(&self) -> String {
        match (&self.artist, &self.album) {
            (Some(artist), Some(album)) => format!("{} - {} ({})", artist, self.title, album),
            (Some(artist), None) => format!("{} - {}", artist, self.title),
            (None, Some(album)) => format!("{} ({})", self.title, album),
            (None, None) => self.title.clone(),
        }
    }

    /// get formatted duration as mm:ss string
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration.map(|d| {
            let seconds = d.microseconds / 1_000_000;
            format!("{}:{:02}", seconds / 60, seconds % 60)
        })
    }

    /// check if the song is deleted (soft delete)
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    /// convert to regular song struct (without user preferences)
    pub fn to_song(&self) -> Song {
        Song {
            id: self.id,
            media_blob_id: self.media_blob_id.clone(),
            thumbnail_blob_id: self.thumbnail_blob_id.clone(),
            waveform_blob_id: self.waveform_blob_id.clone(),
            thumbnail_blob_ids: self.thumbnail_blob_ids.clone(),
            title: self.title.clone(),
            artist: self.artist.clone(),
            album: self.album.clone(),
            album_artist: self.album_artist.clone(),
            track_number: self.track_number,
            disc_number: self.disc_number,
            duration: self.duration,
            genre: self.genre.clone(),
            sub_genres: self.sub_genres.clone(),
            year: self.year,
            bpm: self.bpm,
            key_signature: self.key_signature.clone(),
            rating: self.rating,
            is_favorite: self.is_favorite,
            tags: self.tags.clone(),
            metadata: self.metadata.clone(),
            processing_status: None,
            processing_notes: None,
            deleted_at: self.deleted_at,
            deleted_by: self.deleted_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            version: self.version,
        }
    }
}

// simplified struct that matches get_songs_with_user_preferences database function
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct SongWithUserPrefs {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_seconds: Option<i64>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub tags: Option<Vec<String>>,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub preference_updated_at: Option<OffsetDateTime>,
}

impl SongWithUserPrefs {
    /// get a formatted display title for the song
    pub fn display_title(&self) -> String {
        match &self.artist {
            Some(artist) => format!("{} - {}", artist, self.title),
            None => self.title.clone(),
        }
    }

    /// get formatted duration as mm:ss string
    pub fn formatted_duration(&self) -> Option<String> {
        self.duration_seconds
            .map(|seconds| format!("{}:{:02}", seconds / 60, seconds % 60))
    }
}
