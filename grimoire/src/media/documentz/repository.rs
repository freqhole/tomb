//! document repository — CRUD operations for the documentz table

use super::models::{CreateDocumentRequest, Document};
use crate::database;
use crate::error::GrimoireResult;

/// create a new document entity
pub async fn create_document(req: CreateDocumentRequest) -> GrimoireResult<Document> {
    let pool = database::connect().await?;

    let document = sqlx::query_as!(
        Document,
        "INSERT INTO documentz (
            media_blob_id, title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.media_blob_id,
        req.title,
        req.description,
        req.original_filename,
        req.author,
        req.page_count,
        req.doc_type,
        req.language,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(document)
}

/// get document entity by id
pub async fn get_document_by_id(id: &str) -> GrimoireResult<Document> {
    let pool = database::connect().await?;

    let document = sqlx::query_as!(
        Document,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM documentz
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(document)
}

/// get document entity by media blob id
pub async fn get_document_by_blob_id(media_blob_id: &str) -> GrimoireResult<Document> {
    let pool = database::connect().await?;

    let document = sqlx::query_as!(
        Document,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM documentz
         WHERE media_blob_id = ? AND deleted_at IS NULL
         LIMIT 1",
        media_blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(document)
}

/// list document entities (non-deleted only)
pub async fn list_documents(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<Vec<Document>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let documents = sqlx::query_as!(
        Document,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM documentz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(documents)
}

/// soft delete a document entity
pub async fn delete_document(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE documentz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("document entity not found: {}", id),
        });
    }

    Ok(())
}
