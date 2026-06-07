//! pick the next song to broadcast.
//!
//! supports station play modes:
//!
//! - [`pick_random_song`] — uniform random from the entire library. used
//!   as a zero-config fallback (e.g. when a station has no source set).
//! - [`pick_for_station`] — uses `stations::resolve_playlist` to compute
//!   the station's effective song set, then chooses by play_mode:
//!   - `shuffle`: random with recent-repeat avoidance
//!   - `album`: shuffle albums, then play each album in disc/track order

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::stations;
use sqlx::FromRow;
use tracing::info;

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
    /// blob_id of the song's primary audio blob.
    pub audio_blob_id: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// total track length in milliseconds (sourced from `songz.duration`).
    pub duration_ms: Option<i64>,
    /// blob_id of the song's waveform image, when one exists.
    pub waveform_blob_id: Option<String>,
    /// blob_id of the best available art image for this song.
    /// fallback chain: song_imagez → album_imagez → artist_imagez.
    /// used by public timeline manifests to populate art URLs.
    pub art_blob_id: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct CandidateMeta {
    song_id: String,
    album_id: Option<String>,
    disc_number: i64,
    track_number: i64,
}

/// pick a random song from the library that has a usable local file.
/// returns `Err` when there are no playable songs.
pub async fn pick_random_song() -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;

    let row = sqlx::query!(
        r#"SELECT s.id          as "song_id!",
                  s.title       as "title!",
                  s.duration,
                  b.id          as "audio_blob_id?",
                  b.local_path,
                  ar.name       as "artist_name?",
                  al.title      as "album_title?",
                                    (SELECT wf.id
                                         FROM media_blobz wf
                                        WHERE wf.parent_blob_id = b.id
                                            AND wf.blob_type = 'waveform'
                                            AND wf.deleted_at IS NULL
                                        LIMIT 1)    as "waveform_blob_id?",
                                    COALESCE(
                                        (SELECT si.media_blob_id FROM song_imagez si
                                            WHERE si.song_id = s.id
                                            ORDER BY si.is_primary DESC LIMIT 1),
                                        (SELECT ai.media_blob_id FROM album_imagez ai
                                            JOIN album_songz als2 ON als2.album_id = ai.album_id AND als2.song_id = s.id
                                            ORDER BY ai.is_primary DESC LIMIT 1),
                                        (SELECT ari.media_blob_id FROM artist_imagez ari
                                            JOIN artist_songz ars2 ON ars2.artist_id = ari.artist_id AND ars2.song_id = s.id
                                            ORDER BY ari.is_primary DESC LIMIT 1)
                                    )             as "art_blob_id?: String"
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
        audio_blob_id: row.audio_blob_id,
        artist: row.artist_name,
        album: row.album_title,
        duration_ms: row.duration,
        waveform_blob_id: row.waveform_blob_id,
        art_blob_id: row.art_blob_id,
    })
}

/// get all playable song ids from the library. used as fallback for
/// album mode when no explicit source is configured.
async fn all_playable_songs() -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;

    let song_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT DISTINCT s.id as "song_id!"
           FROM songz s
           JOIN media_blobz b ON b.id = s.media_blob_id
           WHERE b.local_path IS NOT NULL
             AND s.deleted_at IS NULL
             AND b.deleted_at IS NULL
           ORDER BY s.id"#
    )
    .fetch_all(&pool)
    .await?;

    info!(
        "[radio-picker] all_playable_songs() found {} songs",
        song_ids.len()
    );

    Ok(song_ids)
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
    pick_for_station_after_with_options(station_id, None, false).await
}

/// pick the next track for a station while forcing album mode to jump to
/// a new album start. used by broadcaster after admin skip requests.
pub async fn pick_for_station_force_new_album(station_id: &str) -> GrimoireResult<RadioTrack> {
    pick_for_station_after_with_options(station_id, None, true).await
}

/// pick the next track for a station, optionally anchored to a specific
/// last-played song id. planner uses this to build mode-correct lookahead
/// without waiting for play_history rows to be written.
pub async fn pick_for_station_after(
    station_id: &str,
    anchor_song_id: Option<&str>,
) -> GrimoireResult<RadioTrack> {
    pick_for_station_after_with_options(station_id, anchor_song_id, false).await
}

