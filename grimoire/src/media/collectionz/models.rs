//! collection domain models — cross-domain collections

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// collection entity — groups items from any media domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Collection {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub collection_type: Option<String>,
    pub cover_blob_id: Option<String>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// an item within a collection, referencing an entity in any domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
    pub item_type: String,
    pub item_id: String,
    pub position: i64,
    pub added_at: i64,
}

/// request for creating a new collection
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateCollectionRequest {
    pub title: String,
    pub description: Option<String>,
    pub collection_type: Option<String>,
    pub cover_blob_id: Option<String>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}

/// request for adding an item to a collection
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddCollectionItemRequest {
    pub collection_id: String,
    pub item_type: String,
    pub item_id: String,
    pub position: Option<i64>,
}
