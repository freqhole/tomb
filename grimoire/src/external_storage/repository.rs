//! removable-storage sync persistence — synced-song bookkeeping, claimed
//! paths, sync manifests, filter-sets, and device stats. all previously
//! lived either in a per-device `.freqhole.db.json` file written onto the
//! removable device itself, or in charnel's local toml config
//! (`last_synced_at`); both moved here in migration 053 so this state is
//! queryable/durable rather than a hand-rolled file format. a removable
//! device's "known" status was already tied to the local install (the
//! device list itself lives in charnel's local config, not on the
//! device), so this doesn't change portability semantics.
//!
//! filter-set resolution (`resolve_filter_set_groups`) reuses
//! `radio::stations::repository`'s `song_ids_for_clause`/
//! `all_playable_song_ids`/`parse_filter_clause` — the two tables have
//! identical filter-clause shapes (see migrations 051 and 053).

use super::models::{FilterSet, FilterSetFilter, FilterSetGroup, SyncManifest, SyncedSong};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::stations::repository::{
    all_playable_song_ids, parse_filter_clause, song_ids_for_clause, FilterRow,
};

// ---------- synced songs ---------------------------------------------------

pub async fn get_synced_song(device_id: &str, song_id: &str) -> GrimoireResult<Option<SyncedSong>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        SyncedSong,
        r#"SELECT song_id as "song_id!", relative_path as "relative_path!",
                  sha256 as "sha256!", blake3, tag_hash as "tag_hash!",
                  synced_at as "synced_at!"
           FROM external_storage_synced_songz
           WHERE device_id = ? AND song_id = ?"#,
        device_id,
        song_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn list_synced_songs(device_id: &str) -> GrimoireResult<Vec<SyncedSong>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        SyncedSong,
        r#"SELECT song_id as "song_id!", relative_path as "relative_path!",
                  sha256 as "sha256!", blake3, tag_hash as "tag_hash!",
                  synced_at as "synced_at!"
           FROM external_storage_synced_songz
           WHERE device_id = ?"#,
        device_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert_synced_song(
    device_id: &str,
    song_id: &str,
    relative_path: &str,
    sha256: &str,
    blake3: Option<&str>,
    tag_hash: &str,
) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"INSERT INTO external_storage_synced_songz
              (device_id, song_id, relative_path, sha256, blake3, tag_hash, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT (device_id, song_id) DO UPDATE SET
              relative_path = excluded.relative_path,
              sha256        = excluded.sha256,
              blake3        = excluded.blake3,
              tag_hash      = excluded.tag_hash,
              synced_at     = unixepoch()"#,
        device_id,
        song_id,
        relative_path,
        sha256,
        blake3,
        tag_hash
    )
    .execute(&pool)
    .await?;
    Ok(())
}

pub async fn remove_synced_song(device_id: &str, song_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "DELETE FROM external_storage_synced_songz WHERE device_id = ? AND song_id = ?",
        device_id,
        song_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ---------- claimed paths ---------------------------------------------------

/// true if `relative_path` was ever handed out to this device — kept
/// even after the owning song's `external_storage_synced_songz` row is
/// removed/moved, so a freed-up path is never silently reused for
/// different content.
pub async fn is_path_claimed(device_id: &str, relative_path: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;
    let count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM external_storage_claimed_pathz
           WHERE device_id = ? AND relative_path = ?"#,
        device_id,
        relative_path
    )
    .fetch_one(&pool)
    .await?;
    Ok(count > 0)
}

