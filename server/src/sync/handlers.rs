//! Sync API handlers for media blob, song, and playlist synchronization
//!
//! This module provides HTTP endpoints for efficient synchronization
//! between clients and server using cursor-based pagination and timestamp filtering.

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use axum::{
    extract::{Extension, Query},
    Json,
};
use grimoire::music::MusicRepository;
use grimoire::{
    DatabaseConnection, FullSyncRequest, MediaBlobService, SyncAcknowledgment, SyncRequest,
    SyncResponse, SyncStatusResponse,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tracing::{debug, error, info, warn};

/// Query parameters for incremental sync
#[derive(Debug, Serialize, Deserialize)]
pub struct IncrementalSyncQuery {
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Pagination cursor for continuing sync
    pub cursor: Option<String>,
    /// Number of items per batch
    pub page_size: Option<i64>,
    /// Whether to include binary data
    pub include_data: Option<bool>,
    /// Filter by MIME type patterns (comma-separated)
    pub mime_types: Option<String>,
}

/// Query parameters for full sync
#[derive(Debug, Serialize, Deserialize)]
pub struct FullSyncQuery {
    /// Batch size for paginated full sync
    pub batch_size: Option<i64>,
    /// Starting cursor for resuming full sync
    pub start_cursor: Option<String>,
    /// Whether to include binary data
    pub include_data: Option<bool>,
    /// Filter by MIME type patterns (comma-separated)
    pub mime_types: Option<String>,
}

/// Request body for sync acknowledgment
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncAckRequest {
    /// Timestamp of the sync that was processed
    pub sync_timestamp: String,
    /// Number of items successfully synced
    pub items_synced: i64,
    /// IDs of items that failed to sync
    pub failed_items: Option<Vec<String>>,
}

/// Response for sync recommendations
#[derive(Debug, Serialize)]
pub struct SyncRecommendationsResponse {
    pub should_sync: bool,
    pub recommended_batch_size: i64,
    pub recommended_interval_seconds: u64,
    pub estimated_batches: i64,
    pub estimated_duration_seconds: i64,
    pub priority: String,
    pub items_to_sync: i64,
}

/// Query parameters for song sync
#[derive(Debug, Serialize, Deserialize)]
pub struct SongSyncQuery {
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Pagination cursor for continuing sync
    pub cursor: Option<String>,
    /// Number of items per batch
    pub page_size: Option<i64>,
    /// Filter by artist
    pub artist: Option<String>,
    /// Filter by album
    pub album: Option<String>,
    /// Only sync favorites
    pub favorites_only: Option<bool>,
}

/// Query parameters for playlist sync
#[derive(Debug, Serialize, Deserialize)]
pub struct PlaylistSyncQuery {
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Pagination cursor for continuing sync
    pub cursor: Option<String>,
    /// Number of items per batch
    pub page_size: Option<i64>,
    /// Only sync public playlists
    pub public_only: Option<bool>,
    /// Filter by client ID
    pub client_id: Option<String>,
}

/// Query parameters for playlist songs sync
#[derive(Debug, Serialize, Deserialize)]
pub struct PlaylistSongSyncQuery {
    /// Optional playlist ID to filter by (if None, sync all playlist songs)
    pub playlist_id: Option<String>,
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Pagination cursor for continuing sync
    pub cursor: Option<String>,
    /// Number of items per batch
    pub page_size: Option<i32>,
}

/// Query parameters for photo sync
#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoSyncQuery {
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Cursor for pagination
    pub cursor: Option<String>,
    /// Number of items per page
    pub page_size: Option<i64>,
    /// Filter by title search
    pub title_search: Option<String>,
    /// Filter by dimensions
    pub width_min: Option<i32>,
    pub width_max: Option<i32>,
    pub height_min: Option<i32>,
    pub height_max: Option<i32>,
}