async fn pick_for_station_after_with_options(
    station_id: &str,
    anchor_song_id: Option<&str>,
    force_new_album: bool,
) -> GrimoireResult<RadioTrack> {
    let station = stations::get_station(station_id).await?.ok_or_else(|| {
        GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} not found"),
        }
    })?;

    let mut candidates = stations::resolve_playlist(station_id).await?;

    let mode = match station.play_mode.trim().to_ascii_lowercase().as_str() {
        "album" => "album",
        _ => "shuffle",
    };

    // for album mode, use the full library if no explicit candidates are
    // configured. for shuffle, use random fallback.
    if candidates.is_empty() {
        if mode == "album" {
            // get all songs to apply mode logic to full library.
            candidates = all_playable_songs().await?;
            info!(
                "[radio-picker] station {} (mode: {}) has no explicit source; using full library ({} songs)",
                station_id,
                mode,
                candidates.len()
            );
            if candidates.is_empty() {
                return Err(GrimoireError::ProcessingFailed {
                    message: "radio: no songs available in library".to_string(),
                });
            }
        } else {
            info!(
                "[radio-picker] station {} (mode: shuffle) has no explicit source; using random fallback",
                station_id
            );
            // shuffle with no explicit source = fall back to global random pool.
            // this is what the auto-seeded default station relies on.
            return pick_random_song().await;
        }
    } else {
        info!(
            "[radio-picker] station {} (mode: {}) using {} explicit candidates",
            station_id,
            mode,
            candidates.len()
        );
    }

    if mode == "album" {
        let chosen =
            pick_album_mode(station_id, &candidates, anchor_song_id, force_new_album).await?;
        return fetch_track(&chosen).await;
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

async fn pick_album_mode(
    station_id: &str,
    candidates: &[String],
    anchor_song_id: Option<&str>,
    force_new_album: bool,
) -> GrimoireResult<String> {
    let rows = load_candidate_meta(candidates).await?;
    if rows.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} resolved 0 album candidates"),
        });
    }

    let (by_album, song_pos) = build_album_index(rows);
    info!(
        "[radio-album-mode] station {} loaded {} albums with {} total tracks",
        station_id,
        by_album.len(),
        song_pos.len()
    );

    let last_played = resolve_last_song_id(station_id, anchor_song_id).await;
    info!(
        "[radio-album-mode] station {} last_played: {:?}",
        station_id, last_played
    );

    if !force_new_album {
        if let Some(next) = next_track_in_same_album(&by_album, &song_pos, last_played.as_deref()) {
            info!(
                "[radio-album-mode] station {} continuing in same album: next track {}",
                station_id, next
            );
            return Ok(next);
        }
    } else {
        info!(
            "[radio-album-mode] station {} forcing new album after skip request",
            station_id
        );
    }

    let album_keys = candidate_albums_for_new_pick(&by_album, &song_pos, last_played.as_deref());
    if album_keys.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} has no album groups"),
        });
    }

    info!(
        "[radio-album-mode] station {} picking new album from {} candidates",
        station_id,
        album_keys.len()
    );

    let chosen_album = {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();
        album_keys
            .choose(&mut rng)
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: format!("radio: station {station_id} failed to choose album"),
            })?
            .clone()
    };

    let first_track = by_album
        .get(&chosen_album)
        .and_then(|v| v.first())
        .cloned()
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} chosen album has no tracks"),
        })?;

    info!(
        "[radio-album-mode] station {} chose album {} → first track: {}",
        station_id, chosen_album, first_track
    );

    Ok(first_track)
}

async fn load_candidate_meta(candidates: &[String]) -> GrimoireResult<Vec<CandidateMeta>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let pool = database::connect().await?;
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        r#"
        SELECT
            s.id                AS song_id,
            map.album_id        AS album_id,
            COALESCE(s.disc_number, 1)  AS disc_number,
            COALESCE(s.track_number, 1) AS track_number
        FROM songz s
        LEFT JOIN (
            SELECT als.song_id AS song_id, MIN(als.album_id) AS album_id
            FROM album_songz als
            GROUP BY als.song_id
        ) map ON map.song_id = s.id
        LEFT JOIN albumz al ON al.id = map.album_id
        WHERE s.id IN (
        "#,
    );

    {
        let mut separated = qb.separated(", ");
        for id in candidates {
            separated.push_bind(id);
        }
    }

    qb.push(
        r#")
        AND s.deleted_at IS NULL
        ORDER BY
            LOWER(COALESCE(al.title, '')) ASC,
            map.album_id ASC,
            COALESCE(s.disc_number, 1) ASC,
            COALESCE(s.track_number, 1) ASC,
            LOWER(s.title) ASC,
            s.id ASC"#,
    );

    qb.build_query_as::<CandidateMeta>()
        .fetch_all(&pool)
        .await
        .map_err(GrimoireError::from)
}

