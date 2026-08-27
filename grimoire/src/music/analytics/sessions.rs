//! playback session tracking
//!
//! tracks user progress through entities (albums, playlists, artists, genres, songs,
//! videos, shuffles, radio). each session represents a single "playing/watching X"
//! that gets updated as items are played. `items` is an ordered list of
//! `{entity_type: "song"|"video", entity_id}` objects, which lets one session
//! represent a pure-song, pure-video, or interleaved mixed queue-play
//! (supersedes the song-only `listen_sessionz`/`song_ids` shape).

use super::feed_events::upsert_session_feed_event;
use crate::database;
use crate::error::ErrorDetail;
use crate::GrimoireResponse;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tracing;
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

/// session type — what kind of entity is being played.
///
/// entity_id for a taxon session points at `taxonz.id`, which can be any
/// kind (genre, label, mood, era, region, ...). `mixed` covers sessions
/// whose `items` contain both songs and videos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackSessionType {
    Song,
    Album,
    Artist,
    Taxon,
    Playlist,
    Shuffle,
    Radio,
    Video,
    VideoSeries,
    VideoSeason,
    Mixed,
}

impl ZodSchemaTrait for PlaybackSessionType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("song"), z.literal("album"), z.literal("artist"), z.literal("taxon"), z.literal("playlist"), z.literal("shuffle"), z.literal("radio"), z.literal("video"), z.literal("video_series"), z.literal("video_season"), z.literal("mixed")])"#.to_string()
    }
}

impl std::fmt::Display for PlaybackSessionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Song => write!(f, "song"),
            Self::Album => write!(f, "album"),
            Self::Artist => write!(f, "artist"),
            Self::Taxon => write!(f, "taxon"),
            Self::Playlist => write!(f, "playlist"),
            Self::Shuffle => write!(f, "shuffle"),
            Self::Radio => write!(f, "radio"),
            Self::Video => write!(f, "video"),
            Self::VideoSeries => write!(f, "video_series"),
            Self::VideoSeason => write!(f, "video_season"),
            Self::Mixed => write!(f, "mixed"),
        }
    }
}

impl PlaybackSessionType {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "song" => Self::Song,
            "album" => Self::Album,
            "artist" => Self::Artist,
            // accept legacy "genre" string from cached payloads for backward compatibility
            "taxon" | "genre" => Self::Taxon,
            "playlist" => Self::Playlist,
            "shuffle" => Self::Shuffle,
            "radio" => Self::Radio,
            "video" => Self::Video,
            "video_series" => Self::VideoSeries,
            "video_season" => Self::VideoSeason,
            "mixed" => Self::Mixed,
            _ => Self::Song,
        }
    }
}

/// session lifecycle status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackSessionStatus {
    Active,
    Paused,
    Completed,
    Abandoned,
}

impl ZodSchemaTrait for PlaybackSessionStatus {
    fn zod_schema() -> String {
        r#"z.union([z.literal("active"), z.literal("paused"), z.literal("completed"), z.literal("abandoned")])"#.to_string()
    }
}

impl std::fmt::Display for PlaybackSessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Paused => write!(f, "paused"),
            Self::Completed => write!(f, "completed"),
            Self::Abandoned => write!(f, "abandoned"),
        }
    }
}

impl PlaybackSessionStatus {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "active" => Self::Active,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "abandoned" => Self::Abandoned,
            _ => Self::Active,
        }
    }
}

/// a single item within a playback session's queue - a song or video
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, Eq)]
pub struct SessionItem {
    /// "song" or "video"
    pub entity_type: String,
    pub entity_id: String,
}

/// a playback session record
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaybackSession {
    pub id: String,
    pub user_id: String,
    pub session_type: PlaybackSessionType,
    pub entity_id: Option<String>,
    pub label: String,
    pub items: Vec<SessionItem>,
    pub total_items: i64,
    pub items_completed: i64,
    pub total_duration_ms: i64,
    pub played_duration_ms: i64,
    pub current_item_index: i64,
    pub current_item_position_ms: i64,
    pub status: PlaybackSessionStatus,
    pub created_at: i64,
    pub updated_at: i64,
    /// username (resolved from user_id, for feed display)
    pub username: Option<String>,
    /// progress percentage (0-100)
    pub progress_percent: Option<f64>,
}

