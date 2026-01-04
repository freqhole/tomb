//! Generic media traits for cross-domain code reuse
//!
//! This module provides common traits and interfaces that can be implemented
//! by different media domains (music, photos, videos) to enable code reuse
//! while maintaining domain-specific functionality.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use time::OffsetDateTime;
use uuid::Uuid;

/// Generic media item trait that all media types can implement
#[async_trait]
pub trait MediaItem: Send + Sync + Clone {
    /// The type of metadata this media item contains
    type Metadata: Send + Sync + Clone;

    /// The type of collection this media item can belong to
    type Collection: MediaCollection;

    /// Get the unique identifier for this media item
    fn id(&self) -> Uuid;

    /// Get the media blob ID that contains the actual file data
    fn media_blob_id(&self) -> &str;

    /// Get the thumbnail blob ID if available
    fn thumbnail_blob_id(&self) -> Option<&str>;

    /// Get the title or name of this media item
    fn title(&self) -> &str;

    /// Get the creation timestamp
    fn created_at(&self) -> OffsetDateTime;

    /// Get the last update timestamp
    fn updated_at(&self) -> OffsetDateTime;

    /// Get the version for sync purposes
    fn version(&self) -> i64;

    /// Check if this item is marked as deleted (soft delete)
    fn is_deleted(&self) -> bool;

    /// Check if this item is marked as favorite
    fn is_favorite(&self) -> bool;

    /// Get user-defined tags
    fn tags(&self) -> &[String];

    /// Get the metadata specific to this media type
    fn metadata(&self) -> &Self::Metadata;

    /// Get a formatted display title for UI purposes
    /// #todo: yank.
    fn display_title(&self) -> String {
        self.title().to_string()
    }

    /// Get the file extension this media type typically uses
    /// #todo: yank.
    fn typical_extensions() -> &'static [&'static str];

    /// Get the MIME types this media type supports
    fn supported_mime_types() -> &'static [&'static str];
}

/// Generic media collection trait for organizing media items
#[async_trait]
pub trait MediaCollection: Send + Sync + Clone {
    /// The type of media items this collection contains
    type Item: MediaItem;

    /// Get the unique identifier for this collection
    fn id(&self) -> Uuid;

    /// Get the title of this collection
    fn title(&self) -> &str;

    /// Get the description of this collection if available
    fn description(&self) -> Option<&str>;

    /// Get the creation timestamp
    fn created_at(&self) -> OffsetDateTime;

    /// Get the last update timestamp
    fn updated_at(&self) -> OffsetDateTime;

    /// Get the version for sync purposes
    fn version(&self) -> i64;

    /// Check if this collection is marked as deleted (soft delete)
    fn is_deleted(&self) -> bool;

    /// Check if this collection is public
    fn is_public(&self) -> bool;

    /// Check if this collection is collaborative
    fn is_collaborative(&self) -> bool;

    /// Get the thumbnail blob ID if available
    fn thumbnail_blob_id(&self) -> Option<&str>;

    /// Get the client ID that created this collection
    /// #todo: hmm, yank?
    fn client_id(&self) -> Option<&str>;
}

/// Trait for extracting metadata from media files
#[async_trait]
pub trait MetadataExtractor<T: MediaItem>: Send + Sync {
    /// Error type for metadata extraction
    type Error: std::error::Error + Send + Sync + 'static;

    /// Extract metadata from a file at the given path
    async fn extract_metadata(&self, file_path: &Path) -> Result<T::Metadata, Self::Error>;

    /// Check if a file is supported by this extractor
    fn supports_file(&self, file_path: &Path) -> bool;

    /// Get the priority of this extractor (higher = preferred)
    /// #todo: hmm, yank? where's this used?
    fn priority(&self) -> i32 {
        0
    }
}

/// Trait for generating thumbnails from media files
#[async_trait]
pub trait ThumbnailGenerator<T: MediaItem>: Send + Sync {
    /// Error type for thumbnail generation
    type Error: std::error::Error + Send + Sync + 'static;

    /// Generate a thumbnail for a media file
    async fn generate_thumbnail(
        &self,
        file_path: &Path,
        output_path: &Path,
        max_width: u32,
        max_height: u32,
    ) -> Result<ThumbnailInfo, Self::Error>;

    /// Check if this generator supports the given file
    fn supports_file(&self, file_path: &Path) -> bool;

    /// Get the priority of this generator (higher = preferred)
    /// #todo: hmm, yank? where is this used?
    fn priority(&self) -> i32 {
        0
    }

    /// Get the preferred thumbnail format
    /// #todo: yank? should be webp
    fn preferred_format(&self) -> ImageFormat {
        ImageFormat::Jpeg
    }
}

