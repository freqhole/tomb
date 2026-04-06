//! photo repository — CRUD operations for the photoz table

use super::models::{CreatePhotoRequest, Photo};
use crate::database;
use crate::error::GrimoireResult;

/// create a new photo entity
pub async fn create_photo(req: CreatePhotoRequest) -> GrimoireResult<Photo> {
    let pool = database::connect().await?;

    let photo = sqlx::query_as!(
        Photo,
        "INSERT INTO photoz (
            media_blob_id, title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.media_blob_id,
        req.title,
        req.description,
        req.original_filename,
        req.taken_at,
        req.width,
        req.height,
        req.camera_make,
        req.camera_model,
        req.gps_lat,
        req.gps_lon,
        req.orientation,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(photo)
}

/// get photo entity by id
pub async fn get_photo_by_id(id: &str) -> GrimoireResult<Photo> {
    let pool = database::connect().await?;

    let photo = sqlx::query_as!(
        Photo,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM photoz
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(photo)
}

/// get photo entity by media blob id
pub async fn get_photo_by_blob_id(media_blob_id: &str) -> GrimoireResult<Photo> {
    let pool = database::connect().await?;

    let photo = sqlx::query_as!(
        Photo,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM photoz
         WHERE media_blob_id = ? AND deleted_at IS NULL
         LIMIT 1",
        media_blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(photo)
}

/// list photo entities (non-deleted only)
pub async fn list_photos(limit: Option<u32>, offset: Option<u32>) -> GrimoireResult<Vec<Photo>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let photos = sqlx::query_as!(
        Photo,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM photoz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(photos)
}

/// soft delete a photo entity
pub async fn delete_photo(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE photoz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("photo entity not found: {}", id),
        });
    }

    Ok(())
}
