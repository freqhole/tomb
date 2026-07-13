//! media blob service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use reliquary::blobz::{BlobStore, SqliteBlobStore};

use super::models::{BlobType, CreateMediaBlobRequest, MediaBlob};
use crate::error::{GrimoireError, GrimoireResult};
use crate::{blob_data, config, database};

/// create a new media blob with deduplication by SHA256
pub async fn create_media_blob(req: CreateMediaBlobRequest) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let blob_type = req.blob_type.unwrap_or(BlobType::Original);
    let blob_type_str = blob_type.as_str();
    let metadata_str = serde_json::to_string(&req.metadata).unwrap_or_else(|_| "{}".to_string());

    // check if a blob with this SHA256 already exists (simple dedup check)
    // since sha256 has a UNIQUE constraint, we can't have two blobs with the same sha256
    // if the same content is uploaded again, just return the existing blob
    if let Ok(existing_blob) = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE sha256 = ?
         LIMIT 1",
        req.sha256
    )
    .fetch_one(&pool)
    .await
    {
        // if blob was deleted, undelete it
        if existing_blob.deleted_at.is_some() {
            tracing::info!(
                "create_blob: found deleted blob with same sha256, undeleting: existing_id={}, sha256={}",
                existing_blob.id,
                existing_blob.sha256
            );
            let undeleted_blob = sqlx::query_as!(
                MediaBlob,
                "UPDATE media_blobz
                 SET deleted_at = NULL,
                     deleted_by = NULL,
                     updated_at = unixepoch(),
                     updated_by = ?
                 WHERE id = ?
                 RETURNING
                    id as \"id!\",
                    sha256 as \"sha256!\",
                    size,
                    mime,
                    source_client_id,
                    local_path,
                    filename,
                    parent_blob_id,
                    blob_type as \"blob_type!\",
                    metadata,
                    created_at as \"created_at!\",
                    updated_at as \"updated_at!\",
                    deleted_at,
                    deleted_by,
                    created_by,
                    updated_by,
                    width,
                    height,
                    blake3",
                req.created_by,
                existing_blob.id
            )
            .fetch_one(&pool)
            .await?;

            let mut undeleted_with_metadata = undeleted_blob;
            undeleted_with_metadata.metadata =
                serde_json::from_str(undeleted_with_metadata.metadata.as_str().unwrap_or("{}"))
                    .unwrap_or_default();

            // same path-relocation logic as the active-existing branch:
            // when the resurrected blob is being re-ingested from a new
            // on-disk path, point local_path / filename at the new home
            // and refresh cheap-skip metadata.
            let final_row = match (&req.local_path, &undeleted_with_metadata.local_path) {
                (Some(new_p), old) if old.as_deref() != Some(new_p.as_str()) => {
                    let mut relocated =
                        maybe_relocate_existing_blob(&pool, &undeleted_with_metadata, &req).await?;
                    relocated.metadata =
                        serde_json::from_str(relocated.metadata.as_str().unwrap_or("{}"))
                            .unwrap_or_default();
                    relocated
                }
                _ => undeleted_with_metadata,
            };
            return Ok(final_row);
        }

        // blob already exists and is not deleted, return it with parsed metadata
        tracing::info!(
            "create_blob: found existing blob with same sha256, returning: existing_id={}, sha256={}, blob_type={}",
            existing_blob.id,
            existing_blob.sha256,
            existing_blob.blob_type
        );

        // path-relocation: if the caller is bringing a different on-disk
        // path for the same content (file was moved, or re-scanned from a
        // new root), repoint local_path / filename to the new location
        // and refresh the cheap-skip dedup metadata (file_size,
        // file_modified_at) so the next scan can fast-skip this file at
        // its new home instead of falling through to a rescan-update.
        // upload-only callers (data only, no local_path) never trigger
        // this branch, so existing on-disk paths aren't accidentally
        // clobbered.
        let relocated = match (&req.local_path, &existing_blob.local_path) {
            (Some(new_p), old) if old.as_deref() != Some(new_p.as_str()) => {
                maybe_relocate_existing_blob(&pool, &existing_blob, &req).await?
            }
            _ => existing_blob,
        };

        let mut existing_with_metadata = relocated;
        existing_with_metadata.metadata =
            serde_json::from_str(existing_with_metadata.metadata.as_str().unwrap_or("{}"))
                .unwrap_or_default();

        // backfill blob_data if the caller provided binary data and the
        // existing blob has none stored. this covers the case where a blob
        // was originally created via the file scanner (local_path only, no
        // binary data written) and is now being re-uploaded — without this,
        // the ConvertWebp job fails every time with "blob data not found"
        // creating a permanent loop.
        if let Some(data) = req.data {
            let exists_resp = crate::blob_data::blob_data_exists(&existing_with_metadata.id).await;
            let has_data = exists_resp.success && exists_resp.data.unwrap_or(false);
            if !has_data {
                tracing::info!(
                    "create_blob: backfilling missing blob_data for dedup blob_id={}",
                    existing_with_metadata.id
                );
                match crate::blob_data::store_blob_data(&existing_with_metadata.id, data.into())
                    .await
                {
                    r if r.success => {}
                    r => {
                        tracing::warn!(
                            "create_blob: failed to backfill blob_data for {}: {}",
                            existing_with_metadata.id,
                            r.message
                        );
                    }
                }
            }
        }

        return Ok(existing_with_metadata);
    }

    // Create new blob if none exists
    let blob = sqlx::query_as!(
        MediaBlob,
        "INSERT INTO media_blobz (
            sha256, size, mime, source_client_id, local_path, filename,
            parent_blob_id, blob_type, metadata,
            created_by, updated_by, width, height, blake3
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3",
        req.sha256,
        req.size,
        req.mime,
        req.source_client_id,
        req.local_path,
        req.filename,
        req.parent_blob_id,
        blob_type_str,
        metadata_str,
        req.created_by,
        req.created_by,
        req.width,
        req.height,
        req.blake3
    )
    .fetch_one(&pool)
    .await?;

    // Parse the metadata JSON from the returned string
    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    // If binary data was provided, store it in blob_data table
    if let Some(data) = req.data {
        match blob_data::store_blob_data(&blob_with_metadata.id, data.into()).await {
            response if response.success => {}
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                return Err(GrimoireError::ProcessingFailed {
                    message: format!("Failed to store blob data: {}", error_msg),
                });
            }
        }
    }

    Ok(blob_with_metadata)
}

