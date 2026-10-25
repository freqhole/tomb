//! generalized, entity-type-agnostic playback/resume progress
//!
//! `playback_progressz` is a single, cross-domain table: any
//! content-bearing `TaggableEntity` variant (today: video, song) can have
//! a caller's resume position tracked here, plus the two video-only
//! aggregate types (`video_series`/`video_season`) for a season/series-
//! level marker. previously this lived under
//! `crate::video::crud::playback_progressz` (only video ever wrote to
//! it), but it was always designed to be domain-agnostic from day one -
//! see migration 059's own doc comment ("`position_fraction` is the one
//! universal progress value every domain populates"). this mirrors
//! `crate::playlists`'s identical move (`playlist_itemz` was video-only
//! too, until songs needed it) - same shape of problem, same fix.
//!
//! `blake3` (migration 099) is a content-hash identity alongside the
//! existing (user_id, entity_type, entity_id) key: two different
//! databases (a remote peer vs. a locally-synced copy of the same file,
//! or two different remotes) never share entity_ids for "the same"
//! video/song, but DO share the underlying file's blake3 - letting a
//! client correlate progress for the same content across databases by
//! blake3 instead. only meaningful for a single piece of content
//! (video/song); the two aggregate types have no single blake3 and
//! always leave it `None`.

use sea_query::{Expr, Iden, Order, Query, SqliteQueryBuilder};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::entities::TaggableEntity;
use crate::error::ErrorDetail;
use crate::music::analytics::feed_events::create_video_watch_feed_event;
use crate::response::GrimoireResponse;

/// column identifiers for `playback_progressz`, used by
/// `list_playback_progress_by_blake3`'s sea_query-built dynamic IN-list -
/// mirrors `VideozCol`/`VideoSeriezCol` in video/crud/query.rs.
#[derive(Iden)]
enum ProgressCol {
    #[iden = "playback_progressz"]
    Table,
    #[iden = "user_id"]
    UserId,
    #[iden = "entity_type"]
    EntityType,
    #[iden = "entity_id"]
    EntityId,
    #[iden = "position_fraction"]
    PositionFraction,
    #[iden = "position_seconds"]
    PositionSeconds,
    #[iden = "duration_seconds"]
    DurationSeconds,
    #[iden = "position_locator"]
    PositionLocator,
    #[iden = "completed_at"]
    CompletedAt,
    #[iden = "updated_at"]
    UpdatedAt,
    #[iden = "blake3"]
    Blake3,
}

/// bind a sea_query value list onto a sqlx query in declaration order -
/// mirrors the identical helper in video/crud/query.rs /
/// music/crud/query.rs (each dynamic-query file keeps its own small copy
/// rather than sharing one, per this codebase's existing convention).
fn bind_values<'q, O>(
    mut q: sqlx::query::QueryAs<'q, sqlx::Sqlite, O, sqlx::sqlite::SqliteArguments<'q>>,
    values: sea_query::Values,
) -> sqlx::query::QueryAs<'q, sqlx::Sqlite, O, sqlx::sqlite::SqliteArguments<'q>> {
    for v in values.0 {
        match v {
            sea_query::Value::String(Some(s)) => {
                q = q.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                q = q.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                q = q.bind(i as i64);
            }
            _ => {}
        }
    }
    q
}

/// position_fraction at or above this counts as "watched" for feed purposes,
/// mirroring the ~90% completion heuristic used elsewhere for plays.
const WATCHED_THRESHOLD: f64 = 0.9;

/// a single playback progress row
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct PlaybackProgress {
    pub user_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub position_fraction: f64,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub position_locator: Option<String>,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
    /// see this module's own doc comment - `None` for `video_series`/
    /// `video_season` (aggregates, no single piece of content), and for a
    /// `video`/`song` whose own content blake3 somehow isn't resolvable
    /// yet (in practice this should never happen - a row only ever gets
    /// upserted once something has actually been played, by which point
    /// its media blob's blake3 is already denormalized onto its own
    /// entity row - see `resolve_blake3` below).
    pub blake3: Option<String>,
}

