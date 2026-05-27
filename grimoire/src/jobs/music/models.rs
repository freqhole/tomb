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
    /// id of an existing media_blobz row already pointing at this local_path.
    /// when set, the processor takes the rescan-update path instead of
    /// creating new blob/song records (preserves song id, playlist
    /// memberships, favorites, ratings, listening sessions, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub existing_blob_id: Option<String>,
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

// =============================================================================
// last.fm album detail (phase 13)
// =============================================================================

/// parameters for `JobType::LastFmAlbumDetail`. one job per album.
/// fetches `album.getInfo` and `artist.getInfo` (which carries `similar`
/// artists), persists the result into `metadata.lastfm.*`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct LastFmAlbumDetailParams {
    pub album_id: String,
    /// optional MBID hint to make the lookup deterministic when we already
    /// have a confirmed musicbrainz match.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    /// admin override for the artist string sent to last.fm
    /// (`requery_enrichment`, phase 14.5). when None, derived from db.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_override: Option<String>,
    /// admin override for the album/title string sent to last.fm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_override: Option<String>,
}

/// summary written into the job's `result` column on success.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct LastFmAlbumDetailResult {
    pub album_id: String,
    pub album_fetched: bool,
    pub artist_fetched: bool,
    pub album_tag_count: u64,
    pub artist_tag_count: u64,
    pub similar_artist_count: u64,
}

/// request body for the bulk-enqueue offal endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueLastFmAlbumDetailRequest {
    pub album_ids: Vec<String>,
}

/// response from the bulk-enqueue endpoint. one job id per album that was
/// successfully scheduled.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueLastFmAlbumDetailResponse {
    pub job_ids: Vec<String>,
    pub skipped_album_ids: Vec<String>,
}

/// parameters for `JobType::AudioDbAlbumDetail`. one job per album.
/// fetches album by mbid (preferred) or text search, then artist by mbid.
/// persists into `metadata.audiodb.*`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AudioDbAlbumDetailParams {
    pub album_id: String,
    /// optional release-group MBID for direct `album-mb.php` lookup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    /// optional artist MBID for `artist-mb.php` lookup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_mbid: Option<String>,
    /// admin override for the artist string used in fallback text searches
    /// (`requery_enrichment`, phase 14.5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_override: Option<String>,
    /// admin override for the album/title string used in fallback text searches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AudioDbAlbumDetailResult {
    pub album_id: String,
    pub album_fetched: bool,
    pub artist_fetched: bool,
    pub matched_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueAudioDbAlbumDetailRequest {
    pub album_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnqueueAudioDbAlbumDetailResponse {
    pub job_ids: Vec<String>,
    pub skipped_album_ids: Vec<String>,
}

// =============================================================================
// last.fm artist detail (phase 13h)
// =============================================================================

/// parameters for `JobType::LastFmArtistDetail`. one job per artist.
/// fetches `artist.getInfo` (bio + similar) and persists the snapshot
/// into `artistz.metadata.lastfm.*`. each similar artist becomes a
/// `related_artistz` row.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct LastFmArtistDetailParams {
    pub artist_id: String,
    /// optional MBID hint (artist mbid) to make the lookup deterministic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    /// admin override for the artist string sent to last.fm.
    /// when None, derived from `artistz.name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct LastFmArtistDetailResult {
    pub artist_id: String,
    pub artist_fetched: bool,
    pub tag_count: u64,
    pub similar_count: u64,
    pub related_upserted: u64,
}

// =============================================================================
// theaudiodb artist detail (phase 13h)
// =============================================================================

/// parameters for `JobType::AudioDbArtistDetail`. one job per artist.
/// resolves via mbid (preferred) -> `search.php?s=` text fallback;
/// persists into `artistz.metadata.audiodb.*`. audiodb does not expose
/// a "related artists" endpoint we use today, so this processor only
/// populates the bio/image snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AudioDbArtistDetailParams {
    pub artist_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AudioDbArtistDetailResult {
    pub artist_id: String,
    pub artist_fetched: bool,
    pub matched_by: String,
}

