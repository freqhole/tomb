//! Video domain repository
//!
//! This module provides database access layer for videos and playlists,
//! including CRUD operations and queries with proper error handling.

use crate::media::{CreateMediaBlob, MediaBlobRepository, MediaBlobService};
use crate::videos::models::{
    CreateVideo, CreateVideoPlaylist, UpdateVideo, UpdateVideoPlaylist, Video, VideoMetadata,
    VideoPlaylist, VideoPlaylistItem, VideoPlaylistQuery, VideoQuery,
};
use num_traits::FromPrimitive;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum VideoRepositoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Video not found: {0}")]
    VideoNotFound(Uuid),
    #[error("Playlist not found: {0}")]
    PlaylistNotFound(Uuid),
    #[error("Playlist not found by title: {0}")]
    PlaylistNotFoundByTitle(String),
    #[error("Video already in playlist")]
    VideoAlreadyInPlaylist,
    #[error("Video not in playlist")]
    VideoNotInPlaylist,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate playlist title: {0}")]
    DuplicatePlaylistTitle(String),
    #[error("Media blob error: {0}")]
    MediaBlob(#[from] crate::media::MediaServiceError),
}

pub type Result<T> = std::result::Result<T, VideoRepositoryError>;

/// Repository for video and playlist database operations
pub struct VideoRepository {
    pool: PgPool,
    pub media_blob_service: MediaBlobService,
}

impl VideoRepository {
    /// Create a new repository instance
    pub fn new(pool: PgPool) -> Self {
        let media_blob_repo = MediaBlobRepository::new(pool.clone());
        let media_blob_service = MediaBlobService::new(media_blob_repo);

        Self {
            pool,
            media_blob_service,
        }
    }

    /// Get the database pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Get the media blob service
    pub fn media_blob_service(&self) -> &MediaBlobService {
        &self.media_blob_service
    }

    // Video operations

