use crate::search::models::*;
use sqlx::{FromRow, PgPool};
use std::time::Instant;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct MusicSearchRow {
    result_type: String,
    id: Uuid,
    title: String,
    subtitle: String,
    description: Option<String>,
    media_blob_id: Option<String>,
    thumbnail_blob_id: Option<String>,
    search_rank: f32,
    metadata: Option<serde_json::Value>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
struct SuggestionRow {
    suggestion: String,
    category: String,
    frequency: i32,
}

pub struct SearchService {
    pool: PgPool,
}

impl SearchService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Main search method that delegates to appropriate search functions
    pub async fn search(&self, query: SearchQuery) -> Result<SearchResult, SearchError> {
        query.validate()?;
        let start_time = Instant::now();

        // For now, we only support music domain
        if query.domains.contains(&"music".to_string()) {
            self.search_music(&query).await
        } else {
            Ok(SearchResult {
                total_count: 0,
                results: vec![],
                facets: vec![],
                suggestions: vec![],
                query_time_ms: start_time.elapsed().as_millis() as u64,
                page: query.pagination.page,
                page_size: query.pagination.page_size,
                total_pages: 0,
            })
        }
    }

    /// Helper function to build search_songs JSON parameters
    fn build_search_params(
        user_id: Option<uuid::Uuid>,
        query: &SearchQuery,
        sort_by: &str,
        sort_direction: &str,
        limit: i32,
        offset: i32,
    ) -> serde_json::Value {
        let search_type_str = match query.search_type {
            SearchType::WebSearch => "websearch",
            SearchType::PlainText => "plainto",
            SearchType::Phrase => "phrase",
        };

        serde_json::json!({
            "user_id": user_id,
            "search_query": query.query,
            "search_type": search_type_str,
            "structured_search": query.structured_search,
            "artist": query.filters.artist,
            "artist_exact": query.filters.artist_exact.unwrap_or(false),
            "album": query.filters.album,
            "album_exact": query.filters.album_exact.unwrap_or(false),
            "album_artist": query.filters.album_artist,
            "genre": query.filters.genre,
            "title_search": query.filters.title_search,
            "year": query.filters.year,
            "year_min": query.filters.year_min,
            "year_max": query.filters.year_max,
            "rating": query.filters.rating,
            "rating_min": query.filters.rating_min,
            "rating_max": query.filters.rating_max,
            "bpm": query.filters.bpm,
            "bpm_min": query.filters.bpm_min,
            "bpm_max": query.filters.bpm_max,
            "duration_seconds": query.filters.duration_seconds,
            "duration_min": query.filters.duration_min,
            "duration_max": query.filters.duration_max,
            "track_number": query.filters.track_number,
            "disc_number": query.filters.disc_number,
            "is_favorite": query.filters.is_favorite,
            "favorites_only": query.filters.favorites_only.unwrap_or(false),
            "has_thumbnail": query.filters.has_thumbnail,
            "has_lyrics": query.filters.has_lyrics,
            "has_waveform": query.filters.has_waveform,
            "is_compilation": query.filters.is_compilation,
            "tags": query.filters.tags,
            "tags_any": query.filters.tags_any,
            "tags_exclude": query.filters.tags_exclude,
            "genres": query.filters.genres,
            "artists": query.filters.artists,
            "albums": query.filters.albums,
            "file_format": query.filters.file_format,
            "file_formats": query.filters.file_formats,
            "bitrate_min": query.filters.bitrate_min,
            "bitrate_max": query.filters.bitrate_max,
            "created_after": query.filters.created_after,
            "created_before": query.filters.created_before,
            "updated_after": query.filters.updated_after,
            "updated_before": query.filters.updated_before,
            "added_after": query.filters.added_after,
            "added_before": query.filters.added_before,
            "key_signature": query.filters.key_signature,
            "key_signatures": query.filters.key_signatures,
            "mood": query.filters.mood,
            "playlist_id": query.filters.playlist_id,
            "not_in_playlist": query.filters.not_in_playlist,
            "include_deleted": query.filters.include_deleted.unwrap_or(false),
            "media_blob_id": query.filters.media_blob_id,
            "metadata_filter": query.filters.metadata_filter,
            "limit": limit,
            "offset": offset,
            "order_by": sort_by,
            "order_direction": sort_direction
        })
    }

    /// Search only songs using the enhanced search_songs function
    pub async fn search_songs(
        &self,
        user_id: Option<uuid::Uuid>,
        query: &SearchQuery,
    ) -> Result<(Vec<SongSearchResult>, u64), SearchError> {
        let sort_by = if let Some(raw_sort) = &query.ordering.raw_sort {
            // Use raw sort field for fields not in enum (year, duration_seconds, etc.)
            raw_sort.as_str()
        } else {
            match query.ordering.sort_by {
                SortBy::Relevance => "relevance",
                SortBy::CreatedAt => "created_at",
                SortBy::Title => "title",
                SortBy::Artist => "artist",
                SortBy::Album => "album",
                SortBy::Rating => "rating",
                SortBy::UpdatedAt => "updated_at",
            }
        };

        let offset = ((query.pagination.page - 1) * query.pagination.page_size) as i32;
        let limit = query.pagination.page_size as i32;

        let sort_direction = match query.ordering.direction {
            SortDirection::Asc => "asc",
            SortDirection::Desc => "desc",
        };

        let params =
            Self::build_search_params(user_id, query, sort_by, sort_direction, limit, offset);

        let rows = sqlx::query!(
            r#"
            SELECT
                id, media_blob_id, thumbnail_blob_id, waveform_blob_id,
                thumbnail_blob_ids, title, artist, album, album_artist,
                track_number, disc_number, duration, genre, year, bpm,
                key_signature, rating, is_favorite, tags, metadata,
                created_at, updated_at, version, search_rank, total_count
            FROM search_songs($1)
            "#,
            params
        )
        .fetch_all(&self.pool)
        .await?;

        let total_count = rows
            .first()
            .map(|row| row.total_count.unwrap_or(0) as u64)
            .unwrap_or(0);

        let results = rows
            .into_iter()
            .map(|row| SongSearchResult {
                id: row.id.unwrap(),
                media_blob_id: row.media_blob_id.unwrap(),
                thumbnail_blob_id: row.thumbnail_blob_id,
                waveform_blob_id: row.waveform_blob_id,
                thumbnail_blob_ids: row.thumbnail_blob_ids,
                title: row.title.unwrap(),
                artist: row.artist,
                album: row.album,
                album_artist: row.album_artist,
                track_number: row.track_number,
                disc_number: row.disc_number,
                duration: row.duration.map(|pg_interval| {
                    // Convert PostgreSQL interval to time::Duration
                    // PgInterval stores microseconds, convert to Duration
                    time::Duration::microseconds(pg_interval.microseconds)
                }),
                genre: row.genre,
                year: row.year,
                bpm: row.bpm,
                key_signature: row.key_signature,
                rating: row.rating,
                is_favorite: row.is_favorite.unwrap_or(false),
                tags: row.tags.unwrap_or_default(),
                metadata: row.metadata,
                created_at: row.created_at.unwrap(),
                updated_at: row.updated_at.unwrap(),
                version: row.version.unwrap(),
                search_rank: row.search_rank.unwrap_or(0.0),
            })
            .collect();

        Ok((results, total_count))
    }

    /// Unified music search (songs + playlists) using music_search function
    pub async fn search_music(&self, query: &SearchQuery) -> Result<SearchResult, SearchError> {
        let start_time = Instant::now();

        // Only return early if there's no query AND no filters
        if query.query.is_none()
            && query.structured_search.is_none()
            && !query.filters.has_any_filters()
        {
            return Ok(SearchResult {
                total_count: 0,
                results: vec![],
                facets: vec![],
                suggestions: vec![],
                query_time_ms: start_time.elapsed().as_millis() as u64,
                page: query.pagination.page,
                page_size: query.pagination.page_size,
                total_pages: 0,
            });
        }

        let search_type = match query.search_type {
            SearchType::WebSearch => "websearch",
            SearchType::PlainText => "plainto",
            SearchType::Phrase => "phrase",
        };

        let offset = ((query.pagination.page - 1) * query.pagination.page_size) as i32;
        let limit = query.pagination.page_size as i32;

        // If filters are present, use search_songs for better filter support
        let (results, total_count) = if query.filters.has_any_filters() {
            // Use search_songs which supports all filters
            let (songs, total_count) = self.search_songs(None, query).await?;

            // Convert songs to SearchResultItem format
            let search_results: Vec<SearchResultItem> = songs
                .into_iter()
                .map(|song| SearchResultItem {
                    id: song.id,
                    result_type: "song".to_string(),
                    title: song.title,
                    subtitle: song.artist.clone(),
                    description: song.album.clone(),
                    thumbnail_blob_id: song.thumbnail_blob_id,
                    media_blob_id: Some(song.media_blob_id),
                    relevance_score: song.search_rank,
                    metadata: serde_json::json!({
                        "artist": song.artist,
                        "album": song.album,
                        "genre": song.genre,
                        "year": song.year,
                        "rating": song.rating,
                        "is_favorite": song.is_favorite,
                        "tags": song.tags
                    }),
                    created_at: song.created_at,
                    updated_at: song.updated_at,
                })
                .collect();

            (search_results, total_count)
        } else {
            // Use the original music_search function for text queries without filters
            let rows = sqlx::query_as::<_, MusicSearchRow>(
                r#"
                SELECT
                    result_type, id, title, subtitle, description,
                    media_blob_id, thumbnail_blob_id, search_rank,
                    metadata, created_at, updated_at
                FROM music_search($1, $2, $3, $4, $5)
                "#,
            )
            .bind(query.query.as_deref())
            .bind(search_type)
            .bind(query.structured_search.as_deref())
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

            let search_results: Vec<SearchResultItem> = rows
                .into_iter()
                .map(|row| SearchResultItem {
                    id: row.id,
                    result_type: row.result_type,
                    title: row.title,
                    subtitle: Some(row.subtitle),
                    description: row.description,
                    thumbnail_blob_id: row.thumbnail_blob_id,
                    media_blob_id: row.media_blob_id,
                    relevance_score: row.search_rank,
                    metadata: row.metadata.unwrap_or_default(),
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                })
                .collect();

            let count = search_results.len() as u64;
            (search_results, count)
        };

        let total_pages = (total_count as f64 / query.pagination.page_size as f64).ceil() as u32;

        let facets = self.get_facets(query).await?;
        let suggestions = if let Some(q) = &query.query {
            self.get_suggestions(q).await?
        } else {
            vec![]
        };

        Ok(SearchResult {
            total_count,
            results,
            facets,
            suggestions,
            query_time_ms: start_time.elapsed().as_millis() as u64,
            page: query.pagination.page,
            page_size: query.pagination.page_size,
            total_pages,
        })
    }

    /// Get search suggestions for autocomplete
    pub async fn get_suggestions(
        &self,
        partial_query: &str,
    ) -> Result<Vec<SearchSuggestion>, SearchError> {
        let rows = sqlx::query_as::<_, SuggestionRow>(
            r#"
            SELECT suggestion, category, frequency
            FROM get_search_suggestions($1, $2)
            "#,
        )
        .bind(partial_query)
        .bind(10i32)
        .fetch_all(&self.pool)
        .await?;

        let suggestions = rows
            .into_iter()
            .map(|row| SearchSuggestion {
                text: row.suggestion,
                category: row.category,
                frequency: row.frequency as u32,
            })
            .collect();

        Ok(suggestions)
    }

    /// Get facets for the current search (placeholder implementation)
    pub async fn get_facets(&self, _query: &SearchQuery) -> Result<Vec<SearchFacet>, SearchError> {
        // TODO: Implement faceted search
        // This would involve querying for common values in searchable fields
        // and their counts within the current search result set
        Ok(vec![])
    }

    /// Get a count of total search results without returning the actual results
    pub async fn count_music_search_results(
        &self,
        query: &SearchQuery,
    ) -> Result<u64, SearchError> {
        if query.query.is_none() && query.structured_search.is_none() {
            return Ok(0);
        }

        let search_type = match query.search_type {
            SearchType::WebSearch => "websearch",
            SearchType::PlainText => "plainto",
            SearchType::Phrase => "phrase",
        };

        let row = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) as count
            FROM music_search($1, $2, $3, 1000000, 0)
            "#,
        )
        .bind(query.query.as_deref())
        .bind(search_type)
        .bind(query.structured_search.as_deref())
        .fetch_one(&self.pool)
        .await?;

        Ok(row as u64)
    }

    /// Simple song listing for non-search scenarios
    pub async fn list_songs(
        &self,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                id, media_blob_id, thumbnail_blob_id, waveform_blob_id,
                thumbnail_blob_ids, title, artist, album, album_artist,
                track_number, disc_number, duration, genre, year, bpm,
                key_signature, rating, is_favorite, tags, metadata,
                created_at, updated_at, version, 0.0 as search_rank,
                0 as total_count
            FROM songs
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
            limit as i32,
            offset as i32
        )
        .fetch_all(&self.pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|row| SongSearchResult {
                id: row.id,
                media_blob_id: row.media_blob_id,
                thumbnail_blob_id: row.thumbnail_blob_id,
                waveform_blob_id: row.waveform_blob_id,
                thumbnail_blob_ids: row.thumbnail_blob_ids,
                title: row.title,
                artist: row.artist,
                album: row.album,
                album_artist: row.album_artist,
                track_number: row.track_number,
                disc_number: row.disc_number,
                duration: row.duration.map(|pg_interval| {
                    // Convert PostgreSQL interval to time::Duration
                    // PgInterval stores microseconds, convert to Duration
                    time::Duration::microseconds(pg_interval.microseconds)
                }),
                genre: row.genre,
                year: row.year,
                bpm: row.bpm,
                key_signature: row.key_signature,
                rating: row.rating,
                is_favorite: row.is_favorite.unwrap_or(false),
                tags: row.tags.unwrap_or_default(),
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                version: row.version,
                search_rank: row
                    .search_rank
                    .map(|bd| bd.to_string().parse::<f32>().unwrap_or(0.0))
                    .unwrap_or(0.0),
            })
            .collect();

        Ok(results)
    }
}

// Convenience methods for common search patterns
impl SearchService {
    /// Quick song search with just a query string
    pub async fn quick_song_search(
        &self,
        query: &str,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let search_query = SearchQuery::new()
            .with_query(query)
            .with_domains(vec!["music".to_string()])
            .with_pagination(1, 20);

        let (results, _) = self.search_songs(None, &search_query).await?;
        Ok(results)
    }

    /// Search songs by artist
    pub async fn search_songs_by_artist(
        &self,
        artist: &str,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let search_query = SearchQuery::new()
            .with_structured_search(&format!("artist:{}", artist))
            .with_domains(vec!["music".to_string()]);

        let (results, _) = self.search_songs(None, &search_query).await?;
        Ok(results)
    }

    /// Search for favorites only
    pub async fn search_favorite_songs(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let mut search_query = SearchQuery::new()
            .with_favorites_only()
            .with_domains(vec!["music".to_string()]);

        if let Some(q) = query {
            search_query = search_query.with_query(q);
        }

        let (results, _) = self.search_songs(None, &search_query).await?;
        Ok(results)
    }
}
