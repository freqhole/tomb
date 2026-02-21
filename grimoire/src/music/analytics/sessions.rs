//! listen session tracking
//!
//! tracks user progress through entities (albums, playlists, artists, genres, songs, shuffles).
//! each session represents a single "listening to X" that gets updated as songs are played.

use crate::database;
use crate::error::ErrorDetail;
use crate::GrimoireResponse;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

/// session type — what kind of entity is being listened to
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListenSessionType {
    Song,
    Album,
    Artist,
    Genre,
    Playlist,
    Shuffle,
}

impl ZodSchemaTrait for ListenSessionType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("song"), z.literal("album"), z.literal("artist"), z.literal("genre"), z.literal("playlist"), z.literal("shuffle")])"#.to_string()
    }
}

impl std::fmt::Display for ListenSessionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Song => write!(f, "song"),
            Self::Album => write!(f, "album"),
            Self::Artist => write!(f, "artist"),
            Self::Genre => write!(f, "genre"),
            Self::Playlist => write!(f, "playlist"),
            Self::Shuffle => write!(f, "shuffle"),
        }
    }
}

impl ListenSessionType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "song" => Self::Song,
            "album" => Self::Album,
            "artist" => Self::Artist,
            "genre" => Self::Genre,
            "playlist" => Self::Playlist,
            "shuffle" => Self::Shuffle,
            _ => Self::Song,
        }
    }
}

/// session lifecycle status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListenSessionStatus {
    Active,
    Paused,
    Completed,
    Abandoned,
}

impl ZodSchemaTrait for ListenSessionStatus {
    fn zod_schema() -> String {
        r#"z.union([z.literal("active"), z.literal("paused"), z.literal("completed"), z.literal("abandoned")])"#.to_string()
    }
}

impl std::fmt::Display for ListenSessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Paused => write!(f, "paused"),
            Self::Completed => write!(f, "completed"),
            Self::Abandoned => write!(f, "abandoned"),
        }
    }
}

impl ListenSessionStatus {
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

/// a listen session record
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListenSession {
    pub id: String,
    pub user_id: String,
    pub session_type: ListenSessionType,
    pub entity_id: Option<String>,
    pub label: String,
    pub song_ids: Vec<String>,
    pub total_songs: i64,
    pub songs_completed: i64,
    pub total_duration_ms: i64,
    pub listened_duration_ms: i64,
    pub current_song_index: i64,
    pub current_song_position_ms: i64,
    pub status: ListenSessionStatus,
    pub created_at: i64,
    pub updated_at: i64,
    /// username (resolved from user_id, for feed display)
    pub username: Option<String>,
    /// progress percentage (0-100)
    pub progress_percent: Option<f64>,
}

/// request to create a new listen session
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateListenSessionRequest {
    pub session_type: String,
    pub entity_id: Option<String>,
    pub label: String,
    pub song_ids: Vec<String>,
    pub total_songs: i64,
    pub total_duration_ms: i64,
}

/// request to update session progress (song-based, not time-based)
/// progress is the index of the next song to play (0 = haven't started, total_songs = done)
/// progress only ever moves forward (server enforces this with MAX)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateListenSessionProgressRequest {
    /// the next song index (after completing/skipping the current song)
    /// e.g., finishing song 0 means progress = 1
    pub progress: i64,
}

