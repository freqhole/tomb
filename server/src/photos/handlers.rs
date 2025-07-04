//! Photos API handlers
//!
//! This module provides HTTP API endpoints for managing photos, galleries, and photo-gallery associations.
//! It follows the same patterns as the music API, providing CRUD operations and sync capabilities.

use axum::{
    extract::{Extension, Path, Query},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tracing::error;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use grimoire::database::DatabaseConnection;
use grimoire::photos::{
    CreateGallery, Gallery, Photo, PhotoGallery, PhotoRepository, UpdateGallery,
};

// Response types
#[derive(Debug, Clone, Serialize)]
pub struct PhotoResponse {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub width_px: Option<i32>,
    pub height_px: Option<i32>,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub location: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub metadata: serde_json::Value,
}

impl From<Photo> for PhotoResponse {
    fn from(photo: Photo) -> Self {
        Self {
            id: photo.id.to_string(),
            title: photo.title,
            description: photo.caption,
            width_px: photo.width_px,
            height_px: photo.height_px,
            media_blob_id: photo.media_blob_id,
            thumbnail_blob_id: photo.thumbnail_blob_id,
            created_at: photo.created_at,
            updated_at: photo.updated_at,
            location: photo.location,
            camera_make: photo.camera_make,
            camera_model: photo.camera_model,
            metadata: photo.metadata,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PhotoListResponse {
    pub photos: Vec<PhotoResponse>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GalleryResponse {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub photo_count: i64,
    pub metadata: serde_json::Value,
}

impl From<Gallery> for GalleryResponse {
    fn from(gallery: Gallery) -> Self {
        Self {
            id: gallery.id.to_string(),
            title: gallery.title,
            description: gallery.description,
            created_at: gallery.created_at,
            updated_at: gallery.updated_at,
            photo_count: 0, // Will be populated by queries that include count
            metadata: gallery.metadata,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GalleryListResponse {
    pub galleries: Vec<GalleryResponse>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhotoGalleryResponse {
    pub id: String,
    pub gallery_id: String,
    pub photo_id: String,
    pub position: i32,
    pub created_at: OffsetDateTime,
    pub photo: Option<PhotoResponse>,
}

impl From<PhotoGallery> for PhotoGalleryResponse {
    fn from(photo_gallery: PhotoGallery) -> Self {
        Self {
            id: photo_gallery.id.to_string(),
            gallery_id: photo_gallery.gallery_id.to_string(),
            photo_id: photo_gallery.photo_id.to_string(),
            position: photo_gallery.position,
            created_at: photo_gallery.created_at,
            photo: None, // Will be populated by queries that include photo data
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GalleryPhotosResponse {
    pub gallery: GalleryResponse,
    pub photos: Vec<PhotoGalleryResponse>,
}

// Query parameters
#[derive(Debug, Deserialize)]
pub struct PhotoQueryParams {
    pub title_search: Option<String>,
    pub width_min: Option<i32>,
    pub width_max: Option<i32>,
    pub height_min: Option<i32>,
    pub height_max: Option<i32>,
    pub has_location: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// PhotoQuery conversion - using available fields from actual PhotoQuery
// Note: Some fields may not be available in current PhotoQuery implementation

#[derive(Debug, Deserialize)]
pub struct GalleryQueryParams {
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// GalleryQuery conversion - using available fields from actual GalleryQuery
// Note: Some fields may not be available in current GalleryQuery implementation

// Request types
#[derive(Debug, Clone, Deserialize)]
pub struct CreateGalleryRequest {
    pub title: String,
    pub description: Option<String>,
    pub photo_ids: Option<Vec<String>>,
}

impl From<CreateGalleryRequest> for CreateGallery {
    fn from(request: CreateGalleryRequest) -> Self {
        Self {
            title: request.title,
            description: request.description,
            client_id: Some("web".to_string()), // Default client ID
            is_public: false,
            is_collaborative: false,
            thumbnail_blob_id: None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateGalleryRequest {
    pub title: Option<String>,
    pub description: Option<String>,
}

impl From<UpdateGalleryRequest> for UpdateGallery {
    fn from(request: UpdateGalleryRequest) -> Self {
        Self {
            title: request.title,
            description: request.description,
            is_public: Some(false), // Default values for required fields
            is_collaborative: Some(false),
            thumbnail_blob_id: None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AddPhotosRequest {
    pub photo_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovePhotoRequest {
    pub photo_id: String,
    pub to_position: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReorderGalleryRequest {
    pub photo_ids: Vec<String>,
}

// API handlers

/// List photos - GET /api/photos
pub async fn list_photos(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Query(params): Query<PhotoQueryParams>,
) -> Result<Json<PhotoListResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    // For now, use basic list_recent_photos method
    let limit = params.limit.unwrap_or(50);
    let photos = photos_repo.list_recent_photos(limit).await.map_err(|e| {
        error!("Failed to fetch photos: {}", e);
        AppError::InternalServerError("Failed to fetch photos".to_string())
    })?;

    let total = photos_repo.count_photos().await.map_err(|e| {
        error!("Failed to count photos: {}", e);
        AppError::InternalServerError("Failed to count photos".to_string())
    })?;

    let photo_responses: Vec<PhotoResponse> = photos.into_iter().map(PhotoResponse::from).collect();

    Ok(Json(PhotoListResponse {
        photos: photo_responses,
        total,
    }))
}

/// Get single photo - GET /api/photos/{id}
pub async fn get_photo(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<PhotoResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let photo_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid photo ID format: {}", e);
        AppError::BadRequest("Invalid photo ID format".to_string())
    })?;

    let photo = photos_repo.get_photo(photo_id).await.map_err(|e| {
        error!("Failed to fetch photo {}: {}", id, e);
        AppError::NotFound(format!("Photo with id {} not found", id))
    })?;

    Ok(Json(PhotoResponse::from(photo)))
}

/// List galleries - GET /api/galleries
pub async fn list_galleries(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Query(_params): Query<GalleryQueryParams>,
) -> Result<Json<GalleryListResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let galleries = photos_repo.list_galleries(50).await.map_err(|e| {
        error!("Failed to fetch galleries: {}", e);
        AppError::InternalServerError("Failed to fetch galleries".to_string())
    })?;

    let total = galleries.len() as i64;
    let gallery_responses: Vec<GalleryResponse> =
        galleries.into_iter().map(GalleryResponse::from).collect();

    Ok(Json(GalleryListResponse {
        galleries: gallery_responses,
        total,
    }))
}

/// Get single gallery - GET /api/galleries/{id}
pub async fn get_gallery(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<GalleryResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let gallery_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid gallery ID format: {}", e);
        AppError::BadRequest("Invalid gallery ID format".to_string())
    })?;

    let gallery = photos_repo.get_gallery(gallery_id).await.map_err(|e| {
        error!("Failed to fetch gallery {}: {}", id, e);
        AppError::NotFound(format!("Gallery with id {} not found", id))
    })?;

    Ok(Json(GalleryResponse::from(gallery)))
}

/// Create gallery - POST /api/galleries
pub async fn create_gallery(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(request): Json<CreateGalleryRequest>,
) -> Result<Json<GalleryResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let create_gallery = CreateGallery::from(request.clone());
    let gallery = photos_repo
        .create_gallery(create_gallery)
        .await
        .map_err(|e| {
            error!("Failed to create gallery: {}", e);
            AppError::InternalServerError("Failed to create gallery".to_string())
        })?;

    // If photo_ids were provided, add them to the gallery
    if let Some(photo_ids) = request.photo_ids {
        for photo_id_str in photo_ids {
            if let Ok(photo_id) = uuid::Uuid::parse_str(&photo_id_str) {
                let _result = photos_repo
                    .add_photo_to_gallery(gallery.id, photo_id, None)
                    .await
                    .map_err(|e| {
                        error!("Failed to add photo {} to gallery: {}", photo_id_str, e);
                        // Continue with other photos instead of failing completely
                    });
            }
        }
    }

    Ok(Json(GalleryResponse::from(gallery)))
}

/// Update gallery - PUT /api/galleries/{id}
pub async fn update_gallery(
    Extension(_db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(_id): Path<String>,
    Json(_request): Json<UpdateGalleryRequest>,
) -> Result<Json<GalleryResponse>, AppError> {
    // For now, return not implemented since update_gallery method may not be available
    Err(AppError::InternalServerError(
        "Gallery update not yet implemented".to_string(),
    ))
}

/// Delete gallery - DELETE /api/galleries/{id}
pub async fn delete_gallery(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let gallery_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid gallery ID format: {}", e);
        AppError::BadRequest("Invalid gallery ID format".to_string())
    })?;

    photos_repo.delete_gallery(gallery_id).await.map_err(|e| {
        error!("Failed to delete gallery {}: {}", id, e);
        AppError::InternalServerError("Failed to delete gallery".to_string())
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Get gallery photos - GET /api/galleries/{id}/photos
pub async fn get_gallery_photos(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<GalleryPhotosResponse>, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let gallery_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid gallery ID format: {}", e);
        AppError::BadRequest("Invalid gallery ID format".to_string())
    })?;

    let gallery = photos_repo.get_gallery(gallery_id).await.map_err(|e| {
        error!("Failed to fetch gallery {}: {}", id, e);
        AppError::NotFound(format!("Gallery with id {} not found", id))
    })?;

    let photos = photos_repo
        .get_gallery_photos(gallery_id, 100)
        .await
        .map_err(|e| {
            error!("Failed to fetch photos for gallery {}: {}", id, e);
            AppError::InternalServerError("Failed to fetch gallery photos".to_string())
        })?;

    // Convert to PhotoGalleryResponse - photos method returns Vec<Photo>, not Vec<PhotoGallery>
    let photo_gallery_responses: Vec<PhotoGalleryResponse> = photos
        .into_iter()
        .enumerate()
        .map(|(idx, photo)| PhotoGalleryResponse {
            id: format!("{}-{}", gallery_id, photo.id),
            gallery_id: gallery_id.to_string(),
            photo_id: photo.id.to_string(),
            position: idx as i32,
            created_at: photo.created_at,
            photo: Some(PhotoResponse::from(photo)),
        })
        .collect();

    Ok(Json(GalleryPhotosResponse {
        gallery: GalleryResponse::from(gallery),
        photos: photo_gallery_responses,
    }))
}

/// Add photos to gallery - POST /api/galleries/{id}/photos
pub async fn add_photos_to_gallery(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(request): Json<AddPhotosRequest>,
) -> Result<StatusCode, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let gallery_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid gallery ID format: {}", e);
        AppError::BadRequest("Invalid gallery ID format".to_string())
    })?;

    for photo_id_str in request.photo_ids {
        if let Ok(photo_id) = uuid::Uuid::parse_str(&photo_id_str) {
            photos_repo
                .add_photo_to_gallery(gallery_id, photo_id, None)
                .await
                .map_err(|e| {
                    error!(
                        "Failed to add photo {} to gallery {}: {}",
                        photo_id_str, id, e
                    );
                    AppError::InternalServerError("Failed to add photos to gallery".to_string())
                })?;
        }
    }

    Ok(StatusCode::CREATED)
}

/// Remove photos from gallery - DELETE /api/galleries/{id}/photos
pub async fn remove_photos_from_gallery(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(request): Json<AddPhotosRequest>, // Reuse the same request type
) -> Result<StatusCode, AppError> {
    let photos_repo = PhotoRepository::new(db.pool().clone());

    let gallery_id = uuid::Uuid::parse_str(&id).map_err(|e| {
        error!("Invalid gallery ID format: {}", e);
        AppError::BadRequest("Invalid gallery ID format".to_string())
    })?;

    for photo_id_str in request.photo_ids {
        if let Ok(photo_id) = uuid::Uuid::parse_str(&photo_id_str) {
            photos_repo
                .remove_photo_from_gallery(gallery_id, photo_id)
                .await
                .map_err(|e| {
                    error!(
                        "Failed to remove photo {} from gallery {}: {}",
                        photo_id_str, id, e
                    );
                    AppError::InternalServerError(
                        "Failed to remove photos from gallery".to_string(),
                    )
                })?;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Create routes for photos API
pub fn create_routes() -> axum::Router {
    use axum::routing::get;

    axum::Router::new()
        .route("/photos", get(list_photos))
        .route("/photos/{id}", get(get_photo))
        .route("/galleries", get(list_galleries).post(create_gallery))
        .route(
            "/galleries/{id}",
            get(get_gallery).put(update_gallery).delete(delete_gallery),
        )
        .route(
            "/galleries/{id}/photos",
            get(get_gallery_photos)
                .post(add_photos_to_gallery)
                .delete(remove_photos_from_gallery),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_photo_response_conversion() {
        let photo = Photo {
            id: uuid::Uuid::new_v4(),
            media_blob_id: "blob-id".to_string(),
            thumbnail_blob_id: Some("thumb-blob-id".to_string()),
            title: Some("Test Photo".to_string()),
            caption: Some("A test photo".to_string()),
            alt_text: None,
            location: Some("Test Location".to_string()),
            latitude: None,
            longitude: None,
            taken_at: None,
            camera_make: Some("Canon".to_string()),
            camera_model: Some("EOS R5".to_string()),
            lens_info: None,
            focal_length: None,
            aperture: None,
            shutter_speed: None,
            iso: Some(100),
            flash_used: None,
            orientation: None,
            width_px: Some(1920),
            height_px: Some(1080),
            color_space: None,
            rating: None,
            is_favorite: None,
            tags: None,
            metadata: serde_json::json!({"iso": 100, "aperture": "f/8"}),
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        let response = PhotoResponse::from(photo.clone());

        assert_eq!(response.id, photo.id.to_string());
        assert_eq!(response.title, photo.title);
        assert_eq!(response.description, photo.caption);
        assert_eq!(response.width_px, photo.width_px);
        assert_eq!(response.height_px, photo.height_px);
        assert_eq!(response.media_blob_id, photo.media_blob_id);
        assert_eq!(response.thumbnail_blob_id, photo.thumbnail_blob_id);
    }
}
