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
                  created_at as "created_at!", updated_at as "updated_at!"
           FROM radio_stationz WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn create_station(req: CreateStationRequest) -> GrimoireResult<RadioStation> {
    let pool = database::connect().await?;
    let is_public = req.is_public.unwrap_or(false) as i64;
    let is_enabled = req.is_enabled.unwrap_or(true) as i64;
    let timeline_only_mode = req.timeline_only_mode.unwrap_or(false) as i64;
    let codec = req
        .codec
        .unwrap_or_else(|| crate::radio::config::MSE_CODEC.to_string());
    let play_mode = normalize_play_mode(req.play_mode);

    // sqlite generates id via DEFAULT (lower(hex(randomblob(8))))
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_stationz
                  (name, description, is_public, is_enabled, encode_args, codec, play_mode, timeline_only_mode)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id"#,
        req.name,
        req.description,
        is_public,
        is_enabled,
        req.encode_args,
        codec,
        play_mode,
          timeline_only_mode,
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
              updated_at         = unixepoch()
           WHERE id = ?"#,
        req.name,
        req.description,
        is_public,
        is_enabled,
        req.encode_args,
        req.codec,
        play_mode,
        timeline_only_mode,
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
    // music_play_eventz.radio_station_id has no ON DELETE action (see
    // migrations/026_play_count_views.sql). nullify any references first so
    // the cascade-less FK doesn't block the station delete. preserves the
    // historical play event for song/album/artist crediting.
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "UPDATE music_play_eventz SET radio_station_id = NULL WHERE radio_station_id = ?",
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

// ---------- filter clauses -----------------------------------------------
//
// every filter row references a real record id via one of the typed FK
// columns (artist_id / album_id / genre_id / tag_id / song_id). the
// `filter_value` field returned to callers is the chosen FK id
// (collapsed via COALESCE), keeping the wire shape stable across the
// data-model rewrite.

pub async fn list_filters(station_id: &str) -> GrimoireResult<Vec<StationFilter>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        StationFilter,
        r#"SELECT f.id as "id!", f.station_id as "station_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.genre_id, f.tag_id, f.song_id, f.playlist_id) as "filter_value!: String",
                  COALESCE(ar.name, al.title, g.label, t.name, s.title, p.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!"
           FROM radio_station_filterz f
           LEFT JOIN artistz   ar ON ar.id = f.artist_id
           LEFT JOIN albumz    al ON al.id = f.album_id
           LEFT JOIN taxonz    g  ON g.id  = f.genre_id
           LEFT JOIN tagz      t  ON t.id  = f.tag_id
           LEFT JOIN songz     s  ON s.id  = f.song_id
           LEFT JOIN playlistz p  ON p.id  = f.playlist_id
           WHERE f.station_id = ?
           ORDER BY f.created_at ASC"#,
        station_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn add_filter(
    station_id: &str,
    filter_type: &str,
    filter_value: &str,
    mode: &str,
) -> GrimoireResult<StationFilter> {
    let pool = database::connect().await?;

    // validate filter_type up front so we can route the FK insert.
    let kind = StationFilterType::parse(filter_type).ok_or_else(|| {
        GrimoireError::ProcessingFailed {
            message: format!(
                "radio: unknown filter_type '{filter_type}' (expected one of artist, album, genre, tag, track, playlist)"
            ),
        }
    })?;

    let mode = match mode.trim().to_ascii_lowercase().as_str() {
        "include" => "include",
        "exclude" => "exclude",
        other => {
            return Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "radio: unknown filter mode '{other}' (expected include or exclude)"
                ),
            });
        }
    };

    // route the supplied id into the right FK column. all other FK
    // columns are left null — the schema CHECK constraint enforces this.
    let (artist_id, album_id, genre_id, tag_id, song_id, playlist_id) = match kind {
        StationFilterType::Artist => (Some(filter_value), None, None, None, None, None),
        StationFilterType::Album => (None, Some(filter_value), None, None, None, None),
        StationFilterType::Genre => (None, None, Some(filter_value), None, None, None),
        StationFilterType::Tag => (None, None, None, Some(filter_value), None, None),
        StationFilterType::Track => (None, None, None, None, Some(filter_value), None),
        StationFilterType::Playlist => (None, None, None, None, None, Some(filter_value)),
    };
    let kind_str = kind.as_str();

    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_station_filterz
              (station_id, filter_type, mode, artist_id, album_id, genre_id, tag_id, song_id, playlist_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id"#,
        station_id,
        kind_str,
        mode,
        artist_id,
        album_id,
        genre_id,
        tag_id,
        song_id,
        playlist_id,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        StationFilter,
        r#"SELECT f.id as "id!", f.station_id as "station_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.genre_id, f.tag_id, f.song_id, f.playlist_id) as "filter_value!: String",
                  COALESCE(ar.name, al.title, g.label, t.name, s.title, p.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!"
           FROM radio_station_filterz f
           LEFT JOIN artistz   ar ON ar.id = f.artist_id
           LEFT JOIN albumz    al ON al.id = f.album_id
           LEFT JOIN taxonz    g  ON g.id  = f.genre_id
           LEFT JOIN tagz      t  ON t.id  = f.tag_id
           LEFT JOIN songz     s  ON s.id  = f.song_id
           LEFT JOIN playlistz p  ON p.id  = f.playlist_id
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

/// resolve a station's effective song list. returns DISTINCT song ids.
///
/// rules:
///   * includes are grouped by `filter_type`. within a group the matches
///     are UNIONed (e.g. two artist includes => songs by either artist).
///     across groups the unions are INTERSECTED (e.g. an artist include
///     plus a genre include => songs by that artist AND in that genre).
///   * the union of every `exclude` clause is then subtracted.
///   * when only excludes are configured, the candidate set is seeded
///     from the full playable library so excludes still take effect.
///   * when there are zero filter rows, returns an empty vec — caller
///     treats this as "no source" and falls back to the full library or
///     a global random pick.
pub async fn resolve_playlist(station_id: &str) -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;

    let filters = list_filters_with_fks(&pool, station_id).await?;

    if filters.is_empty() {
        return Ok(Vec::new());
    }

    let includes: Vec<&FilterRow> = filters.iter().filter(|f| f.mode == "include").collect();
    let excludes: Vec<&FilterRow> = filters.iter().filter(|f| f.mode == "exclude").collect();

    // group includes by filter_type, then union within a group and
    // intersect across groups.
    let mut result: std::collections::HashSet<String> = if includes.is_empty() {
        all_playable_song_ids(&pool).await?.into_iter().collect()
    } else {
        let mut by_type: std::collections::HashMap<String, std::collections::HashSet<String>> =
            std::collections::HashMap::new();
        for clause in &includes {
            let matches = song_ids_for_clause(&pool, clause).await?;
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

    // subtract excludes (union of every exclude clause).
    for clause in &excludes {
        let matches = song_ids_for_clause(&pool, clause).await?;
        for id in matches {
            result.remove(&id);
        }
    }

    Ok(result.into_iter().collect())
}

/// every playable song id in the library — used as the seed set when a
/// station has only `exclude` filters configured. mirrors the query in
/// `playlist::all_playable_songs` but lives here to avoid a cross-module
/// dependency.
async fn all_playable_song_ids(pool: &sqlx::SqlitePool) -> GrimoireResult<Vec<String>> {
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

/// internal row carrying the typed FK columns alongside the metadata.
struct FilterRow {
    filter_type: String,
    mode: String,
    artist_id: Option<String>,
    album_id: Option<String>,
    genre_id: Option<String>,
    tag_id: Option<String>,
    song_id: Option<String>,
    playlist_id: Option<String>,
}

async fn list_filters_with_fks(
    pool: &sqlx::SqlitePool,
    station_id: &str,
) -> GrimoireResult<Vec<FilterRow>> {
    sqlx::query_as!(
        FilterRow,
        r#"SELECT filter_type as "filter_type!",
                  mode as "mode!",
                  artist_id, album_id, genre_id, tag_id, song_id, playlist_id
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
async fn song_ids_for_clause(
    pool: &sqlx::SqlitePool,
    clause: &FilterRow,
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
        "genre" => match &clause.genre_id {
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
                    r#"SELECT DISTINCT ps.song_id as "song_id!"
                   FROM playlist_songz ps
                   WHERE ps.playlist_id = ?"#,
                    id
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
