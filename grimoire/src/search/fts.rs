use crate::search::models::*;
use sqlx::{FromRow, PgPool};
use std::time::Instant;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct SearchSongRow {
    id: Uuid,
    media_blob_id: String,
    thumbnail_blob_id: Option<String>,
    waveform_blob_id: Option<String>,
    thumbnail_blob_ids: Option<Vec<String>>,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    track_number: Option<i32>,
    disc_number: Option<i32>,
    duration: Option<sqlx::postgres::types::PgInterval>,
    genre: Option<String>,
    year: Option<i32>,
    bpm: Option<i32>,
    key_signature: Option<String>,
    rating: Option<i32>,
    is_favorite: Option<bool>,
    tags: Option<Vec<String>>,
    metadata: Option<serde_json::Value>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    version: i64,
    search_rank: Option<f32>,
}

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

    /// Search only songs using the enhanced search_songs function
    pub async fn search_songs(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let search_type = match query.search_type {
            SearchType::WebSearch => "websearch",
            SearchType::PlainText => "plainto",
            SearchType::Phrase => "phrase",
        };

        let sort_by = match query.ordering.sort_by {
            SortBy::Relevance => "relevance",
            SortBy::CreatedAt => "created_at",
            SortBy::Title => "title",
            SortBy::Artist => "artist",
            SortBy::Album => "album",
            SortBy::Rating => "rating",
            _ => "relevance",
        };

        let offset = ((query.pagination.page - 1) * query.pagination.page_size) as i32;
        let limit = query.pagination.page_size as i32;

        let rows = sqlx::query_as::<_, SearchSongRow>(
            r#"
            SELECT
                id, media_blob_id, thumbnail_blob_id, waveform_blob_id,
                thumbnail_blob_ids, title, artist, album, album_artist,
                track_number, disc_number, duration, genre, year, bpm,
                key_signature, rating, is_favorite, tags, metadata,
                created_at, updated_at, version, search_rank
            FROM search_songs(
                $1, $2, $3,                                    -- text search
                $4, $5, $6, $7, $8, $9, $10,                  -- basic filters
                $11, $12, $13, $14, $15, $16, $17, $18, $19,   -- numeric filters
                $20, $21, $22, $23, $24, $25, $26,            -- numeric filters cont.
                $27, $28, $29, $30, $31, $32,                 -- boolean filters
                $33, $34, $35, $36, $37, $38,                 -- array filters
                $39, $40, $41, $42,                           -- file/technical filters
                $43, $44, $45, $46, $47, $48,                 -- date filters
                $49, $50, $51,                                -- advanced filters
                $52, $53,                                     -- library management
                $54, $55,                                     -- response options
                $56, $57,                                     -- legacy fields
                $58, $59, $60                                 -- pagination/ordering
            )
            "#,
        )
        // === TEXT SEARCH ===
        .bind(query.query.as_deref())
        .bind(search_type)
        .bind(query.structured_search.as_deref())
        // === BASIC FILTERS ===
        .bind(query.filters.artist.as_deref())
        .bind(query.filters.artist_exact)
        .bind(query.filters.album.as_deref())
        .bind(query.filters.album_exact)
        .bind(query.filters.album_artist.as_deref())
        .bind(query.filters.genre.as_deref())
        .bind(query.filters.title_search.as_deref())
        // === NUMERIC RANGE FILTERS ===
        .bind(query.filters.year)
        .bind(query.filters.year_min)
        .bind(query.filters.year_max)
        .bind(query.filters.rating)
        .bind(query.filters.rating_min)
        .bind(query.filters.rating_max)
        .bind(query.filters.bpm)
        .bind(query.filters.bpm_min)
        .bind(query.filters.bpm_max)
        .bind(query.filters.duration_seconds)
        .bind(query.filters.duration_min)
        .bind(query.filters.duration_max)
        .bind(query.filters.track_number)
        .bind(query.filters.disc_number)
        // === BOOLEAN FILTERS ===
        .bind(query.filters.is_favorite)
        .bind(query.filters.favorites_only)
        .bind(query.filters.has_thumbnail)
        .bind(query.filters.has_lyrics)
        .bind(query.filters.has_waveform)
        .bind(query.filters.is_compilation)
        // === ARRAY/MULTI-VALUE FILTERS ===
        .bind(query.filters.tags.as_deref())
        .bind(query.filters.tags_any.as_deref())
        .bind(query.filters.tags_exclude.as_deref())
        .bind(query.filters.genres.as_deref())
        .bind(query.filters.artists.as_deref())
        .bind(query.filters.albums.as_deref())
        // === FILE/TECHNICAL FILTERS ===
        .bind(query.filters.file_format.as_deref())
        .bind(query.filters.file_formats.as_deref())
        .bind(query.filters.bitrate_min)
        .bind(query.filters.bitrate_max)
        // === DATE FILTERS ===
        .bind(query.filters.created_after)
        .bind(query.filters.created_before)
        .bind(query.filters.updated_after)
        .bind(query.filters.updated_before)
        .bind(query.filters.added_after)
        .bind(query.filters.added_before)
        // === ADVANCED FILTERS ===
        .bind(query.filters.key_signature.as_deref())
        .bind(query.filters.key_signatures.as_deref())
        .bind(query.filters.mood.as_deref())
        // === LIBRARY MANAGEMENT ===
        .bind(query.filters.playlist_id.as_deref())
        .bind(query.filters.not_in_playlist.as_deref())
        // === RESPONSE OPTIONS ===
        .bind(query.filters.include_deleted)
        .bind(query.filters.include_hidden)
        // === LEGACY FIELDS ===
        .bind(query.filters.media_blob_id.as_deref())
        .bind(query.filters.metadata_filter.as_ref())
        // === PAGINATION AND ORDERING ===
        .bind(limit)
        .bind(offset)
        .bind(sort_by)
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
                duration: row.duration.map(|_| time::Duration::ZERO),
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
                search_rank: row.search_rank.unwrap_or(0.0),
            })
            .collect();

        Ok(results)
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
            let songs = self.search_songs(query).await?;

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

            let count = search_results.len() as u64;
            (search_results, count)
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
        let rows = sqlx::query_as::<_, SearchSongRow>(
            r#"
            SELECT
                id, media_blob_id, thumbnail_blob_id, waveform_blob_id,
                thumbnail_blob_ids, title, artist, album, album_artist,
                track_number, disc_number, duration, genre, year, bpm,
                key_signature, rating, is_favorite, tags, metadata,
                created_at, updated_at, version, 0.0 as search_rank
            FROM songs
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit as i32)
        .bind(offset as i32)
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
                duration: row.duration.map(|_| time::Duration::ZERO),
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
                search_rank: row.search_rank.unwrap_or(0.0),
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

        self.search_songs(&search_query).await
    }

    /// Search songs by artist
    pub async fn search_songs_by_artist(
        &self,
        artist: &str,
    ) -> Result<Vec<SongSearchResult>, SearchError> {
        let search_query = SearchQuery::new()
            .with_structured_search(&format!("artist:{}", artist))
            .with_domains(vec!["music".to_string()]);

        self.search_songs(&search_query).await
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

        self.search_songs(&search_query).await
    }
}
