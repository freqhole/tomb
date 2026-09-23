//! pick the next song OR video to broadcast.
//!
//! supports station play modes:
//!
//! - [`pick_random_song`] — uniform random from the entire song library.
//!   used as a zero-config fallback (e.g. when a station has no source
//!   set) - always song-only, since the auto-seeded default station has
//!   no video source by definition.
//! - [`pick_for_station`] — uses `stations::resolve_playlist` to compute
//!   the station's effective song AND video candidate sets, then chooses:
//!   - `shuffle`: random across BOTH domains blended together (with
//!     recent-repeat avoidance on the song side only for now - see
//!     `RadioTrack`'s own doc comment)
//!   - `album`: shuffle albums, then play each album in disc/track order
//!     (song) - `video_only` stations get the video-domain equivalent
//!     (shuffle `video_seriez`, play each in season/episode order) via
//!     `pick_series_mode`. `audio_or_video` stations still ignore video
//!     entirely in album mode (only song albums shuffle there).

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::stations;
use sqlx::FromRow;
use tracing::{debug, info};

/// how many recent play_history rows to consult when avoiding repeats.
/// small enough not to starve tiny stations, large enough that 4-track
/// rotations don't loop.
const RECENT_REPEAT_WINDOW: i64 = 8;

/// which domain a `RadioTrack` came from. kept as one enum (not two
/// separate track structs) so the picker/broadcaster/encoder's shared
/// plumbing (pick, encode, announce, play) doesn't need two near-
/// identical code paths.
/// rides on the wire directly as `NowPlaying.kind` (serde), so it also
/// derives `Serialize`/`Deserialize`/`Default` (`Song` is the default -
/// pre-existing clients/stations are always song-only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RadioItemKind {
    #[default]
    Song,
    Video,
}

impl RadioItemKind {
    /// `"song"` | `"video"` - used by the public (zod-codegen'd) API
    /// surface, which represents kind as a plain string rather than a
    /// Rust enum (matches `RadioStation.play_mode`'s existing convention).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Song => "song",
            Self::Video => "video",
        }
    }
}

