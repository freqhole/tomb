//! station bumpers — short audio/video clips (DJ drops, station IDs)
//! that the broadcaster slots between regular songs/videos.
//!
//! see migrations/024_radio_bumperz.sql (song bumpers) and
//! migrations/083_radio_bumperz_video.sql (added video bumpers) for the
//! schema. each row points at a `songz` or `videoz` row directly
//! (exactly one, never both) so the upload + transcoding + metadata +
//! art pipeline for whichever domain produces a playable bumper without
//! a second flow.
//!
//! the broadcaster picks a bumper between tracks when the per-station
//! `bumper_frequency_seconds` interval has elapsed since the last
//! bumper play. weighted random selection, with `weight` controlling
//! relative pick probability.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// one bumper row. exactly one of `song_id`/`video_id` is set, matching
/// the schema's CHECK constraint - which one determines the bumper's
/// `RadioItemKind` when the broadcaster plays it.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct Bumper {
    pub id: String,
    pub station_id: String,
    pub song_id: Option<String>,
    pub video_id: Option<String>,
    pub label: String,
    pub weight: i64,
    pub created_at: i64,
}

impl Bumper {
    /// the item this bumper plays, tagged with its domain - mirrors
    /// `RadioItemKind`/`RadioTrack`'s own `(kind, id)` shape so callers
    /// (`broadcaster::maybe_play_bumper`) don't need to match on
    /// `song_id`/`video_id` themselves.
    pub fn item(&self) -> (crate::radio::playlist::RadioItemKind, &str) {
        match (&self.song_id, &self.video_id) {
            (Some(id), _) => (crate::radio::playlist::RadioItemKind::Song, id.as_str()),
            (None, Some(id)) => (crate::radio::playlist::RadioItemKind::Video, id.as_str()),
            (None, None) => {
                // schema CHECK constraint makes this unreachable in
                // practice; Song is the safer of two wrong guesses
                // (matches this type's pre-video default everywhere
                // else in the radio module).
                (crate::radio::playlist::RadioItemKind::Song, "")
            }
        }
    }
}

pub async fn list_bumpers(station_id: &str) -> GrimoireResult<Vec<Bumper>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        Bumper,
        r#"SELECT id as "id!", station_id as "station_id!", song_id, video_id,
                  label as "label!", weight as "weight!",
                  created_at as "created_at!"
           FROM radio_bumperz WHERE station_id = ?
           ORDER BY created_at ASC"#,
        station_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

/// add a bumper. exactly one of `song_id`/`video_id` must be `Some` -
/// callers (the admin dispatch handler) validate this before calling in,
/// but the schema's own CHECK constraint is the actual backstop.
pub async fn add_bumper(
    station_id: &str,
    song_id: Option<&str>,
    video_id: Option<&str>,
    label: &str,
    weight: Option<i64>,
) -> GrimoireResult<Bumper> {
    if song_id.is_some() == video_id.is_some() {
        return Err(GrimoireError::BadRequest {
            message: "radio bumper: exactly one of song_id/video_id must be set".to_string(),
        });
    }
    let pool = database::connect().await?;
    let weight = weight.unwrap_or(1).max(1);
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_bumperz (station_id, song_id, video_id, label, weight)
           VALUES (?, ?, ?, ?, ?) RETURNING id"#,
        station_id,
        song_id,
        video_id,
        label,
        weight,
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query_as!(
        Bumper,
        r#"SELECT id as "id!", station_id as "station_id!", song_id, video_id,
                  label as "label!", weight as "weight!",
                  created_at as "created_at!"
           FROM radio_bumperz WHERE id = ?"#,
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn remove_bumper(bumper_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!("DELETE FROM radio_bumperz WHERE id = ?", bumper_id)
        .execute(&pool)
        .await?;
    Ok(())
}

/// fetch the per-station bumper cadence (`null` = bumpers off).
pub async fn get_frequency(station_id: &str) -> GrimoireResult<Option<i64>> {
    let pool = database::connect().await?;
    let freq: Option<Option<i64>> = sqlx::query_scalar!(
        "SELECT bumper_frequency_seconds FROM radio_stationz WHERE id = ?",
        station_id
    )
    .fetch_optional(&pool)
    .await?;
    Ok(freq.flatten())
}

pub async fn set_frequency(station_id: &str, frequency_seconds: Option<i64>) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "UPDATE radio_stationz SET bumper_frequency_seconds = ?, updated_at = unixepoch()
         WHERE id = ?",
        frequency_seconds,
        station_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// weighted-random pick of one bumper for the named station. returns
/// `None` when the station has no bumpers.
pub async fn pick_random(station_id: &str) -> GrimoireResult<Option<Bumper>> {
    let bumpers = list_bumpers(station_id).await?;
    if bumpers.is_empty() {
        return Ok(None);
    }
    let total: i64 = bumpers.iter().map(|b| b.weight.max(1)).sum();
    if total <= 0 {
        return Ok(None);
    }
    use rand::Rng;
    let mut roll = rand::thread_rng().gen_range(0..total);
    for b in bumpers {
        let w = b.weight.max(1);
        if roll < w {
            return Ok(Some(b));
        }
        roll -= w;
    }
    Ok(None)
}