/// list all media blobs (non-deleted only)
pub async fn list_media_blobs() -> GrimoireResult<Vec<MediaBlob>> {
    let pool = database::connect().await?;

    let blobs = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    // Parse metadata JSON for each blob
    let blobs_with_metadata = blobs
        .into_iter()
        .map(|mut blob| {
            blob.metadata =
                serde_json::from_str(blob.metadata.as_str().unwrap_or("{}")).unwrap_or_default();
            blob
        })
        .collect();

    Ok(blobs_with_metadata)
}

/// get media blob by id
pub async fn get_media_blob(id: &str) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let blob = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE id = ?
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    // Parse the metadata JSON
    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// get media blob by sha256 content hash
pub async fn get_media_blob_by_sha256(sha256: &str) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let blob = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE sha256 = ? AND deleted_at IS NULL
         LIMIT 1",
        sha256
    )
    .fetch_one(&pool)
    .await?;

    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// get media blob with binary data for streaming
///
/// returns (MediaBlob, Option<Vec<u8>>)
/// - if blob has local_path, returns (blob, None) - data should be read from filesystem
/// - if blob data is in grimoire's own blob_data table, returns (blob, Some(data))
/// - otherwise, falls back to reliquary's blob store: resolves the row by
///   this id (recorded there as old_grimoire_id) and reads its bytes by
///   blake3 hash, returning (blob, Some(data)) if found
/// - if no source has the data, returns MediaBlobNotFound
pub async fn get_media_blob_with_data(id: &str) -> GrimoireResult<(MediaBlob, Option<Vec<u8>>)> {
    let blob = get_media_blob(id).await?;

    // if blob has local_path, caller should read from filesystem
    if blob.local_path.is_some() {
        return Ok((blob, None));
    }

    // try to get data from blob_data table
    let data_response = blob_data::get_blob_data(&blob.id).await;

    if data_response.success {
        if let Some(data) = data_response.data {
            return Ok((blob, Some(data)));
        }
    }

    // fall back to reliquary: any problem reaching it or resolving the blob
    // there is treated the same as "not found" rather than propagated, so a
    // reliquary-side issue never changes this function's error type.
    if let Ok(reliquary_pool) = database::connect_reliquary().await {
        let store = SqliteBlobStore::new(reliquary_pool, &config::get_config().data_dir);
        if let Ok(Some(record)) = store.get_by_old_id(&blob.id).await {
            if let Ok(Some(data)) = store.read_bytes(&record.blake3).await {
                return Ok((blob, Some(data)));
            }
        }
    }

    // no data source available
    Err(GrimoireError::MediaBlobNotFound { id: id.to_string() })
}