/// Query parameters for gallery sync
#[derive(Debug, Serialize, Deserialize)]
pub struct GallerySyncQuery {
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Cursor for pagination
    pub cursor: Option<String>,
    /// Number of items per page
    pub page_size: Option<i64>,
    /// Filter by title search
    pub title_search: Option<String>,
}

/// Query parameters for photo_gallery sync
#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoGallerySyncQuery {
    /// Gallery ID to filter by
    pub gallery_id: Option<String>,
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Cursor for pagination
    pub cursor: Option<String>,
    /// Number of items per page
    pub page_size: Option<i64>,
}

pub async fn incremental_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<IncrementalSyncQuery>,
) -> Result<Json<SyncResponse>, AppError> {
    info!(
        "Incremental sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse last sync time
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        Some(
            OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
                .map_err(|e| {
                    AppError::BadRequest(format!("Invalid last_sync_time format: {}", e))
                })?,
        )
    } else {
        None
    };

    // Parse MIME types
    let mime_types = params
        .mime_types
        .map(|types| types.split(',').map(|s| s.trim().to_string()).collect());

    // Create sync request
    let sync_request = SyncRequest {
        last_sync_time,
        cursor: params.cursor,
        page_size: params.page_size,
        client_id: user.user().id.to_string(),
        include_data: params.include_data,
        mime_types,
    };

    // Execute sync
    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    let sync_response = service.incremental_sync(sync_request).await.map_err(|e| {
        error!("Incremental sync failed: {}", e);
        AppError::InternalServerError("Sync operation failed".to_string())
    })?;

    info!(
        "Incremental sync completed for user: {} - {} items",
        user.user().username,
        sync_response.pagination.batch_size
    );

    Ok(Json(sync_response))
}

/// Full sync endpoint - GET /api/sync/media/full
pub async fn full_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<FullSyncQuery>,
) -> Result<Json<SyncResponse>, AppError> {
    info!(
        "Full sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse MIME types
    let mime_types = params
        .mime_types
        .map(|types| types.split(',').map(|s| s.trim().to_string()).collect());

    // Create full sync request
    let sync_request = FullSyncRequest {
        client_id: user.user().id.to_string(),
        batch_size: params.batch_size,
        start_cursor: params.start_cursor,
        include_data: params.include_data,
        mime_types,
    };

    // Execute full sync
    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    let sync_response = service.full_sync(sync_request).await.map_err(|e| {
        error!("Full sync failed: {}", e);
        AppError::InternalServerError("Full sync operation failed".to_string())
    })?;

    info!(
        "Full sync batch completed for user: {} - {} items",
        user.user().username,
        sync_response.pagination.batch_size
    );

    Ok(Json(sync_response))
}

/// Sync acknowledgment endpoint - POST /api/sync/media/acknowledge
pub async fn acknowledge_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(ack_request): Json<SyncAckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Sync acknowledgment from user: {} (client: {}) - {} items",
        user.user().username,
        user.user().id,
        ack_request.items_synced
    );

    // Parse sync timestamp
    let sync_timestamp = OffsetDateTime::parse(
        &ack_request.sync_timestamp,
        &time::format_description::well_known::Rfc3339,
    )
    .map_err(|e| AppError::BadRequest(format!("Invalid sync_timestamp format: {}", e)))?;

    // Parse failed item UUIDs
    let failed_items = ack_request
        .failed_items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|id_str| {
            uuid::Uuid::parse_str(&id_str)
                .map_err(|e| {
                    warn!("Invalid UUID in failed_items: {} - {}", id_str, e);
                    e
                })
                .ok()
        })
        .collect();

    // Create client sync state (simplified for this example)
    let client_sync_state = grimoire::ClientSyncState::new(user.user().id.to_string());

    // Create acknowledgment
    let acknowledgment = SyncAcknowledgment {
        client_id: user.user().id.to_string(),
        sync_timestamp,
        items_synced: ack_request.items_synced,
        failed_items,
        client_sync_state,
    };

    // Process acknowledgment
    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    service
        .process_sync_acknowledgment(acknowledgment)
        .await
        .map_err(|e| {
            error!("Failed to process sync acknowledgment: {}", e);
            AppError::InternalServerError("Failed to process acknowledgment".to_string())
        })?;

    debug!("Sync acknowledgment processed successfully");

    Ok(Json(serde_json::json!({
        "status": "acknowledged",
        "timestamp": OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap()
    })))
}

