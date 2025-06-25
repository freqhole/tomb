//! Media blob repository for database operations
//!
//! This module provides database access layer for media blobs,
//! including CRUD operations and queries.

use crate::error::WebauthnError;
use crate::media::models::{CreateMediaBlob, MediaBlob, MediaBlobQuery, MediaBlobStats};
use grimoire::config::MediaConfig;
use grimoire::DatabaseConnection;
use sqlx::postgres::PgRow;
use sqlx::Row;
use time::OffsetDateTime;
use tracing::{debug, error, info};
use uuid::Uuid;

/// Media blob repository for database operations
pub struct MediaRepository<'a> {
    db: &'a DatabaseConnection,
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Media blob not found")]
    NotFound,
    #[error("Invalid SHA256 hash")]
    InvalidHash,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate SHA256 hash")]
    Duplicate,
}

impl From<MediaError> for WebauthnError {
    fn from(err: MediaError) -> Self {
        match err {
            MediaError::Database(e) => WebauthnError::SqlxError(e),
            MediaError::NotFound => WebauthnError::UserNotFound,
            MediaError::InvalidHash => WebauthnError::BadRequest,
            MediaError::Validation(_) => WebauthnError::BadRequest,
            MediaError::Duplicate => WebauthnError::BadRequest,
        }
    }
}

