//! pick the next song to broadcast.
//!
//! phase 0: pure random pick from songs that have a `local_path` on disk.
//! phase 1 promotes this to a `ShufflePlaylist` that maintains a queue and
//! avoids replaying recent tracks.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// the bare minimum the encoder needs to start ffmpeg, plus enough metadata
/// for a now-playing display. album/artist come from junction tables and may
/// legitimately be missing for some songs.
#[derive(Debug, Clone)]
pub struct RadioTrack {
    pub song_id: String,
    pub title: String,
    pub local_path: String,
    pub artist: Option<String>,
    pub album: Option<String>,
}

/// pick a random song from the library that has a usable local file.
///
/// returns `Err` if there are no playable songs (empty library, or all songs
/// are blob-only with no `local_path`).
pub async fn pick_random_song() -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;

    // sqlite's `RANDOM()` is fine for a small library; ORDER BY RANDOM() does
    // a full scan but freqhole libraries are small enough that this isn't a
    // hot path concern. phase 1's broadcaster picks once per song (~3 minutes).
    let row = sqlx::query!(
        "SELECT s.id as song_id,
                s.title,
                b.local_path,
                ar.name as artist_name,
                al.title as album_title
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
         LIMIT 1"
    )
    .fetch_optional(&pool)
    .await?;

    let row = row.ok_or_else(|| GrimoireError::ProcessingFailed {
        message: "radio: no playable songs in library (none have a local_path)".to_string(),
    })?;

    // joined columns from songz come back as Option<_>; the WHERE filter
    // guarantees local_path is Some, but song_id from the join is also typed
    // nullable — unwrap with a defensive fallback.
    let song_id = row.song_id.unwrap_or_default();
    let title = row.title;
    let local_path = row
        .local_path
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: song {song_id} has no local_path"),
        })?;

    Ok(RadioTrack {
        song_id,
        title,
        local_path,
        artist: row.artist_name,
        album: row.album_title,
    })
}