/// the bare minimum the encoder needs to start ffmpeg, plus enough
/// metadata for a now-playing display.
///
/// `song_id`/`audio_blob_id` hold a VIDEO id/blob id when
/// `kind == RadioItemKind::Video` - not renamed to a kind-neutral name
/// yet because the wire protocol (`radio::messages::NowPlaying`, which
/// these feed directly) is still entirely song-shaped and keeps the same
/// field names; both will be renamed together once the wire protocol
/// itself gains a kind discriminator (see the plan doc's "wire protocol"
/// step) rather than doing the rename twice.
#[derive(Debug, Clone)]
pub struct RadioTrack {
    pub kind: RadioItemKind,
    pub song_id: String,
    pub title: String,
    pub local_path: String,
    /// blob_id of the song's primary audio blob.
    pub audio_blob_id: Option<String>,
    /// `None` for a video - videos have no "performing artist" concept
    /// modeled here yet (series/season could be a future equivalent).
    pub artist: Option<String>,
    pub album: Option<String>,
    /// total track length in milliseconds (sourced from `songz.duration`).
    pub duration_ms: Option<i64>,
    /// blob_id of the song's waveform image, when one exists. always
    /// `None` for a video.
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
        kind: RadioItemKind::Song,
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

/// pick a random video from the library. used as the video-domain
/// zero-config fallback (mirrors `pick_random_song`) so a `video_only` or
/// `audio_or_video` station with no filters configured at all still
/// shuffles across every playable video instead of erroring - matches
/// how a song-side station with no filters already falls back to the
/// full song library.
pub async fn pick_random_video() -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;
    let video_ids = stations::repository::all_playable_video_ids(&pool).await?;
    let id = {
        use rand::seq::SliceRandom;
        video_ids
            .choose(&mut rand::thread_rng())
            .cloned()
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "radio: no playable videos in library".to_string(),
            })?
    };
    fetch_track(RadioItemKind::Video, &id).await
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

    // content_mode gates which domain(s) this station ever draws from -
    // 'audio_only' (every pre-existing station) never touches video_ids,
    // 'video_only' never touches song_ids, 'audio_or_video' uses both.
    // this is what makes it safe for cross-domain criteria filters
    // (taxon/tag/favorite/etc) to also match video: an audio_only
    // station's resolve_playlist call below never even RUNS a video
    // query, let alone returns one.
    let content_mode = station.content_mode.trim().to_ascii_lowercase();

    // request-taking stations draw from the member-submitted queue first
    // (see crate::radio::requests) - falls through to the normal
    // filter-based picker below once the queue is empty. an incompatible-
    // with-content_mode or now-unfetchable item is dropped (logged) and
    // the next one tried instead - the submit route already checks
    // content_mode compatibility up front, so this loop is just a safety
    // net, not the primary enforcement.
    if station.accepts_requests != 0 {
        loop {
            let Some(req) = crate::radio::requests::pop_next(station_id).await else {
                break;
            };
            let compatible = !matches!(
                (req.kind, content_mode.as_str()),
                (RadioItemKind::Song, "video_only") | (RadioItemKind::Video, "audio_only")
            );
            if !compatible {
                tracing::warn!(
                    "[radio-picker] station {station_id} dropped a queued request for {:?} {} \
                     - incompatible with content_mode {content_mode}",
                    req.kind,
                    req.item_id
                );
                continue;
            }
            match fetch_track(req.kind, &req.item_id).await {
                Ok(track) => return Ok(track),
                Err(e) => {
                    tracing::warn!(
                        "[radio-picker] station {station_id} dropped a queued request for {:?} \
                         {} - failed to fetch: {e}",
                        req.kind,
                        req.item_id
                    );
                    continue;
                }
            }
        }
    }

    let resolved = stations::resolve_playlist(station_id, &content_mode).await?;
    let mut song_candidates = if content_mode == "video_only" {
        Vec::new()
    } else {
        resolved.song_ids
    };
    let video_candidates = if content_mode == "audio_only" {
        Vec::new()
    } else {
        resolved.video_ids
    };

    let mode = match station.play_mode.trim().to_ascii_lowercase().as_str() {
        "album" => "album",
        _ => "shuffle",
    };

    if mode == "album" {
        if content_mode == "video_only" {
            // video's album-mode equivalent: shuffle across video_seriez,
            // then play each series in season/episode order - mirrors the
            // song branch below (full-library fallback, pick_series_mode
            // mirrors pick_album_mode). audio_or_video stations still
            // ignore video entirely in album mode, same as before - only
            // video_only's previous hard error is being lifted here.
            let mut video_pool = video_candidates;
            if video_pool.is_empty() {
                let pool = database::connect().await?;
                video_pool = stations::repository::all_playable_video_ids(&pool).await?;
                debug!(
                    "[radio-picker] station {} (mode: {}) has no explicit source; using full video library ({} videos)",
                    station_id,
                    mode,
                    video_pool.len()
                );
                if video_pool.is_empty() {
                    return Err(GrimoireError::ProcessingFailed {
                        message: "radio: no videos available in library".to_string(),
                    });
                }
            } else {
                info!(
                    "[radio-picker] station {} (mode: {}) using {} explicit video candidates",
                    station_id,
                    mode,
                    video_pool.len()
                );
            }

            let chosen =
                pick_series_mode(station_id, &video_pool, anchor_song_id, force_new_album).await?;
            return fetch_track(RadioItemKind::Video, &chosen).await;
        }
        // use the full song library if no explicit candidates are
        // configured (video candidates are ignored entirely in this mode).
        if song_candidates.is_empty() {
            song_candidates = all_playable_songs().await?;
            debug!(
                "[radio-picker] station {} (mode: {}) has no explicit source; using full library ({} songs)",
                station_id,
                mode,
                song_candidates.len()
            );
            if song_candidates.is_empty() {
                return Err(GrimoireError::ProcessingFailed {
                    message: "radio: no songs available in library".to_string(),
                });
            }
        } else {
            info!(
                "[radio-picker] station {} (mode: {}) using {} explicit candidates",
                station_id,
                mode,
                song_candidates.len()
            );
        }

        let chosen = pick_album_mode(
            station_id,
            &song_candidates,
            anchor_song_id,
            force_new_album,
        )
        .await?;
        return fetch_track(RadioItemKind::Song, &chosen).await;
    }

    // shuffle mode: blend song + video candidates into one pool. no
    // explicit source at all in either domain = fall back to the global
    // random pool for whichever domain(s) content_mode allows -
    // `pick_random_song` for audio_only/audio_or_video (the zero-config
    // default station relies on this), `pick_random_video` for
    // video_only/audio_or_video (mirrors the song-side fallback -
    // previously this errored, requiring an explicit `all_videos` filter
    // just to get ANY video playing, which was confusing for a station
    // whose whole point is "shuffle everything").
    if song_candidates.is_empty() && video_candidates.is_empty() {
        debug!(
            "[radio-picker] station {} (mode: shuffle) has no explicit source; using random fallback",
            station_id
        );
        if content_mode == "video_only" {
            return pick_random_video().await;
        }
        return pick_random_song().await;
    }
    info!(
        "[radio-picker] station {} (mode: shuffle) using {} song + {} video explicit candidates",
        station_id,
        song_candidates.len(),
        video_candidates.len()
    );

    // de-dupe songs against recent plays. video has no play-history
    // tracking yet (radio_play_historyz.song_id FKs to songz - see
    // broadcaster.rs's play_track, which skips recording a play at all
    // for a video pick), so recent-repeat avoidance only applies to the
    // song side for now.
    let recent = stations::list_play_history(station_id, RECENT_REPEAT_WINDOW)
        .await
        .unwrap_or_default();
    if !recent.is_empty() {
        let recent_ids: std::collections::HashSet<&str> =
            recent.iter().map(|p| p.song_id.as_str()).collect();
        let filtered: Vec<String> = song_candidates
            .iter()
            .filter(|id| !recent_ids.contains(id.as_str()))
            .cloned()
            .collect();
        // only apply the filter if it doesn't wipe out every song
        // candidate with no video candidates to fall back on - mirrors
        // the original "better to repeat than stall" reasoning, now
        // evaluated against the combined pool.
        if !filtered.is_empty() || !video_candidates.is_empty() {
            song_candidates = filtered;
        }
    }

    // pick one at random (across both domains) + fetch its full metadata.
    // scope rng so its !Send ThreadRng is dropped before the await below.
    let chosen = {
        use rand::seq::SliceRandom;
        let pool: Vec<(RadioItemKind, String)> = song_candidates
            .into_iter()
            .map(|id| (RadioItemKind::Song, id))
            .chain(
                video_candidates
                    .into_iter()
                    .map(|id| (RadioItemKind::Video, id)),
            )
            .collect();
        let mut rng = rand::thread_rng();
        pool.choose(&mut rng)
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: format!("radio: station {station_id} resolved 0 candidates"),
            })?
            .clone()
    };

    fetch_track(chosen.0, &chosen.1).await
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