    /// Get a video by ID
    pub async fn get_video(&self, id: Uuid) -> Result<Video> {
        let video = sqlx::query_as!(
            Video,
            "SELECT * FROM videos WHERE id = $1 AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::VideoNotFound(id))?;

        Ok(video)
    }

    /// Create a video record with media blob
    pub async fn create_video_with_blob(
        &self,
        file_path: &str,
        file_hash: String,
        file_size: i64,
        mime_type: String,
        metadata: VideoMetadata,
        client_id: Option<&str>,
        thumbnail_blob_id: Option<String>,
        thumbnail_blob_ids: Option<Vec<String>>,
    ) -> Result<Video> {
        // Create media blob for the original video (stored on filesystem)
        let create_blob = CreateMediaBlob {
            data: None, // Videos are stored on filesystem, not in database
            sha256: file_hash,
            size: Some(file_size),
            mime: Some(mime_type),
            source_client_id: client_id.map(|s| s.to_string()),
            local_path: Some(file_path.to_string()),
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            content_id: None,
            metadata: serde_json::json!({}),
        };

        let media_blob = self
            .media_blob_service
            .create_media_blob(create_blob)
            .await?;

        // Create video record using the generated media blob ID
        let video_id = Uuid::new_v4();
        let video = sqlx::query_as!(
            Video,
            r#"
            INSERT INTO videos (
                id, media_blob_id, thumbnail_blob_id, thumbnail_blob_ids,
                title, description, duration, width_px, height_px, fps,
                video_codec, audio_codec, bitrate, container_format,
                is_hdr, color_profile, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
            ) RETURNING *
            "#,
            video_id,
            media_blob.id,
            thumbnail_blob_id,
            thumbnail_blob_ids.as_deref(),
            metadata
                .extended_metadata
                .as_ref()
                .and_then(|m| m.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("Untitled Video"),
            metadata
                .extended_metadata
                .as_ref()
                .and_then(|m| m.get("description"))
                .and_then(|d| d.as_str()),
            metadata
                .duration
                .map(|d| sqlx::postgres::types::PgInterval::try_from(
                    std::time::Duration::from_secs_f64(d)
                )
                .unwrap()),
            metadata.width_px,
            metadata.height_px,
            metadata
                .fps
                .map(|fr| bigdecimal::BigDecimal::from_f64(fr).unwrap_or_default()),
            metadata.video_codec,
            metadata.audio_codec,
            metadata.bitrate,
            metadata.container_format,
            metadata.is_hdr,
            metadata.color_profile,
            serde_json::to_value(&metadata).unwrap_or_else(|_| serde_json::json!({}))
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(video)
    }

    /// Create a video record
    pub async fn create_video(&self, create_video: CreateVideo) -> Result<Video> {
        let video = sqlx::query_as!(
            Video,
            r#"
            INSERT INTO videos (
                media_blob_id, thumbnail_blob_id, thumbnail_blob_ids,
                title, description, is_favorite, tags, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            ) RETURNING *
            "#,
            create_video.media_blob_id,
            create_video.thumbnail_blob_id,
            create_video.thumbnail_blob_ids.as_deref(),
            create_video.title,
            create_video.description,
            create_video.is_favorite,
            create_video.tags.as_deref(),
            create_video
                .metadata
                .unwrap_or_else(|| serde_json::json!({}))
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(video)
    }

    /// Update a video
    pub async fn update_video(&self, id: Uuid, update_video: UpdateVideo) -> Result<Video> {
        let video = sqlx::query_as!(
            Video,
            r#"
            UPDATE videos SET
                title = COALESCE($2, title),
                description = COALESCE($3, description),
                thumbnail_blob_id = COALESCE($4, thumbnail_blob_id),
                is_favorite = COALESCE($5, is_favorite),
                tags = COALESCE($6, tags),
                rating = COALESCE($7, rating),
                updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *
            "#,
            id,
            update_video.title,
            update_video.description,
            update_video.thumbnail_blob_id,
            update_video.is_favorite,
            update_video.tags.as_deref(),
            update_video.rating
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::VideoNotFound(id))?;

        Ok(video)
    }

    /// Soft delete a video
    pub async fn delete_video(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<()> {
        let rows_affected = sqlx::query!(
            "UPDATE videos SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL",
            id,
            deleted_by
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(VideoRepositoryError::VideoNotFound(id));
        }

        Ok(())
    }

    /// List videos with optional filtering
    pub async fn list_videos(
        &self,
        query: Option<VideoQuery>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Video>> {
        // For now, use a simple implementation without dynamic filters
        // This can be enhanced later with a proper query builder
        let videos = match (query, limit, offset) {
            (None, Some(limit), Some(offset)) => {
                sqlx::query_as!(
                    Video,
                    "SELECT * FROM videos WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2",
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?
            }
            (None, Some(limit), None) => {
                sqlx::query_as!(
                    Video,
                    "SELECT * FROM videos WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1",
                    limit
                )
                .fetch_all(&self.pool)
                .await?
            }
            (None, None, None) => {
                sqlx::query_as!(
                    Video,
                    "SELECT * FROM videos WHERE deleted_at IS NULL ORDER BY created_at DESC"
                )
                .fetch_all(&self.pool)
                .await?
            }
            // For queries with filters, implement specific methods as needed
            _ => {
                sqlx::query_as!(
                    Video,
                    "SELECT * FROM videos WHERE deleted_at IS NULL ORDER BY created_at DESC"
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        Ok(videos)
    }

    /// Get video count with optional filtering
    pub async fn count_videos(&self, _query: Option<VideoQuery>) -> Result<i64> {
        // For now, simple count without complex filtering
        let count = sqlx::query_scalar!("SELECT COUNT(*) FROM videos WHERE deleted_at IS NULL")
            .fetch_one(&self.pool)
            .await?;

        Ok(count.unwrap_or(0))
    }

    // Video Playlist operations

    /// Get a playlist by ID
    pub async fn get_playlist(&self, id: Uuid) -> Result<VideoPlaylist> {
        let playlist = sqlx::query_as!(
            VideoPlaylist,
            "SELECT * FROM video_playlists WHERE id = $1 AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::PlaylistNotFound(id))?;

        Ok(playlist)
    }

    /// Get a playlist by title
    pub async fn get_playlist_by_title(&self, title: &str) -> Result<VideoPlaylist> {
        let playlist = sqlx::query_as!(
            VideoPlaylist,
            "SELECT * FROM video_playlists WHERE title = $1 AND deleted_at IS NULL",
            title
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::PlaylistNotFoundByTitle(
            title.to_string(),
        ))?;

        Ok(playlist)
    }

    /// Create a playlist
    pub async fn create_playlist(
        &self,
        create_playlist: CreateVideoPlaylist,
    ) -> Result<VideoPlaylist> {
        // Check for duplicate title
        if let Ok(_) = self.get_playlist_by_title(&create_playlist.title).await {
            return Err(VideoRepositoryError::DuplicatePlaylistTitle(
                create_playlist.title,
            ));
        }

        let playlist = sqlx::query_as!(
            VideoPlaylist,
            r#"
            INSERT INTO video_playlists (
                title, description, client_id, is_public, is_collaborative, thumbnail_blob_id
            ) VALUES (
                $1, $2, $3, $4, $5, $6
            ) RETURNING *
            "#,
            create_playlist.title,
            create_playlist.description,
            create_playlist.client_id,
            create_playlist.is_public.unwrap_or(false),
            create_playlist.is_collaborative.unwrap_or(false),
            create_playlist.thumbnail_blob_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(playlist)
    }

    /// Update a playlist
    pub async fn update_playlist(
        &self,
        id: Uuid,
        update_playlist: UpdateVideoPlaylist,
    ) -> Result<VideoPlaylist> {
        let playlist = sqlx::query_as!(
            VideoPlaylist,
            r#"
            UPDATE video_playlists SET
                title = COALESCE($2, title),
                description = COALESCE($3, description),
                is_public = COALESCE($4, is_public),
                is_collaborative = COALESCE($5, is_collaborative),
                thumbnail_blob_id = COALESCE($6, thumbnail_blob_id),
                updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *
            "#,
            id,
            update_playlist.title,
            update_playlist.description,
            update_playlist.is_public,
            update_playlist.is_collaborative,
            update_playlist.thumbnail_blob_id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::PlaylistNotFound(id))?;

        Ok(playlist)
    }

    /// Soft delete a playlist
    pub async fn delete_playlist(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<()> {
        let rows_affected = sqlx::query!(
            "UPDATE video_playlists SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL",
            id,
            deleted_by
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(VideoRepositoryError::PlaylistNotFound(id));
        }

        Ok(())
    }

    /// List playlists with optional filtering
    pub async fn list_playlists(
        &self,
        _query: Option<VideoPlaylistQuery>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<VideoPlaylist>> {
        // Simple implementation without complex filtering for now
        let playlists = match (limit, offset) {
            (Some(limit), Some(offset)) => {
                sqlx::query_as!(
                    VideoPlaylist,
                    "SELECT * FROM video_playlists WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2",
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?
            }
            (Some(limit), None) => {
                sqlx::query_as!(
                    VideoPlaylist,
                    "SELECT * FROM video_playlists WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1",
                    limit
                )
                .fetch_all(&self.pool)
                .await?
            }
            _ => {
                sqlx::query_as!(
                    VideoPlaylist,
                    "SELECT * FROM video_playlists WHERE deleted_at IS NULL ORDER BY created_at DESC"
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        Ok(playlists)
    }

    /// Get playlist count with optional filtering
    pub async fn count_playlists(&self, _query: Option<VideoPlaylistQuery>) -> Result<i64> {
        let count =
            sqlx::query_scalar!("SELECT COUNT(*) FROM video_playlists WHERE deleted_at IS NULL")
                .fetch_one(&self.pool)
                .await?;

        Ok(count.unwrap_or(0))
    }

    // Playlist-Video relationship operations

    /// Add a video to a playlist
    pub async fn add_video_to_playlist(
        &self,
        playlist_id: Uuid,
        video_id: Uuid,
        client_id: Option<&str>,
    ) -> Result<VideoPlaylistItem> {
        // Check if video is already in playlist
        let existing = sqlx::query!(
            "SELECT id FROM video_playlist_items WHERE playlist_id = $1 AND video_id = $2",
            playlist_id,
            video_id
        )
        .fetch_optional(&self.pool)
        .await?;

        if existing.is_some() {
            return Err(VideoRepositoryError::VideoAlreadyInPlaylist);
        }

        // Get the next position
        let next_position: i32 = sqlx::query_scalar!(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM video_playlist_items WHERE playlist_id = $1",
            playlist_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(1);

        let playlist_item = sqlx::query_as!(
            VideoPlaylistItem,
            r#"
            INSERT INTO video_playlist_items (
                playlist_id, video_id, position, added_by_client_id
            ) VALUES (
                $1, $2, $3, $4
            ) RETURNING *
            "#,
            playlist_id,
            video_id,
            next_position,
            client_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(playlist_item)
    }

    /// Remove a video from a playlist
    pub async fn remove_video_from_playlist(
        &self,
        playlist_id: Uuid,
        video_id: Uuid,
    ) -> Result<()> {
        let rows_affected = sqlx::query!(
            "DELETE FROM video_playlist_items WHERE playlist_id = $1 AND video_id = $2",
            playlist_id,
            video_id
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(VideoRepositoryError::VideoNotInPlaylist);
        }

        // Reorder remaining videos
        sqlx::query!(
            r#"
            UPDATE video_playlist_items SET position = new_position
            FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY position) as new_position
                FROM video_playlist_items
                WHERE playlist_id = $1
            ) AS ranked
            WHERE video_playlist_items.id = ranked.id
            "#,
            playlist_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get videos in a playlist
    pub async fn get_playlist_videos(
        &self,
        playlist_id: Uuid,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Video>> {
        let videos = match (limit, offset) {
            (Some(limit), Some(offset)) => {
                sqlx::query_as!(
                    Video,
                    r#"
                    SELECT v.* FROM videos v
                    JOIN video_playlist_items vpi ON v.id = vpi.video_id
                    WHERE vpi.playlist_id = $1 AND v.deleted_at IS NULL
                    ORDER BY vpi.position
                    LIMIT $2 OFFSET $3
                    "#,
                    playlist_id,
                    limit,
                    offset
                )
                .fetch_all(&self.pool)
                .await?
            }
            (Some(limit), None) => {
                sqlx::query_as!(
                    Video,
                    r#"
                    SELECT v.* FROM videos v
                    JOIN video_playlist_items vpi ON v.id = vpi.video_id
                    WHERE vpi.playlist_id = $1 AND v.deleted_at IS NULL
                    ORDER BY vpi.position
                    LIMIT $2
                    "#,
                    playlist_id,
                    limit
                )
                .fetch_all(&self.pool)
                .await?
            }
            _ => {
                sqlx::query_as!(
                    Video,
                    r#"
                    SELECT v.* FROM videos v
                    JOIN video_playlist_items vpi ON v.id = vpi.video_id
                    WHERE vpi.playlist_id = $1 AND v.deleted_at IS NULL
                    ORDER BY vpi.position
                    "#,
                    playlist_id
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        Ok(videos)
    }

    /// Get video count in a playlist
    pub async fn count_playlist_videos(&self, playlist_id: Uuid) -> Result<i64> {
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) FROM videos v
            JOIN video_playlist_items vpi ON v.id = vpi.video_id
            WHERE vpi.playlist_id = $1 AND v.deleted_at IS NULL
            "#,
            playlist_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(count.unwrap_or(0))
    }

    /// Get playlists containing a video
    pub async fn get_video_playlists(&self, video_id: Uuid) -> Result<Vec<VideoPlaylist>> {
        let playlists = sqlx::query_as!(
            VideoPlaylist,
            r#"
            SELECT p.* FROM video_playlists p
            JOIN video_playlist_items vpi ON p.id = vpi.playlist_id
            WHERE vpi.video_id = $1 AND p.deleted_at IS NULL
            ORDER BY p.title
            "#,
            video_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(playlists)
    }

    /// Check if a video exists by hash
    pub async fn exists_by_hash(&self, hash: &str) -> Result<bool> {
        let exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM videos v JOIN media_blobs mb ON v.media_blob_id = mb.id WHERE mb.sha256 = $1 AND v.deleted_at IS NULL)",
            hash
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(exists.unwrap_or(false))
    }

    /// Find playlists by title (case-insensitive partial match)
    pub async fn find_playlists_by_title(&self, title_pattern: &str) -> Result<Vec<VideoPlaylist>> {
        let playlists = sqlx::query_as!(
            VideoPlaylist,
            "SELECT * FROM video_playlists WHERE title ILIKE $1 AND deleted_at IS NULL ORDER BY title",
            format!("%{}%", title_pattern)
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(playlists)
    }

    /// Update video with thumbnail information
    pub async fn update_video_thumbnails(
        &self,
        video_id: Uuid,
        thumbnail_blob_id: String,
        thumbnail_blob_ids: Vec<String>,
    ) -> Result<Video> {
        let video = sqlx::query_as!(
            Video,
            r#"
            UPDATE videos SET
                thumbnail_blob_id = $2,
                thumbnail_blob_ids = $3,
                updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *
            "#,
            video_id,
            thumbnail_blob_id,
            thumbnail_blob_ids.as_slice()
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(VideoRepositoryError::VideoNotFound(video_id))?;

        Ok(video)
    }
}
