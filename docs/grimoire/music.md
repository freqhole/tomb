# Music Module

Domain models and services for music library management, scanning, and playlist operations.

## Overview

The music module provides comprehensive music library functionality including:
- Audio file scanning and metadata extraction
- Song, album, and artist management
- Playlist creation and manipulation
- Music library organization and search

## Architecture

```
music/
├── models.rs           # Domain models and data structures
├── repository.rs       # Database operations and queries
├── service.rs         # Business logic and workflows
├── playlist_service.rs # Playlist-specific operations
├── scanner.rs         # Audio file scanning and processing
└── mod.rs
```

## Core Models

### Song
Represents an individual music track with metadata.

```rust
pub struct Song {
    pub id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_seconds: Option<i32>,
    pub track_number: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub file_path: String,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub play_count: i32,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}
```

### Playlist
Container for organizing songs into collections.

```rust
pub struct Playlist {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}
```

### PlaylistSong
Junction table linking songs to playlists with position.

```rust
pub struct PlaylistSong {
    pub playlist_id: Uuid,
    pub song_id: Uuid,
    pub position: i32,
    pub added_by_client_id: Option<String>,
    pub added_at: OffsetDateTime,
}
```

## Repository Layer

### MusicRepository
Low-level database operations for music entities.

**Key Methods:**
- `get_song(id: Uuid) -> Result<Song>`
- `query_songs(params: SongQueryParams) -> Result<Vec<Song>>`
- `create_song(params: CreateSong) -> Result<Song>`
- `update_song_favorite(id: Uuid, favorite: bool) -> Result<()>`
- `update_song_rating(id: Uuid, rating: Option<i32>) -> Result<()>`
- `delete_song(id: Uuid) -> Result<()>`

**Playlist Operations:**
- `get_playlist(id: Uuid) -> Result<Playlist>`
- `find_playlists_by_title(title: &str, exact: bool) -> Result<Vec<Playlist>>`
- `create_playlist(params: CreatePlaylist) -> Result<Playlist>`
- `add_songs_to_playlist(playlist_id: Uuid, song_ids: &[Uuid]) -> Result<Vec<PlaylistSong>>`
- `remove_songs_from_playlist(playlist_id: Uuid, song_ids: &[Uuid]) -> Result<()>`
- `get_playlist_songs(playlist_id: Uuid) -> Result<Vec<PlaylistSong>>`

**Album/Artist Operations:**
- `get_album_summaries(limit: i64) -> Result<Vec<AlbumSummary>>`
- `get_album_tracks(album: &str, artist: Option<&str>) -> Result<Vec<Song>>`
- `get_artist_albums(artist: &str, limit: i32) -> Result<Vec<AlbumSummary>>`

## Service Layer

### MusicService
High-level business logic for music operations.

**Song Management:**
```rust
// Toggle song favorite status
service.toggle_song_favorite(song_id).await?;

// Rate a song (1-5 stars)
service.rate_song(song_id, Some(4)).await?;

// Search songs with filters
let params = SongQueryParams {
    favorites: Some(true),
    artist: Some("Pink Floyd".to_string()),
    limit: 50,
    offset: 0,
};
let songs = service.query_songs(params).await?;
```

### PlaylistService
Specialized service for playlist operations.

**Playlist Management:**
```rust
// Create playlist with songs
let playlist = service.create_playlist_with_songs(
    "My Favorites",
    Some("Best songs ever"),
    &song_ids,
    Some("user123".to_string())
).await?;

// Find playlist by title or ID
let playlist = service.find_playlist_by_title_or_id("My Playlist").await?;

// Add songs to playlist (handles duplicates gracefully)
let (added, skipped) = service.add_songs_to_playlist(
    playlist_id,
    song_ids,
    Some("user123".to_string())
).await?;
```

**Smart Playlist Operations:**
```rust
// Add songs by title or ID with automatic creation
let (playlist, added, skipped) = service.add_songs_to_playlist_by_title_or_id(
    "New Playlist",  // Creates if doesn't exist
    song_ids,
    Some("user123".to_string())
).await?;

// Create playlist from album
let playlist = service.create_playlist_from_album(
    "Dark Side of the Moon",
    Some("Pink Floyd"),
    Some("Pink Floyd - Dark Side"),
    false // not public
).await?;
```

## Scanner Module

### Audio File Scanning
Automatic discovery and processing of audio files.

