//! Media blob repository with cursor-based pagination support
//!
//! This module provides the repository abstraction for media blob data access
//! with support for both traditional offset-based pagination and modern
//! cursor-based pagination for efficient synchronization.

use super::models::{
    CreateMediaBlob, CursorError, MediaBlob, MediaBlobQuery, PaginatedResult, PaginationDirection,
};
use sqlx::{PgPool, Row};

use time::OffsetDateTime;
use tracing::debug;
use uuid::Uuid;

/// Repository for media blob operations
#[derive(Clone)]
pub struct MediaBlobRepository {
    pool: PgPool,
}

/// Errors that can occur during media blob repository operations
#[derive(Debug, thiserror::Error)]
pub enum MediaRepositoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Media blob not found with id: {0}")]
    NotFound(Uuid),
    #[error("Media blob not found with SHA256: {0}")]
    NotFoundBySha256(String),
    #[error("Invalid cursor: {0}")]
    InvalidCursor(#[from] CursorError),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate media blob with SHA256: {0}")]
    Duplicate(String),
}

impl MediaBlobRepository {
    /// Create a new media blob repository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Create a new media blob
    pub async fn create(
        &self,
        create_blob: CreateMediaBlob,
    ) -> Result<MediaBlob, MediaRepositoryError> {
        let media_blob = create_blob.into_media_blob();
        let data_clone = media_blob.data.clone();

        let row = sqlx::query!(
            r#"
            INSERT INTO media_blobs (id, data, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at
            "#,
            media_blob.id,
            media_blob.data,
            media_blob.sha256,
            media_blob.size,
            media_blob.mime,
            media_blob.source_client_id,
            media_blob.local_path,
            media_blob.parent_blob_id,
            media_blob.blob_type,
            media_blob.metadata,
            media_blob.created_at,
            media_blob.updated_at
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(MediaBlob {
            id: row.id,
            data: data_clone, // Include data in response for create
            sha256: row.sha256,
            size: row.size,
            mime: row.mime,
            source_client_id: row.source_client_id,
            local_path: row.local_path,
            parent_blob_id: row.parent_blob_id,
            blob_type: row.blob_type,
            metadata: row.metadata.unwrap_or_else(|| serde_json::json!({})),
            created_at: row.created_at.unwrap(),
            updated_at: row.updated_at.unwrap(),
        })
    }

    /// Find a media blob by ID
    pub async fn find_by_id(&self, id: Uuid) -> Result<MediaBlob, MediaRepositoryError> {
        let row = sqlx::query!(
            "SELECT id, data, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at FROM media_blobs WHERE id = $1",
            id
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => Ok(MediaBlob {
                id: row.id,
                data: row.data,
                sha256: row.sha256,
                size: row.size,
                mime: row.mime,
                source_client_id: row.source_client_id,
                local_path: row.local_path,
                parent_blob_id: row.parent_blob_id,
                blob_type: row.blob_type,
                metadata: row.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: row.created_at.unwrap(),
                updated_at: row.updated_at.unwrap(),
            }),
            None => Err(MediaRepositoryError::NotFound(id)),
        }
    }

    /// Find a media blob by ID without binary data
    pub async fn find_by_id_without_data(
        &self,
        id: Uuid,
    ) -> Result<MediaBlob, MediaRepositoryError> {
        let row = sqlx::query!(
            "SELECT id, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at FROM media_blobs WHERE id = $1",
            id
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => Ok(MediaBlob {
                id: row.id,
                data: None,
                sha256: row.sha256,
                size: row.size,
                mime: row.mime,
                source_client_id: row.source_client_id,
                local_path: row.local_path,
                parent_blob_id: row.parent_blob_id,
                blob_type: row.blob_type,
                metadata: row.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: row.created_at.unwrap(),
                updated_at: row.updated_at.unwrap(),
            }),
            None => Err(MediaRepositoryError::NotFound(id)),
        }
    }

    /// Find a media blob by SHA256 hash
    pub async fn find_by_sha256(&self, sha256: &str) -> Result<MediaBlob, MediaRepositoryError> {
        let row = sqlx::query!(
            "SELECT id, data, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at FROM media_blobs WHERE sha256 = $1",
            sha256
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => Ok(MediaBlob {
                id: row.id,
                data: row.data,
                sha256: row.sha256,
                size: row.size,
                mime: row.mime,
                source_client_id: row.source_client_id,
                local_path: row.local_path,
                parent_blob_id: row.parent_blob_id,
                blob_type: row.blob_type,
                metadata: row.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: row.created_at.unwrap(),
                updated_at: row.updated_at.unwrap(),
            }),
            None => Err(MediaRepositoryError::NotFoundBySha256(sha256.to_string())),
        }
    }

    /// Query media blobs with advanced pagination support
    pub async fn query(
        &self,
        query: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, MediaRepositoryError> {
        debug!("Querying media blobs with query: {:?}", query);

        if query.is_cursor_based() {
            self.query_with_cursor(query).await
        } else {
            self.query_with_offset(query).await
        }
    }

    /// Query with cursor-based pagination
    async fn query_with_cursor(
        &self,
        query: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, MediaRepositoryError> {
        let page_size = query.effective_page_size();
        let direction = query.pagination_direction();

        // Fetch one extra item to determine if there's a next page
        let fetch_limit = page_size + 1;

        let decoded_cursor = query.decoded_cursor()?;

        // Build the SQL query
        let mut sql = String::from(
            "SELECT id, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at FROM media_blobs WHERE 1=1"
        );
        let mut param_count = 0;
        // Add cursor condition
        if let Some(_cursor) = &decoded_cursor {
            param_count += 1;
            match direction {
                PaginationDirection::Forward => {
                    sql.push_str(&format!(
                        " AND (created_at, id) < (${}, ${})",
                        param_count,
                        param_count + 1
                    ));
                }
                PaginationDirection::Backward => {
                    sql.push_str(&format!(
                        " AND (created_at, id) > (${}, ${})",
                        param_count,
                        param_count + 1
                    ));
                }
            }
            param_count += 1;
        }

        // Add filtering conditions
        if let Some(ref _sha256) = query.sha256 {
            param_count += 1;
            sql.push_str(&format!(" AND sha256 = ${}", param_count));
        }

        if let Some(ref _client_id) = query.source_client_id {
            param_count += 1;
            sql.push_str(&format!(" AND source_client_id = ${}", param_count));
        }

        if let Some(ref _mime_pattern) = query.mime_pattern {
            param_count += 1;
            sql.push_str(&format!(" AND mime LIKE ${}", param_count));
        }

        if let Some(_created_after) = query.created_after {
            param_count += 1;
            sql.push_str(&format!(" AND created_at > ${}", param_count));
        }

        if let Some(_created_before) = query.created_before {
            param_count += 1;
            sql.push_str(&format!(" AND created_at < ${}", param_count));
        }

        if let Some(only_originals) = query.only_originals {
            if only_originals {
                sql.push_str(" AND parent_blob_id IS NULL");
            }
        }

        // Add ordering and limit
        match direction {
            PaginationDirection::Forward => {
                sql.push_str(" ORDER BY created_at DESC, id DESC");
            }
            PaginationDirection::Backward => {
                sql.push_str(" ORDER BY created_at ASC, id ASC");
            }
        }

        param_count += 1;
        sql.push_str(&format!(" LIMIT ${}", param_count));

        // Build and execute query
        let mut sqlx_query = sqlx::query(&sql);

        // Bind cursor values
        if let Some(cursor) = &decoded_cursor {
            sqlx_query = sqlx_query.bind(cursor.created_at).bind(cursor.id);
        }

        // Bind filter values
        if let Some(ref sha256) = query.sha256 {
            sqlx_query = sqlx_query.bind(sha256);
        }
        if let Some(ref client_id) = query.source_client_id {
            sqlx_query = sqlx_query.bind(client_id);
        }
        if let Some(ref mime_pattern) = query.mime_pattern {
            sqlx_query = sqlx_query.bind(format!("%{}%", mime_pattern));
        }
        if let Some(created_after) = query.created_after {
            sqlx_query = sqlx_query.bind(created_after);
        }
        if let Some(created_before) = query.created_before {
            sqlx_query = sqlx_query.bind(created_before);
        }
        // Note: only_originals doesn't need binding as it's just a NULL check

        sqlx_query = sqlx_query.bind(fetch_limit);

        let rows = sqlx_query.fetch_all(&self.pool).await?;

        // Convert rows to MediaBlob objects
        let mut items: Vec<MediaBlob> = rows
            .into_iter()
            .map(|row| MediaBlob {
                id: row.get("id"),
                data: None, // Don't include binary data in query results
                sha256: row.get("sha256"),
                size: row.get("size"),
                mime: row.get("mime"),
                source_client_id: row.get("source_client_id"),
                local_path: row.get("local_path"),
                parent_blob_id: row.get("parent_blob_id"),
                blob_type: row.get::<String, _>("blob_type"),
                metadata: row
                    .get::<Option<serde_json::Value>, _>("metadata")
                    .unwrap_or_else(|| serde_json::json!({})),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        // Reverse items for backward pagination to maintain chronological order
        if matches!(direction, PaginationDirection::Backward) {
            items.reverse();
        }

        // Determine pagination state
        let has_next_page = items.len() > page_size as usize;
        let actual_items = if has_next_page {
            items.into_iter().take(page_size as usize).collect()
        } else {
            items
        };

        // Generate cursors
        let next_cursor = if has_next_page && !actual_items.is_empty() {
            let last_item = actual_items.last().unwrap();
            Some(last_item.cursor().encode()?)
        } else {
            None
        };

        let previous_cursor = if decoded_cursor.is_some() && !actual_items.is_empty() {
            let first_item = actual_items.first().unwrap();
            Some(first_item.cursor().encode()?)
        } else {
            None
        };

        let has_previous_page = decoded_cursor.is_some();

        Ok(PaginatedResult::new(
            actual_items,
            has_next_page,
            has_previous_page,
            next_cursor,
            previous_cursor,
            None, // No total count for cursor-based pagination
        ))
    }

    /// Query with traditional offset-based pagination
    async fn query_with_offset(
        &self,
        query: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, MediaRepositoryError> {
        let limit = query.effective_page_size();
        let offset = query.offset.unwrap_or(0);

        // Build the query for items
        let mut sql = String::from(
            "SELECT id, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at FROM media_blobs WHERE 1=1"
        );
        let mut count_sql = String::from("SELECT COUNT(*) FROM media_blobs WHERE 1=1");
        let mut param_count = 0;

        // Add filtering conditions to both queries
        if let Some(ref _sha256) = query.sha256 {
            param_count += 1;
            let condition = format!(" AND sha256 = ${}", param_count);
            sql.push_str(&condition);
            count_sql.push_str(&condition);
        }

        if let Some(ref _client_id) = query.source_client_id {
            param_count += 1;
            let condition = format!(" AND source_client_id = ${}", param_count);
            sql.push_str(&condition);
            count_sql.push_str(&condition);
        }

        if let Some(ref _mime_pattern) = query.mime_pattern {
            param_count += 1;
            let condition = format!(" AND mime LIKE ${}", param_count);
            sql.push_str(&condition);
            count_sql.push_str(&condition);
        }

        if let Some(_created_after) = query.created_after {
            param_count += 1;
            let condition = format!(" AND created_at > ${}", param_count);
            sql.push_str(&condition);
            count_sql.push_str(&condition);
        }

        if let Some(_created_before) = query.created_before {
            param_count += 1;
            let condition = format!(" AND created_at < ${}", param_count);
            sql.push_str(&condition);
            count_sql.push_str(&condition);
        }

        if let Some(only_originals) = query.only_originals {
            if only_originals {
                let condition = " AND parent_blob_id IS NULL";
                sql.push_str(condition);
                count_sql.push_str(condition);
            }
        }

        // Add ordering and pagination to main query
        sql.push_str(" ORDER BY created_at DESC, id DESC");
        param_count += 1;
        sql.push_str(&format!(" LIMIT ${}", param_count));
        param_count += 1;
        sql.push_str(&format!(" OFFSET ${}", param_count));

        // Execute count query first
        let mut count_query = sqlx::query(&count_sql);
        if let Some(ref sha256) = query.sha256 {
            count_query = count_query.bind(sha256);
        }
        if let Some(ref client_id) = query.source_client_id {
            count_query = count_query.bind(client_id);
        }
        if let Some(ref mime_pattern) = query.mime_pattern {
            count_query = count_query.bind(format!("%{}%", mime_pattern));
        }
        if let Some(created_after) = query.created_after {
            count_query = count_query.bind(created_after);
        }
        if let Some(created_before) = query.created_before {
            count_query = count_query.bind(created_before);
        }
        // Note: only_originals doesn't need binding as it's just a NULL check

        let total_count: i64 = count_query.fetch_one(&self.pool).await?.get(0);

        // Execute main query
        let mut main_query = sqlx::query(&sql);
        if let Some(ref sha256) = query.sha256 {
            main_query = main_query.bind(sha256);
        }
        if let Some(ref client_id) = query.source_client_id {
            main_query = main_query.bind(client_id);
        }
        if let Some(ref mime_pattern) = query.mime_pattern {
            main_query = main_query.bind(format!("%{}%", mime_pattern));
        }
        if let Some(created_after) = query.created_after {
            main_query = main_query.bind(created_after);
        }
        if let Some(created_before) = query.created_before {
            main_query = main_query.bind(created_before);
        }
        // Note: only_originals doesn't need binding as it's just a NULL check
        main_query = main_query.bind(limit).bind(offset);

        let rows = main_query.fetch_all(&self.pool).await?;

        // Convert rows to MediaBlob objects
        let items: Vec<MediaBlob> = rows
            .into_iter()
            .map(|row| MediaBlob {
                id: row.get("id"),
                data: None, // Don't include binary data in query results
                sha256: row.get("sha256"),
                size: row.get("size"),
                mime: row.get("mime"),
                source_client_id: row.get("source_client_id"),
                local_path: row.get("local_path"),
                parent_blob_id: row.get("parent_blob_id"),
                blob_type: row.get::<String, _>("blob_type"),
                metadata: row
                    .get::<Option<serde_json::Value>, _>("metadata")
                    .unwrap_or_else(|| serde_json::json!({})),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(PaginatedResult::from_offset_page(
            items,
            total_count,
            offset,
            limit,
        ))
    }

    /// Check if a media blob exists by SHA256
    pub async fn exists_by_sha256(&self, sha256: &str) -> Result<bool, MediaRepositoryError> {
        let row = sqlx::query!(
            "SELECT EXISTS(SELECT 1 FROM media_blobs WHERE sha256 = $1)",
            sha256
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row.exists.unwrap_or(false))
    }

    /// Update metadata for a media blob
    pub async fn update_metadata(
        &self,
        id: Uuid,
        metadata: serde_json::Value,
    ) -> Result<MediaBlob, MediaRepositoryError> {
        let updated_at = OffsetDateTime::now_utc();

        let row = sqlx::query!(
            "UPDATE media_blobs SET metadata = $1, updated_at = $2 WHERE id = $3 RETURNING id, sha256, size, mime, source_client_id, local_path, parent_blob_id, blob_type, metadata, created_at, updated_at",
            metadata,
            updated_at,
            id
        )
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => Ok(MediaBlob {
                id: row.id,
                data: None, // Don't include binary data in update response
                sha256: row.sha256,
                size: row.size,
                mime: row.mime,
                source_client_id: row.source_client_id,
                local_path: row.local_path,
                parent_blob_id: row.parent_blob_id,
                blob_type: row.blob_type,
                metadata: row.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: row.created_at.unwrap(),
                updated_at: row.updated_at.unwrap(),
            }),
            None => Err(MediaRepositoryError::NotFound(id)),
        }
    }

    /// Delete a media blob by ID
    pub async fn delete(&self, id: Uuid) -> Result<(), MediaRepositoryError> {
        let result = sqlx::query!("DELETE FROM media_blobs WHERE id = $1", id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            Err(MediaRepositoryError::NotFound(id))
        } else {
            Ok(())
        }
    }

    /// Get media blob statistics
    pub async fn get_stats(&self) -> Result<MediaBlobStats, MediaRepositoryError> {
        let stats_row = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_count,
                COALESCE(SUM(size), 0)::BIGINT as total_size,
                COUNT(DISTINCT sha256) as unique_sha256_count
            FROM media_blobs
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let mime_rows = sqlx::query!(
            r#"
            SELECT mime as mime_type, COUNT(*) as count
            FROM media_blobs
            GROUP BY mime
            ORDER BY count DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mime_type_distribution = mime_rows
            .into_iter()
            .map(|row| MimeTypeCount {
                mime_type: row.mime_type,
                count: row.count.unwrap_or(0),
            })
            .collect();

        Ok(MediaBlobStats {
            total_count: stats_row.total_count.unwrap_or(0),
            total_size: stats_row.total_size,
            unique_sha256_count: stats_row.unique_sha256_count.unwrap_or(0),
            mime_type_distribution,
        })
    }

    /// Count media blobs by source client ID
    pub async fn count_by_source_client_id(
        &self,
        source_client_id: &str,
    ) -> Result<i64, MediaRepositoryError> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_blobs WHERE source_client_id = $1",
        )
        .bind(source_client_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }
}

/// Media blob statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaBlobStats {
    pub total_count: i64,
    pub total_size: Option<i64>,
    pub unique_sha256_count: i64,
    pub mime_type_distribution: Vec<MimeTypeCount>,
}

/// Count of blobs by MIME type
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MimeTypeCount {
    pub mime_type: Option<String>,
    pub count: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    use uuid::Uuid;

    // Helper function for tests that need a database
    #[allow(dead_code)]
    async fn setup_test_db() -> PgPool {
        // This would typically use a test database
        // For now, we'll skip actual database tests
        todo!("Setup test database for integration tests")
    }

    #[test]
    fn test_media_repository_error_display() {
        let id = Uuid::new_v4();
        let error = MediaRepositoryError::NotFound(id);
        assert!(error.to_string().contains(&id.to_string()));
    }

    #[test]
    fn test_cursor_error_conversion() {
        let cursor_error = CursorError::InvalidFormat("test".to_string());
        let repo_error: MediaRepositoryError = cursor_error.into();
        match repo_error {
            MediaRepositoryError::InvalidCursor(_) => (),
            _ => panic!("Expected InvalidCursor error"),
        }
    }
}
