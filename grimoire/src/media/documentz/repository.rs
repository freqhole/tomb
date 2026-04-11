//! document repository — CRUD operations for the documentz table

use super::models::{CreateDocumentRequest, Document, DocumentPageImage};
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

/// insert a document image association (page render or thumbnail)
pub async fn insert_document_image(
    document_id: &str,
    media_blob_id: &str,
    image_type: &str,
    page_number: Option<i64>,
    total_pages: Option<i64>,
    is_primary: bool,
) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    sqlx::query!(
        "INSERT OR IGNORE INTO document_imagez (document_id, media_blob_id, image_type, page_number, total_pages, is_primary)
         VALUES (?, ?, ?, ?, ?, ?)",
        document_id,
        media_blob_id,
        image_type,
        page_number,
        total_pages,
        is_primary,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// get all page render images for a document, ordered by page number
pub async fn get_document_page_images(document_id: &str) -> GrimoireResult<Vec<DocumentPageImage>> {
    let pool = database::connect().await?;
    let rows = sqlx::query_as!(
        DocumentPageImage,
        "SELECT
            di.document_id,
            di.media_blob_id as page_blob_id,
            di.page_number,
            di.total_pages,
            mb.blake3,
            mb.size,
            mb.mime,
            mb.filename
         FROM document_imagez di
         JOIN media_blobz mb ON di.media_blob_id = mb.id
         WHERE di.document_id = ? AND di.image_type = 'page_render' AND mb.deleted_at IS NULL
         ORDER BY di.page_number",
        document_id,
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}

/// get all page render images for a document by its media blob id
pub async fn get_document_page_images_by_blob_id(
    media_blob_id: &str,
) -> GrimoireResult<Vec<DocumentPageImage>> {
    let pool = database::connect().await?;
    let rows = sqlx::query_as!(
        DocumentPageImage,
        "SELECT
            di.document_id,
            di.media_blob_id as page_blob_id,
            di.page_number,
            di.total_pages,
            mb.blake3,
            mb.size,
            mb.mime,
            mb.filename
         FROM document_imagez di
         JOIN documentz d ON di.document_id = d.id
         JOIN media_blobz mb ON di.media_blob_id = mb.id
         WHERE d.media_blob_id = ? AND di.image_type = 'page_render' AND mb.deleted_at IS NULL AND d.deleted_at IS NULL
         ORDER BY di.page_number",
        media_blob_id,
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}

/// delete all page render images for a document (for re-rendering)
pub async fn delete_document_page_images(document_id: &str) -> GrimoireResult<u64> {
    let pool = database::connect().await?;
    let result = sqlx::query!(
        "DELETE FROM document_imagez WHERE document_id = ? AND image_type = 'page_render'",
        document_id,
    )
    .execute(&pool)
    .await?;
    Ok(result.rows_affected())
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

/// update document metadata fields (extracted from processing)
pub async fn update_document_metadata(
    id: &str,
    author: Option<String>,
    page_count: Option<i64>,
    doc_type: Option<String>,
    language: Option<String>,
) -> GrimoireResult<Document> {
    let pool = database::connect().await?;

    let document = sqlx::query_as!(
        Document,
        "UPDATE documentz SET
            author = COALESCE(?, author),
            page_count = COALESCE(?, page_count),
            doc_type = COALESCE(?, doc_type),
            language = COALESCE(?, language)
         WHERE id = ? AND deleted_at IS NULL
         RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            author, page_count, doc_type, language, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        author,
        page_count,
        doc_type,
        language,
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(document)
}
