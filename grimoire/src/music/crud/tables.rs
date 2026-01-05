//! sea-query table definitions for type-safe query building
//! defines enums for all database tables and columns

use sea_query::Iden;

/// Songs table definition
pub enum Songs {
    Table,
    Rowid,
    Id,
    MediaBlobId,
    ThumbnailBlobId,
    WaveformBlobId,
    Title,
    TrackNumber,
    DiscNumber,
    Duration,
    Year,
    Bpm,
    KeySignature,
    Metadata,
    ProcessingStatus,
    ProcessingNotes,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
    DeletedBy,
    CreatedBy,
    UpdatedBy,
    ArtistRowid,
    AlbumRowid,
}

/// Artists table definition
pub enum Artists {
    Table,
    Rowid,
    Id,
    Name,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
    DeletedBy,
    CreatedBy,
    UpdatedBy,
}

/// Albums table definition
pub enum Albums {
    Table,
    Rowid,
    Id,
    Title,
    AlbumType,
    ReleaseDate,
    ReleaseDatePrecision,
    Label,
    GenreRowid,
    SongCount,
    TotalDuration,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
    DeletedBy,
    CreatedBy,
    UpdatedBy,
    ArtistRowid,
}

/// Genres table definition
pub enum Genres {
    Table,
    Rowid,
    Id,
    Name,
    CreatedAt,
}

/// Playlists table definition
pub enum Playlists {
    Table,
    Rowid,
    Id,
    Title,
    Description,
    IsPublic,
    ThumbnailBlobId,
    CreatedByRowid,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
    DeletedBy,
    CreatedBy,
    UpdatedBy,
}

/// Media Blobz table definition
pub enum MediaBlobz {
    Table,
    Id,
    Sha256,
    Size,
    Mime,
    SourceClientId,
    LocalPath,
    Metadata,
    CreatedAt,
    UpdatedAt,
    ParentBlobId,
    BlobType,
    ContentId,
    DeletedAt,
    DeletedBy,
    CreatedBy,
    UpdatedBy,
}

// Helper functions for table names (matching actual database table names)
impl Songs {
    pub fn table_name() -> &'static str {
        "songz"
    }
}

impl Artists {
    pub fn table_name() -> &'static str {
        "artistz"
    }
}

impl Albums {
    pub fn table_name() -> &'static str {
        "albumz"
    }
}

impl Genres {
    pub fn table_name() -> &'static str {
        "genrez"
    }
}

impl Playlists {
    pub fn table_name() -> &'static str {
        "playlistz"
    }
}

impl MediaBlobz {
    pub fn table_name() -> &'static str {
        "media_blobz"
    }
}

// Implement Iden for table names to match database schema
impl Iden for Songs {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "songz",
                Self::Rowid => "rowid",
                Self::Id => "id",
                Self::MediaBlobId => "media_blob_id",
                Self::ThumbnailBlobId => "thumbnail_blob_id",
                Self::WaveformBlobId => "waveform_blob_id",
                Self::Title => "title",
                Self::TrackNumber => "track_number",
                Self::DiscNumber => "disc_number",
                Self::Duration => "duration",
                Self::Year => "year",
                Self::Bpm => "bpm",
                Self::KeySignature => "key_signature",
                Self::Metadata => "metadata",
                Self::ProcessingStatus => "processing_status",
                Self::ProcessingNotes => "processing_notes",
                Self::CreatedAt => "created_at",
                Self::UpdatedAt => "updated_at",
                Self::DeletedAt => "deleted_at",
                Self::DeletedBy => "deleted_by",
                Self::CreatedBy => "created_by",
                Self::UpdatedBy => "updated_by",
                Self::ArtistRowid => "artist_rowid",
                Self::AlbumRowid => "album_rowid",
            }
        )
        .unwrap();
    }
}

impl Iden for Artists {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "artistz",
                Self::Rowid => "rowid",
                Self::Id => "id",
                Self::Name => "name",
                Self::CreatedAt => "created_at",
                Self::UpdatedAt => "updated_at",
                Self::DeletedAt => "deleted_at",
                Self::DeletedBy => "deleted_by",
                Self::CreatedBy => "created_by",
                Self::UpdatedBy => "updated_by",
            }
        )
        .unwrap();
    }
}

impl Iden for Albums {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "albumz",
                Self::Rowid => "rowid",
                Self::Id => "id",
                Self::Title => "title",
                Self::AlbumType => "album_type",
                Self::ReleaseDate => "release_date",
                Self::ReleaseDatePrecision => "release_date_precision",
                Self::Label => "label",
                Self::GenreRowid => "genre_rowid",
                Self::SongCount => "song_count",
                Self::TotalDuration => "total_duration",
                Self::CreatedAt => "created_at",
                Self::UpdatedAt => "updated_at",
                Self::DeletedAt => "deleted_at",
                Self::DeletedBy => "deleted_by",
                Self::CreatedBy => "created_by",
                Self::UpdatedBy => "updated_by",
                Self::ArtistRowid => "artist_rowid",
            }
        )
        .unwrap();
    }
}

impl Iden for Genres {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "genrez",
                Self::Rowid => "rowid",
                Self::Id => "id",
                Self::Name => "name",
                Self::CreatedAt => "created_at",
            }
        )
        .unwrap();
    }
}

impl Iden for Playlists {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "playlistz",
                Self::Rowid => "rowid",
                Self::Id => "id",
                Self::Title => "title",
                Self::Description => "description",
                Self::IsPublic => "is_public",
                Self::ThumbnailBlobId => "thumbnail_blob_id",
                Self::CreatedByRowid => "created_by_rowid",
                Self::CreatedAt => "created_at",
                Self::UpdatedAt => "updated_at",
                Self::DeletedAt => "deleted_at",
                Self::DeletedBy => "deleted_by",
                Self::CreatedBy => "created_by",
                Self::UpdatedBy => "updated_by",
            }
        )
        .unwrap();
    }
}

impl Iden for MediaBlobz {
    fn unquoted(&self, s: &mut dyn std::fmt::Write) {
        write!(
            s,
            "{}",
            match self {
                Self::Table => "media_blobz",
                Self::Id => "id",
                Self::Sha256 => "sha256",
                Self::Size => "size",
                Self::Mime => "mime",
                Self::SourceClientId => "source_client_id",
                Self::LocalPath => "local_path",
                Self::Metadata => "metadata",
                Self::CreatedAt => "created_at",
                Self::UpdatedAt => "updated_at",
                Self::ParentBlobId => "parent_blob_id",
                Self::BlobType => "blob_type",
                Self::ContentId => "content_id",
                Self::DeletedAt => "deleted_at",
                Self::DeletedBy => "deleted_by",
                Self::CreatedBy => "created_by",
                Self::UpdatedBy => "updated_by",
            }
        )
        .unwrap();
    }
}