/// Sync status endpoint - GET /api/sync/status
pub async fn sync_status(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<SyncStatusResponse>, AppError> {
    debug!("Sync status requested");

    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    let status = service.get_sync_status().await.map_err(|e| {
        error!("Failed to get sync status: {}", e);
        AppError::InternalServerError("Failed to get sync status".to_string())
    })?;

    Ok(Json(status))
}

/// Sync recommendations endpoint - GET /api/sync/recommendations
pub async fn sync_recommendations(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<IncrementalSyncQuery>,
) -> Result<Json<SyncRecommendationsResponse>, AppError> {
    info!(
        "Sync recommendations requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse last sync time
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        Some(
            OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
                .map_err(|e| {
                    AppError::BadRequest(format!("Invalid last_sync_time format: {}", e))
                })?,
        )
    } else {
        None
    };

    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    let recommendations = service
        .get_sync_recommendations(&user.user().id.to_string(), last_sync_time)
        .await
        .map_err(|e| {
            error!("Failed to get sync recommendations: {}", e);
            AppError::InternalServerError("Failed to get recommendations".to_string())
        })?;

    // Convert priority to string
    let priority_str = match recommendations.priority {
        grimoire::SyncPriority::Low => "low",
        grimoire::SyncPriority::Normal => "normal",
        grimoire::SyncPriority::High => "high",
        grimoire::SyncPriority::Critical => "critical",
    };

    // Get count of items to sync
    let sync_request = SyncRequest {
        last_sync_time,
        cursor: None,
        page_size: Some(1),
        client_id: user.user().id.to_string(),
        include_data: Some(false),
        mime_types: None,
    };

    let sample_sync = service.incremental_sync(sync_request).await.map_err(|e| {
        error!("Failed to check items to sync: {}", e);
        AppError::InternalServerError("Failed to check sync items".to_string())
    })?;

    let items_to_sync = sample_sync.total_items.unwrap_or(0);

    let response = SyncRecommendationsResponse {
        should_sync: recommendations.should_sync,
        recommended_batch_size: recommendations.recommended_batch_size,
        recommended_interval_seconds: recommendations.recommended_interval_seconds,
        estimated_batches: recommendations.estimated_batches,
        estimated_duration_seconds: recommendations.estimated_duration_seconds,
        priority: priority_str.to_string(),
        items_to_sync,
    };

    Ok(Json(response))
}

/// Check if sync is needed endpoint - GET /api/sync/check
pub async fn check_sync_needed(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<IncrementalSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    debug!(
        "Checking if sync needed for user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse last sync time or default to epoch
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
            .map_err(|e| AppError::BadRequest(format!("Invalid last_sync_time format: {}", e)))?
    } else {
        OffsetDateTime::UNIX_EPOCH
    };

    let grimoire_repo = grimoire::MediaBlobRepository::new(db.pool().clone());
    let service = MediaBlobService::new(grimoire_repo);

    let needs_sync = service
        .needs_sync(&user.user().id.to_string(), last_sync_time)
        .await
        .map_err(|e| {
            error!("Failed to check sync need: {}", e);
            AppError::InternalServerError("Failed to check sync requirement".to_string())
        })?;

    Ok(Json(serde_json::json!({
        "needs_sync": needs_sync,
        "last_checked": OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "client_id": user.user().id.to_string()
    })))
}

/// Song incremental sync endpoint - GET /api/sync/songs
pub async fn incremental_song_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<SongSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Song sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse last sync time
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        Some(
            OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
                .map_err(|e| {
                    AppError::BadRequest(format!("Invalid last_sync_time format: {}", e))
                })?,
        )
    } else {
        None
    };

    let music_repo = MusicRepository::new(db.pool().clone());
    let page_size = params.page_size.unwrap_or(50);
    let offset = params
        .cursor
        .as_ref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);

    // Request one extra item to determine if there are more pages
    let songs = music_repo
        .query_songs(grimoire::music::SongQuery {
            limit: Some(page_size + 1),
            offset: Some(offset),
            artist: params.artist,
            album: params.album,
            favorites_only: params.favorites_only,
            updated_after: last_sync_time,
            ..Default::default()
        })
        .await
        .map_err(|e| {
            error!("Failed to fetch songs: {}", e);
            AppError::InternalServerError("Sync operation failed".to_string())
        })?;

    // Calculate pagination metadata
    let has_more = songs.len() > page_size as usize;
    let actual_songs = if has_more {
        songs
            .into_iter()
            .take(page_size as usize)
            .collect::<Vec<_>>()
    } else {
        songs
    };
    let next_cursor = if has_more {
        Some((offset + page_size).to_string())
    } else {
        None
    };

    info!(
        "Song sync completed for user: {} - {} items",
        user.user().username,
        actual_songs.len()
    );

    Ok(Json(serde_json::json!({
        "items": actual_songs,
        "pagination": {
            "batch_size": actual_songs.len(),
            "has_more": has_more,
            "next_cursor": next_cursor,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": actual_songs.len()
    })))
}

