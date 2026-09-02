//! video import review - request/response types for tracking review state
//! of video blobs arriving via import jobs. reuses the shared
//! `import_blobz`/`job_sessionz` tables already populated by the music
//! domain (they key on `media_blob_id`, which is domain-agnostic).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// a pending review session with its unreviewed video groups
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingVideoReviewSession {
    pub session_id: String,
    pub created_at: i64,
    /// username of the user who uploaded (only populated for admin callers)
    pub uploader_username: Option<String>,
    /// groups in this session that have at least one unreviewed blob
    pub groups: Vec<PendingVideoReviewGroup>,
}

/// a group of pending videos sharing a detected series, or a single
/// standalone video (movie/clip/no series match) when `series_id` is
/// `None` - `group_key` is `series_id` for the former, the video's own id
/// for the latter, and is the identifier every other review route below
/// takes to address the group.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingVideoReviewGroup {
    pub group_key: String,
    pub series_id: Option<String>,
    pub series_title: Option<String>,
    pub poster_blob_id: Option<String>,
    pub videos: Vec<PendingReviewVideoSummary>,
    pub pending_blob_count: i64,
}

/// summary of a single pending video within a review group
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PendingReviewVideoSummary {
    pub video_id: String,
    pub title: String,
    /// "series" | "movie" | "clip" - only meaningful when the group has
    /// no `series_id` (mirrors `Video::content_type`'s own doc comment).
    pub content_type: String,
    pub season_id: Option<String>,
    pub season_number: Option<i64>,
    pub season_title: Option<String>,
    pub episode_number: Option<i64>,
}

/// request to list pending review sessions
///
/// members see sessions where they are the uploader.
/// admins see all sessions.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPendingVideoReviewRequest {
    /// optional session_id filter - returns data for a single session only
    pub session_id: Option<String>,
}

/// request to mark a whole group (a series, or a single standalone video)
/// reviewed, with no metadata changes
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MarkVideoGroupReviewedRequest {
    pub group_key: String,
    pub session_id: String,
}

/// a brand new season to create (found-or-created by (series, number),
/// never a raw admin-gated create call) as part of a single review action.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct NewSeasonPatch {
    pub season_number: i64,
    pub title: Option<String>,
}

/// per-video patch fields during import review
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoReviewPatch {
    pub video_id: String,
    pub title: Option<String>,
    pub episode_number: Option<i64>,
    /// assign this video to a season within the group's series - the
    /// season must already exist (create it first via the regular
    /// create-video-season call, then pass the resulting id here).
    pub season_id: Option<String>,
    /// create (or reuse, if a season with this number already exists) a
    /// season under the group's series and assign this video to it -
    /// resolved server-side under this call's own review permission, so
    /// the uploader never needs the admin-gated create_video_season route.
    /// ignored if `season_id` is set.
    pub new_season: Option<NewSeasonPatch>,
    /// "series" | "movie" | "clip" - only meaningful for a standalone
    /// (non-series) group; reclassifying a video already in a series
    /// group goes through `move_video` instead, since that also handles
    /// detaching series_id/season_id.
    pub content_type: Option<String>,
}

/// request to patch a group's metadata and mark it reviewed in one call.
/// `series_title`/`series_description` only apply when the group has a
/// `series_id` (ignored for standalone-video groups - patch the video's
/// own title via `videos` instead).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PatchVideoGroupReviewRequest {
    pub group_key: String,
    pub session_id: String,
    pub series_title: Option<String>,
    pub series_description: Option<String>,
    /// per-video patches applied before the group is marked reviewed
    pub videos: Option<Vec<VideoReviewPatch>>,
}

/// request to move a single video to a different series/season (e.g. fix
/// a misdetected series during review). `to_series_id`/`to_season_id` of
/// `None` detaches the video into a standalone group.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MoveVideoReviewRequest {
    pub video_id: String,
    pub to_series_id: Option<String>,
    pub to_season_id: Option<String>,
    /// only used when `to_series_id` is `None` (detaching to standalone) -
    /// "movie" or "clip"; defaults to "movie" if omitted. ignored when
    /// moving into a series (content_type is forced to "series" then).
    pub content_type: Option<String>,
    /// create (or reuse, if a series with this title already exists) a
    /// series and move the video into it - resolved server-side under
    /// this call's own review permission, so the uploader never needs the
    /// admin-gated create_video_series route. takes precedence over
    /// `to_series_id` when both are set.
    pub new_series_title: Option<String>,
    /// create (or reuse) a season under the resolved series (existing or
    /// newly created) and move the video into it. takes precedence over
    /// `to_season_id` when both are set.
    pub new_season: Option<NewSeasonPatch>,
}

/// request to check if a specific video's review group has pending
/// (unreviewed) import blobs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoPendingRequest {
    pub video_id: String,
}

/// response indicating whether a video's review group has pending blobs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoPendingResponse {
    /// the session_id of the most recent pending session for this group, if any
    pub session_id: Option<String>,
    /// total count of unreviewed blobs for this group across all sessions
    pub pending_count: i64,
    /// created_at of the most recent pending session, if any
    pub created_at: Option<i64>,
}

/// generic success response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoImportReviewOk {
    pub ok: bool,
}
