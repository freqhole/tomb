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
    total_count: i64,
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
    ) -> Result<(Vec<SongSearchResult>, u64), SearchError> {
        let search_type = match query.search_type {
            SearchType::WebSearch => "websearch",
            SearchType::PlainText => "plainto",
            SearchType::Phrase => "phrase",
        };

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

        let rows = sqlx::query_as::<_, SearchSongRow>(
            r#"
            SELECT
                id, media_blob_id, thumbnail_blob_id, waveform_blob_id,
                thumbnail_blob_ids, title, artist, album, album_artist,
                track_number, disc_number, duration, genre, year, bpm,
                key_signature, rating, is_favorite, tags, metadata,
                created_at, updated_at, version, search_rank, total_count
            FROM search_songs(
                $1,  -- user_id
                $2,  -- p_search_query
                $3,  -- p_search_type
                $4,  -- p_structured_search
                $5,  -- p_artist
                $6,  -- p_artist_exact
                $7,  -- p_album
                $8,  -- p_album_exact
                $9,  -- p_album_artist
                $10, -- p_genre
                $11, -- p_title_search
                $12, -- p_year
                $13, -- p_year_min
                $14, -- p_year_max
                $15, -- p_rating
                $16, -- p_rating_min
                $17, -- p_rating_max
                $18, -- p_bpm
                $19, -- p_bpm_min
                $20, -- p_bpm_max
                $21, -- p_duration_seconds
                $22, -- p_duration_min
                $23, -- p_duration_max
                $24, -- p_track_number
                $25, -- p_disc_number
                $26, -- p_is_favorite
                $27, -- p_favorites_only
                $28, -- p_has_thumbnail
                $29, -- p_has_lyrics
                $30, -- p_has_waveform
                $31, -- p_is_compilation
                $32, -- p_tags
                $33, -- p_tags_any
                $34, -- p_tags_exclude
                $35, -- p_genres
                $36, -- p_artists
                $37, -- p_albums
                $38, -- p_file_format
                $39, -- p_file_formats
                $40, -- p_bitrate_min
                $41, -- p_bitrate_max
                $42, -- p_created_after
                $43, -- p_created_before
                $44, -- p_updated_after
                $45, -- p_updated_before
                $46, -- p_added_after
                $47, -- p_added_before
                $48, -- p_key_signature
                $49, -- p_key_signatures
                $50, -- p_mood
                $51, -- p_playlist_id
                $52, -- p_not_in_playlist
                $53, -- p_include_deleted
                $54, -- p_media_blob_id
                $55, -- p_metadata_filter
                $56, -- p_limit
                $57, -- p_offset
                $58, -- p_order_by
                $59  -- p_sort_direction
            )
            "#,
        )
        .bind(None::<uuid::Uuid>) // user_id
        .bind(query.query.as_deref()) // search_query
        .bind(search_type) // search_type
        .bind(query.structured_search.as_deref()) // structured_search
        .bind(query.filters.artist.as_deref()) // artist
        .bind(query.filters.artist_exact) // artist_exact
        .bind(query.filters.album.as_deref()) // album
        .bind(query.filters.album_exact) // album_exact
        .bind(query.filters.album_artist.as_deref()) // album_artist
        .bind(query.filters.genre.as_deref()) // genre
        .bind(query.filters.title_search.as_deref()) // title_search
        .bind(query.filters.year) // year
        .bind(query.filters.year_min) // year_min
        .bind(query.filters.year_max) // year_max
        .bind(query.filters.rating) // rating
        .bind(query.filters.rating_min) // rating_min
        .bind(query.filters.rating_max) // rating_max
        .bind(query.filters.bpm) // bpm
        .bind(query.filters.bpm_min) // bpm_min
        .bind(query.filters.bpm_max) // bpm_max
        .bind(query.filters.duration_seconds) // duration_seconds
        .bind(query.filters.duration_min) // duration_min
        .bind(query.filters.duration_max) // duration_max
        .bind(query.filters.track_number) // track_number
        .bind(query.filters.disc_number) // disc_number
        .bind(query.filters.is_favorite) // is_favorite
        .bind(query.filters.favorites_only) // favorites_only
        .bind(query.filters.has_thumbnail) // has_thumbnail
        .bind(query.filters.has_lyrics) // has_lyrics
        .bind(query.filters.has_waveform) // has_waveform
        .bind(query.filters.is_compilation) // is_compilation
        .bind(query.filters.tags.as_deref()) // tags
        .bind(query.filters.tags_any.as_deref()) // tags_any
        .bind(query.filters.tags_exclude.as_deref()) // tags_exclude
        .bind(query.filters.genres.as_deref()) // genres
        .bind(query.filters.artists.as_deref()) // artists
        .bind(query.filters.albums.as_deref()) // albums
        .bind(query.filters.file_format.as_deref()) // file_format
        .bind(query.filters.file_formats.as_deref()) // file_formats
        .bind(query.filters.bitrate_min) // bitrate_min
        .bind(query.filters.bitrate_max) // bitrate_max
        .bind(query.filters.created_after) // created_after
        .bind(query.filters.created_before) // created_before
        .bind(query.filters.updated_after) // updated_after
        .bind(query.filters.updated_before) // updated_before
        .bind(query.filters.added_after) // added_after
        .bind(query.filters.added_before) // added_before
        .bind(query.filters.key_signature.as_deref()) // key_signature
        .bind(query.filters.key_signatures.as_deref()) // key_signatures
        .bind(query.filters.mood.as_deref()) // mood
        .bind(query.filters.playlist_id.as_deref()) // playlist_id
        .bind(query.filters.not_in_playlist.as_deref()) // not_in_playlist
        .bind(query.filters.include_deleted.unwrap_or(false)) // include_deleted
        .bind(query.filters.media_blob_id.as_deref()) // media_blob_id
        .bind(query.filters.metadata_filter.as_ref()) // metadata_filter
        .bind(limit) // limit
        .bind(offset) // offset
        .bind(sort_by) // order_by
        .bind(sort_direction) // sort_direction
        .fetch_all(&self.pool)
        .await?;

        let total_count = rows.first().map(|row| row.total_count as u64).unwrap_or(0);

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
            let (songs, total_count) = self.search_songs(query).await?;

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

        let (results, _) = self.search_songs(&search_query).await?;
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

        let (results, _) = self.search_songs(&search_query).await?;
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

        let (results, _) = self.search_songs(&search_query).await?;
        Ok(results)
    }
}
