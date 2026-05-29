//! media blob service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{BlobType, CreateMediaBlobRequest, MediaBlob};
use crate::error::{GrimoireError, GrimoireResult};
use crate::{blob_data, database};

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
                serde_json::from_str(&undeleted_with_metadata.metadata.as_str().unwrap_or("{}"))
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
                        serde_json::from_str(&relocated.metadata.as_str().unwrap_or("{}"))
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
            serde_json::from_str(&existing_with_metadata.metadata.as_str().unwrap_or("{}"))
                .unwrap_or_default();
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
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
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
                serde_json::from_str(&blob.metadata.as_str().unwrap_or("{}")).unwrap_or_default();
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
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
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
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// get media blob with binary data for streaming
///
/// returns (MediaBlob, Option<Vec<u8>>)
/// - if blob has local_path, returns (blob, None) - data should be read from filesystem
/// - if blob data is in database, returns (blob, Some(data))
/// - if neither exists, returns error
pub async fn get_media_blob_with_data(id: &str) -> GrimoireResult<(MediaBlob, Option<Vec<u8>>)> {
    let blob = get_media_blob(id).await?;

    // If blob has local_path, caller should read from filesystem
    if blob.local_path.is_some() {
        return Ok((blob, None));
    }

    // Try to get data from blob_data table
    let data_response = blob_data::get_blob_data(&blob.id).await;

    if data_response.success {
        if let Some(data) = data_response.data {
            return Ok((blob, Some(data)));
        }
    }

    // No data source available
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
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
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
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
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
                serde_json::from_str(&blob.metadata.as_str().unwrap_or("{}")).unwrap_or_default();
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
