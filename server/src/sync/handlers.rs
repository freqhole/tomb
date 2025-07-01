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
    /// Playlist ID to sync songs for
    pub playlist_id: String,
    /// Last sync timestamp in RFC3339 format
    pub last_sync_time: Option<String>,
    /// Pagination cursor for continuing sync
    pub cursor: Option<String>,
    /// Number of items per batch
    pub page_size: Option<i64>,
}

/// Incremental sync endpoint - GET /api/sync/media
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
    let songs = music_repo
        .query_songs(grimoire::music::SongQuery {
            limit: params.page_size.map(|l| l as i64),
            offset: Some(0), // TODO: implement cursor-based pagination
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

    info!(
        "Song sync completed for user: {} - {} items",
        user.user().username,
        songs.len()
    );

    Ok(Json(serde_json::json!({
        "items": songs,
        "pagination": {
            "batch_size": songs.len(),
            "has_more": false,
            "next_cursor": null,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": songs.len()
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
    let playlists = music_repo
        .query_playlists(grimoire::music::PlaylistQuery {
            limit: params.page_size.map(|l| l as i64),
            offset: Some(0), // TODO: implement cursor-based pagination
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

    Ok(Json(serde_json::json!({
        "items": playlists,
        "pagination": {
            "batch_size": playlists.len(),
            "has_more": false,
            "next_cursor": null,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": playlists.len()
    })))
}

/// Playlist songs sync endpoint - GET /api/sync/playlist-songs
pub async fn incremental_playlist_song_sync(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<PlaylistSongSyncQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    info!(
        "Playlist songs sync requested by user: {} for playlist: {}",
        user.user().username,
        params.playlist_id
    );

    // Parse playlist ID
    let playlist_id = uuid::Uuid::parse_str(&params.playlist_id)
        .map_err(|e| AppError::BadRequest(format!("Invalid playlist_id format: {}", e)))?;

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

    // Get playlist songs as simple PlaylistSong entities (not detailed with song info)
    let playlist_songs = if let Some(sync_time) = last_sync_time {
        sqlx::query_as::<_, grimoire::music::PlaylistSong>(
            "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
             FROM playlist_songs
             WHERE playlist_id = $1 AND created_at > $2
             ORDER BY position",
        )
        .bind(playlist_id)
        .bind(sync_time)
    } else {
        sqlx::query_as::<_, grimoire::music::PlaylistSong>(
            "SELECT id, playlist_id, song_id, position, created_at, added_by_client_id, metadata
             FROM playlist_songs
             WHERE playlist_id = $1
             ORDER BY position",
        )
        .bind(playlist_id)
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

    Ok(Json(serde_json::json!({
        "items": playlist_songs,
        "pagination": {
            "batch_size": playlist_songs.len(),
            "has_more": false,
            "next_cursor": null,
            "progress": null,
            "suggested_delay": null
        },
        "sync_timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),
        "is_full_sync": last_sync_time.is_none(),
        "total_items": playlist_songs.len()
    })))
}
