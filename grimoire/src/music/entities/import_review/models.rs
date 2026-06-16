//! import review - models for the import_blobz table and related request/response types

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// a pending import session with its unreviewed album ids
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingReviewSession {
    pub session_id: String,
    pub created_at: i64,
    /// username of the user who uploaded (only populated for admin callers)
    pub uploader_username: Option<String>,
    /// albums in this session that have at least one unreviewed blob
    pub albums: Vec<PendingReviewAlbum>,
}

/// summary of an album that has pending review blobs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingReviewAlbum {
    pub album_id: String,
    pub title: String,
    pub artist_id: Option<String>,
    pub artist_name: Option<String>,
    pub artwork_blob_id: Option<String>,
    pub song_count: i64,
    pub pending_blob_count: i64,
}

/// request to list pending review sessions
///
/// members see sessions where they are the uploader.
/// admins see all sessions.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPendingReviewRequest {
    /// optional session_id filter - returns data for a single session only
    pub session_id: Option<String>,
}

/// request to mark all pending blobs in an album (within a session) as reviewed
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MarkAlbumReviewedRequest {
    pub album_id: String,
    pub session_id: String,
}

/// request to patch album metadata and mark it reviewed in one call.
/// wraps UpdateAlbumRequest fields - only fields that are Some will be updated.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PatchAlbumReviewRequest {
    pub album_id: String,
    pub session_id: String,
    /// new album title
    pub title: Option<String>,
    /// artist id (preferred) or artist_name (looked up or created)
    pub artist_id: Option<String>,
    pub artist_name: Option<String>,
    pub album_type: Option<String>,
    pub release_date: Option<String>,
    pub label: Option<String>,
    /// per-song patches applied after the album update
    pub songs: Option<Vec<SongReviewPatch>>,
}

/// patch fields for a single song during import review
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongReviewPatch {
    pub song_id: String,
    pub title: Option<String>,
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
    /// track-level artist credit (compilations)
    pub track_artist: Option<String>,
}

/// request to merge several albums into one target.
/// source albums are deleted after their songs are moved.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MergeAlbumsReviewRequest {
    pub session_id: String,
    /// albums to merge from (will be deleted)
    pub source_ids: Vec<String>,
    /// album to merge into (kept)
    pub target_id: String,
}

/// request to move a single song to a different album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MoveSongReviewRequest {
    pub session_id: String,
    pub song_id: String,
    pub to_album_id: String,
}

/// request to check if a specific album has pending (unreviewed) import blobs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumPendingRequest {
    pub album_id: String,
}

/// response indicating whether an album has pending review blobs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumPendingResponse {
    /// the session_id of the most recent pending session for this album, if any
    pub session_id: Option<String>,
    /// total count of unreviewed blobs for this album across all sessions
    pub pending_count: i64,
    /// created_at of the most recent pending session, if any
    pub created_at: Option<i64>,
}

/// generic success response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ImportReviewOk {
    pub ok: bool,
}
