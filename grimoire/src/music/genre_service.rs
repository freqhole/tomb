// genre service to handle config loading and coordinate repository calls
use crate::config::AppConfig;
use crate::music::genre_models::*;
use crate::music::genre_repository::GenreRepository;
use sqlx::PgPool;

pub struct GenreService {
    repository: GenreRepository,
    config: AppConfig,
}

impl GenreService {
    pub fn new(pool: PgPool, config: AppConfig) -> Self {
        Self {
            repository: GenreRepository::new(pool),
            config,
        }
    }

    /// get predefined genres from config
    pub fn get_predefined_genres(&self) -> Vec<String> {
        self.config.media.genres.clone().unwrap_or_else(|| {
            // fallback list if config is missing
            vec![
                "rock".to_string(),
                "pop".to_string(),
                "jazz".to_string(),
                "classical".to_string(),
                "electronic".to_string(),
                "hip-hop".to_string(),
                "country".to_string(),
                "folk".to_string(),
                "blues".to_string(),
                "reggae".to_string(),
                "metal".to_string(),
                "punk".to_string(),
                "indie".to_string(),
                "alternative".to_string(),
                "experimental".to_string(),
                "ambient".to_string(),
                "techno".to_string(),
                "house".to_string(),
                "trance".to_string(),
                "drum-and-bass".to_string(),
                "dubstep".to_string(),
                "r-n-b".to_string(),
                "soul".to_string(),
                "funk".to_string(),
                "gospel".to_string(),
                "world".to_string(),
                "soundtrack".to_string(),
                "instrumental".to_string(),
            ]
        })
    }

    /// get all genres with statistics
    pub async fn get_genre_stats(&self) -> Result<GenreStatsResponse, GenreServiceError> {
        let predefined_genres = self.get_predefined_genres();

        if predefined_genres.is_empty() {
            return Err(GenreServiceError::ConfigError(
                "no predefined genres found in config".to_string(),
            ));
        }

        self.repository
            .get_genre_stats(&predefined_genres)
            .await
            .map_err(GenreServiceError::DatabaseError)
    }

    /// search within genres
    pub async fn search_genres(
        &self,
        request: GenreSearchRequest,
    ) -> Result<GenreSearchResponse, GenreServiceError> {
        // validate request
        request
            .validate()
            .map_err(GenreServiceError::ValidationError)?;

        // if artist is specified, return albums; otherwise return artists
        if request.artist.is_some() {
            let albums = self
                .repository
                .search_genre_albums(&request)
                .await
                .map_err(GenreServiceError::DatabaseError)?;
            Ok(GenreSearchResponse::Albums(albums))
        } else {
            let artists = self
                .repository
                .search_genre_artists(&request)
                .await
                .map_err(GenreServiceError::DatabaseError)?;
            Ok(GenreSearchResponse::Artists(artists))
        }
    }

    /// validate that a genre is in the predefined list
    pub fn is_valid_genre(&self, genre: &str) -> bool {
        let predefined = self.get_predefined_genres();
        predefined.iter().any(|g| g.eq_ignore_ascii_case(genre))
    }

    /// parse comma-separated sub_genres input string
    pub fn parse_sub_genres(input: &str) -> Vec<String> {
        input
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect()
    }

    /// format sub_genres array as comma-separated string for ui display
    pub fn format_sub_genres(sub_genres: &[String]) -> String {
        sub_genres.join(", ")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GenreServiceError {
    #[error("database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("config error: {0}")]
    ConfigError(String),

    #[error("validation error: {0}")]
    ValidationError(String),
}