/// request to list listen sessions
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListListenSessionsRequest {
    pub user_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// response with listen sessions and total count
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListListenSessionsResponse {
    pub items: Vec<ListenSession>,
    pub total: i64,
}

/// filter song_ids to only those that actually exist in the songs table.
/// this prevents clients from sending song IDs from other servers or invalid IDs.
/// uses json_each() so the query works with a single bind parameter and the query! macro.
async fn validate_song_ids(pool: &SqlitePool, song_ids: &[String]) -> Vec<String> {
    if song_ids.is_empty() {
        return vec![];
    }

    let song_ids_json = serde_json::to_string(song_ids).unwrap_or_else(|_| "[]".to_string());

    let valid_ids: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar!(
        r#"
        SELECT s.id as "id!"
        FROM songz s
        INNER JOIN json_each(?) je ON s.id = je.value
        "#,
        song_ids_json,
    )
    .fetch_all(pool)
    .await;

    match valid_ids {
        Ok(ids) => {
            // preserve original ordering
            let valid_set: std::collections::HashSet<String> = ids.into_iter().collect();
            song_ids
                .iter()
                .filter(|id| valid_set.contains(id.as_str()))
                .cloned()
                .collect()
        }
        Err(e) => {
            eprintln!("failed to validate song_ids: {e}");
            // on error, keep the original IDs rather than losing data
            song_ids.to_vec()
        }
    }
}

/// create a new listen session
pub async fn create_listen_session(
    user_id: &str,
    req: &CreateListenSessionRequest,
) -> GrimoireResponse<ListenSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let session_type = &req.session_type;
    let entity_id = req.entity_id.as_deref();
    let label = &req.label;

    // validate song_ids — only keep IDs that exist on this server
    let validated_song_ids = validate_song_ids(&pool, &req.song_ids).await;
    if validated_song_ids.is_empty() {
        return GrimoireResponse::failure("no valid song IDs found on this server", vec![]);
    }

    let song_ids_json =
        serde_json::to_string(&validated_song_ids).unwrap_or_else(|_| "[]".to_string());
    let total_songs = validated_song_ids.len() as i64;
    let total_duration_ms = req.total_duration_ms;

    let result = sqlx::query!(
        r#"
        INSERT INTO listen_sessionz (user_id, session_type, entity_id, label, song_ids, total_songs, total_duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id as "id!", created_at as "created_at!: i64", updated_at as "updated_at!: i64"
        "#,
        user_id,
        session_type,
        entity_id,
        label,
        song_ids_json,
        total_songs,
        total_duration_ms,
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(row) => {
            let session = ListenSession {
                id: row.id,
                user_id: user_id.to_string(),
                session_type: ListenSessionType::from_str(session_type),
                entity_id: req.entity_id.clone(),
                label: label.clone(),
                song_ids: validated_song_ids,
                total_songs,
                songs_completed: 0,
                total_duration_ms,
                listened_duration_ms: 0,
                current_song_index: 0,
                current_song_position_ms: 0,
                status: ListenSessionStatus::Active,
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: None,
                progress_percent: Some(0.0),
            };
            GrimoireResponse::success("listen session created", session)
        }
        Err(e) => GrimoireResponse::failure("failed to create listen session", vec![e.into()]),
    }
}

/// update session progress (song-based)
/// progress only moves forward - server enforces this with MAX
/// when progress >= total_songs, the trigger auto-marks session as completed
pub async fn update_listen_session_progress(
    session_id: &str,
    user_id: &str,
    req: &UpdateListenSessionProgressRequest,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // progress only moves forward (MAX ensures this)
    // songs_completed tracks the same value for the auto-complete trigger
    // current_song_index = progress - 1 (the last song we finished), clamped to 0
    let result = sqlx::query!(
        r#"
        UPDATE listen_sessionz
        SET songs_completed = MAX(songs_completed, ?),
            current_song_index = MAX(current_song_index, MAX(0, ? - 1)),
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
            GrimoireResponse::success_unit("session progress updated")
        }
        Ok(_) => GrimoireResponse::failure(
            "listen session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the listen session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session progress", vec![e.into()]),
    }
}

/// update session status (complete, abandon, pause)
pub async fn update_listen_session_status(
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
        UPDATE listen_sessionz
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
        Ok(r) if r.rows_affected() > 0 => GrimoireResponse::success_unit("session status updated"),
        Ok(_) => GrimoireResponse::failure(
            "listen session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the listen session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session status", vec![e.into()]),
    }
}

/// request to update session songs (queue sync)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateListenSessionSongsRequest {
    /// updated list of song ids (replaces the entire list)
    pub song_ids: Vec<String>,
    /// updated label (smart label computed by client)
    pub label: String,
    /// updated total songs count
    pub total_songs: i64,
    /// updated total duration in milliseconds
    pub total_duration_ms: i64,
}

/// update session songs — syncs the session's song list with the current queue
///
/// called when the user adds or removes songs from the queue while a session
/// is active. ownership-checked: only the session owner can update songs.
pub async fn update_listen_session_songs(
    session_id: &str,
    user_id: &str,
    req: &UpdateListenSessionSongsRequest,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // validate song_ids — only keep IDs that exist on this server
    let validated_song_ids = validate_song_ids(&pool, &req.song_ids).await;
    let song_ids_json =
        serde_json::to_string(&validated_song_ids).unwrap_or_else(|_| "[]".to_string());
    let validated_total_songs = validated_song_ids.len() as i64;

    let result = sqlx::query!(
        r#"
        UPDATE listen_sessionz
        SET song_ids = ?,
            label = ?,
            total_songs = ?,
            total_duration_ms = ?,
            updated_at = unixepoch()
        WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')
        "#,
        song_ids_json,
        req.label,
        validated_total_songs,
        req.total_duration_ms,
        session_id,
        user_id,
    )
    .execute(&pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => GrimoireResponse::success_unit("session songs updated"),
        Ok(_) => GrimoireResponse::failure(
            "listen session not found or not active",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the listen session does not exist, has been deleted, or is not active",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to update session songs", vec![e.into()]),
    }
}

