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
//! filter-set resolution (`resolve_filter_set`) reuses
//! `radio::stations::repository`'s `song_ids_for_clause`/
//! `all_playable_song_ids`/`parse_filter_clause` — the two tables have
//! identical filter-clause shapes (see migrations 051 and 053).

use super::models::{FilterSet, FilterSetFilter, SyncManifest, SyncedSong};
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
                  f.mode as "mode!", f.created_at as "created_at!"
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
) -> GrimoireResult<FilterSetFilter> {
    let pool = database::connect().await?;

    let (kind, mode, (artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value)) =
        parse_filter_clause("sync filter", filter_type, filter_value, mode)?;
    let kind_str = kind.as_str();

    let id: String = sqlx::query_scalar!(
        r#"INSERT INTO external_storage_filter_set_filterz
              (filter_set_id, filter_type, mode, artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                  f.mode as "mode!", f.created_at as "created_at!"
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

/// resolve a filter-set's effective song list. returns DISTINCT song
/// ids. identical algorithm to
/// `radio::stations::repository::resolve_playlist` — see that
/// function's doc comment for the include/exclude/union/intersect
/// rules — against `external_storage_filter_set_filterz` instead of
/// `radio_station_filterz`.
pub async fn resolve_filter_set(filter_set_id: &str) -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;

    let filters = list_filter_set_rows(&pool, filter_set_id).await?;
    if filters.is_empty() {
        return Ok(Vec::new());
    }

    let includes: Vec<&FilterRow> = filters.iter().filter(|f| f.mode == "include").collect();
    let excludes: Vec<&FilterRow> = filters.iter().filter(|f| f.mode == "exclude").collect();

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

    for clause in &excludes {
        let matches = song_ids_for_clause(&pool, clause).await?;
        for id in matches {
            result.remove(&id);
        }
    }

    Ok(result.into_iter().collect())
}

async fn list_filter_set_rows(
    pool: &sqlx::SqlitePool,
    filter_set_id: &str,
) -> GrimoireResult<Vec<FilterRow>> {
    sqlx::query_as!(
        FilterRow,
        r#"SELECT filter_type as "filter_type!", mode as "mode!",
                  artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value
           FROM external_storage_filter_set_filterz
           WHERE filter_set_id = ?
           ORDER BY created_at ASC"#,
        filter_set_id
    )
    .fetch_all(pool)
    .await
    .map_err(GrimoireError::from)
}