/// every relative path ever claimed for this device — used to seed the
/// in-memory set that `path_naming::uniquify_path` checks against.
pub async fn list_claimed_paths(device_id: &str) -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;
    sqlx::query_scalar!(
        r#"SELECT relative_path as "relative_path!" FROM external_storage_claimed_pathz
           WHERE device_id = ?"#,
        device_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn claim_path(device_id: &str, relative_path: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"INSERT INTO external_storage_claimed_pathz (device_id, relative_path)
           VALUES (?, ?)
           ON CONFLICT (device_id, relative_path) DO NOTHING"#,
        device_id,
        relative_path
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// free a claimed path (e.g. a song's old path, once it's being moved
/// away from) so it's fair game again for a different song.
pub async fn unclaim_path(device_id: &str, relative_path: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "DELETE FROM external_storage_claimed_pathz WHERE device_id = ? AND relative_path = ?",
        device_id,
        relative_path
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ---------- sync manifests (playlists / favorites / filter-sets) ----------

pub async fn get_manifest(
    device_id: &str,
    sync_set_id: &str,
) -> GrimoireResult<Option<SyncManifest>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        SyncManifest,
        r#"SELECT sync_set_id as "sync_set_id!", filename as "filename!",
                  synced_at as "synced_at!"
           FROM external_storage_sync_manifestz
           WHERE device_id = ? AND sync_set_id = ?"#,
        device_id,
        sync_set_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn list_manifests(device_id: &str) -> GrimoireResult<Vec<SyncManifest>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        SyncManifest,
        r#"SELECT sync_set_id as "sync_set_id!", filename as "filename!",
                  synced_at as "synced_at!"
           FROM external_storage_sync_manifestz
           WHERE device_id = ?"#,
        device_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn upsert_manifest(
    device_id: &str,
    sync_set_id: &str,
    filename: &str,
) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"INSERT INTO external_storage_sync_manifestz
              (device_id, sync_set_id, filename, synced_at)
           VALUES (?, ?, ?, unixepoch())
           ON CONFLICT (device_id, sync_set_id) DO UPDATE SET
              filename = excluded.filename, synced_at = unixepoch()"#,
        device_id,
        sync_set_id,
        filename
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// remove a manifest, returning the row that was deleted (if any) so the
/// caller can clean up the on-device `.m3u8` file at `filename`.
pub async fn remove_manifest(
    device_id: &str,
    sync_set_id: &str,
) -> GrimoireResult<Option<SyncManifest>> {
    let existing = get_manifest(device_id, sync_set_id).await?;
    if existing.is_some() {
        let pool = database::connect().await?;
        sqlx::query!(
            "DELETE FROM external_storage_sync_manifestz WHERE device_id = ? AND sync_set_id = ?",
            device_id,
            sync_set_id
        )
        .execute(&pool)
        .await?;
    }
    Ok(existing)
}

// ---------- device stats ---------------------------------------------------

pub async fn get_device_last_synced_at(device_id: &str) -> GrimoireResult<Option<i64>> {
    let pool = database::connect().await?;
    let row: Option<Option<i64>> = sqlx::query_scalar!(
        "SELECT last_synced_at FROM external_storage_device_statz WHERE device_id = ?",
        device_id
    )
    .fetch_optional(&pool)
    .await?;
    Ok(row.flatten())
}

pub async fn set_device_last_synced_at(device_id: &str, ts: i64) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        r#"INSERT INTO external_storage_device_statz (device_id, last_synced_at)
           VALUES (?, ?)
           ON CONFLICT (device_id) DO UPDATE SET last_synced_at = excluded.last_synced_at"#,
        device_id,
        ts
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ---------- filter sets -----------------------------------------------------

pub async fn list_filter_sets() -> GrimoireResult<Vec<FilterSet>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        FilterSet,
        r#"SELECT id as "id!", name as "name!", device_id, created_at as "created_at!",
                  updated_at as "updated_at!"
           FROM external_storage_filter_setz ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn get_filter_set(id: &str) -> GrimoireResult<Option<FilterSet>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        FilterSet,
        r#"SELECT id as "id!", name as "name!", device_id, created_at as "created_at!",
                  updated_at as "updated_at!"
           FROM external_storage_filter_setz WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    .map_err(GrimoireError::from)
}

/// the one default filter-set for a device - created lazily on first
/// use. multiple named filter-sets per device may come back in a later
/// phase (see docs/removable-storage-sync-plan.md phase 6); for now
/// every device gets exactly one, enforced by a partial unique index on
/// `device_id`.
pub async fn get_or_create_default_filter_set(device_id: &str) -> GrimoireResult<FilterSet> {
    let pool = database::connect().await?;
    let existing = sqlx::query_as!(
        FilterSet,
        r#"SELECT id as "id!", name as "name!", device_id, created_at as "created_at!",
                  updated_at as "updated_at!"
           FROM external_storage_filter_setz WHERE device_id = ?"#,
        device_id
    )
    .fetch_optional(&pool)
    .await?;
    if let Some(set) = existing {
        return Ok(set);
    }

    let id: String = sqlx::query_scalar!(
        "INSERT INTO external_storage_filter_setz (name, device_id) VALUES ('default', ?) RETURNING id",
        device_id
    )
    .fetch_one(&pool)
    .await?;
    get_filter_set(&id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: "external_storage: created filter-set vanished from db".to_string(),
        })
}

pub async fn create_filter_set(name: &str) -> GrimoireResult<FilterSet> {
    let pool = database::connect().await?;
    let id: String = sqlx::query_scalar!(
        "INSERT INTO external_storage_filter_setz (name) VALUES (?) RETURNING id",
        name
    )
    .fetch_one(&pool)
    .await?;
    get_filter_set(&id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: "external_storage: created filter-set vanished from db".to_string(),
        })
}

