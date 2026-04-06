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

/// update photo metadata fields (extracted from EXIF or image processing)
pub async fn update_photo_metadata(
    id: &str,
    width: Option<i64>,
    height: Option<i64>,
    taken_at: Option<i64>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    gps_lat: Option<f64>,
    gps_lon: Option<f64>,
    orientation: Option<i64>,
) -> GrimoireResult<Photo> {
    let pool = database::connect().await?;

    let photo = sqlx::query_as!(
        Photo,
        "UPDATE photoz SET
            width = COALESCE(?, width),
            height = COALESCE(?, height),
            taken_at = COALESCE(?, taken_at),
            camera_make = COALESCE(?, camera_make),
            camera_model = COALESCE(?, camera_model),
            gps_lat = COALESCE(?, gps_lat),
            gps_lon = COALESCE(?, gps_lon),
            orientation = COALESCE(?, orientation)
         WHERE id = ? AND deleted_at IS NULL
         RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            taken_at, width, height, camera_make, camera_model,
            gps_lat, gps_lon, orientation, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        width,
        height,
        taken_at,
        camera_make,
        camera_model,
        gps_lat,
        gps_lon,
        orientation,
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(photo)
}
