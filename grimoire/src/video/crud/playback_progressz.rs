//! playback / resume progress (new capability - resume / continue-watching).
//! `position_fraction` is the one universal progress value every
//! domain populates; `position_seconds`/`duration_seconds` are additionally
//! populated for time-based media (video); `position_locator` is a
//! free-form, shared-infra-opaque string a domain can use however it needs.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use super::entity_taxonz::VideoEntityType;
use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

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
}

/// create or update a user's playback progress for a video-domain entity
#[allow(clippy::too_many_arguments)]
pub async fn upsert_playback_progress(
    user_id: &str,
    entity_type: VideoEntityType,
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
    let progress = match sqlx::query_as!(
        PlaybackProgress,
        r#"INSERT INTO playback_progressz (
            user_id, entity_type, entity_id, position_fraction, position_seconds,
            duration_seconds, position_locator, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET
            position_fraction = excluded.position_fraction,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            position_locator = excluded.position_locator,
            completed_at = excluded.completed_at,
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
            updated_at as "updated_at!""#,
        user_id,
        entity_type_str,
        entity_id,
        position_fraction,
        position_seconds,
        duration_seconds,
        position_locator,
        completed_at
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

    GrimoireResponse::success("Playback progress saved successfully", progress)
}

/// get a user's playback progress for a specific video-domain entity
pub async fn get_playback_progress(
    user_id: &str,
    entity_type: VideoEntityType,
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
            updated_at as "updated_at!"
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
/// "continue watching" rail)
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
            updated_at as "updated_at!"
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