pub async fn rename_filter_set(id: &str, name: &str) -> GrimoireResult<FilterSet> {
    let pool = database::connect().await?;
    sqlx::query!(
        "UPDATE external_storage_filter_setz SET name = ?, updated_at = unixepoch() WHERE id = ?",
        name,
        id
    )
    .execute(&pool)
    .await?;
    get_filter_set(id)
        .await?
        .ok_or_else(|| GrimoireError::ProcessingFailed {
            message: format!("external_storage: filter-set not found: {id}"),
        })
}

pub async fn delete_filter_set(id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!("DELETE FROM external_storage_filter_setz WHERE id = ?", id)
        .execute(&pool)
        .await?;
    Ok(())
}

// ---------- filter-set clauses ---------------------------------------------

pub async fn list_filter_set_filters(filter_set_id: &str) -> GrimoireResult<Vec<FilterSetFilter>> {
    let pool = database::connect().await?;
    sqlx::query_as!(
        FilterSetFilter,
        r#"SELECT f.id as "id!", f.filter_set_id as "filter_set_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.taxon_id, f.tag_id, f.song_id, f.playlist_id,
                           CAST(f.criteria_value AS TEXT), '') as "filter_value!: String",
                  COALESCE(ar.name, al.title, tx.label, t.name, s.title, p.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!",
                  CASE WHEN f.filter_type IN ('favorite', 'rating_gte', 'rating_lte')
                       THEN CASE WHEN f.criteria_scope = 1 THEN 'everyone' ELSE 'me' END
                       ELSE NULL END as "criteria_scope: String"
           FROM external_storage_filter_set_filterz f
           LEFT JOIN artistz   ar ON ar.id = f.artist_id
           LEFT JOIN albumz    al ON al.id = f.album_id
           LEFT JOIN taxonz    tx ON tx.id = f.taxon_id
           LEFT JOIN tagz      t  ON t.id  = f.tag_id
           LEFT JOIN songz     s  ON s.id  = f.song_id
           LEFT JOIN playlistz p  ON p.id  = f.playlist_id
           WHERE f.filter_set_id = ?
           ORDER BY f.created_at ASC"#,
        filter_set_id
    )
    .fetch_all(&pool)
    .await
    .map_err(GrimoireError::from)
}

