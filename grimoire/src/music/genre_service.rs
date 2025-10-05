//! Genre service for business logic and coordination
//!
//! This module provides the business logic layer for genre operations,
//! coordinating between the repository and the API endpoints.

use crate::config::app_config::GenreConfig;
use crate::music::{genre_models::*, genre_repository::GenreRepository};
use sqlx::PgPool;
use std::collections::HashMap;

pub struct GenreService {
    repository: GenreRepository,
}

impl GenreService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            repository: GenreRepository::new(pool),
        }
    }

    /// Parse genre groups from config and create mapping for individual genres to groups
    fn parse_genre_groups(&self, genre_config: &[GenreConfig]) -> HashMap<String, String> {
        let mut genre_map = HashMap::new();

        for group in genre_config {
            // Map each individual genre to the group display name
            for genre in &group.genres {
                genre_map.insert(genre.to_lowercase(), group.display.clone());
            }
        }

        genre_map
    }

    /// Get all individual genres from config for autocomplete
    pub fn get_all_individual_genres(&self, genre_config: &[GenreConfig]) -> Vec<String> {
        let mut all_genres = Vec::new();

        for group in genre_config {
            all_genres.extend(group.genres.clone());
        }

        // Sort alphabetically and remove duplicates
        all_genres.sort();
        all_genres.dedup();
        all_genres
    }

    /// Check if a song's genre matches any group and return the group name
    pub fn find_genre_group(
        &self,
        song_genre: &str,
        genre_config: &[GenreConfig],
    ) -> Option<String> {
        let genre_map = self.parse_genre_groups(genre_config);
        genre_map.get(&song_genre.to_lowercase()).cloned()
    }

    /// Get all predefined genres with statistics using grouping logic
    pub async fn get_genre_stats(
        &self,
        predefined_genres: &[GenreConfig],
        with_songs_only: bool,
    ) -> Result<GenreStatsResponse, sqlx::Error> {
        self.repository
            .get_genre_stats_with_grouping(predefined_genres, with_songs_only)
            .await
    }

    /// Search within genres, returning either artists or albums
    pub async fn search_genres(
        &self,
        mut request: GenreSearchRequest,
        genre_config: &[GenreConfig],
    ) -> Result<serde_json::Value, sqlx::Error> {
        // If genre_slug is provided, expand it to individual genres
        if let Some(slug) = &request.genre_slug {
            if let Some(config) = genre_config.iter().find(|g| g.slug == *slug) {
                // Replace genre_slug with expanded individual genres list
                request.genre_slug = None;
                request.expanded_genres = Some(config.genres.clone());
            }
        }

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