/// Information about a generated thumbnail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailInfo {
    /// Width of the generated thumbnail
    pub width: u32,
    /// Height of the generated thumbnail
    pub height: u32,
    /// Format of the thumbnail image
    pub format: ImageFormat,
    /// Size of the thumbnail file in bytes
    pub size: u64,
    /// MIME type of the thumbnail
    pub mime_type: String,
}

/// Supported image formats for thumbnails
/// #todo yank, just use webp
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    WebP,
    Avif,
}

// #todo yank, just use webp
impl ImageFormat {
    /// Get the MIME type for this format
    pub fn mime_type(&self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Png => "image/png",
            ImageFormat::WebP => "image/webp",
            ImageFormat::Avif => "image/avif",
        }
    }

    /// Get the file extension for this format
    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
            ImageFormat::WebP => "webp",
            ImageFormat::Avif => "avif",
        }
    }
}

/// Trait for scanning directories for media files
#[async_trait]
pub trait MediaScanner<T: MediaItem>: Send + Sync {
    /// Error type for scanning operations
    type Error: std::error::Error + Send + Sync + 'static;

    /// Scan a directory for media files
    async fn scan_directory(
        &self,
        directory: &Path,
        config: &ScanConfig,
    ) -> Result<Vec<ScannedFile>, Self::Error>;

    /// Check if a file should be included in the scan
    fn should_include_file(&self, file_path: &Path) -> bool;

    /// Get the media type this scanner handles
    fn media_type(&self) -> &'static str;
}

/// Configuration for media scanning
#[derive(Debug, Clone)]
pub struct ScanConfig {
    /// Maximum depth to scan into subdirectories
    /// #todo: hmm, do we need this?
    pub max_depth: Option<usize>,
    /// Maximum file size to process (in bytes)
    /// #todo yank? hmm, do we really need this?
    pub max_file_size: Option<u64>,
    /// File extensions to include (if empty, use default for media type)
    pub include_extensions: Vec<String>,
    /// File extensions to exclude
    pub exclude_extensions: Vec<String>,
    /// Directories to skip
    pub skip_directories: Vec<String>,
    /// Whether to follow symbolic links
    pub follow_symlinks: bool,
    /// Batch size for processing files
    pub batch_size: usize,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            max_depth: Some(10),
            max_file_size: Some(500 * 1024 * 1024), // 500MB
            include_extensions: Vec::new(),
            exclude_extensions: Vec::new(),
            // #todo: yank this default and move to some other config, or just skip .dot dirz
            skip_directories: vec![
                ".git".to_string(),
                ".svn".to_string(),
                "node_modules".to_string(),
                ".DS_Store".to_string(), // ...not a dir? #todo
            ],
            follow_symlinks: false,
            batch_size: 100,
        }
    }
}

/// Information about a scanned file
#[derive(Debug, Clone)]
pub struct ScannedFile {
    /// Path to the file
    pub path: std::path::PathBuf,
    /// File size in bytes
    pub size: u64,
    /// Last modified timestamp
    pub modified: OffsetDateTime,
    /// File extension (lowercase)
    pub extension: String,
    /// MIME type if detected
    pub mime_type: Option<String>,
}

/// Repository trait for media items
/// #todo: hmm, do we need this? or is it really used? maybe over architected...
#[async_trait]
pub trait MediaRepository<T: MediaItem>: Send + Sync {
    /// Error type for repository operations
    type Error: std::error::Error + Send + Sync + 'static;

    /// Find a media item by ID
    async fn find_by_id(&self, id: Uuid) -> Result<Option<T>, Self::Error>;

    /// Find media items by media blob ID
    async fn find_by_media_blob_id(&self, blob_id: &str) -> Result<Option<T>, Self::Error>;

    /// Create a new media item
    async fn create(&self, item: &CreateMediaItem<T>) -> Result<T, Self::Error>;

    /// Update an existing media item
    async fn update(&self, id: Uuid, item: &UpdateMediaItem<T>) -> Result<T, Self::Error>;

