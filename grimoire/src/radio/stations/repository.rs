//! radio station persistence + playlist resolution.

use super::models::{
    CreateStationRequest, PlayHistoryEntry, RadioStation, StationFilter, StationFilterType,
    UpdateStationRequest,
};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

fn normalize_play_mode(mode: Option<String>) -> String {
    let raw = mode.unwrap_or_else(|| "shuffle".to_string());
    match raw.trim().to_ascii_lowercase().as_str() {
        "shuffle" => "shuffle".to_string(),
        "album" => "album".to_string(),
        _ => "shuffle".to_string(),
    }
}

/// 'audio_only' (default) | 'audio_or_video' | 'video_only' - see
/// migration 082's doc comment. unrecognized input falls back to
/// 'audio_only' rather than erroring, matching `normalize_play_mode`.
fn normalize_content_mode(mode: Option<String>) -> String {
    let raw = mode.unwrap_or_else(|| "audio_only".to_string());
    match raw.trim().to_ascii_lowercase().as_str() {
        "audio_only" => "audio_only".to_string(),
        "audio_or_video" => "audio_or_video".to_string(),
        "video_only" => "video_only".to_string(),
        _ => "audio_only".to_string(),
    }
}

/// list every station (no filtering; ui can hide disabled ones).
pub async fn list_stations() -> GrimoireResult<Vec<RadioStation>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        RadioStation,
        r#"SELECT id as "id!", name as "name!", description,
                  is_public as "is_public!: i64",
                  is_enabled as "is_enabled!: i64",
                  encode_args, codec as "codec!", play_mode as "play_mode!",
                  timeline_only_mode as "timeline_only_mode!: i64",
                  content_mode as "content_mode!",
                  bumper_frequency_seconds,
                  created_at as "created_at!", updated_at as "updated_at!"
           FROM radio_stationz
           ORDER BY created_at ASC"#
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn get_station(id: &str) -> GrimoireResult<Option<RadioStation>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        RadioStation,
        r#"SELECT id as "id!", name as "name!", description,
                  is_public as "is_public!: i64",
                  is_enabled as "is_enabled!: i64",
                  encode_args, codec as "codec!", play_mode as "play_mode!",
                  timeline_only_mode as "timeline_only_mode!: i64",
                  content_mode as "content_mode!",
                  bumper_frequency_seconds,
                  created_at as "created_at!", updated_at as "updated_at!"
           FROM radio_stationz WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)
}

/// content_mode-appropriate default MSE codec string, used whenever a
/// station's codec isn't explicitly supplied (creation, or a
/// content_mode change - see `create_station`/`update_station`).
/// `audio_only` gets the plain audio default; anything video-capable
/// gets the node-wide `[radio].video_codec` config default.
fn default_codec_for_content_mode(
    content_mode: &str,
    cfg: &crate::radio::config::RadioConfig,
) -> String {
    if content_mode == "audio_only" {
        crate::radio::messages::RADIO_CODEC.to_string()
    } else {
        cfg.video_codec.clone()
    }
}

pub async fn create_station(req: CreateStationRequest) -> GrimoireResult<RadioStation> {
    let pool = database::connect().await?;
    let is_public = req.is_public.unwrap_or(false) as i64;
    let is_enabled = req.is_enabled.unwrap_or(true) as i64;
    let timeline_only_mode = req.timeline_only_mode.unwrap_or(false) as i64;
    let play_mode = normalize_play_mode(req.play_mode);
    let content_mode = normalize_content_mode(req.content_mode);
    // codec always gets a concrete, content_mode-appropriate value at
    // creation time (unlike encode_args, which stays nullable and
    // resolves dynamically - see `RadioStation::effective_encode_args`).
    let codec = req.codec.unwrap_or_else(|| {
        default_codec_for_content_mode(&content_mode, &crate::radio::config::effective())
    });

    // sqlite generates id via DEFAULT (lower(hex(randomblob(8))))
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_stationz
                  (name, description, is_public, is_enabled, encode_args, codec, play_mode, timeline_only_mode, content_mode)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id"#,
        req.name,
        req.description,
        is_public,
        is_enabled,
        req.encode_args,
        codec,
        play_mode,
          timeline_only_mode,
        content_mode,
    )
    .fetch_one(&pool)
    .await?;

    get_station(&id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: "radio: created station vanished from db".to_string(),
        })
}

pub async fn update_station(req: UpdateStationRequest) -> GrimoireResult<RadioStation> {
    let pool = database::connect().await?;

    // do partial-update via COALESCE — keeps the query static (so query!
    // works) but lets nullable fields preserve existing values when not
    // provided.
    let is_public = req.is_public.map(|b| b as i64);
    let is_enabled = req.is_enabled.map(|b| b as i64);
    let timeline_only_mode = req.timeline_only_mode.map(|b| b as i64);

    let play_mode = req.play_mode.map(|m| normalize_play_mode(Some(m)));
    let content_mode = req.content_mode.map(|m| normalize_content_mode(Some(m)));
    // when content_mode is changing and the caller didn't ALSO specify a
    // codec in the same request, refresh codec to the new mode's config
    // default instead of leaving whatever was there before (very likely
    // picked for the OLD content_mode, and would otherwise silently
    // survive the switch wrong - the exact bug that motivated this).
    let codec = match (&content_mode, &req.codec) {
        (Some(cm), None) => Some(default_codec_for_content_mode(
            cm,
            &crate::radio::config::effective(),
        )),
        _ => req.codec,
    };

    sqlx::query!(
        r#"UPDATE radio_stationz SET
              name               = COALESCE(?, name),
              description        = COALESCE(?, description),
              is_public          = COALESCE(?, is_public),
              is_enabled         = COALESCE(?, is_enabled),
              encode_args        = COALESCE(?, encode_args),
              codec              = COALESCE(?, codec),
              play_mode          = COALESCE(?, play_mode),
              timeline_only_mode = COALESCE(?, timeline_only_mode),
              content_mode       = COALESCE(?, content_mode),
              updated_at         = unixepoch()
           WHERE id = ?"#,
        req.name,
        req.description,
        is_public,
        is_enabled,
        req.encode_args,
        codec,
        play_mode,
        timeline_only_mode,
        content_mode,
        req.id,
    )
    .execute(&pool)
    .await?;

    get_station(&req.id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("radio station not found: {}", req.id),
        })
}

