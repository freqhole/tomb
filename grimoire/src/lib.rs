//! Grimoire Package
//!
//! This package provides centralized domain logic and abstractions that can be
//! consumed by HTTP route handlers, WebSocket handlers, the CLI package, and
//! potentially future Rust consumers like a Tauri desktop app.
//!
//! The grimoire contains all the magical spells (business logic) needed to
//! power the application! 🧙‍♀️✨

pub mod analytics;
pub mod auth;
pub mod config;
pub mod database;
pub mod filesys;
pub mod media;
pub mod music;
pub mod notifications;
pub mod photos;
pub mod search;
pub mod thumbnails;
pub mod videos;
pub mod wordlist;

// Re-export analytics types
pub use analytics::{
    AnalyticsError, AnalyticsQuery, AnalyticsService, CleanupConfig, UserActivityQuery,
};

// Re-export auth types
pub use auth::{
    AccountLinkConfig, AccountLinkResult, AuthError, AuthRepository, AuthService, AuthServiceError,
    AuthStats, InviteCode, InviteGenerationConfig, InviteGenerationResult, User, UserRole,
};

// Re-export config types
pub use config::{
    AppConfig, ConfigDisplayFormat, ConfigError, ConfigGenerationOptions, ConfigService,
    ConfigValidationResult,
};

// Re-export wordlist types
pub use wordlist::{
    WordlistConfig, WordlistGenerationResult, WordlistService, WordlistValidationResult,
};

// Re-export media types
pub use media::{
    ClientSyncState, CreateMediaBlob, FullSyncRequest, MediaBlob, MediaBlobCursor, MediaBlobQuery,
    MediaBlobRepository, MediaBlobService, MediaBlobStats, MediaTypeDetector, MediaTypeError,
    PaginatedResult, PaginationDirection, StorageStrategy, SyncAcknowledgment, SyncCapabilities,
    SyncPriority, SyncRecommendations, SyncRequest, SyncResponse, SyncStatus, SyncStatusResponse,
};

// Re-export thumbnails types
pub use thumbnails::{
    ThumbnailConfig, ThumbnailError, ThumbnailJob, ThumbnailJobType, ThumbnailRepository,
    ThumbnailService,
};

// Re-export notifications types
pub use notifications::{
    ChannelSubscription, EventStats, LibraryStatsPayload, MusicEventType, NotificationChannel,
    NotificationChannelConfig, NotificationConfig, NotificationEvent, NotificationFilter,
    NotificationService, NotificationServiceError, PlaylistEventPayload, PlaylistSongEventPayload,
    Publisher, PublisherError, ScanCompletedPayload, ScanFailedPayload, ScanProgressPayload,
    SongEventPayload,
};

// Re-export music types
pub use music::{
    AudioMetadata, JobParameters, JobPriority, JobResult, JobStatus, MusicJob, MusicJobHealth,
    MusicJobType, MusicScanSession, ScanSessionStats, ScanSessionStatus, TitleBuilder,
    TitleBuilderConfig, TitleBuilderError,
};

// Re-export photos types
pub use photos::{
    CreateGallery, CreatePhoto, Gallery, Photo, PhotoGallery, PhotoMetadata, PhotoMetadataError,
    PhotoMetadataExtractor, PhotoProcessingConfig, PhotoQuery, PhotoRepository,
    PhotoRepositoryError, PhotoScanConfig, PhotoScanner, PhotoService, PhotoServiceError,
    PhotoStats, PhotoWithMedia, UpdateGallery, UpdatePhoto,
};

// Re-export videos types
pub use videos::{
    CreateVideo, CreateVideoPlaylist, UpdateVideo, UpdateVideoPlaylist, Video, VideoMetadata,
    VideoMetadataError, VideoMetadataExtractor, VideoPlaylist, VideoPlaylistItem,
    VideoPlaylistQuery, VideoQuery, VideoRepository, VideoRepositoryError, VideoScanner,
    VideoService, VideoServiceError, VideoStats,
};

// Re-export search types
pub use search::{
    MusicSearchResult, PaginationOptions, SearchError, SearchFacet, SearchQuery, SearchResult,
    SearchResultItem, SearchService, SearchSuggestion, SearchType, SongSearchResult, SortBy,
    SortDirection,
};

// Re-export database connection
pub use database::DatabaseConnection;
