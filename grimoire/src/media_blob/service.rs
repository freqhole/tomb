//! media blob service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateMediaBlobRequest, MediaBlob};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new media blob
pub async fn create_media_blob(
    req: CreateMediaBlobRequest,
    media_db_path: &str,
) -> GrimoireResult<MediaBlob> {
    let pool = database::connect_media_blobz(media_db_path).await?;

    let blob_type = req.blob_type.unwrap_or_else(|| "original".to_string());
    let metadata_str = serde_json::to_string(&req.metadata).unwrap_or_else(|_| "{}".to_string());

    let blob = sqlx::query_as!(
        MediaBlob,
        "INSERT INTO media_blobz (
            sha256, size, mime, source_client_id, local_path,
            parent_blob_id, blob_type, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            rowid as \"rowid!\",
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by",
        req.sha256,
        req.size,
        req.mime,
        req.source_client_id,
        req.local_path,
        req.parent_blob_id,
        blob_type,
        metadata_str,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    // Parse the metadata JSON from the returned string
    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// list all media blobs (non-deleted only)
pub async fn list_media_blobs(media_db_path: &str) -> GrimoireResult<Vec<MediaBlob>> {
    let pool = database::connect_media_blobz(media_db_path).await?;

    let blobs = sqlx::query_as!(
        MediaBlob,
        "SELECT
            rowid as \"rowid!\",
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
         FROM media_blobz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 100"
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
pub async fn get_media_blob(id: &str, media_db_path: &str) -> GrimoireResult<MediaBlob> {
    let pool = database::connect_media_blobz(media_db_path).await?;

    let blob = sqlx::query_as!(
        MediaBlob,
        "SELECT
            rowid as \"rowid!\",
            id as \"id!\",
            sha256 as \"sha256!\",
            size,
            mime,
            source_client_id,
            local_path,
            parent_blob_id,
            blob_type as \"blob_type!\",
            metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
         FROM media_blobz
         WHERE id = ? AND deleted_at IS NULL",
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::MediaBlobNotFound { id: id.to_string() })?;

    // Parse the metadata JSON
    let mut blob_with_metadata = blob;
    blob_with_metadata.metadata =
        serde_json::from_str(&blob_with_metadata.metadata.as_str().unwrap_or("{}"))
            .unwrap_or_default();

    Ok(blob_with_metadata)
}

/// soft delete a media blob
pub async fn delete_media_blob(
    id: &str,
    deleted_by: Option<String>,
    media_db_path: &str,
) -> GrimoireResult<()> {
    let pool = database::connect_media_blobz(media_db_path).await?;
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
