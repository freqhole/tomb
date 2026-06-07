//! station bumpers — short audio clips (DJ drops, station IDs) that the
//! broadcaster slots between regular songs.
//!
//! see migrations/024_radio_bumperz.sql for the schema. each row points
//! at a `media_blobz` row directly so the upload + transcoding pipeline
//! can produce playable bumpers without cluttering `songz`.
//!
//! the broadcaster picks a bumper between songs when the per-station
//! `bumper_frequency_seconds` interval has elapsed since the last
//! bumper play. weighted random selection, with `weight` controlling
//! relative pick probability.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// one bumper row.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct Bumper {
    pub id: String,
    pub station_id: String,
    pub song_id: String,
    pub label: String,
    pub weight: i64,
    pub created_at: i64,
}

pub async fn list_bumpers(station_id: &str) -> GrimoireResult<Vec<Bumper>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        Bumper,
        r#"SELECT id as "id!", station_id as "station_id!", song_id as "song_id!",
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

pub async fn add_bumper(
    station_id: &str,
    song_id: &str,
    label: &str,
    weight: Option<i64>,
) -> GrimoireResult<Bumper> {
    let pool = database::connect().await?;
    let weight = weight.unwrap_or(1).max(1);
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_bumperz (station_id, song_id, label, weight)
           VALUES (?, ?, ?, ?) RETURNING id"#,
        station_id,
        song_id,
        label,
        weight,
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query_as!(
        Bumper,
        r#"SELECT id as "id!", station_id as "station_id!", song_id as "song_id!",
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
