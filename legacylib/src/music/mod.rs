//! Music domain module
//!
//! This module provides core music processing functionality including:
//! - Song metadata extraction and processing
//! - Thumbnail extraction from audio files
//! - Waveform generation
//! - Smart title construction
//! - File scanning and discovery
//! - Audio file hashing
//!
//! ## Key Features
//!
//! - **Title Builder**: Intelligent song title construction from metadata
//! - **Metadata Extraction**: Extract audio tags and file information
//! - **Thumbnail Processing**: Extract embedded album art
//! - **Waveform Generation**: Create visual waveform representations
//! - **File Discovery**: Scan directories for supported audio files
//! - **Deduplication**: SHA256-based file identification
//!
//! ## Usage Examples
//!
//! ### Smart title construction
//!
//! ```rust
//! use legacylib::music::{TitleBuilder, AudioMetadata};
//! use std::collections::HashMap;
//!
//! let mut tags = HashMap::new();
//! tags.insert("Title".to_string(), "Bohemian Rhapsody".to_string());
//! tags.insert("Artist".to_string(), "Queen".to_string());
//!
//! let metadata = AudioMetadata {
//!     tags,
//!     file_path: "/music/queen/song.mp3".to_string(),
//! };
//!
//! let title = TitleBuilder::new().build_title(&metadata);
//! // Result: "Bohemian Rhapsody - Queen"
//! ```
//!
//! ### Directory scanning
//!
//! ```rust
//! use legacylib::music::Scanner;
//! use legacylib::config::AppConfig;
//!
//! let config = AppConfig::default();
//! let scanner = Scanner::new(&config);
//! let audio_files = scanner.scan_directory("/music/library").await?;
//! ```

pub mod directory_art;
pub mod genre_models;
pub mod genre_repository;
pub mod genre_service;
pub mod hasher;
pub mod jobs;
pub mod metadata;
pub mod models;
pub mod playlist_service;
pub mod processing;
pub mod repository;
pub mod scanner;
pub mod service;
pub mod thumbnail;
pub mod title_builder;
pub mod waveform;

// Re-export main types for convenience
pub use directory_art::{
    extract_basic_metadata, AudioFileMetadata, DirectoryArtConfig, DirectoryArtDetector,
    DirectoryArtError, DirectoryContext, DirectoryImage,
};
pub use hasher::{hash_bytes, hash_file, FileHasher};
pub use jobs::{
    JobParameters, JobPriority, JobResult, JobStatus, MusicJob, MusicJobHealth, MusicJobType,
    MusicScanSession, ScanSessionStats, ScanSessionStatus,
};
pub use metadata::{
    extract_metadata, extract_standard_fields, AudioProperties, AudioTags, CompleteMetadata,
    FileMetadata, MetadataExtractor, StandardFields,
};
pub use models::{
    AlbumSummary, AlbumTrack, ArtistAlbum, BulkSongUpdates, BulkTagOperation,
    BulkUpdateSongsRequest, CreatePlaylist, CreateSong, MusicDatabaseStats, Playlist,
    PlaylistComplete, PlaylistQuery, PlaylistSong, PlaylistSongDetail, PlaylistSongFromJson,
    PlaylistSongWithMedia, PlaylistSummary, PlaylistWithCount, RecentSongWithThumbnail, Song,
    SongQuery, UpdatePlaylist,
};
pub use playlist_service::{PlaylistService, PlaylistServiceError};
pub use processing::{
    get_album_songs_with_status, get_albums_for_processing, get_next_unprocessed_album,
    get_processing_progress, mark_album_status, mark_song_status, AlbumProcessingInfo,
    ProcessingProgress, ProcessingStatus,
};
pub use repository::{MusicRepository, MusicRepositoryError};
pub use scanner::{ConsoleScanProgress, ScanProgress, Scanner, ScannerConfig};
pub use service::{
    CleanupResult, MusicService, MusicServiceError, ScanConfig, ScanResult, SessionStats,
};
pub use thumbnail::{
    extract_thumbnail, has_artwork, ArtworkInfo, ExtractedImage, ImageFormat, ThumbnailExtractor,
    ThumbnailInfo,
};
pub use title_builder::{TitleBuilder, TitleBuilderConfig, TitleBuilderError};
pub use waveform::{
    generate_waveform, generate_waveform_with_config, AudioSamples, GeneratedWaveform,
    WaveformConfig, WaveformGenerator, WaveformInfo,
};