/// parameters for `JobType::AlbumEnrichmentPipeline` (phase 14.4).
/// orchestrator job: enqueues per-source detail jobs for one album,
/// optionally skipping sources whose `metadata.<source>.fetched_at` is
/// recent (`force=false` only).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumEnrichmentPipelineParams {
    pub album_id: String,
    /// which sources to enqueue. defaults to `[Mb, Lastfm, Audiodb]` if
    /// empty.
    #[serde(default)]
    pub sources: Vec<crate::jobs::EnrichmentSource>,
    /// when true, ignore the freshness check and re-enqueue all selected
    /// sources.
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumEnrichmentPipelineResult {
    pub album_id: String,
    /// per-source child job ids that were enqueued.
    pub enqueued_job_ids: Vec<String>,
    /// sources skipped because they already have fresh data and `force=false`.
    pub skipped_sources: Vec<String>,
}

/// parameters for `JobType::AutoApplyAlbumEnrichment`. one job per
/// album, scheduled by `auto_confirm_mb_matches`. the job waits for
/// the upstream mb/lastfm/audiodb detail jobs to settle and then
/// auto-accepts every available proposal + ingests every available
/// remote image. final step flips the album to `enriched`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AutoApplyAlbumEnrichmentParams {
    pub album_id: String,
    /// the user that triggered the auto-confirm (used as `created_by`
    /// on the apply writes + the `caller` for ingest_remote_image).
    pub user_id: String,
    /// optional cached username for the same caller (so the inner
    /// ingest fn can populate the right `updated_by_username` on
    /// album/artist image link rows). when missing the inner fn falls
    /// back to the user_id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// monotonically incremented each time the job reschedules itself
    /// while waiting for upstream chain jobs to finish. capped at 20
    /// (default rescheduled delay 30s == ~10min total wait).
    #[serde(default)]
    pub attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AutoApplyAlbumEnrichmentResult {
    pub album_id: String,
    pub taxons_applied: u32,
    pub urls_applied: u32,
    pub bio_applied: bool,
    pub related_applied: u32,
    pub album_images_ingested: u32,
    pub artist_images_ingested: u32,
    pub final_status: String,
}

/// admin route `enqueue_bulk_enrichment` (phase 14.4e).
/// spawns one `AlbumEnrichmentPipeline` per album_id, optionally tagged
/// to a single job session for grouped progress + cancel.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BulkEnrichmentRequest {
    pub album_ids: Vec<String>,
    /// when empty, defaults to `[Mb, Lastfm, Audiodb]`.
    #[serde(default)]
    pub sources: Vec<crate::jobs::EnrichmentSource>,
    #[serde(default)]
    pub force: bool,
    /// queue priority. defaults to 0; the modal uses 10 for foreground
    /// review so user-driven work jumps ahead of background fills.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BulkEnrichmentResponse {
    pub job_session_id: String,
    /// pipeline orchestrator job ids (one per album).
    pub job_ids: Vec<String>,
    pub skipped_album_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CancelBulkEnrichmentRequest {
    pub job_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CancelBulkEnrichmentResponse {
    pub job_session_id: String,
    pub cancelled_job_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEnrichmentProgressRequest {
    pub album_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct EnrichmentSourceStatus {
    pub source: String, // "mb" | "lastfm" | "audiodb"
    pub status: String, // JobStatus serialized; "none" when no row exists
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub retry_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumEnrichmentProgress {
    pub album_id: String,
    pub sources: Vec<EnrichmentSourceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEnrichmentProgressResponse {
    pub albums: Vec<AlbumEnrichmentProgress>,
}

/// admin route `requery_enrichment` (phase 14.5). re-runs a single source
/// for a single album with optional overrides, replacing the existing
/// candidate set / snapshot for that source. for mb, providing `mbid`
/// skips the search step and goes straight to detail fetch.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct RequeryOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mbid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RequeryEnrichmentRequest {
    pub album_id: String,
    pub source: crate::jobs::EnrichmentSource,
    #[serde(default)]
    pub override_query: RequeryOverride,
    /// queue priority. defaults to 10 (foreground) so manual requery jumps
    /// ahead of background fills.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RequeryEnrichmentResponse {
    pub job_id: String,
    /// which underlying job type was enqueued (e.g. for mb we may pick
    /// `MbAlbumDetail` over `MbAlbumSearch` when an mbid override is given).
    pub job_type: String,
}