/// update media blob local_path (for setting filesystem location after upload)
pub async fn update_blob_local_path(
    id: &str,
    local_path: &str,
    _updated_by: Option<String>,
) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let blob = sqlx::query_as!(
        MediaBlob,
        "UPDATE media_blobz
         SET local_path = ?
         WHERE id = ?
         RETURNING
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3",
        local_path,
        id
    )
    .fetch_one(&pool)
    .await?;

    // parse the metadata JSON
    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// update an existing media_blobz row's `local_path` (and `filename` when
/// the caller supplied one) so it points at the new on-disk location of
/// content we just rediscovered by sha256. also merges
/// `file_size` / `file_modified_at` into the row's metadata json so the
/// directory scanner's cheap-skip dedup recognizes this path as
/// unchanged on the next pass.
///
/// returns the freshly-loaded MediaBlob row with the metadata column
/// still as a json string (the caller re-parses it, matching the rest
/// of this module's contract).
async fn maybe_relocate_existing_blob(
    pool: &sqlx::SqlitePool,
    existing: &MediaBlob,
    req: &CreateMediaBlobRequest,
) -> GrimoireResult<MediaBlob> {
    let new_path = match req.local_path.as_deref() {
        Some(p) => p,
        None => return Ok(existing.clone()),
    };

    // canonicalize the new path before writing to db / handing to iroh-blobs
    // FsStore. callers are inconsistent about whether they've canonicalized
    // already (scanner does, naive imports may not), and a non-canonical path
    // here would silently poison the blob's reference.
    let new_path_canon = crate::paths::canonical_path_string(new_path);
    let new_path = new_path_canon.as_str();

    tracing::info!(
        "create_blob: relocating existing blob to new path: id={}, sha256={}, old_path={:?}, new_path={}",
        existing.id,
        existing.sha256,
        existing.local_path,
        new_path
    );

    // merge cheap-skip metadata into the existing metadata json. preserves
    // any other keys (tags, extracted_*, etc.) the row may carry.
    let mut metadata_json: serde_json::Value = existing
        .metadata
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    if let serde_json::Value::Object(ref mut map) = metadata_json {
        // size and modified-at are best-effort: only refresh when we know
        // them (the caller may not have probed disk yet).
        if let Some(size) = req.size {
            map.insert("file_size".to_string(), serde_json::Value::from(size));
        }
        if let Some(fname) = req.filename.as_deref() {
            map.insert(
                "file_name".to_string(),
                serde_json::Value::from(fname.to_string()),
            );
        }
        // file_modified_at: prefer caller-supplied value (in metadata),
        // else best-effort probe of the new path.
        let caller_mtime = req
            .metadata
            .get("file_modified_at")
            .and_then(|v| v.as_i64());
        let probed_mtime = std::fs::metadata(new_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        if let Some(mt) = caller_mtime.or(probed_mtime) {
            map.insert("file_modified_at".to_string(), serde_json::Value::from(mt));
        }
    }
    let metadata_str = serde_json::to_string(&metadata_json).unwrap_or_else(|_| "{}".to_string());
    let new_filename = req.filename.clone().or_else(|| existing.filename.clone());

    let updated = sqlx::query_as!(
        MediaBlob,
        "UPDATE media_blobz
         SET local_path = ?,
             filename = ?,
             metadata = ?,
             updated_at = unixepoch(),
             updated_by = ?
         WHERE id = ?
         RETURNING
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3",
        new_path,
        new_filename,
        metadata_str,
        req.created_by,
        existing.id
    )
    .fetch_one(pool)
    .await?;

    Ok(updated)
}

/// soft delete a media blob
pub async fn delete_media_blob(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    let rows_affected = sqlx::query!(
        "UPDATE media_blobz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::MediaBlobNotFound { id: id.to_string() });
    }

    Ok(())
}

/// update blake3 hash for a media blob (for on-demand computation or backfill)
pub async fn update_blob_blake3(id: &str, blake3: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE media_blobz SET blake3 = ?, updated_at = unixepoch() WHERE id = ?",
        blake3,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::MediaBlobNotFound { id: id.to_string() });
    }

    Ok(())
}