pub async fn add_filter_set_filter(
    filter_set_id: &str,
    filter_type: &str,
    filter_value: &str,
    mode: &str,
    criteria_scope: Option<&str>,
) -> GrimoireResult<FilterSetFilter> {
    let pool = database::connect().await?;

    let (kind, mode, (artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value)) =
        parse_filter_clause("sync filter", filter_type, filter_value, mode)?;
    let kind_str = kind.as_str();

    // only "favorite"/"rating_gte"/"rating_lte" have a scope choice -
    // "everyone" stores 1, everything else (including "me", the default)
    // stores NULL, matching the behavior every pre-existing `favorite`
    // row already had.
    let criteria_scope_value: Option<i64> = match (kind_str, criteria_scope) {
        ("favorite" | "rating_gte" | "rating_lte", Some("everyone")) => Some(1),
        _ => None,
    };

    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO external_storage_filter_set_filterz
              (filter_set_id, filter_type, mode, artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value, criteria_scope)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id"#,
        filter_set_id,
        kind_str,
        mode,
        artist_id,
        album_id,
        taxon_id,
        tag_id,
        song_id,
        playlist_id,
        criteria_value,
        criteria_scope_value,
    )
    .fetch_one(&pool)
    .await?;

    sqlx::query_as!(
        FilterSetFilter,
        r#"SELECT f.id as "id!", f.filter_set_id as "filter_set_id!",
                  f.filter_type as "filter_type!",
                  COALESCE(f.artist_id, f.album_id, f.taxon_id, f.tag_id, f.song_id, f.playlist_id,
                           CAST(f.criteria_value AS TEXT), '') as "filter_value!: String",
                  COALESCE(ar.name, al.title, tx.label, t.name, s.title, p.title, '') as "filter_label!: String",
                  f.mode as "mode!", f.created_at as "created_at!",
                  CASE WHEN f.filter_type IN ('favorite', 'rating_gte', 'rating_lte')
                       THEN CASE WHEN f.criteria_scope = 1 THEN 'everyone' ELSE 'me' END
                       ELSE NULL END as "criteria_scope: String"
           FROM external_storage_filter_set_filterz f
           LEFT JOIN artistz   ar ON ar.id = f.artist_id
           LEFT JOIN albumz    al ON al.id = f.album_id
           LEFT JOIN taxonz    tx ON tx.id = f.taxon_id
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

pub async fn remove_filter_set_filter(filter_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "DELETE FROM external_storage_filter_set_filterz WHERE id = ?",
        filter_id
    )
    .execute(&pool)
    .await?;
    Ok(())
}

// ---------- filter-set resolution ------------------------------------------

/// internal row carrying both the typed FK columns (needed by
/// `song_ids_for_clause`) and the clause's own id + joined display label
/// — `list_filter_set_rows`'s `FilterRow` has neither, since
/// `resolve_filter_set`'s combined-list algorithm doesn't need per-clause
/// identity.
struct FilterClauseRow {
    id: String,
    filter_type: String,
    mode: String,
    artist_id: Option<String>,
    album_id: Option<String>,
    taxon_id: Option<String>,
    tag_id: Option<String>,
    song_id: Option<String>,
    playlist_id: Option<String>,
    criteria_value: Option<i64>,
    criteria_scope: Option<i64>,
    label: String,
}

async fn list_filter_set_clause_rows(
    pool: &sqlx::SqlitePool,
    filter_set_id: &str,
) -> GrimoireResult<Vec<FilterClauseRow>> {
    sqlx::query_as!(
        FilterClauseRow,
        r#"SELECT f.id as "id!", f.filter_type as "filter_type!", f.mode as "mode!",
                  f.artist_id, f.album_id, f.taxon_id, f.tag_id, f.song_id, f.playlist_id,
                  f.criteria_value, f.criteria_scope,
                  COALESCE(ar.name, al.title, tx.label, t.name, s.title, p.title, '') as "label!: String"
           FROM external_storage_filter_set_filterz f
           LEFT JOIN artistz   ar ON ar.id = f.artist_id
           LEFT JOIN albumz    al ON al.id = f.album_id
           LEFT JOIN taxonz    tx ON tx.id = f.taxon_id
           LEFT JOIN tagz      t  ON t.id  = f.tag_id
           LEFT JOIN songz     s  ON s.id  = f.song_id
           LEFT JOIN playlistz p  ON p.id  = f.playlist_id
           WHERE f.filter_set_id = ?
           ORDER BY f.created_at ASC"#,
        filter_set_id
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)
}

