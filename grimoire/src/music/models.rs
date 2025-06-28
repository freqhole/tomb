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
    pub media_blob_id: Uuid,
    pub thumbnail_blob_id: Option<Uuid>,
    pub waveform_blob_id: Option<Uuid>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub metadata: serde_json::Value,
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
    pub media_blob_id: Option<Uuid>,
    pub thumbnail_blob_id: Option<Uuid>,
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
    pub media_blob_id: Option<Uuid>,
    pub thumbnail_blob_id: Option<Uuid>,
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
            media_blob_id: self.media_blob_id,
            thumbnail_blob_id: self.thumbnail_blob_id,
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
    pub media_blob_id: Option<Uuid>,
    pub thumbnail_blob_id: Option<Uuid>,
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
            media_blob_id: self.media_blob_id,
            thumbnail_blob_id: self.thumbnail_blob_id,
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
    pub album_thumbnail_id: Option<Uuid>,
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
    pub thumbnail_id: Option<Uuid>,
    pub thumbnail_mime: Option<String>,
    pub waveform_id: Option<Uuid>,
    pub waveform_mime: Option<String>,
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
    pub media_blob_id: Uuid,
    pub thumbnail_id: Option<Uuid>,
    pub waveform_id: Option<Uuid>,
}

impl AlbumTrack {
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
    pub media_blob_id: Uuid,
    pub thumbnail_blob_id: Option<Uuid>,
    pub waveform_blob_id: Option<Uuid>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub genre: Option<String>,
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
    pub favorites_only: Option<bool>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating_min: Option<i32>,
    pub title_search: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
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
            media_blob_id: Uuid::new_v4(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
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
            media_blob_id: Uuid::new_v4(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
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