/// video's counterpart to `pick_album_mode` - shuffle across
/// `video_seriez`, then play each series in season/episode order.
/// reuses `next_track_in_same_album`/`candidate_albums_for_new_pick`
/// as-is (both are already generic over an "album/series key -> ordered
/// id list" map, no song-specific typing) - only the data loading +
/// index-building steps need a video-shaped counterpart.
///
/// continuity note: `radio_play_historyz` is song-only (its `song_id`
/// column FKs to `songz` - see this module's doc comment), so there is
/// no persisted "last video played" to fall back on. `resolve_last_song_id`
/// still works correctly here despite the name: when `anchor_song_id` is
/// `Some` (the common case - `broadcaster::refill_planner` threads the
/// last pick's id through in-memory regardless of domain) it's used
/// directly without touching the DB; a cold start with no anchor just
/// begins a new series, the same safe fallback album mode gets on ITS
/// own cold start.
async fn pick_series_mode(
    station_id: &str,
    candidates: &[String],
    anchor_video_id: Option<&str>,
    force_new_series: bool,
) -> GrimoireResult<String> {
    let rows = load_video_candidate_meta(candidates).await?;
    if rows.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} resolved 0 series candidates"),
        });
    }

    let (by_series, video_pos) = build_series_index(rows);
    info!(
        "[radio-series-mode] station {} loaded {} series with {} total episodes",
        station_id,
        by_series.len(),
        video_pos.len()
    );

    let last_played = resolve_last_song_id(station_id, anchor_video_id).await;
    info!(
        "[radio-series-mode] station {} last_played: {:?}",
        station_id, last_played
    );

    if !force_new_series {
        if let Some(next) = next_track_in_same_album(&by_series, &video_pos, last_played.as_deref())
        {
            info!(
                "[radio-series-mode] station {} continuing in same series: next episode {}",
                station_id, next
            );
            return Ok(next);
        }
    } else {
        info!(
            "[radio-series-mode] station {} forcing new series after skip request",
            station_id
        );
    }

    let series_keys = candidate_albums_for_new_pick(&by_series, &video_pos, last_played.as_deref());
    if series_keys.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} has no series groups"),
        });
    }

    info!(
        "[radio-series-mode] station {} picking new series from {} candidates",
        station_id,
        series_keys.len()
    );

    let chosen_series = {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();
        series_keys
            .choose(&mut rng)
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: format!("radio: station {station_id} failed to choose series"),
            })?
            .clone()
    };

    let first_episode = by_series
        .get(&chosen_series)
        .and_then(|v| v.first())
        .cloned()
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: station {station_id} chosen series has no episodes"),
        })?;

    info!(
        "[radio-series-mode] station {} chose series {} → first episode: {}",
        station_id, chosen_series, first_episode
    );

    Ok(first_episode)
}

