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
            return Ok(undeleted_with_metadata);
        }

        // blob already exists and is not deleted, return it with parsed metadata
        tracing::info!(
            "create_blob: found existing blob with same sha256, returning: existing_id={}, sha256={}, blob_type={}",
            existing_blob.id,
            existing_blob.sha256,
            existing_blob.blob_type
        );
        let mut existing_with_metadata = existing_blob;
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
/// accepts blob id OR sha256 hash (auto-detected by length)
/// returns (MediaBlob, Option<Vec<u8>>)
/// - if blob has local_path, returns (blob, None) - data should be read from filesystem
/// - if blob data is in database, returns (blob, Some(data))
/// - if neither exists, returns error
pub async fn get_media_blob_with_data(id_or_sha256: &str) -> GrimoireResult<(MediaBlob, Option<Vec<u8>>)> {
    // auto-detect: sha256 is 64 chars, blob_id is shorter
    let blob = if id_or_sha256.len() == 64 && id_or_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        get_media_blob_by_sha256(id_or_sha256).await?
    } else {
        get_media_blob(id_or_sha256).await?
    };

    // If blob has local_path, caller should read from filesystem
    if blob.local_path.is_some() {
        return Ok((blob, None));
    }

    // Try to get data from blob_data table (using actual blob id, not sha256)
    let data_response = blob_data::get_blob_data(&blob.id).await;

    if data_response.success {
        if let Some(data) = data_response.data {
            return Ok((blob, Some(data)));
        }
    }

    // No data source available
    Err(GrimoireError::MediaBlobNotFound {
        id: id_or_sha256.to_string(),
    })
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

/// count blobs that need blake3 computation (have local_path but no blake3)
pub async fn count_blobs_needing_blake3() -> GrimoireResult<i64> {
    let pool = database::connect().await?;

    let result: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM media_blobz WHERE local_path IS NOT NULL AND blake3 IS NULL AND deleted_at IS NULL"
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
         WHERE local_path IS NOT NULL AND blake3 IS NULL AND deleted_at IS NULL
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