/// get media blob by blake3 hash (for iroh-blobs requests)
pub async fn get_media_blob_by_blake3(blake3: &str) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let blob = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE blake3 = ? AND deleted_at IS NULL
         LIMIT 1",
        blake3
    )
    .fetch_one(&pool)
    .await?;

    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// count blobs that need blake3 computation (no blake3 yet).
/// covers both file-backed audio (local_path set) and db-stored blobs
/// (images, thumbnails, waveforms in blob_data table).
pub async fn count_blobs_needing_blake3() -> GrimoireResult<i64> {
    let pool = database::connect().await?;

    let result: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM media_blobz WHERE blake3 IS NULL AND deleted_at IS NULL",
    )
    .fetch_one(&pool)
    .await?;

    Ok(result.0)
}

/// blake3 backfill status: total non-deleted media blob rows, how many
/// already have a blake3 hash, and how many still need one. this is the
/// backfill gate check - production readiness means `missing_blake3` is 0.
pub async fn count_blake3_backfill_status() -> GrimoireResult<(i64, i64, i64)> {
    let pool = database::connect().await?;

    let (total, with_blake3): (i64, i64) =
        sqlx::query_as("SELECT COUNT(*), COUNT(blake3) FROM media_blobz WHERE deleted_at IS NULL")
            .fetch_one(&pool)
            .await?;

    let missing_blake3 = total - with_blake3;
    Ok((total, with_blake3, missing_blake3))
}

/// list blobs that need blake3 computation (for backfill)
pub async fn list_blobs_needing_blake3(limit: i64) -> GrimoireResult<Vec<MediaBlob>> {
    let pool = database::connect().await?;

    let blobs = sqlx::query_as!(
        MediaBlob,
        "SELECT
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         WHERE blake3 IS NULL AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT ?",
        limit
    )
    .fetch_all(&pool)
    .await?;

    let blobs_with_metadata = blobs
        .into_iter()
        .map(|mut blob| {
            blob.metadata =
                serde_json::from_str(blob.metadata.as_str().unwrap_or("{}")).unwrap_or_default();
            blob
        })
        .collect();

    Ok(blobs_with_metadata)
}