/// Audio metadata structure for title building
/// #todo: hmm, is this used? move it or yank it!
#[derive(Debug, Clone)]
pub struct AudioMetadata {
    /// Tag metadata extracted from the audio file
    pub tags: std::collections::HashMap<String, String>,
    /// Full file system path to the audio file
    pub file_path: String,
}

impl AudioMetadata {
    /// Create new audio metadata
    pub fn new(tags: std::collections::HashMap<String, String>, file_path: String) -> Self {
        Self { tags, file_path }
    }

    /// Get a tag value by key (case-insensitive)
    pub fn get_tag(&self, key: &str) -> Option<&String> {
        // Try exact match first
        if let Some(value) = self.tags.get(key) {
            return Some(value);
        }

        // Try case-insensitive match
        let key_lower = key.to_lowercase();
        self.tags
            .iter()
            .find(|(k, _)| k.to_lowercase() == key_lower)
            .map(|(_, v)| v)
    }

    /// Get the filename without extension from the file path
    pub fn filename_without_extension(&self) -> Option<String> {
        std::path::Path::new(&self.file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    /// Get the full filename from the file path
    pub fn filename(&self) -> Option<String> {
        std::path::Path::new(&self.file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_audio_metadata_creation() {
        let mut tags = HashMap::new();
        tags.insert("Title".to_string(), "Test Song".to_string());
        tags.insert("Artist".to_string(), "Test Artist".to_string());

        let metadata = AudioMetadata::new(tags, "/music/test.mp3".to_string());

        assert_eq!(metadata.get_tag("Title"), Some(&"Test Song".to_string()));
        assert_eq!(metadata.get_tag("Artist"), Some(&"Test Artist".to_string()));
        assert_eq!(metadata.file_path, "/music/test.mp3");
    }

    #[test]
    fn test_case_insensitive_tag_lookup() {
        let mut tags = HashMap::new();
        tags.insert("TITLE".to_string(), "Test Song".to_string());
        tags.insert("artist".to_string(), "Test Artist".to_string());

        let metadata = AudioMetadata::new(tags, "/music/test.mp3".to_string());

        assert_eq!(metadata.get_tag("title"), Some(&"Test Song".to_string()));
        assert_eq!(metadata.get_tag("ARTIST"), Some(&"Test Artist".to_string()));
        assert_eq!(metadata.get_tag("Title"), Some(&"Test Song".to_string()));
    }

    #[test]
    fn test_filename_extraction() {
        let metadata = AudioMetadata::new(
            HashMap::new(),
            "/music/artist/album/01 - Great Song.mp3".to_string(),
        );

        assert_eq!(
            metadata.filename_without_extension(),
            Some("01 - Great Song".to_string())
        );
        assert_eq!(metadata.filename(), Some("01 - Great Song.mp3".to_string()));
    }

    #[test]
    fn test_filename_extraction_edge_cases() {
        // No extension
        let metadata1 = AudioMetadata::new(HashMap::new(), "/music/song".to_string());
        assert_eq!(
            metadata1.filename_without_extension(),
            Some("song".to_string())
        );
        assert_eq!(metadata1.filename(), Some("song".to_string()));

        // Multiple extensions
        let metadata2 = AudioMetadata::new(HashMap::new(), "/music/song.backup.mp3".to_string());
        assert_eq!(
            metadata2.filename_without_extension(),
            Some("song.backup".to_string())
        );
        assert_eq!(metadata2.filename(), Some("song.backup.mp3".to_string()));

        // Root path only
        let metadata3 = AudioMetadata::new(HashMap::new(), "song.mp3".to_string());
        assert_eq!(
            metadata3.filename_without_extension(),
            Some("song".to_string())
        );
        assert_eq!(metadata3.filename(), Some("song.mp3".to_string()));
    }
}