pub async fn delete_station(id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    // play_eventz.radio_station_id has no ON DELETE action (see
    // migrations/026_play_count_views.sql, superseded by migrations/074_play_eventz.sql).
    // nullify any references first so the cascade-less FK doesn't block the
    // station delete. preserves the historical play event for song/album/artist crediting.
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "UPDATE play_eventz SET radio_station_id = NULL WHERE radio_station_id = ?",
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("DELETE FROM radio_stationz WHERE id = ?", id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

// ---------- one-shot migration: stale per-station encode_args ------------
//
// a per-station `encode_args` override that exactly matches one of these
// previously-shipped node-wide defaults was never an intentional per-
// station customization - just a snapshot of whatever the node-wide
// default happened to produce at some point (e.g. round-tripped through
// `radio_config_get`/`_set`), frozen onto the station row. safe to clear
// back to NULL ("inherit") since that just makes the station track the
// live node-wide default again; a genuine customization would not
// coincidentally match one of these byte-for-byte. see
// `crate::upgrade::upgrade_config_and_migrate` for the version gate that
// calls this.
const KNOWN_STALE_ENCODE_ARGS: &[&str] = &[
    // pre-server-side-pacing audio default (still had `-re`, from before
    // the broadcaster started pacing output itself).
    "-hide_banner -loglevel error -re -i {input} -vn -c:a aac -b:a 192k -movflags frag_keyframe+empty_moov+default_base_moof -frag_duration 3000000 -f mp4 pipe:1",
    // pre-0.3.7 video default, before `-x264-params scenecut=0` +
    // `-force_key_frames` fixed variable/short fragment durations caused
    // by libx264's adaptive scene-cut keyframes.
    "-hide_banner -loglevel error -fflags +genpts -i {input} -map 0:v:0 -map 0:a:0 -c:v libx264 -profile:v main -preset veryfast -b:v 2500k -pix_fmt yuv420p -c:a aac -profile:a aac_low -b:a 192k -ar 48000 -ac 2 -movflags frag_keyframe+empty_moov+default_base_moof -frag_duration 3000000 -avoid_negative_ts make_zero -f mp4 pipe:1",
];

/// report for [`clear_stale_default_encode_args`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct StaleEncodeArgsMigrationReport {
    /// number of stations that had any per-station `encode_args` override.
    pub examined: i64,
    /// ids of stations whose override exactly matched a known-stale
    /// default and was cleared back to NULL.
    pub cleared_station_ids: Vec<String>,
}

/// clear any per-station `encode_args` override that exactly matches a
/// previously-shipped node-wide default (see `KNOWN_STALE_ENCODE_ARGS`).
pub async fn clear_stale_default_encode_args() -> GrimoireResult<StaleEncodeArgsMigrationReport> {
    let pool = database::connect().await?;
    let rows = sqlx::query!(
        r#"SELECT id as "id!", encode_args FROM radio_stationz
           WHERE encode_args IS NOT NULL AND encode_args != ''"#
    )
    .fetch_all(&pool)
    .await?;

    let examined = rows.len() as i64;
    let mut cleared_station_ids = Vec::new();
    for row in rows {
        let Some(args) = row.encode_args else {
            continue;
        };
        if KNOWN_STALE_ENCODE_ARGS.contains(&args.as_str()) {
            sqlx::query!(
                "UPDATE radio_stationz SET encode_args = NULL WHERE id = ?",
                row.id
            )
            .execute(&pool)
            .await?;
            cleared_station_ids.push(row.id);
        }
    }

    Ok(StaleEncodeArgsMigrationReport {
        examined,
        cleared_station_ids,
    })
}

// ---------- filter clauses -----------------------------------------------
//
// reference-type rows (artist/album/taxon/tag/track/playlist) reference a
// real record id via one of the typed FK columns (artist_id / album_id /
// taxon_id / tag_id / song_id / playlist_id). criteria-type rows
// (favorite/rating/play_count/duration/added_days, added in migration
// 051) carry a plain numeric threshold in `criteria_value` instead (no
// value at all for `favorite`). the `filter_value` field returned to
// callers collapses whichever is set via COALESCE, keeping the wire
// shape stable across both data models.
//
// note: migration 038 renamed the genre-only `genre_id` column to a
// kind-agnostic `taxon_id` (still FK -> taxonz). a station can now
// include/exclude any taxon kind — genre, label, mood, era, region, ...

pub async fn list_filters(station_id: &str) -> GrimoireResult<Vec<StationFilter>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        StationFilter,
        r#"SELECT f.id as "id!", f.station_id as "station_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.taxon_id, f.tag_id, f.song_id, f.playlist_id,
                           f.video_id, f.video_series_id,
                           CAST(f.criteria_value AS TEXT), '') as "filter_value!: String",
                  COALESCE(ar.name, al.title, tx.label, t.name, s.title, p.title, v.title, vs.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!"
           FROM radio_station_filterz f
           LEFT JOIN artistz     ar ON ar.id = f.artist_id
           LEFT JOIN albumz      al ON al.id = f.album_id
           LEFT JOIN taxonz      tx ON tx.id = f.taxon_id
           LEFT JOIN tagz        t  ON t.id  = f.tag_id
           LEFT JOIN songz       s  ON s.id  = f.song_id
           LEFT JOIN playlistz   p  ON p.id  = f.playlist_id
           LEFT JOIN videoz      v  ON v.id  = f.video_id
           LEFT JOIN video_seriez vs ON vs.id = f.video_series_id
           WHERE f.station_id = ?
           ORDER BY f.created_at ASC"#,
        station_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

/// (artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, video_id,
/// video_series_id, criteria_value) — exactly one of these nine is `Some`
/// for a given filter row (or none, for `favorite`), per the CHECK
/// constraint added in migrations 051/081.
///
/// `pub(crate)` — shared with `external_storage::repository`, whose
/// filter-set-filter table has the identical FK/criteria shape.
pub(crate) type FilterInsertCols<'a> = (
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<&'a str>,
    Option<i64>,
);