#[derive(Debug, Clone, FromRow)]
struct CandidateVideoMeta {
    video_id: String,
    series_id: Option<String>,
    season_number: Option<i64>,
    episode_number: Option<i64>,
}

async fn load_video_candidate_meta(
    candidates: &[String],
) -> GrimoireResult<Vec<CandidateVideoMeta>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let pool = database::connect().await?;
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        r#"
        SELECT
            v.id             AS video_id,
            v.series_id      AS series_id,
            vs.season_number AS season_number,
            v.episode_number AS episode_number
        FROM videoz v
        LEFT JOIN video_seasonz vs ON vs.id = v.season_id
        WHERE v.id IN (
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
        AND v.deleted_at IS NULL
        ORDER BY
            v.series_id IS NULL,
            v.series_id ASC,
            vs.season_number IS NULL,
            vs.season_number ASC,
            v.episode_number IS NULL,
            v.episode_number ASC,
            v.id ASC"#,
    );

    qb.build_query_as::<CandidateVideoMeta>()
        .fetch_all(&pool)
        .await
        .map_err(GrimoireError::from)
}

/// video's counterpart to `build_album_index` - groups by `series_id`
/// (a video with no series gets its own singleton group, same
/// `__single__:` sentinel convention `build_album_index` uses for a
/// song with no album), orders each group by season/episode number
/// (both nullable - unset values sort last, mirroring
/// `list_videos_by_series`'s existing ordering convention).
#[allow(clippy::type_complexity)]
fn build_series_index(
    rows: Vec<CandidateVideoMeta>,
) -> (
    std::collections::HashMap<String, Vec<String>>,
    std::collections::HashMap<String, (String, usize)>,
) {
    info!("[radio-series-build] got {} rows to index", rows.len());

    let mut grouped: std::collections::HashMap<String, Vec<CandidateVideoMeta>> =
        std::collections::HashMap::new();

    for row in rows {
        let series_key = row
            .series_id
            .clone()
            .unwrap_or_else(|| format!("__single__:{}", row.video_id));
        grouped.entry(series_key).or_default().push(row);
    }

    let mut by_series: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut video_pos: std::collections::HashMap<String, (String, usize)> =
        std::collections::HashMap::new();

    for (series_key, mut episodes) in grouped {
        episodes.sort_by(|a, b| {
            a.season_number
                .unwrap_or(i64::MAX)
                .cmp(&b.season_number.unwrap_or(i64::MAX))
                .then_with(|| {
                    a.episode_number
                        .unwrap_or(i64::MAX)
                        .cmp(&b.episode_number.unwrap_or(i64::MAX))
                })
                .then_with(|| a.video_id.cmp(&b.video_id))
        });

        let mut ordered = Vec::with_capacity(episodes.len());
        for (idx, e) in episodes.into_iter().enumerate() {
            ordered.push(e.video_id.clone());
            video_pos.insert(e.video_id, (series_key.clone(), idx));
        }
        by_series.insert(series_key, ordered);
    }

    (by_series, video_pos)
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

#[allow(clippy::type_complexity)]
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

/// load the full RadioTrack row for a given item id - dispatches to the
/// song or video query depending on `kind`. single public entry point so
/// callers (the picker, bumper playback) don't need their own branch.
pub async fn fetch_track(kind: RadioItemKind, item_id: &str) -> GrimoireResult<RadioTrack> {
    match kind {
        RadioItemKind::Song => fetch_song_track(item_id).await,
        RadioItemKind::Video => fetch_video_track(item_id).await,
    }
}

/// load the full RadioTrack row for a given song id. returns the same
/// shape as `pick_random_song` minus the random ordering.
async fn fetch_song_track(song_id: &str) -> GrimoireResult<RadioTrack> {
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
        kind: RadioItemKind::Song,
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

/// load the full RadioTrack row for a given video id. video counterpart
/// of `fetch_song_track` - no artist/album/waveform concept, art comes
/// from the video's own poster instead of the song_imagez/album_imagez/
/// artist_imagez fallback chain.
async fn fetch_video_track(video_id: &str) -> GrimoireResult<RadioTrack> {
    let pool = database::connect().await?;
    let row = sqlx::query!(
        r#"SELECT v.id             as "video_id!",
                  v.title          as "title!",
                  v.duration_seconds,
                  b.id             as "media_blob_id?",
                  b.local_path,
                  v.poster_blob_id as "art_blob_id?"
             FROM videoz v
             JOIN media_blobz b ON b.id = v.media_blob_id
            WHERE v.id = ?
              AND b.local_path IS NOT NULL
              AND v.deleted_at IS NULL
              AND b.deleted_at IS NULL
            LIMIT 1"#,
        video_id
    )
    .fetch_optional(&pool)
    .await?;

    let row = row.ok_or_else(|| GrimoireError::ProcessingFailed {
        message: format!("radio: video {video_id} not playable (deleted or no local_path)"),
    })?;

    let local_path = row
        .local_path
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio: video {video_id} has no local_path"),
        })?;

    let duration_ms = row
        .duration_seconds
        .map(|secs| (secs * 1000.0).round() as i64);

    Ok(RadioTrack {
        kind: RadioItemKind::Video,
        song_id: row.video_id,
        title: row.title,
        local_path,
        audio_blob_id: row.media_blob_id,
        artist: None,
        album: None,
        duration_ms,
        waveform_blob_id: None,
        art_blob_id: row.art_blob_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_album_index, build_series_index, candidate_albums_for_new_pick,
        next_track_in_same_album, CandidateMeta, CandidateVideoMeta,
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

    #[test]
    fn build_series_index_orders_episodes_by_season_then_episode() {
        let rows = vec![
            CandidateVideoMeta {
                video_id: "v1_s1_e2".to_string(),
                series_id: Some("series1".to_string()),
                season_number: Some(1),
                episode_number: Some(2),
            },
            CandidateVideoMeta {
                video_id: "v1_s1_e1".to_string(),
                series_id: Some("series1".to_string()),
                season_number: Some(1),
                episode_number: Some(1),
            },
            CandidateVideoMeta {
                video_id: "v1_s2_e1".to_string(),
                series_id: Some("series1".to_string()),
                season_number: Some(2),
                episode_number: Some(1),
            },
        ];

        let (by_series, video_pos) = build_series_index(rows);
        assert_eq!(
            by_series.get("series1").cloned().unwrap_or_default(),
            vec![
                "v1_s1_e1".to_string(),
                "v1_s1_e2".to_string(),
                "v1_s2_e1".to_string(),
            ]
        );
        assert_eq!(video_pos.get("v1_s1_e1"), Some(&("series1".to_string(), 0)));
        assert_eq!(video_pos.get("v1_s2_e1"), Some(&("series1".to_string(), 2)));
    }

    #[test]
    fn build_series_index_gives_seriesless_videos_their_own_singleton_group() {
        let rows = vec![
            CandidateVideoMeta {
                video_id: "standalone".to_string(),
                series_id: None,
                season_number: None,
                episode_number: None,
            },
            CandidateVideoMeta {
                video_id: "s1_e1".to_string(),
                series_id: Some("series1".to_string()),
                season_number: Some(1),
                episode_number: Some(1),
            },
        ];

        let (by_series, video_pos) = build_series_index(rows);
        // a video with no series gets its own group, keyed by a
        // sentinel that can never collide with a real series id.
        assert_eq!(by_series.len(), 2);
        assert_eq!(
            by_series.get("__single__:standalone").cloned(),
            Some(vec!["standalone".to_string()])
        );
        assert_eq!(
            video_pos.get("standalone"),
            Some(&("__single__:standalone".to_string(), 0))
        );
        assert_eq!(video_pos.get("s1_e1"), Some(&("series1".to_string(), 0)));
    }

    #[test]
    fn series_mode_sequence_finishes_series_before_switching() {
        let rows = vec![
            CandidateVideoMeta {
                video_id: "a_s1_e2".to_string(),
                series_id: Some("A".to_string()),
                season_number: Some(1),
                episode_number: Some(2),
            },
            CandidateVideoMeta {
                video_id: "b_s1_e1".to_string(),
                series_id: Some("B".to_string()),
                season_number: Some(1),
                episode_number: Some(1),
            },
            CandidateVideoMeta {
                video_id: "a_s2_e1".to_string(),
                series_id: Some("A".to_string()),
                season_number: Some(2),
                episode_number: Some(1),
            },
            CandidateVideoMeta {
                video_id: "a_s1_e1".to_string(),
                series_id: Some("A".to_string()),
                season_number: Some(1),
                episode_number: Some(1),
            },
        ];

        let (by_series, video_pos) = build_series_index(rows);

        // next_track_in_same_album/candidate_albums_for_new_pick are
        // reused as-is for series mode - they're generic over the
        // "group key -> ordered id list" map shape.
        assert_eq!(
            next_track_in_same_album(&by_series, &video_pos, Some("a_s1_e1")),
            Some("a_s1_e2".to_string())
        );
        assert_eq!(
            next_track_in_same_album(&by_series, &video_pos, Some("a_s1_e2")),
            Some("a_s2_e1".to_string())
        );
        assert_eq!(
            next_track_in_same_album(&by_series, &video_pos, Some("a_s2_e1")),
            None
        );
        let mut next_series =
            candidate_albums_for_new_pick(&by_series, &video_pos, Some("a_s2_e1"));
        next_series.sort();
        assert_eq!(next_series, vec!["B".to_string()]);
    }
}