    /// Soft delete a media item
    async fn delete(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<(), Self::Error>;

    /// List media items with pagination
    async fn list(
        &self,
        query: &MediaQuery,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<T>, Self::Error>;

    /// Count total media items matching query
    async fn count(&self, query: &MediaQuery) -> Result<i64, Self::Error>;

    /// Get media items for sync (cursor-based pagination)
    async fn get_for_sync(&self, cursor: Option<i64>, limit: i64) -> Result<Vec<T>, Self::Error>;
}

/// Repository trait for media collections
/// #todo: hmm, do we need this? or is it really used? maybe over architected...
#[async_trait]
pub trait CollectionRepository<T: MediaCollection>: Send + Sync {
    /// Error type for repository operations
    type Error: std::error::Error + Send + Sync + 'static;

    /// Find a collection by ID
    async fn find_by_id(&self, id: Uuid) -> Result<Option<T>, Self::Error>;

    /// Create a new collection
    async fn create(&self, collection: &CreateCollection) -> Result<T, Self::Error>;

    /// Update an existing collection
    async fn update(&self, id: Uuid, collection: &UpdateCollection) -> Result<T, Self::Error>;

    /// Soft delete a collection
    async fn delete(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<(), Self::Error>;

    /// List collections with pagination
    async fn list(
        &self,
        query: &CollectionQuery,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<T>, Self::Error>;

    /// Add an item to a collection
    async fn add_item(
        &self,
        collection_id: Uuid,
        item_id: Uuid,
        position: Option<i32>,
    ) -> Result<(), Self::Error>;

    /// Remove an item from a collection
    async fn remove_item(&self, collection_id: Uuid, item_id: Uuid) -> Result<(), Self::Error>;

    /// Get items in a collection
    async fn get_items(
        &self,
        collection_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<T::Item>, Self::Error>;

    /// Reorder items in a collection
    async fn reorder_items(
        &self,
        collection_id: Uuid,
        item_positions: &[(Uuid, i32)],
    ) -> Result<(), Self::Error>;
}

/// Generic query parameters for media items
/// #todo: hmm, do we really need this?
#[derive(Debug, Clone, Default)]
pub struct MediaQuery {
    /// Filter by favorite status
    pub is_favorite: Option<bool>,
    /// Filter by tags (all must match)
    pub tags: Vec<String>,
    /// Text search in title and other fields
    pub search: Option<String>,
    /// Filter by creation date range
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    /// Additional domain-specific filters
    pub filters: HashMap<String, String>,
}

/// Generic query parameters for collections
/// #todo: do we really need this or actually use it?
/// #todo: the rest of this file could maybe be yanked?!
#[derive(Debug, Clone, Default)]
pub struct CollectionQuery {
    /// Filter by public status
    pub is_public: Option<bool>,
    /// Filter by collaborative status
    pub is_collaborative: Option<bool>,
    /// Text search in title and description
    pub search: Option<String>,
    /// Filter by creation date range
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    /// Additional domain-specific filters
    pub filters: HashMap<String, String>,
}

/// Generic structure for creating media items
#[derive(Debug, Clone)]
pub struct CreateMediaItem<T: MediaItem> {
    /// Media blob ID
    pub media_blob_id: String,
    /// Optional thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
    /// Title of the media item
    pub title: String,
    /// Whether this item is marked as favorite
    pub is_favorite: bool,
    /// User-defined tags
    pub tags: Vec<String>,
    /// Domain-specific metadata
    pub metadata: T::Metadata,
}

/// Generic structure for updating media items
#[derive(Debug, Clone)]
pub struct UpdateMediaItem<T: MediaItem> {
    /// Optional new title
    pub title: Option<String>,
    /// Optional thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
    /// Optional favorite status
    pub is_favorite: Option<bool>,
    /// Optional tags (replaces existing tags)
    pub tags: Option<Vec<String>>,
    /// Optional metadata updates
    pub metadata: Option<T::Metadata>,
}

/// Generic structure for creating collections
#[derive(Debug, Clone)]
pub struct CreateCollection {
    /// Title of the collection
    pub title: String,
    /// Optional description
    pub description: Option<String>,
    /// Optional client ID
    pub client_id: Option<String>,
    /// Whether this collection is public
    pub is_public: bool,
    /// Whether this collection is collaborative
    pub is_collaborative: bool,
    /// Optional thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
}

/// Generic structure for updating collections
#[derive(Debug, Clone)]
pub struct UpdateCollection {
    /// Optional new title
    pub title: Option<String>,
    /// Optional new description
    pub description: Option<String>,
    /// Optional public status
    pub is_public: Option<bool>,
    /// Optional collaborative status
    pub is_collaborative: Option<bool>,
    /// Optional thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
}

/// Service trait for media operations
/// #todo: this might be the only one to keep?
#[async_trait]
pub trait MediaService<T: MediaItem>: Send + Sync {
    /// Error type for service operations
    type Error: std::error::Error + Send + Sync + 'static;

    /// Process a media file and create a media item
    async fn process_file(
        &self,
        file_path: &Path,
        session_id: Option<Uuid>,
    ) -> Result<T, Self::Error>;

    /// Generate thumbnails for a media item
    async fn generate_thumbnails(&self, item: &T) -> Result<Vec<String>, Self::Error>;

    /// Update metadata for a media item
    async fn update_metadata(&self, item_id: Uuid) -> Result<T, Self::Error>;

    /// Get processing statistics
    async fn get_stats(&self) -> Result<MediaStats, Self::Error>;
}

/// Statistics for media processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaStats {
    /// Total number of media items
    pub total_items: i64,
    /// Number of items with thumbnails
    pub items_with_thumbnails: i64,
    /// Number of favorite items
    pub favorite_items: i64,
    /// Average file size
    pub average_file_size: Option<f64>,
    /// Total storage used
    pub total_storage_bytes: i64,
}
