//! pick the next song to broadcast.
//!
//! supports two modes:
//!
//! - [`pick_random_song`] — uniform random from the entire library. used
//!   as a zero-config fallback (e.g. when a station has no source set).
//! - [`pick_for_station`] — uses `stations::resolve_playlist` to compute
//!   the station's effective song set + filters out anything in the most
//!   recent N play_history entries to avoid back-to-back repeats.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::stations;

/// how many recent play_history rows to consult when avoiding repeats.
/// small enough not to starve tiny stations, large enough that 4-track
/// rotations don't loop.
const RECENT_REPEAT_WINDOW: i64 = 8;

/// the bare minimum the encoder needs to start ffmpeg, plus enough
/// metadata for a now-playing display.
#[derive(Debug, Clone)]
pub struct RadioTrack {
    pub song_id: String,
    pub title: String,
    pub local_path: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// total track length in milliseconds (sourced from `songz.duration`).
    pub duration_ms: Option<i64>,
    /// blob_id of the song's waveform image, when one exists.
    pub waveform_blob_id: Option<String>,
}

/// pick a random song from the library that has a usable local file.
/// returns `Err` when there are no playable songs.
pub async fn pick_random_song() -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;

    let row = sqlx::query!(
        r#"SELECT s.id          as "song_id!",
                  s.title       as "title!",
                  s.duration,
                  b.local_path,
                  ar.name       as "artist_name?",
                  al.title      as "album_title?",
                  (SELECT wf.id
                     FROM media_blobz wf
                    WHERE wf.parent_blob_id = b.id
                      AND wf.blob_type = 'waveform'
                      AND wf.deleted_at IS NULL
                    LIMIT 1)    as "waveform_blob_id?"
             FROM songz s
             JOIN media_blobz b ON b.id = s.media_blob_id
             LEFT JOIN artist_songz ars ON ars.song_id = s.id
             LEFT JOIN artistz ar ON ar.id = ars.artist_id AND ar.deleted_at IS NULL
             LEFT JOIN album_songz als ON als.song_id = s.id
             LEFT JOIN albumz al ON al.id = als.album_id AND al.deleted_at IS NULL
            WHERE b.local_path IS NOT NULL
              AND s.deleted_at IS NULL
              AND b.deleted_at IS NULL
            ORDER BY RANDOM()
            LIMIT 1"#
    )
    .fetch_optional(&pool)
    .await?;

    let row = row.ok_or_else(|| GrimoireError::ProcessingFailed {
        message: "radio: no playable songs in library (none have a local_path)".to_string(),
    })?;

    let local_path = row
        .local_path
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: song {} has no local_path", row.song_id),
        })?;

    Ok(RadioTrack {
        song_id: row.song_id,
        title: row.title,
        local_path,
        artist: row.artist_name,
        album: row.album_title,
        duration_ms: row.duration,
        waveform_blob_id: row.waveform_blob_id,
    })
}

/// pick the next track for a specific station. uses the station's
/// configured source (explicit songs ∪ filter clauses); falls back to
/// `pick_random_song` when the station has no source configured (so the
/// default seeded "freqhole radio" station works zero-config).
///
/// recent-repeat avoidance: filters out any song id that appears in the
/// last `RECENT_REPEAT_WINDOW` play_history rows. when filtering would
/// leave the candidate set empty, the filter is dropped (better to repeat
/// than stall).
pub async fn pick_for_station(station_id: &str) -> GrimoireResult<RadioTrack> {
    let mut candidates = stations::resolve_playlist(station_id).await?;

    // empty source = fall back to the global random pool. this is what
    // the auto-seeded default station relies on.
    if candidates.is_empty() {
        return pick_random_song().await;
    }

    // de-dupe against recent plays.
    let recent = stations::list_play_history(station_id, RECENT_REPEAT_WINDOW)
        .await
        .unwrap_or_default();
    if !recent.is_empty() {
        let recent_ids: std::collections::HashSet<&str> =
            recent.iter().map(|p| p.song_id.as_str()).collect();
        let filtered: Vec<String> = candidates
            .iter()
            .filter(|id| !recent_ids.contains(id.as_str()))
            .cloned()
            .collect();
        if !filtered.is_empty() {
            candidates = filtered;
        }
    }

    // pick one at random + fetch its full metadata. scope rng so its
    // !Send ThreadRng is dropped before the await on fetch_track.
    let chosen = {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();
        candidates
            .choose(&mut rng)
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: format!("radio: station {station_id} resolved 0 candidates"),
            })?
            .clone()
    };

    fetch_track(&chosen).await
}

/// load the full RadioTrack row for a given song id. returns the same
/// shape as `pick_random_song` minus the random ordering.
async fn fetch_track(song_id: &str) -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"SELECT s.id          as "song_id!",
                  s.title       as "title!",
                  s.duration,
                  b.local_path,
                  ar.name       as "artist_name?",
                  al.title      as "album_title?",
                  (SELECT wf.id
                     FROM media_blobz wf
                    WHERE wf.parent_blob_id = b.id
                      AND wf.blob_type = 'waveform'
                      AND wf.deleted_at IS NULL
                    LIMIT 1)    as "waveform_blob_id?"
             FROM songz s
             JOIN media_blobz b ON b.id = s.media_blob_id
             LEFT JOIN artist_songz ars ON ars.song_id = s.id
             LEFT JOIN artistz ar ON ar.id = ars.artist_id AND ar.deleted_at IS NULL
             LEFT JOIN album_songz als ON als.song_id = s.id
             LEFT JOIN albumz al ON al.id = als.album_id AND al.deleted_at IS NULL
            WHERE s.id = ?
              AND b.local_path IS NOT NULL
              AND s.deleted_at IS NULL
              AND b.deleted_at IS NULL
            LIMIT 1"#,
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    let row = row.ok_or_else(|| GrimoireError::ProcessingFailed {
        message: format!("radio: song {song_id} not playable (deleted or no local_path)"),
    })?;

    let local_path = row
        .local_path
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: song {song_id} has no local_path"),
        })?;

    Ok(RadioTrack {
        song_id: row.song_id,
        title: row.title,
        local_path,
        artist: row.artist_name,
        album: row.album_title,
        duration_ms: row.duration,
        waveform_blob_id: row.waveform_blob_id,
    })
}