/// Playlist incremental sync endpoint - GET /api/sync/playlists
pub async fn incremental_playlist_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<PlaylistSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Playlist sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    // Parse last sync time
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        Some(
            OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
                .map_err(|e| {
                    AppError::BadRequest(format!("Invalid last_sync_time format: {}", e))
                })?,
        )
    } else {
        None
    };

    let music_repo = MusicRepository::new(db.pool().clone());
    let page_size = params.page_size.unwrap_or(50);
    let offset = params
        .cursor
        .as_ref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);

    // Request one extra item to determine if there are more pages
    let playlists = music_repo
        .query_playlists(grimoire::music::PlaylistQuery {
            limit: Some(page_size + 1),
            offset: Some(offset),
            public_only: params.public_only,
            client_id: params.client_id,
            updated_after: last_sync_time,
            ..Default::default()
        })
        .await
        .map_err(|e| {
            error!("Failed to fetch playlists: {}", e);
            AppError::InternalServerError("Sync operation failed".to_string())
        })?;

    info!(
        "Playlist sync completed for user: {} - {} items",
        user.user().username,
        playlists.len()
    );

    // Calculate pagination metadata
    let has_more = playlists.len() > page_size as usize;
    let actual_playlists = if has_more {
        playlists
            .into_iter()
            .take(page_size as usize)
            .collect::<Vec<_>>()
    } else {
        playlists
    };
    let next_cursor = if has_more {
        Some((offset + page_size).to_string())
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "items": actual_playlists,
        "pagination": {
            "batch_size": actual_playlists.len(),
            "has_more": has_more,
            "next_cursor": next_cursor,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": actual_playlists.len()
    })))
}