/// request to create a new playback session
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreatePlaybackSessionRequest {
    pub session_type: String,
    pub entity_id: Option<String>,
    pub label: String,
    pub items: Vec<SessionItem>,
    pub total_items: i64,
    pub total_duration_ms: i64,
}

/// request to update session progress (item-based, not time-based)
/// progress is the index of the next item to play (0 = haven't started, total_items = done)
/// progress only ever moves forward (server enforces this with MAX)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdatePlaybackSessionProgressRequest {
    /// the session id to update
    pub id: String,
    /// the next item index (after completing/skipping the current item)
    /// e.g., finishing item 0 means progress = 1
    pub progress: i64,
}

/// request to list playback sessions
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPlaybackSessionsRequest {
    pub user_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// response with playback sessions and total count
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPlaybackSessionsResponse {
    pub items: Vec<PlaybackSession>,
    pub total: i64,
}

/// request for getting a playback session by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetPlaybackSessionRequest {
    pub id: String,
}

/// request for deleting a playback session
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeletePlaybackSessionRequest {
    pub id: String,
}

/// request for updating playback session status
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdatePlaybackSessionStatusRequest {
    pub id: String,
    pub status: String,
}

/// filter items to only those that actually exist on this server (song items
/// checked against `songz`, video items checked against `videoz`; anything
/// else is dropped). this prevents clients from sending IDs from other
/// servers or invalid IDs. preserves original ordering.
async fn validate_items(pool: &SqlitePool, items: &[SessionItem]) -> Vec<SessionItem> {
    if items.is_empty() {
        tracing::debug!("validate_items: empty input");
        return vec![];
    }

    let song_ids: Vec<String> = items
        .iter()
        .filter(|i| i.entity_type == "song")
        .map(|i| i.entity_id.clone())
        .collect();
    let video_ids: Vec<String> = items
        .iter()
        .filter(|i| i.entity_type == "video")
        .map(|i| i.entity_id.clone())
        .collect();

    let valid_song_ids: std::collections::HashSet<String> = if song_ids.is_empty() {
        Default::default()
    } else {
        let song_ids_json = serde_json::to_string(&song_ids).unwrap_or_else(|_| "[]".to_string());
        let result: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar!(
            r#"
            SELECT s.id as "id!"
            FROM songz s
            INNER JOIN json_each(?) je ON s.id = je.value
            "#,
            song_ids_json,
        )
        .fetch_all(pool)
        .await;
        match result {
            Ok(ids) => ids.into_iter().collect(),
            Err(e) => {
                tracing::warn!(error = %e, "validate_items: song id DB query failed");
                song_ids.iter().cloned().collect()
            }
        }
    };

    let valid_video_ids: std::collections::HashSet<String> = if video_ids.is_empty() {
        Default::default()
    } else {
        let video_ids_json =
            serde_json::to_string(&video_ids).unwrap_or_else(|_| "[]".to_string());
        let result: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar!(
            r#"
            SELECT v.id as "id!"
            FROM videoz v
            INNER JOIN json_each(?) je ON v.id = je.value
            "#,
            video_ids_json,
        )
        .fetch_all(pool)
        .await;
        match result {
            Ok(ids) => ids.into_iter().collect(),
            Err(e) => {
                tracing::warn!(error = %e, "validate_items: video id DB query failed");
                video_ids.iter().cloned().collect()
            }
        }
    };

    tracing::debug!(
        input_count = items.len(),
        valid_songs = valid_song_ids.len(),
        valid_videos = valid_video_ids.len(),
        "validate_items: found valid IDs"
    );

    items
        .iter()
        .filter(|i| match i.entity_type.as_str() {
            "song" => valid_song_ids.contains(&i.entity_id),
            "video" => valid_video_ids.contains(&i.entity_id),
            _ => false,
        })
        .cloned()
        .collect()
}

/// serialize a list of items to the `items` JSON column shape:
/// `[{"entity_type": "song", "entity_id": "..."}, ...]`
fn items_to_json(items: &[SessionItem]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}