**Features:**
- Recursive directory scanning
- Metadata extraction using `lofty` crate
- Batch processing for large libraries
- Session-based scanning with resume capability
- Progress tracking and error handling

**Usage:**
```rust
let scanner_config = ScannerConfig {
    path: "/path/to/music".to_string(),
    max_depth: 10,
    batch_size: 100,
    supported_extensions: vec!["mp3", "flac", "ogg", "m4a"],
    max_file_size_mb: 100,
};

let session = scanner.start_scan(scanner_config).await?;
let results = scanner.get_scan_results(session.id).await?;
```

## Query Parameters

### SongQueryParams
Flexible filtering for song queries.

```rust
pub struct SongQueryParams {
    pub favorites: Option<bool>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub min_rating: Option<i32>,
    pub max_rating: Option<i32>,
    pub year_from: Option<i32>,
    pub year_to: Option<i32>,
    pub limit: i64,
    pub offset: i64,
    pub sort_by: Option<String>,
    pub sort_order: Option<SortOrder>,
}
```

### PlaylistQueryParams
Filtering options for playlist queries.

```rust
pub struct PlaylistQueryParams {
    pub public_only: Option<bool>,
    pub client_id: Option<String>,
    pub title_contains: Option<String>,
    pub limit: i64,
    pub offset: i64,
}
```

## Error Handling

### MusicRepositoryError
Database-level errors.

```rust
pub enum MusicRepositoryError {
    Database(sqlx::Error),
    SongNotFound(Uuid),
    PlaylistNotFound(Uuid),
    PlaylistNotFoundByTitle(String),
    SongAlreadyInPlaylist,
    SongNotInPlaylist,
    Validation(String),
    DuplicatePlaylistTitle(String),
}
```

### MusicServiceError
Business logic errors.

```rust
pub enum MusicServiceError {
    Repository(MusicRepositoryError),
    InvalidInput(String),
    BusinessLogicViolation(String),
    ScannerError(String),
}
```

## Usage Examples

### Basic Operations
```rust
// Initialize services
let repository = MusicRepository::new(pool);
let music_service = MusicService::new(&repository);
let playlist_service = PlaylistService::new(repository);

// Scan music library
let scan_session = music_service.scan_directory(
    "/home/user/Music",
    "Initial Import",
    100  // batch size
).await?;

// Create and populate playlist
let playlist = playlist_service.create_playlist(CreatePlaylist {
    title: "Road Trip Mix".to_string(),
    description: Some("Songs for long drives".to_string()),
    client_id: Some("user123".to_string()),
    is_public: Some(true),
    is_collaborative: Some(false),
    metadata: None,
}).await?;

// Find songs and add to playlist
let songs = music_service.query_songs(SongQueryParams {
    artist: Some("The Beatles".to_string()),
    limit: 20,
    offset: 0,
    ..Default::default()
}).await?;

let song_ids: Vec<Uuid> = songs.into_iter().map(|s| s.id).collect();
playlist_service.add_songs_to_playlist(
    playlist.id,
    song_ids,
    Some("user123".to_string())
).await?;
```

### Advanced Playlist Management
```rust
// Smart playlist creation - creates if doesn't exist
let (playlist, added, skipped) = playlist_service
    .add_songs_to_playlist_by_title_or_id(
        "Chill Music",
        vec![song1_id, song2_id, duplicate_song_id],
        Some("user123".to_string())
    ).await?;

println!("Added {} songs, skipped {} duplicates", added.len(), skipped.len());

// Create playlist from album
let album_playlist = playlist_service.create_playlist_from_album(
    "OK Computer",
    Some("Radiohead"),
    None,  // Use album name as playlist title
    false  // Private playlist
).await?;

// Reorder playlist songs
playlist_service.reorder_playlist(
    playlist.id,
    vec![song3_id, song1_id, song2_id]  // New order
).await?;
```

## Performance Notes

- Database queries use indexes on commonly filtered fields
- Batch operations for adding multiple songs to playlists
- Lazy loading for large playlist contents
- Connection pooling for concurrent operations
- Streaming support for large scan operations

## Configuration

Music module behavior is controlled by configuration:

```jsonc
{
  "media": {
    "supported_audio_formats": ["mp3", "flac", "ogg", "m4a", "wav"],
    "max_blob_file_size": 10485760,
    "max_fs_file_size": 104857600
  }
}
```