/// resolve the content-hash identity for an entity about to have its
/// progress upserted - `None` for anything with no single blake3
/// (the two aggregate types), or if the entity row/its blake3 somehow
/// can't be found (best-effort: a missing blake3 just means this row
/// won't be matchable by content hash, not a failed upsert).
async fn resolve_blake3(
    pool: &sqlx::SqlitePool,
    entity_type: TaggableEntity,
    entity_id: &str,
) -> Option<String> {
    match entity_type {
        TaggableEntity::Video => sqlx::query_scalar!(
            r#"SELECT media_blob_blake3 as "blake3?" FROM videoz WHERE id = ?"#,
            entity_id
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten(),
        TaggableEntity::Song => sqlx::query_scalar!(
            r#"SELECT media_blob_blake3 as "blake3?" FROM songz WHERE id = ?"#,
            entity_id
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten(),
        _ => None,
    }
}

/// create or update a user's playback progress for an entity
#[allow(clippy::too_many_arguments)]
pub async fn upsert_playback_progress(
    user_id: &str,
    entity_type: TaggableEntity,
    entity_id: &str,
    position_fraction: f64,
    position_seconds: Option<f64>,
    duration_seconds: Option<f64>,
    position_locator: Option<String>,
    completed_at: Option<i64>,
) -> GrimoireResponse<PlaybackProgress> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    let blake3 = resolve_blake3(&pool, entity_type, entity_id).await;
    let progress = match sqlx::query_as!(
        PlaybackProgress,
        r#"INSERT INTO playback_progressz (
            user_id, entity_type, entity_id, position_fraction, position_seconds,
            duration_seconds, position_locator, completed_at, blake3
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET
            position_fraction = excluded.position_fraction,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            position_locator = excluded.position_locator,
            completed_at = excluded.completed_at,
            blake3 = excluded.blake3,
            updated_at = unixepoch()
        RETURNING
            user_id as "user_id!",
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            position_fraction as "position_fraction!",
            position_seconds,
            duration_seconds,
            position_locator,
            completed_at,
            updated_at as "updated_at!",
            blake3"#,
        user_id,
        entity_type_str,
        entity_id,
        position_fraction,
        position_seconds,
        duration_seconds,
        position_locator,
        completed_at,
        blake3
    )
    .fetch_one(&pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to save playback progress",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // video-watch completion feed event - video-only (song completion
    // events are handled entirely by music's own, separate, long-standing
    // play-tracking pathway; nothing to wire up here for it).
    if entity_type == TaggableEntity::Video && position_fraction >= WATCHED_THRESHOLD {
        let user_id = user_id.to_string();
        let video_id = entity_id.to_string();
        tokio::spawn(async move {
            let _ = create_video_watch_feed_event(&video_id, &user_id).await;
        });
    }

    GrimoireResponse::success("Playback progress saved successfully", progress)
}

/// get a user's playback progress for a specific entity
pub async fn get_playback_progress(
    user_id: &str,
    entity_type: TaggableEntity,
    entity_id: &str,
) -> GrimoireResponse<Option<PlaybackProgress>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    let progress = match sqlx::query_as!(
        PlaybackProgress,
        r#"SELECT
            user_id as "user_id!",
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            position_fraction as "position_fraction!",
            position_seconds,
            duration_seconds,
            position_locator,
            completed_at,
            updated_at as "updated_at!",
            blake3
         FROM playback_progressz
         WHERE user_id = ? AND entity_type = ? AND entity_id = ?"#,
        user_id,
        entity_type_str,
        entity_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get playback progress",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playback progress retrieved successfully", progress)
}

/// list a user's most recently updated playback progress rows (e.g. for a
/// "continue watching"/"continue listening" rail)
pub async fn list_playback_progress_for_user(
    user_id: &str,
    limit: Option<u32>,
) -> GrimoireResponse<Vec<PlaybackProgress>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let limit = limit.unwrap_or(50).min(500) as i64;
    let progress = match sqlx::query_as!(
        PlaybackProgress,
        r#"SELECT
            user_id as "user_id!",
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            position_fraction as "position_fraction!",
            position_seconds,
            duration_seconds,
            position_locator,
            completed_at,
            updated_at as "updated_at!",
            blake3
         FROM playback_progressz
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?"#,
        user_id,
        limit
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list playback progress",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playback progress retrieved successfully", progress)
}

/// list a user's playback progress rows matching ANY of the given blake3
/// hashes - an exact, precise lookup (not a recency-capped approximation
/// like `list_playback_progress_for_user`), for a caller that already
/// knows exactly which content it cares about (e.g. "every episode in
/// this series") and wants progress for exactly that set, regardless of
/// how recently any of it was touched relative to everything else the
/// user has ever watched/listened to.
pub async fn list_playback_progress_by_blake3(
    user_id: &str,
    blake3_values: &[String],
) -> GrimoireResponse<Vec<PlaybackProgress>> {
    if blake3_values.is_empty() {
        return GrimoireResponse::success("Playback progress retrieved successfully", Vec::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // dynamic IN-list via sea_query, same pattern as video/crud/query.rs's
    // query_videos (Expr::col(...).is_in(...), then build() + bind_values
    // to hand the resulting sql + values to sqlx) rather than a raw
    // sqlx::QueryBuilder string - keeps this consistent with how every
    // other dynamic-length filter in this codebase is built.
    let mut q = Query::select();
    q.columns([
        ProgressCol::UserId,
        ProgressCol::EntityType,
        ProgressCol::EntityId,
        ProgressCol::PositionFraction,
        ProgressCol::PositionSeconds,
        ProgressCol::DurationSeconds,
        ProgressCol::PositionLocator,
        ProgressCol::CompletedAt,
        ProgressCol::UpdatedAt,
        ProgressCol::Blake3,
    ])
    .from(ProgressCol::Table)
    .and_where(Expr::col(ProgressCol::UserId).eq(user_id))
    .and_where(Expr::col(ProgressCol::Blake3).is_in(blake3_values.to_vec()))
    .order_by(ProgressCol::UpdatedAt, Order::Desc);

    let (sql, values) = q.build(SqliteQueryBuilder);
    let progress = match bind_values(sqlx::query_as::<_, PlaybackProgress>(&sql), values)
        .fetch_all(&pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list playback progress",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playback progress retrieved successfully", progress)
}
