//! document domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// document entity — PDFs, ebooks, text files, etc.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Document {
    pub id: String,
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub author: Option<String>,
    pub page_count: Option<i64>,
    pub doc_type: Option<String>,
    pub language: Option<String>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new document entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateDocumentRequest {
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub author: Option<String>,
    pub page_count: Option<i64>,
    pub doc_type: Option<String>,
    pub language: Option<String>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}

/// a single page image from a rendered document
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct DocumentPageImage {
    pub document_id: String,
    pub page_blob_id: String,
    pub page_number: Option<i64>,
    pub total_pages: Option<i64>,
    pub blake3: Option<String>,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub filename: Option<String>,
}
