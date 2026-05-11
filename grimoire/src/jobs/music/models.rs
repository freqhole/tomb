//! music job parameters and results
//!
//! request/response types for music-specific job processors

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// parameters for directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryParams {
    pub directory_path: String,
    pub recursive: bool,
    pub max_depth: Option<u32>,
    pub file_extensions: Option<Vec<String>>, // if None, use default audio extensions
    #[serde(default)]
    pub skip_tracked_subdirs: bool,
}

/// parameters for file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileParams {
    pub file_path: String,
    pub extract_metadata: bool,
    pub generate_thumbnail: bool,
    pub generate_waveform: bool,
    /// original fetch URL (set when this file came from a FetchMedia job)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

/// results from directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryResult {
    pub files_discovered: u64,
    pub jobs_created: u64,
    pub errors: Vec<String>,
}

/// results from file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileResult {
    pub media_blob_id: String,
    pub song_id: Option<String>,
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
    pub metadata_extracted: bool,
    pub thumbnail_generated: bool,
    pub waveform_generated: bool,
}

// ============================================================================
// CLI Response Types
// ============================================================================

/// response for scan job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanJobCreatedResponse {
    pub job_id: String,
    pub session_id: String,
    pub path: String,
    pub recursive: bool,
    pub max_depth: Option<usize>,
}

/// response for process file job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessJobCreatedResponse {
    pub job_id: String,
    pub file_path: String,
}

// =============================================================================
// musicbrainz album search
// =============================================================================

/// parameters for a single `JobType::MbAlbumSearch` job. one job covers one
/// album so the queue can be checkpointed/retried per-row and the existing
/// jobs status endpoint surfaces granular progress.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MbAlbumSearchParams {
    pub album_id: String,
    /// optional admin override for the artist string sent to the search api;
    /// when None, the processor derives it from the artist_albumz join.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_override: Option<String>,
    /// optional admin override for the release/title string sent to the search
    /// api; when None, uses `albumz.title`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_override: Option<String>,
    /// auto-confirm the top hit when local_confidence >= this threshold (0..1).
    /// `None` means never auto-confirm (default behaviour).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_confirm_threshold: Option<f64>,
}

/// result summary written into the job's `result` column on success.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MbAlbumSearchResult {
    pub album_id: String,
    pub candidate_count: u64,
    pub top_local_confidence: Option<f64>,
    pub auto_confirmed_release_id: Option<String>,
    pub final_status: String,
}

/// request body for the bulk-enqueue offal endpoint. accepts a list of album
/// ids (e.g. the current selection or filter result from the library view).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueMbAlbumSearchRequest {
    pub album_ids: Vec<String>,
    /// auto-confirm threshold passed through to every spawned job. None to
    /// keep results unconfirmed for review.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_confirm_threshold: Option<f64>,
}

/// response from the bulk-enqueue endpoint. one job id per album that was
/// successfully scheduled.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueMbAlbumSearchResponse {
    pub job_ids: Vec<String>,
    pub skipped_album_ids: Vec<String>,
}

// =============================================================================
// musicbrainz album detail (folksonomy enrichment, phase 8)
// =============================================================================

/// parameters for `JobType::MbAlbumDetail`. enqueued by `confirm_mb_match`
/// after the user (or auto-confirm) picks a candidate. fetches release-group
/// + release detail with `+genres+tags` and merges folksonomy data into the
/// album's metadata blob.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MbAlbumDetailParams {
    pub album_id: String,
    pub release_group_id: String,
    /// optional release id; when present the processor also fetches the
    /// release-level genres/tags, otherwise only release-group-level data
    /// is captured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
}

/// summary written into the job's `result` column on success.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MbAlbumDetailResult {
    pub album_id: String,
    pub release_genre_count: u64,
    pub release_tag_count: u64,
    pub release_group_genre_count: u64,
    pub release_group_tag_count: u64,
    pub final_status: String,
}