/// stable manifest key + display name for one include clause, keyed by
/// the referenced entity so re-adding the same playlist/tag/taxon after
/// removing it reuses the same `.m3u8` instead of creating a duplicate.
fn group_identity(clause: &FilterClauseRow) -> (String, String) {
    match clause.filter_type.as_str() {
        "playlist" => (
            format!(
                "playlist:{}",
                clause.playlist_id.clone().unwrap_or_default()
            ),
            clause.label.clone(),
        ),
        "tag" => (
            format!("tag:{}", clause.tag_id.clone().unwrap_or_default()),
            clause.label.clone(),
        ),
        "taxon" => (
            format!("taxon:{}", clause.taxon_id.clone().unwrap_or_default()),
            clause.label.clone(),
        ),
        "artist" => (
            format!("artist:{}", clause.artist_id.clone().unwrap_or_default()),
            clause.label.clone(),
        ),
        "album" => (
            format!("album:{}", clause.album_id.clone().unwrap_or_default()),
            clause.label.clone(),
        ),
        "track" => (
            format!("track:{}", clause.song_id.clone().unwrap_or_default()),
            clause.label.clone(),
        ),
        "favorite" => ("favorite".to_string(), "favorites".to_string()),
        other => (format!("{other}:{}", clause.id), clause.label.clone()),
    }
}

/// resolve a filter-set into one independently-matched group per include
/// clause — phase 8: lets sync write a separate `.m3u8` per
/// playlist/tag/taxon/favorites the user included, instead of one
/// combined manifest for the whole filter-set.
///
/// every include clause becomes its own group, keyed by the entity it
/// references so two
/// clauses pointing at the same playlist/tag/taxon (or two `favorite`
/// clauses) merge into one group instead of writing duplicate `.m3u8`
/// files; the union of every exclude clause's matches is still
/// subtracted from each group. when only excludes are configured, falls
/// back to a single group over the whole playable library (minus
/// excludes), named after the filter-set itself.
///
/// `user_id` scopes the `"favorite"`/`"rating_gte"`/`"rating_lte"`
/// clauses to that user's own favorites/ratings only, unless a given
/// clause opted into `criteria_scope = 1` ("everyone's") — unlike radio
/// stations, a device sync belongs to one user.
pub async fn resolve_filter_set_groups(
    filter_set_id: &str,
    user_id: &str,
) -> GrimoireResult<Vec<FilterSetGroup>> {
    let pool = database::connect().await?;
    let rows = list_filter_set_clause_rows(&pool, filter_set_id).await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let as_filter_row = |r: &FilterClauseRow| FilterRow {
        filter_type: r.filter_type.clone(),
        mode: r.mode.clone(),
        artist_id: r.artist_id.clone(),
        album_id: r.album_id.clone(),
        taxon_id: r.taxon_id.clone(),
        tag_id: r.tag_id.clone(),
        song_id: r.song_id.clone(),
        playlist_id: r.playlist_id.clone(),
        criteria_value: r.criteria_value,
        criteria_scope: r.criteria_scope,
    };

    let includes: Vec<&FilterClauseRow> = rows.iter().filter(|f| f.mode == "include").collect();
    let excludes: Vec<&FilterClauseRow> = rows.iter().filter(|f| f.mode == "exclude").collect();

    let mut excluded_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for clause in &excludes {
        excluded_ids
            .extend(song_ids_for_clause(&pool, &as_filter_row(clause), Some(user_id)).await?);
    }

    if includes.is_empty() {
        let mut all: std::collections::HashSet<String> =
            all_playable_song_ids(&pool).await?.into_iter().collect();
        for id in &excluded_ids {
            all.remove(id);
        }
        let name = get_filter_set(filter_set_id)
            .await?
            .map(|s| s.name)
            .unwrap_or_else(|| "default".to_string());
        return Ok(vec![FilterSetGroup {
            key: filter_set_id.to_string(),
            name,
            song_ids: all.into_iter().collect(),
        }]);
    }

    // merge include clauses that share a group key (e.g. the same
    // playlist added twice) into one group instead of one per clause row.
    let mut merged: std::collections::HashMap<String, (String, std::collections::HashSet<String>)> =
        std::collections::HashMap::new();
    for clause in &includes {
        let matches = song_ids_for_clause(&pool, &as_filter_row(clause), Some(user_id)).await?;
        let (key, name) = group_identity(clause);
        let entry = merged
            .entry(key)
            .or_insert_with(|| (name, std::collections::HashSet::new()));
        entry.1.extend(matches);
    }

    let groups = merged
        .into_iter()
        .map(|(key, (name, mut matches))| {
            for id in &excluded_ids {
                matches.remove(id);
            }
            FilterSetGroup {
                key,
                name,
                song_ids: matches.into_iter().collect(),
            }
        })
        .collect();
    Ok(groups)
}
