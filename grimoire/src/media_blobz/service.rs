//! media blob service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use reliquary::blobz::{BlobStore, SqliteBlobStore};

use super::models::{BlobType, CreateMediaBlobRequest, MediaBlob};
use super::reliquary_mirror;
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

            if let Some(blake3) = undeleted_with_metadata.blake3.as_deref() {
                reliquary_mirror::mirror_restore(blake3).await;
            }

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

        // mirror any caller-provided bytes into reliquary. this covers the
        // case where a blob was originally created via the file scanner
        // (local_path only, no bytes stored anywhere) and is now being
        // re-uploaded — without this, the ConvertWebp job would never find
        // the original bytes. safe to call unconditionally: the underlying
        // store dedupes by blake3 internally, so there's no need to probe
        // for existing bytes first.
        if let Some(data) = &req.data {
            reliquary_mirror::mirror_insert_bytes(&existing_with_metadata, data.as_ref()).await;
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

    // mirror any provided bytes into reliquary (a no-op until the blob has
    // a blake3 hash - dedup happens on the hash internally, so this is
    // always safe to call unconditionally rather than probing first).
    if let Some(data) = &req.data {
        reliquary_mirror::mirror_insert_bytes(&blob_with_metadata, data.as_ref()).await;
    } else if blob_with_metadata.local_path.is_some() {
        reliquary_mirror::mirror_register_local_path(&blob_with_metadata).await;
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
    let deleted_by_for_mirror = deleted_by.clone();

    let row = sqlx::query!(
        "UPDATE media_blobz
         SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ?
         WHERE id = ? AND deleted_at IS NULL
         RETURNING blake3",
        deleted_by,
        deleted_by,
        id
    )
    .fetch_optional(&pool)
    .await?;

    let row = match row {
        Some(row) => row,
        None => return Err(GrimoireError::MediaBlobNotFound { id: id.to_string() }),
    };

    if let (Some(blake3), Some(actor)) = (row.blake3.as_deref(), deleted_by_for_mirror.as_deref()) {
        reliquary_mirror::mirror_soft_delete(blake3, actor).await;
    }

    Ok(())
}

/// update a media blob's registered content identity (sha256, blake3,
/// mime, size) to match bytes that have replaced its previously-stored
/// content - e.g. converting an original image to webp under the same
/// blob id. sha256 has a UNIQUE constraint; if the new hash would collide
/// with another blob's existing sha256 (vanishingly unlikely for real
/// content, but checked defensively - the same conflict-check-first
/// pattern the rescan path uses for a similar "content changed, hash
/// needs bumping" case), the sha256/blake3 update is skipped and a
/// warning is logged, while mime/size still update to reflect the new
/// bytes.
pub async fn update_blob_content(
    id: &str,
    sha256: &str,
    blake3: &str,
    mime: &str,
    size: i64,
) -> GrimoireResult<MediaBlob> {
    let pool = database::connect().await?;

    let conflict = sqlx::query!(
        "SELECT id as \"id!\" FROM media_blobz WHERE sha256 = ? AND id != ? LIMIT 1",
        sha256,
        id
    )
    .fetch_optional(&pool)
    .await?;

    let blob = if conflict.is_some() {
        tracing::warn!(
            "update_blob_content: new sha256 for blob {} collides with another blob's sha256 - leaving stored sha256/blake3 unchanged",
            id
        );
        sqlx::query_as!(
            MediaBlob,
            "UPDATE media_blobz
             SET mime = ?, size = ?, updated_at = unixepoch()
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
            mime,
            size,
            id
        )
        .fetch_one(&pool)
        .await?
    } else {
        sqlx::query_as!(
            MediaBlob,
            "UPDATE media_blobz
             SET sha256 = ?, blake3 = ?, mime = ?, size = ?, updated_at = unixepoch()
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
            sha256,
            blake3,
            mime,
            size,
            id
        )
        .fetch_one(&pool)
        .await?
    };

    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
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

    // this update marks the first point at which the blob has a hash, so
    // the deferred dual-write into reliquary happens here.
    if let Ok(blob) = get_media_blob(id).await {
        if blob.local_path.is_some() {
            reliquary_mirror::mirror_register_local_path(&blob).await;
        } else if let Ok((_, Some(bytes))) = get_media_blob_with_data(id).await {
            reliquary_mirror::mirror_insert_bytes(&blob, &bytes).await;
        }
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

    // these tests spin up a fresh tempdir with their own grimoire.db,
    // blob_data db, and reliquary.db (via the same real db pool singletons
    // `get_media_blob_with_data` itself uses), so each is marked #[ignore]
    // per this crate's convention for tests touching those singletons. run
    // ONE at a time, each its own process - the pools are process-wide, so
    // running more than one together (even in the same `--ignored` filter)
    // races over the same singleton and fails with a spurious "table
    // already exists" migration error:
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_get_media_blob_with_data_falls_back_to_reliquary
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_get_media_blob_with_data_not_found_anywhere
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_update_blob_content_updates_all_fields
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::service::tests::test_update_blob_content_skips_hash_update_on_sha256_conflict
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

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_update_blob_content_updates_all_fields() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type)
             VALUES ('convert01', ?, 10, 'image/jpeg', 'original')",
        )
        .bind("a".repeat(64))
        .execute(&pool)
        .await
        .expect("insert media_blobz row");

        let new_sha256 = "b".repeat(64);
        let new_blake3 = reliquary::hash_bytes(b"webp bytes");
        let updated = update_blob_content("convert01", &new_sha256, &new_blake3, "image/webp", 42)
            .await
            .expect("update_blob_content");
        assert_eq!(updated.sha256, new_sha256);
        assert_eq!(updated.blake3.as_deref(), Some(new_blake3.as_str()));
        assert_eq!(updated.mime.as_deref(), Some("image/webp"));
        assert_eq!(updated.size, Some(42));

        // re-fetch to confirm the update was actually persisted, not just
        // reflected in the returned row.
        let refetched = get_media_blob("convert01").await.expect("get_media_blob");
        assert_eq!(refetched.sha256, new_sha256);
        assert_eq!(refetched.blake3.as_deref(), Some(new_blake3.as_str()));
        assert_eq!(refetched.mime.as_deref(), Some("image/webp"));
        assert_eq!(refetched.size, Some(42));
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_update_blob_content_skips_hash_update_on_sha256_conflict() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");
        let other_sha256 = "c".repeat(64);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type)
             VALUES ('other01', ?, 5, 'image/png', 'original')",
        )
        .bind(&other_sha256)
        .execute(&pool)
        .await
        .expect("insert other blob");

        let original_sha256 = "d".repeat(64);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type)
             VALUES ('convert02', ?, 10, 'image/jpeg', 'original')",
        )
        .bind(&original_sha256)
        .execute(&pool)
        .await
        .expect("insert convert02 blob");

        // attempt to bump convert02's sha256 to the same value other01
        // already owns - the sha256/blake3 update must be skipped (the
        // UNIQUE constraint would otherwise reject the whole statement),
        // while mime/size still update to reflect the new bytes.
        let colliding_blake3 = reliquary::hash_bytes(b"colliding webp bytes");
        let updated = update_blob_content(
            "convert02",
            &other_sha256,
            &colliding_blake3,
            "image/webp",
            99,
        )
        .await
        .expect("update_blob_content");
        assert_eq!(
            updated.sha256, original_sha256,
            "sha256 must be left unchanged on conflict"
        );
        assert_eq!(
            updated.blake3, None,
            "blake3 must be left unchanged on conflict"
        );
        assert_eq!(updated.mime.as_deref(), Some("image/webp"));
        assert_eq!(updated.size, Some(99));
    }
}