/// Playlist songs sync endpoint - GET /api/sync/playlist-songs
pub async fn incremental_playlist_song_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<PlaylistSongSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let playlist_filter_msg = if let Some(ref pid) = params.playlist_id {
        format!(" for playlist: {}", pid)
    } else {
        " for all playlists".to_string()
    };

    info!(
        "Playlist songs sync requested by user: {}{}",
        user.user().username,
        playlist_filter_msg
    );

    // Parse playlist ID if provided
    let playlist_id = if let Some(pid_str) = &params.playlist_id {
        Some(
            uuid::Uuid::parse_str(pid_str)
                .map_err(|e| AppError::BadRequest(format!("Invalid playlist_id format: {}", e)))?,
        )
    } else {
        None
    };

    // Parse last sync time
    let last_sync_time = if let Some(time_str) = params.last_sync_time {
        Some(
            OffsetDateTime::parse(&time_str, &time::format_description::well_known::Rfc3339)
                .map_err(|e| {
                    AppError::BadRequest(format!("Invalid last_sync_time format: {}", e))
                })?,
        )
    } else {
        None
    };

    let page_size = params.page_size.unwrap_or(50);
    let offset = params
        .cursor
        .as_ref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);

    // Get playlist songs as simple PlaylistSong entities (not detailed with song info)
    // Request one extra item to determine if there are more pages
    let playlist_songs = if let Some(sync_time) = last_sync_time {
        if let Some(pid) = playlist_id {
            sqlx::query_as::<_, grimoire::music::PlaylistSong>(
                "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
                 FROM playlist_songs
                 WHERE playlist_id = $1 AND created_at > $2
                 ORDER BY playlist_id, position
                 LIMIT $3 OFFSET $4",
            )
            .bind(pid)
            .bind(sync_time)
            .bind(page_size + 1)
            .bind(offset)
        } else {
            sqlx::query_as::<_, grimoire::music::PlaylistSong>(
                "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
                 FROM playlist_songs
                 WHERE created_at > $1
                 ORDER BY playlist_id, position
                 LIMIT $2 OFFSET $3",
            )
            .bind(sync_time)
            .bind(page_size + 1)
            .bind(offset)
        }
    } else {
        if let Some(pid) = playlist_id {
            sqlx::query_as::<_, grimoire::music::PlaylistSong>(
                "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
                 FROM playlist_songs
                 WHERE playlist_id = $1
                 ORDER BY playlist_id, position
                 LIMIT $2 OFFSET $3",
            )
            .bind(pid)
            .bind(page_size + 1)
            .bind(offset)
        } else {
            sqlx::query_as::<_, grimoire::music::PlaylistSong>(
                "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
                 FROM playlist_songs
                 ORDER BY playlist_id, position
                 LIMIT $1 OFFSET $2",
            )
            .bind(page_size + 1)
            .bind(offset)
        }
    }
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to fetch playlist songs: {}", e);
        AppError::InternalServerError("Sync operation failed".to_string())
    })?;

    info!(
        "Playlist songs sync completed for user: {} - {} items",
        user.user().username,
        playlist_songs.len()
    );

    // Calculate pagination metadata
    let has_more = playlist_songs.len() > page_size as usize;
    let actual_playlist_songs = if has_more {
        playlist_songs
            .into_iter()
            .take(page_size as usize)
            .collect::<Vec<_>>()
    } else {
        playlist_songs
    };
    let next_cursor = if has_more {
        Some((offset + page_size as i64).to_string())
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "items": actual_playlist_songs,
        "pagination": {
            "batch_size": actual_playlist_songs.len(),
            "has_more": has_more,
            "next_cursor": next_cursor,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": actual_playlist_songs.len()
    })))
}

/// Photo incremental sync endpoint - GET /api/sync/photos
pub async fn incremental_photo_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<PhotoSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Photo sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    let photos_repo = grimoire::photos::PhotoRepository::new(db.pool().clone());
    let page_size = params.page_size.unwrap_or(50) as i64;

    // Use list_recent_photos method since query_photos may not be available
    let photos = photos_repo
        .list_recent_photos(page_size + 1)
        .await
        .map_err(|e| {
            error!("Failed to fetch photos: {}", e);
            AppError::InternalServerError("Sync operation failed".to_string())
        })?;

    // Calculate pagination metadata
    let has_more = photos.len() > page_size as usize;
    let actual_photos = if has_more {
        photos
            .into_iter()
            .take(page_size as usize)
            .collect::<Vec<_>>()
    } else {
        photos
    };
    let next_cursor = if has_more {
        Some(page_size.to_string())
    } else {
        None
    };

    // Add _data_type to each photo for client processing
    let photos_with_type: Vec<serde_json::Value> = actual_photos
        .into_iter()
        .map(|photo| {
            let mut photo_json = serde_json::to_value(photo).unwrap_or_default();
            photo_json["_data_type"] = serde_json::Value::String("photo".to_string());
            photo_json
        })
        .collect();

    info!(
        "Photo sync completed for user: {} - {} items",
        user.user().username,
        photos_with_type.len()
    );

    Ok(Json(serde_json::json!({
        "items": photos_with_type,
        "pagination": {
            "batch_size": photos_with_type.len(),
            "has_more": has_more,
            "next_cursor": next_cursor,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": true,
        "total_items": photos_with_type.len()
    })))
}