/// get a single listen session by id (readable by any authenticated user)
pub async fn get_listen_session(session_id: &str) -> GrimoireResponse<ListenSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let result = sqlx::query!(
        r#"
        SELECT
            ls.id as "id!", ls.user_id, ls.session_type, ls.entity_id, ls.label,
            ls.song_ids, ls.total_songs, ls.songs_completed,
            ls.total_duration_ms, ls.listened_duration_ms,
            ls.current_song_index, ls.current_song_position_ms,
            ls.status, ls.created_at, ls.updated_at,
            (SELECT u.username FROM user_accountz u WHERE u.id = ls.user_id) as "username?"
        FROM listen_sessionz ls
        WHERE ls.id = ?
        "#,
        session_id,
    )
    .fetch_optional(&pool)
    .await;

    match result {
        Ok(Some(row)) => {
            let song_ids: Vec<String> = serde_json::from_str(&row.song_ids).unwrap_or_default();

            let progress = if row.total_songs > 0 {
                Some((row.songs_completed as f64 / row.total_songs as f64 * 100.0).min(100.0))
            } else {
                Some(0.0)
            };

            let session = ListenSession {
                id: row.id,
                user_id: row.user_id,
                session_type: ListenSessionType::from_str(&row.session_type),
                entity_id: row.entity_id,
                label: row.label,
                song_ids,
                total_songs: row.total_songs,
                songs_completed: row.songs_completed,
                total_duration_ms: row.total_duration_ms,
                listened_duration_ms: row.listened_duration_ms,
                current_song_index: row.current_song_index,
                current_song_position_ms: row.current_song_position_ms,
                status: ListenSessionStatus::from_str(&row.status),
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: row.username,
                progress_percent: progress,
            };

            GrimoireResponse::success("listen session found", session)
        }
        Ok(None) => GrimoireResponse::failure(
            "listen session not found",
            vec![ErrorDetail::new(
                "session_not_found",
                "Session Not Found",
                "the listen session does not exist or has been deleted",
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to get listen session", vec![e.into()]),
    }
}

/// list listen sessions with optional filters
pub async fn list_listen_sessions(
    req: &ListListenSessionsRequest,
) -> GrimoireResponse<(Vec<ListenSession>, i64)> {
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
        FROM listen_sessionz
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
            ls.id as "id!", ls.user_id, ls.session_type, ls.entity_id, ls.label,
            ls.song_ids, ls.total_songs, ls.songs_completed,
            ls.total_duration_ms, ls.listened_duration_ms,
            ls.current_song_index, ls.current_song_position_ms,
            ls.status, ls.created_at, ls.updated_at,
            (SELECT u.username FROM user_accountz u WHERE u.id = ls.user_id) as "username?"
        FROM listen_sessionz ls
        WHERE (? IS NULL OR ls.user_id = ?)
          AND (? IS NULL OR ls.status = ?)
        ORDER BY ls.updated_at DESC
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
            return GrimoireResponse::failure("failed to list listen sessions", vec![e.into()])
        }
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let song_ids: Vec<String> = serde_json::from_str(&row.song_ids).unwrap_or_default();

            let progress = if row.total_songs > 0 {
                Some((row.songs_completed as f64 / row.total_songs as f64 * 100.0).min(100.0))
            } else {
                Some(0.0)
            };

            ListenSession {
                id: row.id,
                user_id: row.user_id,
                session_type: ListenSessionType::from_str(&row.session_type),
                entity_id: row.entity_id,
                label: row.label,
                song_ids,
                total_songs: row.total_songs,
                songs_completed: row.songs_completed,
                total_duration_ms: row.total_duration_ms,
                listened_duration_ms: row.listened_duration_ms,
                current_song_index: row.current_song_index,
                current_song_position_ms: row.current_song_position_ms,
                status: ListenSessionStatus::from_str(&row.status),
                created_at: row.created_at,
                updated_at: row.updated_at,
                username: row.username,
                progress_percent: progress,
            }
        })
        .collect();

    GrimoireResponse::success("listen sessions retrieved", (items, count))
}

/// delete a listen session
///
/// admins can delete any session, other users can only delete their own.
pub async fn delete_listen_session(
    session_id: &str,
    requesting_user_id: &str,
    is_admin: bool,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // check ownership if not admin
    if !is_admin {
        let owner =
            sqlx::query_scalar::<_, String>("SELECT user_id FROM listen_sessionz WHERE id = ?")
                .bind(session_id)
                .fetch_optional(&pool)
                .await;

        match owner {
            Ok(Some(uid)) if uid == requesting_user_id => {} // allowed
            Ok(Some(_)) => {
                return GrimoireResponse::failure("not authorized to delete this session", vec![])
            }
            Ok(None) => return GrimoireResponse::failure("session not found", vec![]),
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to check session ownership",
                    vec![e.into()],
                )
            }
        }
    }

    let result = sqlx::query("DELETE FROM listen_sessionz WHERE id = ?")
        .bind(session_id)
        .execute(&pool)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => GrimoireResponse::success_unit("session deleted"),
        Ok(_) => GrimoireResponse::failure("session not found", vec![]),
        Err(e) => GrimoireResponse::failure("failed to delete session", vec![e.into()]),
    }
}