fn build_album_index(
    rows: Vec<CandidateMeta>,
) -> (
    std::collections::HashMap<String, Vec<String>>,
    std::collections::HashMap<String, (String, usize)>,
) {
    info!("[radio-album-build] got {} rows to index", rows.len());
    for (idx, row) in rows.iter().take(10).enumerate() {
        info!(
            "[radio-album-build] row {}: song={} album_id={:?} disc={} track={}",
            idx, row.song_id, row.album_id, row.disc_number, row.track_number
        );
    }

    let mut grouped: std::collections::HashMap<String, Vec<CandidateMeta>> =
        std::collections::HashMap::new();

    for row in rows {
        let album_key = row
            .album_id
            .clone()
            .unwrap_or_else(|| format!("__single__:{}", row.song_id));
        grouped.entry(album_key).or_default().push(row);
    }

    let mut by_album: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut song_pos: std::collections::HashMap<String, (String, usize)> =
        std::collections::HashMap::new();

    for (album_key, mut tracks) in grouped {
        tracks.sort_by(|a, b| {
            a.disc_number
                .cmp(&b.disc_number)
                .then_with(|| a.track_number.cmp(&b.track_number))
                .then_with(|| a.song_id.cmp(&b.song_id))
        });

        let mut ordered = Vec::with_capacity(tracks.len());
        for (idx, t) in tracks.into_iter().enumerate() {
            ordered.push(t.song_id.clone());
            song_pos.insert(t.song_id, (album_key.clone(), idx));
        }
        by_album.insert(album_key, ordered);
    }

    (by_album, song_pos)
}

fn next_track_in_same_album(
    by_album: &std::collections::HashMap<String, Vec<String>>,
    song_pos: &std::collections::HashMap<String, (String, usize)>,
    last_song_id: Option<&str>,
) -> Option<String> {
    let last = last_song_id?;
    let (album_key, pos) = song_pos.get(last)?;
    let album_tracks = by_album.get(album_key)?;
    if *pos + 1 < album_tracks.len() {
        Some(album_tracks[*pos + 1].clone())
    } else {
        None
    }
}

fn candidate_albums_for_new_pick(
    by_album: &std::collections::HashMap<String, Vec<String>>,
    song_pos: &std::collections::HashMap<String, (String, usize)>,
    last_song_id: Option<&str>,
) -> Vec<String> {
    let mut album_keys: Vec<String> = by_album.keys().cloned().collect();
    if let Some(last_id) = last_song_id {
        if let Some((last_album_key, _)) = song_pos.get(last_id) {
            if album_keys.len() > 1 {
                album_keys.retain(|k| k != last_album_key);
            }
        }
    }
    album_keys
}

