//! Genre service for business logic and coordination
//!
//! This module provides the business logic layer for genre operations,
//! coordinating between the repository and the API endpoints.

use crate::music::{genre_models::*, genre_repository::GenreRepository};
use sqlx::PgPool;

pub struct GenreService {
    repository: GenreRepository,
}

impl GenreService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            repository: GenreRepository::new(pool),
        }
    }

    /// Get all predefined genres with statistics
    pub async fn get_genre_stats(
        &self,
        predefined_genres: &[String],
        with_songs_only: bool,
    ) -> Result<GenreStatsResponse, sqlx::Error> {
        self.repository
            .get_genre_stats(predefined_genres, with_songs_only)
            .await
    }

    /// Search within genres, returning either artists or albums
    pub async fn search_genres(
        &self,
        request: GenreSearchRequest,
    ) -> Result<serde_json::Value, sqlx::Error> {
        // Default to searching artists unless specifically requesting albums
        let search_albums =
            request.sort_by.as_deref() == Some("albums") || request.artist.is_some();

        if search_albums {
            let response = self.repository.search_genre_albums(&request).await?;
            Ok(serde_json::to_value(response).unwrap())
        } else {
            let response = self.repository.search_genre_artists(&request).await?;
            Ok(serde_json::to_value(response).unwrap())
        }
    }
}