/// parse the `items` JSON column back into a list of items
fn items_from_json(json_str: &str) -> Vec<SessionItem> {
    serde_json::from_str(json_str).unwrap_or_default()
}

/// create a new playback session
pub async fn create_playback_session(
    user_id: &str,
    req: &CreatePlaybackSessionRequest,
) -> GrimoireResponse<PlaybackSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let session_type = &req.session_type;
    let entity_id = req.entity_id.as_deref();
    let label = &req.label;

    // radio sessions are station-level only — no per-track tracking, so we
    // skip item validation and accept an empty items list.
    let is_radio = session_type == "radio";

    // validate items — only keep entities that exist on this server
    let validated_items = if is_radio {
        Vec::new()
    } else {
        let v = validate_items(&pool, &req.items).await;
        if v.is_empty() {
            return GrimoireResponse::failure(
                "no valid items found on this server",
                vec![crate::error::ErrorDetail::new(
                    "invalid_items",
                    "invalid items",
                    format!(
                        "none of the {} provided items exist on this server",
                        req.items.len()
                    ),
                )],
            );
        }
        v
    };

    let items_json = items_to_json(&validated_items);
    let total_items = validated_items.len() as i64;
    let total_duration_ms = req.total_duration_ms;

    let result = sqlx::query!(
        r#"
        INSERT INTO playback_sessionz (user_id, session_type, entity_id, label, items, total_items, total_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id as "id!", created_at as "created_at!: i64", updated_at as "updated_at!: i64"
        "#,
        user_id,
        session_type,
        entity_id,
        label,
        items_json,
        total_items,
        total_duration_ms,
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(row) => {
            let session = PlaybackSession {
                id: row.id.clone(),
                user_id: user_id.to_string(),
                session_type: PlaybackSessionType::from_str(session_type),
                entity_id: req.entity_id.clone(),
                label: label.clone(),
                items: validated_items,
                total_items,
                items_completed: 0,
                total_duration_ms,
                played_duration_ms: 0,
                current_item_index: 0,
                current_item_position_ms: 0,
                status: PlaybackSessionStatus::Active,
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: None,
                progress_percent: Some(0.0),
            };
            // create feed event
            let feed_resp = upsert_session_feed_event(&row.id).await;
            if !feed_resp.success {
                tracing::warn!(
                    session_id = %row.id,
                    session_type = %req.session_type,
                    message = %feed_resp.message,
                    errors = ?feed_resp.errors,
                    "failed to upsert session feed event on create"
                );
            }
            GrimoireResponse::success("playback session created", session)
        }
        Err(e) => GrimoireResponse::failure("failed to create playback session", vec![e.into()]),
    }
}

/// update session progress (item-based)
/// progress only moves forward - server enforces this with MAX
/// when progress >= total_items, the trigger auto-marks session as completed
/// rejects updates for completed sessions (prevents feed timestamp churn)
pub async fn update_playback_session_progress(
    session_id: &str,
    user_id: &str,
    req: &UpdatePlaybackSessionProgressRequest,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // check current state - skip update if no actual progress change or session is completed
    let current = sqlx::query!(
        r#"
        SELECT items_completed, status
        FROM playback_sessionz
        WHERE id = ? AND user_id = ?
        "#,
        session_id,
        user_id,
    )
    .fetch_optional(&pool)
    .await;

    match current {
        Ok(Some(row)) => {
            // reject updates for completed sessions
            if row.status == "completed" {
                return GrimoireResponse::success_unit(
                    "session already completed, progress ignored",
                );
            }
            // skip if no actual progress (prevents updated_at churn)
            if req.progress <= row.items_completed {
                return GrimoireResponse::success_unit("no progress change");
            }
        }
        Ok(None) => {
            return GrimoireResponse::failure(
                "playback session not found",
                vec![ErrorDetail::new(
                    "session_not_found",
                    "Session Not Found",
                    "the playback session does not exist or has been deleted",
                )],
            );
        }
        Err(e) => {
            return GrimoireResponse::failure("failed to check session state", vec![e.into()]);
        }
    }

    // progress only moves forward (MAX ensures this)
    // items_completed tracks the same value for the auto-complete trigger
    // current_item_index = progress - 1 (the last item we finished), clamped to 0
    let result = sqlx::query!(
        r#"
        UPDATE playback_sessionz
        SET items_completed = MAX(items_completed, ?),
            current_item_index = MAX(current_item_index, MAX(0, ? - 1)),
            updated_at = unixepoch()
        WHERE id = ? AND user_id = ?
        "#,
        req.progress,
        req.progress,
        session_id,
        user_id,
    )
    .execute(&pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // update feed event
            let feed_resp = upsert_session_feed_event(session_id).await;
            if !feed_resp.success {
                tracing::warn!(
                    %session_id,
                    message = %feed_resp.message,
                    errors = ?feed_resp.errors,
                    "failed to upsert session feed event on progress update"
                );
            }
            GrimoireResponse::success_unit("session progress updated")
        }
        Ok(_) => GrimoireResponse::failure(
            "playback session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the playback session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session progress", vec![e.into()]),
    }
}