async fn resolve_last_song_id(station_id: &str, anchor_song_id: Option<&str>) -> Option<String> {
    if let Some(anchor) = anchor_song_id {
        let trimmed = anchor.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    stations::list_play_history(station_id, 1)
        .await
        .ok()
        .and_then(|v| v.into_iter().next())
        .map(|p| p.song_id)
}

/// load the full RadioTrack row for a given song id. returns the same
/// shape as `pick_random_song` minus the random ordering.
pub async fn fetch_track(song_id: &str) -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"SELECT s.id          as "song_id!",
                  s.title       as "title!",
                  s.duration,
                  b.id          as "audio_blob_id?",
                  b.local_path,
                  ar.name       as "artist_name?",
                  al.title      as "album_title?",
                  (SELECT wf.id
                     FROM media_blobz wf
                    WHERE wf.parent_blob_id = b.id
                      AND wf.blob_type = 'waveform'
                      AND wf.deleted_at IS NULL
                    LIMIT 1)    as "waveform_blob_id?",
                  COALESCE(
                    (SELECT si.media_blob_id FROM song_imagez si
                      WHERE si.song_id = s.id
                      ORDER BY si.is_primary DESC LIMIT 1),
                    (SELECT ai.media_blob_id FROM album_imagez ai
                      JOIN album_songz als2 ON als2.album_id = ai.album_id AND als2.song_id = s.id
                      ORDER BY ai.is_primary DESC LIMIT 1),
                    (SELECT ari.media_blob_id FROM artist_imagez ari
                      JOIN artist_songz ars2 ON ars2.artist_id = ari.artist_id AND ars2.song_id = s.id
                      ORDER BY ari.is_primary DESC LIMIT 1)
                  )             as "art_blob_id?: String"
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
        audio_blob_id: row.audio_blob_id,
        artist: row.artist_name,
        album: row.album_title,
        duration_ms: row.duration,
        waveform_blob_id: row.waveform_blob_id,
        art_blob_id: row.art_blob_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_album_index, candidate_albums_for_new_pick, next_track_in_same_album, CandidateMeta,
    };

    #[test]
    fn build_album_index_orders_tracks_by_disc_then_track() {
        let rows = vec![
            CandidateMeta {
                song_id: "s2".to_string(),
                album_id: Some("a1".to_string()),
                disc_number: 1,
                track_number: 2,
            },
            CandidateMeta {
                song_id: "s1".to_string(),
                album_id: Some("a1".to_string()),
                disc_number: 1,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "s4".to_string(),
                album_id: Some("a1".to_string()),
                disc_number: 2,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "s3".to_string(),
                album_id: Some("a1".to_string()),
                disc_number: 1,
                track_number: 3,
            },
        ];

        let (by_album, song_pos) = build_album_index(rows);
        assert_eq!(
            by_album.get("a1").cloned().unwrap_or_default(),
            vec![
                "s1".to_string(),
                "s2".to_string(),
                "s3".to_string(),
                "s4".to_string()
            ]
        );
        assert_eq!(song_pos.get("s1"), Some(&("a1".to_string(), 0)));
        assert_eq!(song_pos.get("s4"), Some(&("a1".to_string(), 3)));
    }

    #[test]
    fn build_album_index_keeps_albums_independent() {
        let rows = vec![
            CandidateMeta {
                song_id: "a_t2".to_string(),
                album_id: Some("A".to_string()),
                disc_number: 1,
                track_number: 2,
            },
            CandidateMeta {
                song_id: "b_t1".to_string(),
                album_id: Some("B".to_string()),
                disc_number: 1,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "a_t1".to_string(),
                album_id: Some("A".to_string()),
                disc_number: 1,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "b_t2".to_string(),
                album_id: Some("B".to_string()),
                disc_number: 1,
                track_number: 2,
            },
        ];

        let (by_album, song_pos) = build_album_index(rows);
        assert_eq!(
            by_album.get("A").cloned().unwrap_or_default(),
            vec!["a_t1".to_string(), "a_t2".to_string()]
        );
        assert_eq!(
            by_album.get("B").cloned().unwrap_or_default(),
            vec!["b_t1".to_string(), "b_t2".to_string()]
        );
        assert_eq!(song_pos.get("a_t2"), Some(&("A".to_string(), 1)));
        assert_eq!(song_pos.get("b_t2"), Some(&("B".to_string(), 1)));
    }

    #[test]
    fn album_mode_sequence_finishes_album_before_switching() {
        let rows = vec![
            CandidateMeta {
                song_id: "a_d1_t2".to_string(),
                album_id: Some("A".to_string()),
                disc_number: 1,
                track_number: 2,
            },
            CandidateMeta {
                song_id: "b_d1_t1".to_string(),
                album_id: Some("B".to_string()),
                disc_number: 1,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "a_d2_t1".to_string(),
                album_id: Some("A".to_string()),
                disc_number: 2,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "a_d1_t1".to_string(),
                album_id: Some("A".to_string()),
                disc_number: 1,
                track_number: 1,
            },
            CandidateMeta {
                song_id: "b_d1_t2".to_string(),
                album_id: Some("B".to_string()),
                disc_number: 1,
                track_number: 2,
            },
        ];

        let (by_album, song_pos) = build_album_index(rows);

        // simulate successive boundaries while album A is active.
        assert_eq!(
            next_track_in_same_album(&by_album, &song_pos, Some("a_d1_t1")),
            Some("a_d1_t2".to_string())
        );
        assert_eq!(
            next_track_in_same_album(&by_album, &song_pos, Some("a_d1_t2")),
            Some("a_d2_t1".to_string())
        );

        // once the last track in A finishes, the next album choice set
        // should exclude A (when another album exists).
        assert_eq!(
            next_track_in_same_album(&by_album, &song_pos, Some("a_d2_t1")),
            None
        );
        let mut next_albums = candidate_albums_for_new_pick(&by_album, &song_pos, Some("a_d2_t1"));
        next_albums.sort();
        assert_eq!(next_albums, vec!["B".to_string()]);
    }
}