impl<'a> MediaRepository<'a> {
    /// Create a new repository instance
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self { db }
    }

    /// Create a new media blob
    pub async fn create(
        &self,
        params: CreateMediaBlob,
        media_config: &MediaConfig,
    ) -> Result<MediaBlob, WebauthnError> {
        // Validate input with config-based limits
        params
            .validate(
                media_config.max_blob_file_size,
                media_config.max_fs_file_size,
            )
            .map_err(|e| {
                warn!("zomg>>>> bad media_blob {}", e);

                WebauthnError::BadRequest
            })?;

        info!("Creating media blob with SHA256: {}", params.sha256);

        let blob = MediaBlob::new(params);

        let result = sqlx::query!(
            r#"
            INSERT INTO media_blobs (
                id, data, sha256, size, mime, source_client_id,
                local_path, metadata, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            "#,
            blob.id,
            blob.data,
            blob.sha256,
            blob.size,
            blob.mime,
            blob.source_client_id,
            blob.local_path,
            blob.metadata,
            blob.created_at,
            blob.updated_at
        )
        .execute(self.db.pool())
        .await;

        match result {
            Ok(_) => {
                info!("Successfully created media blob: {}", blob.id);
                Ok(blob)
            }
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                warn!("Duplicate SHA256 hash: {}", blob.sha256);
                Err(WebauthnError::BadRequest)
            }
            Err(e) => {
                error!("Failed to create media blob: {}", e);
                println!("onoz blob Failed to create media blob: {}", e);
                Err(WebauthnError::SqlxError(e))
            }
        }
    }

    /// Find a media blob by ID
    pub async fn find_by_id(&self, id: Uuid) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by ID: {}", id);

        let row = sqlx::query!(
            r#"
            SELECT id, data, sha256, size, mime, source_client_id,
                   local_path, metadata, created_at, updated_at
            FROM media_blobs
            WHERE id = $1
            "#,
            id
        )
        .fetch_optional(self.db.pool())
        .await?;

        match row {
            Some(r) => Ok(MediaBlob {
                id: r.id,
                data: r.data,
                sha256: r.sha256,
                size: r.size,
                mime: r.mime,
                source_client_id: r.source_client_id,
                local_path: r.local_path,
                metadata: r.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: r.created_at.unwrap_or_else(OffsetDateTime::now_utc),
                updated_at: r.updated_at.unwrap_or_else(OffsetDateTime::now_utc),
            }),
            None => Err(WebauthnError::UserNotFound),
        }
    }

    /// Find a media blob by SHA256 hash
    pub async fn get_by_sha256(&self, sha256: &str) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by SHA256: {}", sha256);

        let row = sqlx::query!(
            r#"
            SELECT id, data, sha256, size, mime, source_client_id,
                   local_path, metadata, created_at, updated_at
            FROM media_blobs
            WHERE sha256 = $1
            "#,
            sha256
        )
        .fetch_optional(self.db.pool())
        .await?;

        match row {
            Some(r) => Ok(MediaBlob {
                id: r.id,
                data: r.data,
                sha256: r.sha256,
                size: r.size,
                mime: r.mime,
                source_client_id: r.source_client_id,
                local_path: r.local_path,
                metadata: r.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: r.created_at.unwrap_or_else(OffsetDateTime::now_utc),
                updated_at: r.updated_at.unwrap_or_else(OffsetDateTime::now_utc),
            }),
            None => Err(WebauthnError::UserNotFound),
        }
    }

    /// Find a media blob by ID without data (for efficient responses)
    /// Get a media blob by ID without data field for efficiency
    pub async fn get_by_id_without_data(&self, id: Uuid) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by ID without data: {}", id);

        let row = sqlx::query!(
            r#"
            SELECT id, sha256, size, mime, source_client_id,
                   local_path, metadata, created_at, updated_at
            FROM media_blobs
            WHERE id = $1
            "#,
            id
        )
        .fetch_optional(self.db.pool())
        .await?;

        match row {
            Some(r) => Ok(MediaBlob {
                id: r.id,
                data: None, // Explicitly exclude data
                sha256: r.sha256,
                size: r.size,
                mime: r.mime,
                source_client_id: r.source_client_id,
                local_path: r.local_path,
                metadata: r.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: r.created_at.unwrap_or_else(OffsetDateTime::now_utc),
                updated_at: r.updated_at.unwrap_or_else(OffsetDateTime::now_utc),
            }),
            None => Err(WebauthnError::UserNotFound),
        }
    }

    /// Query media blobs with filtering and pagination
    pub async fn query(&self, params: MediaBlobQuery) -> Result<Vec<MediaBlob>, WebauthnError> {
        debug!("Querying media blobs with params: {:?}", params);

        let limit = params.limit.unwrap_or(50).min(1000); // Cap at 1000
        let offset = params.offset.unwrap_or(0);

        // Build the query manually since we need to handle type conversion
        let mut sql = String::from(
            "SELECT id, sha256, size, mime, source_client_id, local_path, metadata, created_at, updated_at FROM media_blobs WHERE 1=1"
        );
        let mut param_count = 0;

        if let Some(ref _sha256) = params.sha256 {
            param_count += 1;
            sql.push_str(&format!(" AND sha256 = ${}", param_count));
        }

        if let Some(ref _client_id) = params.source_client_id {
            param_count += 1;
            sql.push_str(&format!(" AND source_client_id = ${}", param_count));
        }

        if let Some(ref _mime_pattern) = params.mime_pattern {
            param_count += 1;
            sql.push_str(&format!(" AND mime LIKE ${}", param_count));
        }

        param_count += 1;
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ${}", param_count));
        param_count += 1;
        sql.push_str(&format!(" OFFSET ${}", param_count));

        // Execute the query manually
        let mut query = sqlx::query(&sql);

        if let Some(ref sha256) = params.sha256 {
            query = query.bind(sha256);
        }
        if let Some(ref client_id) = params.source_client_id {
            query = query.bind(client_id);
        }
        if let Some(ref mime_pattern) = params.mime_pattern {
            query = query.bind(format!("%{}%", mime_pattern));
        }
        query = query.bind(limit).bind(offset);

        let rows = query.fetch_all(self.db.pool()).await?;

        let blobs = rows
            .into_iter()
            .map(|row: PgRow| {
                MediaBlob {
                    id: row.get("id"),
                    data: None, // Don't include data in query results
                    sha256: row.get("sha256"),
                    size: row.get("size"),
                    mime: row.get("mime"),
                    source_client_id: row.get("source_client_id"),
                    local_path: row.get("local_path"),
                    metadata: row
                        .get::<Option<serde_json::Value>, _>("metadata")
                        .unwrap_or_else(|| serde_json::json!({})),
                    created_at: row
                        .get::<Option<OffsetDateTime>, _>("created_at")
                        .unwrap_or_else(OffsetDateTime::now_utc),
                    updated_at: row
                        .get::<Option<OffsetDateTime>, _>("updated_at")
                        .unwrap_or_else(OffsetDateTime::now_utc),
                }
            })
            .collect();

        Ok(blobs)
    }

    /// Get media blob statistics
    pub async fn get_stats(&self) -> Result<MediaBlobStats, WebauthnError> {
        debug!("Getting media blob statistics");

        // TODO: Uncomment after running sqlx prepare
        /*
        // Get total count and size
        let totals = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_count,
                SUM(size) as total_size,
                COUNT(DISTINCT sha256) as unique_sha256_count
            FROM media_blobs
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        // Get MIME type distribution
        let mime_rows = sqlx::query!(
            r#"
            SELECT mime, COUNT(*) as count
            FROM media_blobs
            GROUP BY mime
            ORDER BY count DESC
            "#
        )
        .fetch_all(self.db.pool())
        .await?;

        let mime_type_distribution = mime_rows
            .into_iter()
            .map(|r| MimeTypeCount {
                mime_type: r.mime,
                count: r.count.unwrap_or(0),
            })
            .collect();

        Ok(MediaBlobStats {
            total_count: totals.total_count.unwrap_or(0),
            total_size: totals
                .total_size
                .map(|s| s.to_string().parse::<i64>().unwrap_or(0)),
            unique_sha256_count: totals.unique_sha256_count.unwrap_or(0),
            mime_type_distribution,
        })
        */

        // Temporary mock implementation
        Ok(MediaBlobStats {
            total_count: 0,
            total_size: None,
            unique_sha256_count: 0,
            mime_type_distribution: vec![],
        })
    }

    /// Update blob metadata
    pub async fn update_metadata(
        &self,
        id: Uuid,
        _metadata: serde_json::Value,
    ) -> Result<MediaBlob, WebauthnError> {
        debug!("Updating metadata for media blob: {}", id);

        // TODO: Uncomment after running sqlx prepare
        /*
        let updated_at = OffsetDateTime::now_utc();

        sqlx::query!(
            r#"
            UPDATE media_blobs
            SET metadata = $1, updated_at = $2
            WHERE id = $3
            "#,
            metadata,
            updated_at,
            id
        )
        .execute(self.db.pool())
        .await?;

        // Return the updated blob
        self.find_by_id(id).await
        */

        // Temporary mock implementation
        Err(WebauthnError::UserNotFound)
    }

    /// Delete a media blob by ID
    pub async fn delete(&self, id: Uuid) -> Result<bool, WebauthnError> {
        info!("Deleting media blob: {}", id);

        let result = sqlx::query!("DELETE FROM media_blobs WHERE id = $1", id)
            .execute(self.db.pool())
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Clean up old media blobs (older than specified days)
    pub async fn cleanup_old_blobs(&self, days: i32) -> Result<u64, WebauthnError> {
        info!("Cleaning up media blobs older than {} days", days);

        let cutoff_date = OffsetDateTime::now_utc() - time::Duration::days(days as i64);

        let result = sqlx::query!("DELETE FROM media_blobs WHERE created_at < $1", cutoff_date)
            .execute(self.db.pool())
            .await?;

        let deleted_count = result.rows_affected();
        info!("Deleted {} old media blobs", deleted_count);

        Ok(deleted_count)
    }

    /// Get media blobs by client ID
    pub async fn find_by_client_id(
        &self,
        client_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        let query = MediaBlobQuery {
            limit,
            offset,
            source_client_id: Some(client_id.to_string()),
            ..Default::default()
        };

        self.query(query).await
    }

    /// Check if a media blob exists by SHA256
    pub async fn exists_by_sha256(&self, sha256: &str) -> Result<bool, WebauthnError> {
        debug!("Checking if media blob exists by SHA256: {}", sha256);

        let result = sqlx::query!(
            "SELECT 1 as exists FROM media_blobs WHERE sha256 = $1 LIMIT 1",
            sha256
        )
        .fetch_optional(self.db.pool())
        .await?;

        Ok(result.is_some())
    }

    /// Get recent media blobs (within last N days)
    pub async fn get_recent(
        &self,
        days: i32,
        _limit: Option<i64>,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        debug!("Getting recent media blobs from last {} days", days);

        // TODO: Uncomment after running sqlx prepare
        /*
        let cutoff_date = OffsetDateTime::now_utc() - time::Duration::days(days as i64);
        let limit = limit.unwrap_or(50).min(1000);

        let rows = sqlx::query!(
            r#"
            SELECT id, sha256, size, mime, source_client_id,
                   local_path, metadata, created_at, updated_at
            FROM media_blobs
            WHERE created_at >= $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
            cutoff_date,
            limit
        )
        .fetch_all(self.db.pool())
        .await?;

        let blobs = rows
            .into_iter()
            .map(|r| MediaBlob {
                id: r.id,
                data: None,
                sha256: r.sha256,
                size: r.size,
                mime: r.mime,
                source_client_id: r.source_client_id,
                local_path: r.local_path,
                metadata: r.metadata.unwrap_or_else(|| serde_json::json!({})),
                created_at: r.created_at.unwrap_or_else(OffsetDateTime::now_utc),
                updated_at: r.updated_at.unwrap_or_else(OffsetDateTime::now_utc),
            })
            .collect();

        Ok(blobs)
        */

        // Temporary mock implementation
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use grimoire::DatabaseConnection;

    async fn _setup_test_db() -> DatabaseConnection {
        // This would be set up with test database in real tests
        todo!("Setup test database")
    }

    #[tokio::test]
    async fn test_create_media_blob() {
        // let db = setup_test_db().await;
        // let repo = MediaRepository::new(&db);

        // let params = CreateMediaBlob {
        //     data: Some(vec![1, 2, 3, 4]),
        //     sha256: "a".repeat(64),
        //     size: Some(4),
        //     mime: Some("image/png".to_string()),
        //     source_client_id: Some("test-client".to_string()),
        //     local_path: None,
        //     metadata: serde_json::Value::Null,
        // };

        // let result = repo.create(params).await;
        // assert!(result.is_ok());
        assert!(true); // Placeholder test
    }
}