/// update session status (complete, abandon, pause)
pub async fn update_playback_session_status(
    session_id: &str,
    user_id: &str,
    status: &str,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let result = sqlx::query!(
        r#"
        UPDATE playback_sessionz
        SET status = ?,
            updated_at = unixepoch()
        WHERE id = ? AND user_id = ?
        "#,
        status,
        session_id,
        user_id,
    )
    .execute(&pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // update feed event
            let feed_resp = upsert_session_feed_event(session_id).await;
            if !feed_resp.success {
                tracing::warn!(
                    %session_id,
                    message = %feed_resp.message,
                    errors = ?feed_resp.errors,
                    "failed to upsert session feed event on status update"
                );
            }
            GrimoireResponse::success_unit("session status updated")
        }
        Ok(_) => GrimoireResponse::failure(
            "playback session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the playback session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session status", vec![e.into()]),
    }
}

/// request to update session items (queue sync)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdatePlaybackSessionItemsRequest {
    /// the session id to update
    pub id: String,
    /// updated list of items (replaces the entire list)
    pub items: Vec<SessionItem>,
    /// updated label (smart label computed by client)
    pub label: String,
    /// updated total items count
    pub total_items: i64,
    /// updated total duration in milliseconds
    pub total_duration_ms: i64,
}

/// update session items — syncs the session's item list with the current queue
///
/// called when the user adds or removes songs/videos from the queue while a
/// session is active. ownership-checked: only the session owner can update items.
pub async fn update_playback_session_items(
    session_id: &str,
    user_id: &str,
    req: &UpdatePlaybackSessionItemsRequest,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // validate items — only keep entities that exist on this server
    let validated_items = validate_items(&pool, &req.items).await;
    let items_json = items_to_json(&validated_items);
    let validated_total_items = validated_items.len() as i64;

    let result = sqlx::query!(
        r#"
        UPDATE playback_sessionz
        SET items = ?,
            label = ?,
            total_items = ?,
            total_duration_ms = ?,
            updated_at = unixepoch()
        WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')
        "#,
        items_json,
        req.label,
        validated_total_items,
        req.total_duration_ms,
        session_id,
        user_id,
    )
    .execute(&pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // update feed event
            let feed_resp = upsert_session_feed_event(session_id).await;
            if !feed_resp.success {
                tracing::warn!(
                    %session_id,
                    message = %feed_resp.message,
                    errors = ?feed_resp.errors,
                    "failed to upsert session feed event on items update"
                );
            }
            GrimoireResponse::success_unit("session items updated")
        }
        Ok(_) => GrimoireResponse::failure(
            "playback session not found or not active",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the playback session does not exist, has been deleted, or is not active",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session items", vec![e.into()]),
    }
}