/// Gallery incremental sync endpoint - GET /api/sync/galleries
pub async fn incremental_gallery_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(_params): Query<GallerySyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Gallery sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    let photos_repo = grimoire::photos::PhotoRepository::new(db.pool().clone());

    // Use list_galleries method since query_galleries may not be available
    let galleries = photos_repo.list_galleries(50).await.map_err(|e| {
        error!("Failed to fetch galleries: {}", e);
        AppError::InternalServerError("Sync operation failed".to_string())
    })?;

    // Add _data_type to each gallery for client processing
    let galleries_with_type: Vec<serde_json::Value> = galleries
        .into_iter()
        .map(|gallery| {
            let mut gallery_json = serde_json::to_value(gallery).unwrap_or_default();
            gallery_json["_data_type"] = serde_json::Value::String("gallery".to_string());
            gallery_json
        })
        .collect();

    info!(
        "Gallery sync completed for user: {} - {} items",
        user.user().username,
        galleries_with_type.len()
    );

    Ok(Json(serde_json::json!({
        "items": galleries_with_type,
        "pagination": {
            "batch_size": galleries_with_type.len(),
            "has_more": false,
            "next_cursor": null,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": true,
        "total_items": galleries_with_type.len()
    })))
}

/// Photo Gallery incremental sync endpoint - GET /api/sync/photo-galleries
pub async fn incremental_photo_gallery_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(_params): Query<PhotoGallerySyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Photo Gallery sync requested by user: {} (client: {})",
        user.user().username,
        user.user().id
    );

    let photos_repo = grimoire::photos::PhotoRepository::new(db.pool().clone());

    // Get all galleries first, then fetch their photos to create photo_gallery records
    let galleries = photos_repo.list_galleries(50).await.map_err(|e| {
        error!("Failed to fetch galleries: {}", e);
        AppError::InternalServerError("Sync operation failed".to_string())
    })?;

    let mut photo_galleries_with_type: Vec<serde_json::Value> = Vec::new();

    // For each gallery, get its photos and create photo_gallery records
    for gallery in galleries {
        let photos = match photos_repo.get_gallery_photos(gallery.id, 100).await {
            Ok(photos) => photos,
            Err(e) => {
                error!("Failed to fetch photos for gallery {}: {}", gallery.id, e);
                // Continue with other galleries instead of failing
                continue;
            }
        };

        for (idx, photo) in photos.into_iter().enumerate() {
            let photo_gallery = serde_json::json!({
                "id": format!("{}-{}", gallery.id, photo.id),
                "gallery_id": gallery.id,
                "photo_id": photo.id,
                "position": idx as i32,
                "created_at": photo.created_at,
                "_data_type": "photo_gallery"
            });
            photo_galleries_with_type.push(photo_gallery);
        }
    }

    info!(
        "Photo Gallery sync completed for user: {} - {} items",
        user.user().username,
        photo_galleries_with_type.len()
    );

    Ok(Json(serde_json::json!({
        "items": photo_galleries_with_type,
        "pagination": {
            "batch_size": photo_galleries_with_type.len(),
            "has_more": false,
            "next_cursor": null,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": true,
        "total_items": photo_galleries_with_type.len()
    })))
}
