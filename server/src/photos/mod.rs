//! Photos module for server API
//!
//! This module provides HTTP API endpoints for managing photos, galleries, and photo associations.
//! It follows the same patterns as the music API, providing CRUD operations and sync capabilities.

pub mod handlers;

pub use handlers::{
    add_photos_to_gallery, create_gallery, delete_gallery, get_gallery, get_gallery_photos,
    get_photo, list_galleries, list_photos, remove_photos_from_gallery, update_gallery,
    AddPhotosRequest, CreateGalleryRequest, GalleryListResponse, GalleryPhotosResponse,
    GalleryQueryParams, GalleryResponse, MovePhotoRequest, PhotoGalleryResponse, PhotoListResponse,
    PhotoQueryParams, PhotoResponse, ReorderGalleryRequest, UpdateGalleryRequest,
};

use crate::auth::middleware::require_authentication;
use axum::middleware;
use axum::Router;

/// Build photos routes
pub fn build_photos_routes() -> Router {
    Router::new()
        .nest("/api", handlers::create_routes())
        .layer(middleware::from_fn(require_authentication))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_photos_routes() {
        let _router = build_photos_routes();
        // Basic test to ensure router builds without panicking
    }
}