/// return the subset of `blake3s` for which a non-deleted media_blob row exists.
///
/// used by the send-to-remote dedupe negotiation step to avoid re-shipping
/// audio blobs the destination already has.
pub async fn find_present_blake3s(blake3s: &[String]) -> GrimoireResult<Vec<String>> {
    if blake3s.is_empty() {
        return Ok(Vec::new());
    }
    let pool = database::connect().await?;

    // bind the hash list as a single json array and unpack it via
    // `json_each` so we keep compile-time-checked sql via `query_scalar!`.
    let hashes_json = serde_json::to_string(blake3s).unwrap_or_else(|_| "[]".to_string());
    let rows: Vec<String> = sqlx::query_scalar!(
        r#"SELECT blake3 as "blake3!"
           FROM media_blobz
           WHERE blake3 IS NOT NULL
             AND deleted_at IS NULL
             AND blake3 IN (SELECT value FROM json_each(?))"#,
        hashes_json
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}

/// return the subset of `sha256s` for which a non-deleted media_blob row exists.
///
/// used by the send-to-remote dedupe negotiation step for image blobs and any
/// other content addressed by sha256 rather than blake3.
pub async fn find_present_sha256s(sha256s: &[String]) -> GrimoireResult<Vec<String>> {
    if sha256s.is_empty() {
        return Ok(Vec::new());
    }
    let pool = database::connect().await?;

    let hashes_json = serde_json::to_string(sha256s).unwrap_or_else(|_| "[]".to_string());
    let rows: Vec<String> = sqlx::query_scalar!(
        r#"SELECT sha256 as "sha256!"
           FROM media_blobz
           WHERE deleted_at IS NULL
             AND sha256 IN (SELECT value FROM json_each(?))"#,
        hashes_json
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reliquary::blobz::NewBlobMeta;

    // both tests spin up a fresh tempdir with their own grimoire.db,
    // blob_data db, and reliquary.db (via the same real db pool singletons
    // `get_media_blob_with_data` itself uses), so each is marked #[ignore]
    // per this crate's convention for tests touching those singletons. run
    // ONE at a time, each its own process - the pools are process-wide, so
    // running both together (even in the same `--ignored` filter) races
    // over the same singleton and fails with a spurious "table already
    // exists" migration error:
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_get_media_blob_with_data_falls_back_to_reliquary
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_get_media_blob_with_data_not_found_anywhere
    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_get_media_blob_with_data_falls_back_to_reliquary() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");

        // a media_blobz row with neither a local_path nor a blob_data row -
        // grimoire's own sources both come up empty.
        let bytes = b"reliquary-backed audio bytes";
        let blake3 = reliquary::hash_bytes(bytes);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('fallback01', ?, ?, 'audio/mpeg', 'original', ?)",
        )
        .bind("f".repeat(64))
        .bind(bytes.len() as i64)
        .bind(&blake3)
        .execute(&pool)
        .await
        .expect("insert media_blobz row");

        // the matching reliquary row, linked back to the grimoire id via
        // old_grimoire_id.
        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let config = crate::config::get_config();
        let store = SqliteBlobStore::new(reliquary_pool.clone(), &config.data_dir);
        let record = store
            .insert(bytes, NewBlobMeta::default())
            .await
            .expect("insert reliquary blob");
        sqlx::query("UPDATE blobz SET old_grimoire_id = ? WHERE blake3 = ?")
            .bind("fallback01")
            .bind(&record.blake3)
            .execute(&reliquary_pool)
            .await
            .expect("set old_grimoire_id");

        let (blob, data) = get_media_blob_with_data("fallback01")
            .await
            .expect("get_media_blob_with_data");
        assert_eq!(blob.id, "fallback01");
        assert_eq!(data, Some(bytes.to_vec()));
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_get_media_blob_with_data_not_found_anywhere() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");

        // a media_blobz row with no local_path, no blob_data row, and no
        // matching reliquary row - every source comes up empty.
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('missing01', ?, ?, 'audio/mpeg', 'original', ?)",
        )
        .bind("0".repeat(64))
        .bind(10i64)
        .bind("0".repeat(64))
        .execute(&pool)
        .await
        .expect("insert media_blobz row");

        let result = get_media_blob_with_data("missing01").await;
        assert!(matches!(
            result,
            Err(GrimoireError::MediaBlobNotFound { id }) if id == "missing01"
        ));
    }
}
