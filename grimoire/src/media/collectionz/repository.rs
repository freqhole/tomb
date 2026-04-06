//! collection repository — CRUD operations for collectionz and collection_itemz

use super::models::{
    AddCollectionItemRequest, Collection, CollectionItem, CreateCollectionRequest,
};
use crate::database;
use crate::error::GrimoireResult;

/// create a new collection
pub async fn create_collection(req: CreateCollectionRequest) -> GrimoireResult<Collection> {
    let pool = database::connect().await?;

    let collection = sqlx::query_as!(
        Collection,
        "INSERT INTO collectionz (
            title, description, collection_type, cover_blob_id, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            title as \"title!\",
            description, collection_type, cover_blob_id, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.title,
        req.description,
        req.collection_type,
        req.cover_blob_id,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(collection)
}

/// get collection by id
pub async fn get_collection_by_id(id: &str) -> GrimoireResult<Collection> {
    let pool = database::connect().await?;

    let collection = sqlx::query_as!(
        Collection,
        "SELECT
            id as \"id!\",
            title as \"title!\",
            description, collection_type, cover_blob_id, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM collectionz
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(collection)
}

/// list collections (non-deleted only)
pub async fn list_collections(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<Vec<Collection>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let collections = sqlx::query_as!(
        Collection,
        "SELECT
            id as \"id!\",
            title as \"title!\",
            description, collection_type, cover_blob_id, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM collectionz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(collections)
}

/// soft delete a collection (cascade deletes collection_itemz via FK)
pub async fn delete_collection(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE collectionz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("collection not found: {}", id),
        });
    }

    Ok(())
}

/// add an item to a collection
pub async fn add_item_to_collection(
    req: AddCollectionItemRequest,
) -> GrimoireResult<CollectionItem> {
    let pool = database::connect().await?;

    // if no position specified, append at the end
    let position = match req.position {
        Some(pos) => pos,
        None => {
            let max_pos: Option<(Option<i64>,)> = sqlx::query_as(
                "SELECT MAX(position) FROM collection_itemz WHERE collection_id = ?",
            )
            .bind(&req.collection_id)
            .fetch_optional(&pool)
            .await?;

            max_pos.and_then(|r| r.0).unwrap_or(0) + 1
        }
    };

    let item = sqlx::query_as!(
        CollectionItem,
        "INSERT INTO collection_itemz (
            collection_id, item_type, item_id, position
        ) VALUES (?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            collection_id as \"collection_id!\",
            item_type as \"item_type!\",
            item_id as \"item_id!\",
            position as \"position!\",
            added_at as \"added_at!\"",
        req.collection_id,
        req.item_type,
        req.item_id,
        position
    )
    .fetch_one(&pool)
    .await?;

    Ok(item)
}

/// remove an item from a collection
pub async fn remove_item_from_collection(
    collection_id: &str,
    item_type: &str,
    item_id: &str,
) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "DELETE FROM collection_itemz WHERE collection_id = ? AND item_type = ? AND item_id = ?",
        collection_id,
        item_type,
        item_id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!(
                "collection item not found: {}/{}/{}",
                collection_id, item_type, item_id
            ),
        });
    }

    Ok(())
}

/// list items in a collection, ordered by position
pub async fn list_collection_items(collection_id: &str) -> GrimoireResult<Vec<CollectionItem>> {
    let pool = database::connect().await?;

    let items = sqlx::query_as!(
        CollectionItem,
        "SELECT
            id as \"id!\",
            collection_id as \"collection_id!\",
            item_type as \"item_type!\",
            item_id as \"item_id!\",
            position as \"position!\",
            added_at as \"added_at!\"
         FROM collection_itemz
         WHERE collection_id = ?
         ORDER BY position ASC",
        collection_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(items)
}