/// get a single playback session by id (readable by any authenticated user)
pub async fn get_playback_session(session_id: &str) -> GrimoireResponse<PlaybackSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let result = sqlx::query!(
        r#"
        SELECT
            ps.id as "id!", ps.user_id, ps.session_type, ps.entity_id, ps.label,
            ps.items, ps.total_items, ps.items_completed,
            ps.total_duration_ms, ps.played_duration_ms,
            ps.current_item_index, ps.current_item_position_ms,
            ps.status, ps.created_at, ps.updated_at,
            (SELECT u.username FROM user_accountz u WHERE u.id = ps.user_id) as "username?"
        FROM playback_sessionz ps
        WHERE ps.id = ?
        "#,
        session_id,
    )
    .fetch_optional(&pool)
    .await;

    match result {
        Ok(Some(row)) => {
            let items = items_from_json(&row.items);

            let progress = if row.total_items > 0 {
                Some((row.items_completed as f64 / row.total_items as f64 * 100.0).min(100.0))
            } else {
                Some(0.0)
            };

            let session = PlaybackSession {
                id: row.id,
                user_id: row.user_id,
                session_type: PlaybackSessionType::from_str(&row.session_type),
                entity_id: row.entity_id,
                label: row.label,
                items,
                total_items: row.total_items,
                items_completed: row.items_completed,
                total_duration_ms: row.total_duration_ms,
                played_duration_ms: row.played_duration_ms,
                current_item_index: row.current_item_index,
                current_item_position_ms: row.current_item_position_ms,
                status: PlaybackSessionStatus::from_str(&row.status),
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: row.username,
                progress_percent: progress,
            };

            GrimoireResponse::success("playback session found", session)
        }
        Ok(None) => GrimoireResponse::failure(
            "playback session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the playback session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to get playback session", vec![e.into()]),
    }
}

/// list playback sessions with optional filters
pub async fn list_playback_sessions(
    req: &ListPlaybackSessionsRequest,
) -> GrimoireResponse<(Vec<PlaybackSession>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);
    let user_id = req.user_id.as_deref();
    let status = req.status.as_deref();

    // single query with optional filters using NULL parameter trick
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM playback_sessionz
        WHERE (? IS NULL OR user_id = ?)
          AND (? IS NULL OR status = ?)
        "#,
        user_id,
        user_id,
        status,
        status,
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let rows = sqlx::query!(
        r#"
        SELECT
            ps.id as "id!", ps.user_id, ps.session_type, ps.entity_id, ps.label,
            ps.items, ps.total_items, ps.items_completed,
            ps.total_duration_ms, ps.played_duration_ms,
            ps.current_item_index, ps.current_item_position_ms,
            ps.status, ps.created_at, ps.updated_at,
            (SELECT u.username FROM user_accountz u WHERE u.id = ps.user_id) as "username?"
        FROM playback_sessionz ps
        WHERE (? IS NULL OR ps.user_id = ?)
          AND (? IS NULL OR ps.status = ?)
        ORDER BY ps.updated_at DESC
        LIMIT ? OFFSET ?
        "#,
        user_id,
        user_id,
        status,
        status,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to list playback sessions", vec![e.into()])
        }
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let items = items_from_json(&row.items);

            let progress = if row.total_items > 0 {
                Some((row.items_completed as f64 / row.total_items as f64 * 100.0).min(100.0))
            } else {
                Some(0.0)
            };

            PlaybackSession {
                id: row.id,
                user_id: row.user_id,
                session_type: PlaybackSessionType::from_str(&row.session_type),
                entity_id: row.entity_id,
                label: row.label,
                items,
                total_items: row.total_items,
                items_completed: row.items_completed,
                total_duration_ms: row.total_duration_ms,
                played_duration_ms: row.played_duration_ms,
                current_item_index: row.current_item_index,
                current_item_position_ms: row.current_item_position_ms,
                status: PlaybackSessionStatus::from_str(&row.status),
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: row.username,
                progress_percent: progress,
            }
        })
        .collect();

    GrimoireResponse::success("playback sessions retrieved", (items, count))
}

/// delete a playback session
///
/// only the owner can delete their session (ownership check done in handler).
pub async fn delete_playback_session(session_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let result = sqlx::query("DELETE FROM playback_sessionz WHERE id = ?")
        .bind(session_id)
        .execute(&pool)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => GrimoireResponse::success_unit("session deleted"),
        Ok(_) => GrimoireResponse::failure("session not found", vec![]),
        Err(e) => GrimoireResponse::failure("failed to delete session", vec![e.into()]),
    }
}