/// validate a `(filter_type, filter_value, mode)` triple and route the
/// value into the right FK/criteria column, per the CHECK constraint
/// added in migration 051. shared by radio's `add_filter` and
/// `external_storage::repository::add_filter_set_filter` — the two
/// tables have identical filter-clause shapes, just different owners
/// (`station_id` vs `filter_set_id`).
///
/// `label` is used only in error messages (e.g. "radio" vs "sync filter").
pub(crate) fn parse_filter_clause<'a>(
    label: &str,
    filter_type: &str,
    filter_value: &'a str,
    mode: &str,
) -> GrimoireResult<(StationFilterType, &'static str, FilterInsertCols<'a>)> {
    let kind =
        StationFilterType::parse(filter_type).ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!(
                "{label}: unknown filter_type '{filter_type}' (expected one of artist, album, \
                 taxon, tag, track, playlist, video, video_series, all_videos, favorite, \
                 rating_gte, rating_lte, play_count_gte, play_count_lte, duration_gte, \
                 duration_lte, added_days_gte, added_days_lte)"
            ),
        })?;

    let mode = match mode.trim().to_ascii_lowercase().as_str() {
        "include" => "include",
        "exclude" => "exclude",
        other => {
            return Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "{label}: unknown filter mode '{other}' (expected include or exclude)"
                ),
            });
        }
    };

    // route the supplied value into the right column. all other FK
    // columns (and criteria_value, for reference types) are left null —
    // the schema CHECK constraint enforces this.
    let cols: FilterInsertCols = match kind {
        StationFilterType::Artist => (
            Some(filter_value),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        StationFilterType::Album => (
            None,
            Some(filter_value),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        StationFilterType::Taxon => (
            None,
            None,
            Some(filter_value),
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        StationFilterType::Tag => (
            None,
            None,
            None,
            Some(filter_value),
            None,
            None,
            None,
            None,
            None,
        ),
        StationFilterType::Track => (
            None,
            None,
            None,
            None,
            Some(filter_value),
            None,
            None,
            None,
            None,
        ),
        StationFilterType::Playlist => (
            None,
            None,
            None,
            None,
            None,
            Some(filter_value),
            None,
            None,
            None,
        ),
        StationFilterType::Video => (
            None,
            None,
            None,
            None,
            None,
            None,
            Some(filter_value),
            None,
            None,
        ),
        StationFilterType::VideoSeries => (
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(filter_value),
            None,
        ),
        StationFilterType::Favorite => (None, None, None, None, None, None, None, None, None),
        StationFilterType::AllVideos => (None, None, None, None, None, None, None, None, None),
        StationFilterType::RatingGte | StationFilterType::RatingLte => {
            let n: i64 =
                filter_value
                    .trim()
                    .parse()
                    .map_err(|_| GrimoireError::ProcessingFailed {
                        message: format!(
                            "{label}: filter_value '{filter_value}' for {} must be an integer 1-5",
                            kind.as_str()
                        ),
                    })?;
            if !(1..=5).contains(&n) {
                return Err(GrimoireError::ProcessingFailed {
                    message: format!(
                        "{label}: filter_value '{n}' for {} must be between 1 and 5",
                        kind.as_str()
                    ),
                });
            }
            (None, None, None, None, None, None, None, None, Some(n))
        }
        StationFilterType::PlayCountGte
        | StationFilterType::PlayCountLte
        | StationFilterType::DurationGte
        | StationFilterType::DurationLte
        | StationFilterType::AddedDaysGte
        | StationFilterType::AddedDaysLte => {
            let n: i64 =
                filter_value
                    .trim()
                    .parse()
                    .map_err(|_| GrimoireError::ProcessingFailed {
                        message: format!(
                    "{label}: filter_value '{filter_value}' for {} must be a non-negative integer",
                    kind.as_str()
                ),
                    })?;
            if n < 0 {
                return Err(GrimoireError::ProcessingFailed {
                    message: format!(
                        "{label}: filter_value '{n}' for {} must be non-negative",
                        kind.as_str()
                    ),
                });
            }
            (None, None, None, None, None, None, None, None, Some(n))
        }
    };
    Ok((kind, mode, cols))
}

pub async fn add_filter(
    station_id: &str,
    filter_type: &str,
    filter_value: &str,
    mode: &str,
) -> GrimoireResult<StationFilter> {
    let pool = database::connect().await?;

    let (
        kind,
        mode,
        (
            artist_id,
            album_id,
            taxon_id,
            tag_id,
            song_id,
            playlist_id,
            video_id,
            video_series_id,
            criteria_value,
        ),
    ) = parse_filter_clause("radio", filter_type, filter_value, mode)?;
    let kind_str = kind.as_str();

    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_station_filterz
              (station_id, filter_type, mode, artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, video_id, video_series_id, criteria_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id"#,
        station_id,
        kind_str,
        mode,
        artist_id,
        album_id,
        taxon_id,
        tag_id,
        song_id,
        playlist_id,
        video_id,
        video_series_id,
        criteria_value,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        StationFilter,
        r#"SELECT f.id as "id!", f.station_id as "station_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.taxon_id, f.tag_id, f.song_id, f.playlist_id,
                           f.video_id, f.video_series_id,
                           CAST(f.criteria_value AS TEXT), '') as "filter_value!: String",
                  COALESCE(ar.name, al.title, tx.label, t.name, s.title, p.title, v.title, vs.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!"
           FROM radio_station_filterz f
           LEFT JOIN artistz     ar ON ar.id = f.artist_id
           LEFT JOIN albumz      al ON al.id = f.album_id
           LEFT JOIN taxonz      tx ON tx.id = f.taxon_id
           LEFT JOIN tagz        t  ON t.id  = f.tag_id
           LEFT JOIN songz         s  ON s.id  = f.song_id
           LEFT JOIN playlistz   p  ON p.id  = f.playlist_id
           LEFT JOIN videoz      v  ON v.id  = f.video_id
           LEFT JOIN video_seriez vs ON vs.id = f.video_series_id
           WHERE f.id = ?"#,
        id
    )
    .fetch_one(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn remove_filter(filter_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!("DELETE FROM radio_station_filterz WHERE id = ?", filter_id)
        .execute(&pool)
        .await?;
    Ok(())
}

// ---------- playlist resolution ------------------------------------------

/// a station's effective candidate pool, split by domain. each side is
/// resolved independently (its own union-within-group/intersect-across-
/// group/subtract-excludes pass over only ITS OWN filter rows - see
/// `resolve_playlist`) rather than mixed into one intersection, since a
/// song-only filter type (e.g. `artist`) and a video-only one (e.g.
/// `video_series`) describe two unrelated content pools, not two
/// constraints on the same one - intersecting them would always yield
/// nothing. `video_ids` is empty for any station with zero video-type
/// filter rows, so a pre-existing song-only station's resolution is
/// completely unaffected by this struct's existence.
#[derive(Debug, Clone, Default)]
pub struct ResolvedPlaylist {
    pub song_ids: Vec<String>,
    pub video_ids: Vec<String>,
}

/// resolve a station's effective playlist across both domains.
///
/// rules (applied independently per-domain - see `ResolvedPlaylist`):
///   * includes are grouped by `filter_type`. within a group the matches
///     are UNIONed (e.g. two artist includes => songs by either artist).
///     across groups the unions are INTERSECTED (e.g. an artist include
///     plus a genre include => songs by that artist AND in that genre).
///   * the union of every `exclude` clause is then subtracted.
///   * when only excludes are configured for a domain, that domain's
///     candidate set is seeded from its full playable library so
///     excludes still take effect.
///   * when a domain has zero filter rows of its own, that domain's
///     result is empty — callers treat an empty `song_ids` the same way
///     they always have ("no source", falls back to the full library or
///     a global random pick); an empty `video_ids` simply means this
///     station has no video content configured (the common case today).
///
/// `content_mode` ('audio_only' | 'audio_or_video' | 'video_only', see
/// migration 082) gates whether either domain is resolved AT ALL -
/// 'audio_only' never runs a single video query (not just "discards the
/// result"), which is what makes it safe for `taxon`/`tag`/`favorite`/
/// `rating_gte`/`rating_lte`/`play_count_gte`/`play_count_lte`/
/// `duration_gte`/`duration_lte`/`added_days_gte`/`added_days_lte` filter
/// rows to ALSO match video content for a non-audio_only station: those
/// filter types now route into BOTH domains' independent resolution
/// passes (not just song's), but an 'audio_only' station's video pass
/// simply never executes, so its behavior is byte-for-byte identical to
/// before this existed.
///
/// rules (applied independently per-domain - see `ResolvedPlaylist`):
///   * includes are grouped by `filter_type`. within a group the matches
///     are UNIONed (e.g. two artist includes => songs by either artist).
///     across groups the unions are INTERSECTED (e.g. an artist include
///     plus a genre include => songs by that artist AND in that genre).
///   * the union of every `exclude` clause is then subtracted.
///   * when only excludes are configured for a domain, that domain's
///     candidate set is seeded from its full playable library so
///     excludes still take effect.
///   * when a domain has zero filter rows of its own, that domain's
///     result is empty — callers treat an empty `song_ids` the same way
///     they always have ("no source", falls back to the full library or
///     a global random pick); an empty `video_ids` simply means this
///     station has no video content configured (the common case today).
pub async fn resolve_playlist(
    station_id: &str,
    content_mode: &str,
) -> GrimoireResult<ResolvedPlaylist> {
    let pool = database::connect().await?;

    let resolve_song = content_mode != "video_only";
    let resolve_video = content_mode != "audio_only";

    let filters = list_filters_with_fks(&pool, station_id).await?;

    // strictly video-only reference types - no song equivalent at all.
    const VIDEO_ONLY_FILTER_TYPES: [&str; 3] = ["video", "video_series", "all_videos"];
    // types that describe the same real-world concept for either domain
    // - these rows participate in BOTH domains' independent resolution
    // (each still resolved via its own clause-resolver/full-library
    // fallback), not just song's. `artist`/`album`/`track`/`playlist`
    // stay song-only (no video equivalent for the first three; `playlist`
    // wasn't part of this feature's ask even though playlist_itemz
    // already supports mixed song+video playlists).
    const CROSS_DOMAIN_FILTER_TYPES: [&str; 11] = [
        "taxon",
        "tag",
        "favorite",
        "rating_gte",
        "rating_lte",
        "play_count_gte",
        "play_count_lte",
        "duration_gte",
        "duration_lte",
        "added_days_gte",
        "added_days_lte",
    ];

    let song_ids = if resolve_song {
        let song_filters: Vec<&FilterRow> = filters
            .iter()
            .filter(|f| !VIDEO_ONLY_FILTER_TYPES.contains(&f.filter_type.as_str()))
            .collect();
        resolve_domain(
            &pool,
            &song_filters,
            song_ids_for_clause_default,
            all_playable_song_ids,
        )
        .await?
    } else {
        Default::default()
    };
    let video_ids = if resolve_video {
        let video_filters: Vec<&FilterRow> = filters
            .iter()
            .filter(|f| {
                VIDEO_ONLY_FILTER_TYPES.contains(&f.filter_type.as_str())
                    || CROSS_DOMAIN_FILTER_TYPES.contains(&f.filter_type.as_str())
            })
            .collect();
        resolve_domain(
            &pool,
            &video_filters,
            video_ids_for_clause_default,
            all_playable_video_ids,
        )
        .await?
    } else {
        Default::default()
    };

    Ok(ResolvedPlaylist {
        song_ids: song_ids.into_iter().collect(),
        video_ids: video_ids.into_iter().collect(),
    })
}

/// `song_ids_for_clause` takes an extra `scoped_user_id` param that
/// `resolve_domain`'s generic clause-resolver signature doesn't need
/// (radio stations are shared, not per-listener - always `None`, see
/// `song_ids_for_clause`'s own doc comment) - this thin wrapper adapts it
/// to the same `(pool, clause) -> Vec<String>` shape `video_ids_for_clause`
/// already has, so both can share `resolve_domain`.
async fn song_ids_for_clause_default(
    pool: &sqlx::SqlitePool,
    clause: &FilterRow,
) -> GrimoireResult<Vec<String>> {
    song_ids_for_clause(pool, clause, None).await
}

/// shared include/exclude resolution algorithm for one domain's filter
/// rows - see `ResolvedPlaylist`'s doc comment for why song and video
/// candidates are never intersected against each other. `clause_fn`
/// resolves one filter row to matching ids for this domain;
/// `all_ids_fn` seeds the seen-set when only excludes are configured (or
/// there are no filter rows for this domain, which correctly yields an
/// empty set via the `filters.is_empty()` early return below - the
/// exclude-only fallback only applies when there's at least one
/// (exclude) row).
async fn resolve_domain<'a, ClauseFut, AllFut>(
    pool: &'a sqlx::SqlitePool,
    filters: &[&'a FilterRow],
    clause_fn: impl Fn(&'a sqlx::SqlitePool, &'a FilterRow) -> ClauseFut,
    all_ids_fn: impl FnOnce(&'a sqlx::SqlitePool) -> AllFut,
) -> GrimoireResult<std::collections::HashSet<String>>
where
    ClauseFut: std::future::Future<Output = GrimoireResult<Vec<String>>> + 'a,
    AllFut: std::future::Future<Output = GrimoireResult<Vec<String>>>,
{
    if filters.is_empty() {
        return Ok(std::collections::HashSet::new());
    }

    let includes: Vec<&FilterRow> = filters
        .iter()
        .copied()
        .filter(|f| f.mode == "include")
        .collect();
    let excludes: Vec<&FilterRow> = filters
        .iter()
        .copied()
        .filter(|f| f.mode == "exclude")
        .collect();

    let mut result: std::collections::HashSet<String> = if includes.is_empty() {
        all_ids_fn(pool).await?.into_iter().collect()
    } else {
        let mut by_type: std::collections::HashMap<String, std::collections::HashSet<String>> =
            std::collections::HashMap::new();
        for clause in &includes {
            let matches = clause_fn(pool, clause).await?;
            by_type
                .entry(clause.filter_type.clone())
                .or_default()
                .extend(matches);
        }
        let mut iter = by_type.into_values();
        let mut acc = iter.next().unwrap_or_default();
        for next in iter {
            acc = acc.intersection(&next).cloned().collect();
        }
        acc
    };

    for clause in &excludes {
        let matches = clause_fn(pool, clause).await?;
        for id in matches {
            result.remove(&id);
        }
    }

    Ok(result)
}

/// every playable song id in the library — used as the seed set when a
/// station has only `exclude` filters configured. mirrors the query in
/// `playlist::all_playable_songs` but lives here to avoid a cross-module
/// dependency.
///
/// `pub(crate)` — shared with `external_storage::repository` for the
/// same include-fallback role in filter-set resolution.
pub(crate) async fn all_playable_song_ids(pool: &sqlx::SqlitePool) -> GrimoireResult<Vec<String>> {
    sqlx::query_scalar!(
        r#"SELECT DISTINCT s.id as "song_id!"
           FROM songz s
           JOIN media_blobz b ON b.id = s.media_blob_id
           WHERE b.local_path IS NOT NULL
             AND s.deleted_at IS NULL
             AND b.deleted_at IS NULL"#
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)
}

/// every playable video id in the library — the video-domain counterpart
/// of `all_playable_song_ids`, used as the seed set when a station has
/// only `exclude`-mode video filters configured.
pub(crate) async fn all_playable_video_ids(pool: &sqlx::SqlitePool) -> GrimoireResult<Vec<String>> {
    sqlx::query_scalar!(
        r#"SELECT DISTINCT v.id as "video_id!"
           FROM videoz v
           JOIN media_blobz b ON b.id = v.media_blob_id
           WHERE b.local_path IS NOT NULL
             AND v.deleted_at IS NULL
             AND b.deleted_at IS NULL"#
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)
}

/// look up video ids for one filter clause - the video-domain counterpart
/// of `song_ids_for_clause`. handles the two video-only reference types
/// (`video`/`video_series`), the `all_videos` marker, and mirrors of
/// every cross-domain criteria type `song_ids_for_clause` also handles
/// (`taxon`/`tag`/`favorite`/`rating_gte`/`rating_lte`/`play_count_gte`/
/// `play_count_lte`/`duration_gte`/`duration_lte`/`added_days_gte`/
/// `added_days_lte`) - see `resolve_playlist`'s `CROSS_DOMAIN_FILTER_TYPES`
/// for which types actually get routed here at all (gated on the
/// station's `content_mode` there, not here - this function has no idea
/// what station it's being called for). `artist`/`album`/`track`/
/// `playlist` stay song-only (videos have no artist/album concept, and
/// `playlist` wasn't part of the user's ask - `playlist_itemz` already
/// supports mixed song+video playlists server-side if that's wanted
/// later).
///
/// `scoped_user_id` mirrors `song_ids_for_clause`'s param of the same
/// name - `None` for radio (any-user cascade), `Some(uid)` reserved for
/// a future per-user caller (external_storage sync doesn't call this
/// yet).
pub(crate) async fn video_ids_for_clause(
    pool: &sqlx::SqlitePool,
    clause: &FilterRow,
    scoped_user_id: Option<&str>,
) -> GrimoireResult<Vec<String>> {
    let rows: Vec<String> = match clause.filter_type.as_str() {
        "video" => match &clause.video_id {
            Some(id) => vec![id.clone()],
            None => Vec::new(),
        },
        "video_series" => match &clause.video_series_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT id as "video_id!" FROM videoz
                   WHERE series_id = ? AND deleted_at IS NULL"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "all_videos" => all_playable_video_ids(pool).await?,
        // ---- cross-domain criteria types (mirror song_ids_for_clause) --
        //
        // taxon/tag cascade: a video matches if IT, its video_series, or
        // its video_season (any of the three - `entity_taxonz`/
        // `entity_tagz` are polymorphic across all three, see
        // `VideoEntityType`) carries the tag/taxon. series_id/season_id
        // are NULL for a standalone video, so those joins simply never
        // match for one - safe.
        "taxon" => match &clause.taxon_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT v.id as "video_id!"
                   FROM videoz v
                   LEFT JOIN entity_taxonz et_v ON et_v.entity_type = 'video'
                          AND et_v.entity_id = v.id AND et_v.taxon_id = ?
                   LEFT JOIN entity_taxonz et_s ON et_s.entity_type = 'video_series'
                          AND et_s.entity_id = v.series_id AND et_s.taxon_id = ?
                   LEFT JOIN entity_taxonz et_e ON et_e.entity_type = 'video_season'
                          AND et_e.entity_id = v.season_id AND et_e.taxon_id = ?
                   WHERE et_v.taxon_id IS NOT NULL OR et_s.taxon_id IS NOT NULL
                      OR et_e.taxon_id IS NOT NULL"#,
                    id,
                    id,
                    id,
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "tag" => match &clause.tag_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT v.id as "video_id!"
                   FROM videoz v
                   LEFT JOIN entity_tagz et_v ON et_v.entity_type = 'video'
                          AND et_v.entity_id = v.id AND et_v.tag_id = ?
                   LEFT JOIN entity_tagz et_s ON et_s.entity_type = 'video_series'
                          AND et_s.entity_id = v.series_id AND et_s.tag_id = ?
                   LEFT JOIN entity_tagz et_e ON et_e.entity_type = 'video_season'
                          AND et_e.entity_id = v.season_id AND et_e.tag_id = ?
                   WHERE et_v.tag_id IS NOT NULL OR et_s.tag_id IS NOT NULL
                      OR et_e.tag_id IS NOT NULL"#,
                    id,
                    id,
                    id,
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        // favorite/rating cascade: a video matches if IT, its
        // video_series, or a playlist containing it is
        // favorited/rated. no video_season level here - unlike
        // taxon/tag, favorites/ratings only ever target 'video'/
        // 'video_series'/'playlist' (see client-side FavoriteTarget).
        "favorite" => match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
            Some(uid) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT v.id as "video_id!"
                   FROM videoz v
                   LEFT JOIN user_favoritez fv
                          ON fv.target_type = 'video' AND fv.target_id = v.id AND fv.user_id = ?
                   LEFT JOIN user_favoritez fs
                          ON fs.target_type = 'video_series' AND fs.target_id = v.series_id AND fs.user_id = ?
                   LEFT JOIN playlist_itemz pi ON pi.entity_id = v.id AND pi.entity_type = 'video'
                   LEFT JOIN user_favoritez fp
                          ON fp.target_type = 'playlist' AND fp.target_id = pi.playlist_id AND fp.user_id = ?
                   WHERE fv.id IS NOT NULL OR fs.id IS NOT NULL OR fp.id IS NOT NULL"#,
                    uid,
                    uid,
                    uid,
                )
                .fetch_all(pool)
                .await?
            }
            None => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT v.id as "video_id!"
                   FROM videoz v
                   LEFT JOIN user_favoritez fv
                          ON fv.target_type = 'video' AND fv.target_id = v.id
                   LEFT JOIN user_favoritez fs
                          ON fs.target_type = 'video_series' AND fs.target_id = v.series_id
                   LEFT JOIN playlist_itemz pi ON pi.entity_id = v.id AND pi.entity_type = 'video'
                   LEFT JOIN user_favoritez fp
                          ON fp.target_type = 'playlist' AND fp.target_id = pi.playlist_id
                   WHERE fv.id IS NOT NULL OR fs.id IS NOT NULL OR fp.id IS NOT NULL"#
                )
                .fetch_all(pool)
                .await?
            }
        },
        "rating_gte" => match clause.criteria_value {
            Some(threshold) => {
                match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
                    Some(uid) => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT v.id as "video_id!"
                           FROM videoz v
                           LEFT JOIN user_ratingz rv
                                  ON rv.target_type = 'video' AND rv.target_id = v.id
                                     AND rv.rating >= ? AND rv.user_id = ?
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'video_series' AND rs.target_id = v.series_id
                                     AND rs.rating >= ? AND rs.user_id = ?
                           WHERE rv.id IS NOT NULL OR rs.id IS NOT NULL"#,
                            threshold,
                            uid,
                            threshold,
                            uid,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                    None => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT v.id as "video_id!"
                           FROM videoz v
                           LEFT JOIN user_ratingz rv
                                  ON rv.target_type = 'video' AND rv.target_id = v.id AND rv.rating >= ?
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'video_series' AND rs.target_id = v.series_id AND rs.rating >= ?
                           WHERE rv.id IS NOT NULL OR rs.id IS NOT NULL"#,
                            threshold,
                            threshold,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                }
            }
            None => Vec::new(),
        },
        "rating_lte" => match clause.criteria_value {
            Some(threshold) => {
                match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
                    Some(uid) => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT v.id as "video_id!"
                           FROM videoz v
                           LEFT JOIN user_ratingz rv
                                  ON rv.target_type = 'video' AND rv.target_id = v.id
                                     AND rv.rating <= ? AND rv.user_id = ?
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'video_series' AND rs.target_id = v.series_id
                                     AND rs.rating <= ? AND rs.user_id = ?
                           WHERE rv.id IS NOT NULL OR rs.id IS NOT NULL"#,
                            threshold,
                            uid,
                            threshold,
                            uid,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                    None => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT v.id as "video_id!"
                           FROM videoz v
                           LEFT JOIN user_ratingz rv
                                  ON rv.target_type = 'video' AND rv.target_id = v.id AND rv.rating <= ?
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'video_series' AND rs.target_id = v.series_id AND rs.rating <= ?
                           WHERE rv.id IS NOT NULL OR rs.id IS NOT NULL"#,
                            threshold,
                            threshold,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                }
            }
            None => Vec::new(),
        },
        "play_count_gte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!"
                   FROM videoz v
                   WHERE (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = v.id) >= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "play_count_lte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!"
                   FROM videoz v
                   WHERE (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = v.id) <= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "duration_gte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!" FROM videoz v
                   WHERE v.duration_seconds IS NOT NULL AND v.duration_seconds >= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "duration_lte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!" FROM videoz v
                   WHERE v.duration_seconds IS NOT NULL AND v.duration_seconds <= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        // same "added at least/most n days ago" inversion as songs - see
        // StationFilterType's doc comments.
        "added_days_gte" => match clause.criteria_value {
            Some(days) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!" FROM videoz v
                   WHERE v.created_at <= unixepoch() - (? * 86400)"#,
                    days
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "added_days_lte" => match clause.criteria_value {
            Some(days) => {
                sqlx::query_scalar!(
                    r#"SELECT v.id as "video_id!" FROM videoz v
                   WHERE v.created_at >= unixepoch() - (? * 86400)"#,
                    days
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        _ => Vec::new(),
    };
    Ok(rows)
}

/// thin wrapper adapting `video_ids_for_clause`'s 3-arg signature to the
/// 2-arg `(pool, clause) -> Vec<String>` shape `resolve_domain` expects -
/// mirrors `song_ids_for_clause_default` exactly, same reasoning (radio
/// stations are shared, not per-listener, so `scoped_user_id` is always
/// `None` here).
async fn video_ids_for_clause_default(
    pool: &sqlx::SqlitePool,
    clause: &FilterRow,
) -> GrimoireResult<Vec<String>> {
    video_ids_for_clause(pool, clause, None).await
}

/// internal row carrying the typed FK columns alongside the metadata.
///
/// `pub(crate)` — shared with `external_storage::repository`'s filter-set
/// resolution, which builds this same shape from its own table.
pub(crate) struct FilterRow {
    pub(crate) filter_type: String,
    pub(crate) mode: String,
    pub(crate) artist_id: Option<String>,
    pub(crate) album_id: Option<String>,
    pub(crate) taxon_id: Option<String>,
    pub(crate) tag_id: Option<String>,
    pub(crate) song_id: Option<String>,
    pub(crate) playlist_id: Option<String>,
    pub(crate) video_id: Option<String>,
    pub(crate) video_series_id: Option<String>,
    pub(crate) criteria_value: Option<i64>,
    /// 1 = "everyone's" (favorite/rating), NULL/anything else = "just this
    /// user's". `radio_station_filterz` has no such column (radio's
    /// `favorite`/`rating_gte`/`rating_lte` are always any-user, see
    /// `song_ids_for_clause`) - always NULL there.
    pub(crate) criteria_scope: Option<i64>,
}

async fn list_filters_with_fks(
    pool: &sqlx::SqlitePool,
    station_id: &str,
) -> GrimoireResult<Vec<FilterRow>> {
    sqlx::query_as!(
        FilterRow,
        r#"SELECT filter_type as "filter_type!",
                  mode as "mode!",
                  artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
                  video_id, video_series_id, criteria_value,
                  NULL as "criteria_scope: i64"
           FROM radio_station_filterz
           WHERE station_id = ?
           ORDER BY created_at ASC"#,
        station_id
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)
}

/// look up song ids for one filter clause via FK joins. unknown
/// filter_type values (or rows with all FK columns null — should be
/// impossible thanks to the CHECK constraint) yield an empty vec.
///
/// `scoped_user_id` scopes the `"favorite"`/`"rating_gte"`/`"rating_lte"`
/// clauses to one user's favorites/ratings instead of any user's —
/// `None` preserves the original any-user cascade (radio stations are
/// shared, not per-listener).
///
/// `pub(crate)` — shared with `external_storage::repository` so
/// removable-storage sync filter-sets resolve identically to radio
/// station seed filters, without duplicating this SQL.
pub(crate) async fn song_ids_for_clause(
    pool: &sqlx::SqlitePool,
    clause: &FilterRow,
    scoped_user_id: Option<&str>,
) -> GrimoireResult<Vec<String>> {
    let rows: Vec<String> = match clause.filter_type.as_str() {
        "artist" => match &clause.artist_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT ars.song_id as "song_id!"
                   FROM artist_songz ars
                   WHERE ars.artist_id = ?"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "album" => match &clause.album_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT als.song_id as "song_id!"
                   FROM album_songz als
                   WHERE als.album_id = ?"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "taxon" => match &clause.taxon_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT als.song_id as "song_id!"
                   FROM album_taxonz ag
                   JOIN album_songz als ON als.album_id = ag.album_id
                   WHERE ag.taxon_id = ?"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "tag" => match &clause.tag_id {
            Some(id) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT als.song_id as "song_id!"
                   FROM album_tagz at
                   JOIN album_songz als ON als.album_id = at.album_id
                   WHERE at.tag_id = ?"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "track" => match &clause.song_id {
            Some(id) => vec![id.clone()],
            None => Vec::new(),
        },
        "playlist" => match &clause.playlist_id {
            Some(id) => {
                // resolve at tune time — edits to the playlist propagate
                // automatically without re-syncing the station.
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT ps.entity_id as "song_id!"
                   FROM playlist_itemz ps
                   WHERE ps.playlist_id = ? AND ps.entity_type = 'song'"#,
                    id
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        // ---- criteria types (migration 051) --------------------------
        //
        // favorite/rating cascade: a song counts as a match if it (or its
        // album, or its artist, or — favorite only — a playlist it's in)
        // is favorited/rated by ANY user. this intentionally pulls in
        // every song on a favorited album/by a favorited artist (not just
        // individually-favorited songs) so album-mode stations can still
        // play the whole album in track order instead of a sparse subset.
        // per-clause opt-out: a "favorite" clause defaults to the calling
        // user's own favorites (scoped_user_id), but `criteria_scope = 1`
        // ("everyone's favorites", chosen per-clause in the sync filter
        // editor) falls back to the any-user cascade instead - same one
        // radio stations always use, since they have no per-listener user.
        "favorite" => match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
            Some(uid) => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT s.id as "song_id!"
                   FROM songz s
                   LEFT JOIN user_favoritez fs
                          ON fs.target_type = 'song' AND fs.target_id = s.id AND fs.user_id = ?
                   LEFT JOIN album_songz als ON als.song_id = s.id
                   LEFT JOIN user_favoritez fal
                          ON fal.target_type = 'album' AND fal.target_id = als.album_id AND fal.user_id = ?
                   LEFT JOIN artist_songz ars ON ars.song_id = s.id
                   LEFT JOIN user_favoritez far
                          ON far.target_type = 'artist' AND far.target_id = ars.artist_id AND far.user_id = ?
                   LEFT JOIN playlist_itemz ps ON ps.entity_id = s.id AND ps.entity_type = 'song'
                   LEFT JOIN user_favoritez fap
                          ON fap.target_type = 'playlist' AND fap.target_id = ps.playlist_id AND fap.user_id = ?
                   WHERE fs.id IS NOT NULL OR fal.id IS NOT NULL
                      OR far.id IS NOT NULL OR fap.id IS NOT NULL"#,
                    uid,
                    uid,
                    uid,
                    uid,
                )
                .fetch_all(pool)
                .await?
            }
            None => {
                sqlx::query_scalar!(
                    r#"SELECT DISTINCT s.id as "song_id!"
                   FROM songz s
                   LEFT JOIN user_favoritez fs
                          ON fs.target_type = 'song' AND fs.target_id = s.id
                   LEFT JOIN album_songz als ON als.song_id = s.id
                   LEFT JOIN user_favoritez fal
                          ON fal.target_type = 'album' AND fal.target_id = als.album_id
                   LEFT JOIN artist_songz ars ON ars.song_id = s.id
                   LEFT JOIN user_favoritez far
                          ON far.target_type = 'artist' AND far.target_id = ars.artist_id
                   LEFT JOIN playlist_itemz ps ON ps.entity_id = s.id AND ps.entity_type = 'song'
                   LEFT JOIN user_favoritez fap
                          ON fap.target_type = 'playlist' AND fap.target_id = ps.playlist_id
                   WHERE fs.id IS NOT NULL OR fal.id IS NOT NULL
                      OR far.id IS NOT NULL OR fap.id IS NOT NULL"#
                )
                .fetch_all(pool)
                .await?
            }
        },
        // same per-clause opt-out as "favorite" above: defaults to the
        // calling user's own ratings, `criteria_scope = 1` ("everyone's
        // ratings") falls back to the any-user cascade radio always uses.
        "rating_gte" => match clause.criteria_value {
            Some(threshold) => {
                match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
                    Some(uid) => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT s.id as "song_id!"
                           FROM songz s
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'song' AND rs.target_id = s.id
                                     AND rs.rating >= ? AND rs.user_id = ?
                           LEFT JOIN album_songz als ON als.song_id = s.id
                           LEFT JOIN user_ratingz ral
                                  ON ral.target_type = 'album' AND ral.target_id = als.album_id
                                     AND ral.rating >= ? AND ral.user_id = ?
                           LEFT JOIN artist_songz ars ON ars.song_id = s.id
                           LEFT JOIN user_ratingz rar
                                  ON rar.target_type = 'artist' AND rar.target_id = ars.artist_id
                                     AND rar.rating >= ? AND rar.user_id = ?
                           WHERE rs.id IS NOT NULL OR ral.id IS NOT NULL OR rar.id IS NOT NULL"#,
                            threshold,
                            uid,
                            threshold,
                            uid,
                            threshold,
                            uid,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                    None => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT s.id as "song_id!"
                           FROM songz s
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'song' AND rs.target_id = s.id AND rs.rating >= ?
                           LEFT JOIN album_songz als ON als.song_id = s.id
                           LEFT JOIN user_ratingz ral
                                  ON ral.target_type = 'album' AND ral.target_id = als.album_id AND ral.rating >= ?
                           LEFT JOIN artist_songz ars ON ars.song_id = s.id
                           LEFT JOIN user_ratingz rar
                                  ON rar.target_type = 'artist' AND rar.target_id = ars.artist_id AND rar.rating >= ?
                           WHERE rs.id IS NOT NULL OR ral.id IS NOT NULL OR rar.id IS NOT NULL"#,
                            threshold,
                            threshold,
                            threshold,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                }
            }
            None => Vec::new(),
        },
        "rating_lte" => match clause.criteria_value {
            Some(threshold) => {
                match scoped_user_id.filter(|_| clause.criteria_scope != Some(1)) {
                    Some(uid) => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT s.id as "song_id!"
                           FROM songz s
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'song' AND rs.target_id = s.id
                                     AND rs.rating <= ? AND rs.user_id = ?
                           LEFT JOIN album_songz als ON als.song_id = s.id
                           LEFT JOIN user_ratingz ral
                                  ON ral.target_type = 'album' AND ral.target_id = als.album_id
                                     AND ral.rating <= ? AND ral.user_id = ?
                           LEFT JOIN artist_songz ars ON ars.song_id = s.id
                           LEFT JOIN user_ratingz rar
                                  ON rar.target_type = 'artist' AND rar.target_id = ars.artist_id
                                     AND rar.rating <= ? AND rar.user_id = ?
                           WHERE rs.id IS NOT NULL OR ral.id IS NOT NULL OR rar.id IS NOT NULL"#,
                            threshold,
                            uid,
                            threshold,
                            uid,
                            threshold,
                            uid,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                    None => {
                        sqlx::query_scalar!(
                            r#"SELECT DISTINCT s.id as "song_id!"
                           FROM songz s
                           LEFT JOIN user_ratingz rs
                                  ON rs.target_type = 'song' AND rs.target_id = s.id AND rs.rating <= ?
                           LEFT JOIN album_songz als ON als.song_id = s.id
                           LEFT JOIN user_ratingz ral
                                  ON ral.target_type = 'album' AND ral.target_id = als.album_id AND ral.rating <= ?
                           LEFT JOIN artist_songz ars ON ars.song_id = s.id
                           LEFT JOIN user_ratingz rar
                                  ON rar.target_type = 'artist' AND rar.target_id = ars.artist_id AND rar.rating <= ?
                           WHERE rs.id IS NOT NULL OR ral.id IS NOT NULL OR rar.id IS NOT NULL"#,
                            threshold,
                            threshold,
                            threshold,
                        )
                        .fetch_all(pool)
                        .await?
                    }
                }
            }
            None => Vec::new(),
        },
        "play_count_gte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!"
                   FROM songz s
                   WHERE (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'song' AND entity_id = s.id) >= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "play_count_lte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!"
                   FROM songz s
                   WHERE (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'song' AND entity_id = s.id) <= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "duration_gte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!" FROM songz s
                   WHERE s.duration IS NOT NULL AND s.duration >= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "duration_lte" => match clause.criteria_value {
            Some(threshold) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!" FROM songz s
                   WHERE s.duration IS NOT NULL AND s.duration <= ?"#,
                    threshold
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        // "added_days_gte" (added AT LEAST n days ago, i.e. older than the
        // cutoff) and "added_days_lte" (added AT MOST n days ago, i.e. more
        // recent than the cutoff) are intentionally inverted relative to
        // their timestamp comparison — see StationFilterType docs.
        "added_days_gte" => match clause.criteria_value {
            Some(days) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!" FROM songz s
                   WHERE s.created_at <= unixepoch() - (? * 86400)"#,
                    days
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        "added_days_lte" => match clause.criteria_value {
            Some(days) => {
                sqlx::query_scalar!(
                    r#"SELECT s.id as "song_id!" FROM songz s
                   WHERE s.created_at >= unixepoch() - (? * 86400)"#,
                    days
                )
                .fetch_all(pool)
                .await?
            }
            None => Vec::new(),
        },
        _ => Vec::new(),
    };
    Ok(rows)
}

// ---------- play history -------------------------------------------------

/// record that a track started playing. returns the play history id so
/// the caller can later mark it finished with [`finish_play`].
pub async fn record_play(
    station_id: &str,
    song_id: &str,
    listener_count: i64,
) -> GrimoireResult<String> {
    let pool = database::connect().await?;
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_play_historyz
              (station_id, song_id, listener_count)
           VALUES (?, ?, ?)
           RETURNING id"#,
        station_id,
        song_id,
        listener_count,
    )
    .fetch_one(&pool)
    .await?;
    Ok(id)
}

/// stamp duration_ms on a previously-recorded play. safe to call even if
/// the row was deleted (returns Ok with 0 rows affected).
pub async fn finish_play(play_id: &str, duration_ms: i64) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "UPDATE radio_play_historyz SET duration_ms = ? WHERE id = ?",
        duration_ms,
        play_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

pub async fn list_play_history(
    station_id: &str,
    limit: i64,
) -> GrimoireResult<Vec<PlayHistoryEntry>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        PlayHistoryEntry,
        r#"SELECT id as "id!", station_id as "station_id!", song_id as "song_id!",
                  started_at as "started_at!", duration_ms,
                  listener_count as "listener_count!"
           FROM radio_play_historyz
           WHERE station_id = ?
           ORDER BY started_at DESC
           LIMIT ?"#,
        station_id,
        limit
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}
