//! radio station persistence + playlist resolution.

use super::models::{
    CreateStationRequest, PlayHistoryEntry, RadioStation, StationFilter, StationSong,
    UpdateStationRequest,
};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

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
    let play_mode = req.play_mode.unwrap_or_else(|| "shuffle".to_string());

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
        req.play_mode,
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
    sqlx::query!("DELETE FROM radio_stationz WHERE id = ?", id)
        .execute(&pool)
        .await?;
    Ok(())
}

// ---------- explicit-include songs ---------------------------------------

pub async fn list_songs(station_id: &str) -> GrimoireResult<Vec<StationSong>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        StationSong,
        r#"SELECT station_id as "station_id!", song_id as "song_id!",
                  sort_order as "sort_order!", added_at as "added_at!"
           FROM radio_station_songz
           WHERE station_id = ?
           ORDER BY sort_order ASC, added_at ASC"#,
        station_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn add_song(station_id: &str, song_id: &str, sort_order: i64) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"INSERT OR REPLACE INTO radio_station_songz
              (station_id, song_id, sort_order)
           VALUES (?, ?, ?)"#,
        station_id,
        song_id,
        sort_order,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

pub async fn remove_song(station_id: &str, song_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "DELETE FROM radio_station_songz WHERE station_id = ? AND song_id = ?",
        station_id,
        song_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ---------- filter clauses -----------------------------------------------

pub async fn list_filters(station_id: &str) -> GrimoireResult<Vec<StationFilter>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        StationFilter,
        r#"SELECT id as "id!", station_id as "station_id!",
                  filter_type as "filter_type!", filter_value as "filter_value!",
                  mode as "mode!", created_at as "created_at!"
           FROM radio_station_filterz
           WHERE station_id = ?
           ORDER BY created_at ASC"#,
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
    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO radio_station_filterz
              (station_id, filter_type, filter_value, mode)
           VALUES (?, ?, ?, ?)
           RETURNING id"#,
        station_id,
        filter_type,
        filter_value,
        mode,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        StationFilter,
        r#"SELECT id as "id!", station_id as "station_id!",
                  filter_type as "filter_type!", filter_value as "filter_value!",
                  mode as "mode!", created_at as "created_at!"
           FROM radio_station_filterz WHERE id = ?"#,
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
/// precedence rules:
///
///   * when the station has any explicit `radio_station_songz` rows,
///     those songs are the entire candidate set
///   * otherwise, use the intersection of every `include` filter clause
///   * in either case, subtract the union of every `exclude` filter clause
///
/// when there are zero explicit songs and zero filters, returns an empty
/// vec — caller treats this as "no source" and falls back elsewhere.
///
/// supported filter_type values today: `tag`, `genre`, `artist`, `album`.
/// other types (year_range, rating_min, etc.) are accepted by `add_filter`
/// but ignored here until the picker grows support.
pub async fn resolve_playlist(station_id: &str) -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;

    // explicit songs take precedence over filter-derived candidates.
    // if a station has seeded songs, it should only play those songs.
    let explicit: Vec<String> = sqlx::query_scalar!(
        r#"SELECT song_id as "song_id!" FROM radio_station_songz WHERE station_id = ?"#,
        station_id
    )
    .fetch_all(&pool)
    .await?;

    let filters = list_filters(station_id).await?;

    let includes: Vec<&StationFilter> = filters.iter().filter(|f| f.mode == "include").collect();
    let excludes: Vec<&StationFilter> = filters.iter().filter(|f| f.mode == "exclude").collect();

    // build the include set: intersection of every include clause's matches.
    // when there are no includes, the filter-driven set is empty (we only
    // play explicit songs).
    let mut filter_set: Option<std::collections::HashSet<String>> = None;
    for clause in &includes {
        let matches = song_ids_matching(&pool, &clause.filter_type, &clause.filter_value).await?;
        let matches: std::collections::HashSet<String> = matches.into_iter().collect();
        filter_set = Some(match filter_set {
            None => matches,
            Some(prev) => prev.intersection(&matches).cloned().collect(),
        });
    }

    // explicit seeds override include filters. when there are no explicit
    // songs, the include-filter result becomes the candidate set.
    let mut result: std::collections::HashSet<String> = if explicit.is_empty() {
        filter_set.unwrap_or_default()
    } else {
        explicit.into_iter().collect()
    };

    // subtract excludes (each clause contributes a set, take the union).
    for clause in &excludes {
        let matches = song_ids_matching(&pool, &clause.filter_type, &clause.filter_value).await?;
        for id in matches {
            result.remove(&id);
        }
    }

    Ok(result.into_iter().collect())
}

/// look up song ids matching one filter clause. unknown filter types
/// return an empty vec (silently ignored — the picker keeps going).
async fn song_ids_matching(
    pool: &sqlx::SqlitePool,
    filter_type: &str,
    filter_value: &str,
) -> GrimoireResult<Vec<String>> {
    let rows: Vec<String> = match filter_type {
        "tag" => {
            // tags live on albumz today; resolve via album_tagz → album_songz.
            // accept either tag id OR tag name (ui-friendly).
            sqlx::query_scalar!(
                r#"SELECT DISTINCT als.song_id as "song_id!"
                   FROM album_tagz at
                   JOIN tagz t ON t.id = at.tag_id
                   JOIN album_songz als ON als.album_id = at.album_id
                   WHERE t.id = ?1 OR t.name = ?1"#,
                filter_value
            )
            .fetch_all(pool)
            .await?
        }
        "genre" => {
            sqlx::query_scalar!(
                r#"SELECT DISTINCT als.song_id as "song_id!"
               FROM album_genrez ag
               JOIN genrez g ON g.id = ag.genre_id
               JOIN album_songz als ON als.album_id = ag.album_id
               WHERE g.id = ?1 OR g.name = ?1"#,
                filter_value
            )
            .fetch_all(pool)
            .await?
        }
        "artist" => {
            sqlx::query_scalar!(
                r#"SELECT DISTINCT ars.song_id as "song_id!"
               FROM artist_songz ars
               JOIN artistz a ON a.id = ars.artist_id
               WHERE a.id = ?1 OR a.name = ?1"#,
                filter_value
            )
            .fetch_all(pool)
            .await?
        }
        "album" => {
            sqlx::query_scalar!(
                r#"SELECT DISTINCT als.song_id as "song_id!"
               FROM album_songz als
               JOIN albumz a ON a.id = als.album_id
               WHERE a.id = ?1 OR a.title = ?1"#,
                filter_value
            )
            .fetch_all(pool)
            .await?
        }
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
