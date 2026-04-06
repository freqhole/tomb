//! file repository — CRUD operations for the filez table

use super::models::{CreateFileRequest, FileEntity};
use crate::database;
use crate::error::GrimoireResult;

/// create a new file entity
pub async fn create_file(req: CreateFileRequest) -> GrimoireResult<FileEntity> {
    let pool = database::connect().await?;

    let file = sqlx::query_as!(
        FileEntity,
        "INSERT INTO filez (
            media_blob_id, title, description, original_filename, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.media_blob_id,
        req.title,
        req.description,
        req.original_filename,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(file)
}

/// get file entity by id
pub async fn get_file_by_id(id: &str) -> GrimoireResult<FileEntity> {
    let pool = database::connect().await?;

    let file = sqlx::query_as!(
        FileEntity,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM filez
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(file)
}

/// get file entity by media blob id
pub async fn get_file_by_blob_id(media_blob_id: &str) -> GrimoireResult<FileEntity> {
    let pool = database::connect().await?;

    let file = sqlx::query_as!(
        FileEntity,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM filez
         WHERE media_blob_id = ? AND deleted_at IS NULL
         LIMIT 1",
        media_blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(file)
}

/// list file entities (non-deleted only)
pub async fn list_files(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<Vec<FileEntity>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let files = sqlx::query_as!(
        FileEntity,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM filez
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(files)
}

/// soft delete a file entity
pub async fn delete_file(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE filez SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("file entity not found: {}", id),
        });
    }

    Ok(())
}
