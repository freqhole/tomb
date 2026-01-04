//! Music domain repository
//!
//! This module provides database access layer for songs and playlists,
//! including CRUD operations and queries with proper error handling.
//! #todo: jesusfuck this file is wayyyyy tooooo huge!

use crate::music::models::{
    AlbumFavoriteStatus, AlbumSummary, AlbumTrack, ArtistAlbum, BulkFavoriteAlbumRequest,
    BulkSongUpdates, BulkTagOperation, BulkUpdatePreferencesRequest, BulkUpdateSongsRequest,
    CreatePlaylist, CreateSong, MusicDatabaseStats, Playlist, PlaylistComplete, PlaylistOwnership,
    PlaylistQuery, PlaylistSong, PlaylistSongDetail, PlaylistSongWithMedia, PlaylistSummary,
    PlaylistWithCount, PlaylistWithUserContext, RecentSongWithThumbnail, Song, SongQuery,
    SongWithMedia, SongWithUserPrefs, TransferPlaylistOwnershipRequest, UpdatePlaylist,
    UpdateUserPlaylistPreferenceRequest, UpdateUserPreferenceRequest, UserPlaylistPreference,
    UserSongPreference,
};
use crate::search::{SearchQuery, SearchService, SongSearchResult, SortBy, SortDirection};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub mod filters;

#[derive(Debug, thiserror::Error)]
pub enum MusicRepositoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Song not found: {0}")]
    SongNotFound(Uuid),
    #[error("Playlist not found: {0}")]
    PlaylistNotFound(Uuid),
    #[error("Playlist not found by title: {0}")]
    PlaylistNotFoundByTitle(String),
    #[error("Song already in playlist")]
    SongAlreadyInPlaylist,
    #[error("Song not in playlist")]
    SongNotInPlaylist,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate playlist title: {0}")]
    DuplicatePlaylistTitle(String),
}

pub type Result<T> = std::result::Result<T, MusicRepositoryError>;

/// Repository for song and playlist database operations
pub struct MusicRepository {
    pool: PgPool,
}

impl MusicRepository {
    /// Create a new repository instance
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get the database pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    // Song operations

    /// Get a song by ID
    pub async fn get_song(&self, id: Uuid) -> Result<Song> {
        let song =
            sqlx::query_as::<_, Song>("SELECT * FROM songs WHERE id = $1 AND deleted_at IS NULL")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(MusicRepositoryError::SongNotFound(id))?;

        Ok(song)
    }

    /// Get song with media information for playback
    pub async fn get_song_with_media(&self, id: Uuid) -> Result<SongWithMedia> {
        let song = sqlx::query_as::<_, SongWithMedia>("SELECT * FROM get_song_with_media($1)")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MusicRepositoryError::SongNotFound(id))?;

        Ok(song)
    }

    /// Query songs with filtering and pagination
    #[allow(unused_variables)] // Variables used for dynamic SQL building
    /// Search songs using the new FTS system
    pub async fn search_songs(
        &self,
        user_id: Option<uuid::Uuid>,
        query: SongQuery,
    ) -> Result<Vec<SongSearchResult>> {
        let search_service = SearchService::new(self.pool.clone());

        // Convert SongQuery to SearchQuery
        let search_query = self.convert_song_query_to_search_query(query);

        let (results, _total_count) = search_service
            .search_songs(user_id, &search_query)
            .await
            .map_err(|e| MusicRepositoryError::Database(sqlx::Error::Protocol(e.to_string())))?;

        Ok(results)
    }

    /// Convert old SongQuery format to new SearchQuery format
    fn convert_song_query_to_search_query(&self, query: SongQuery) -> SearchQuery {
        let mut search_query = SearchQuery::new();

        // Set basic text search
        if let Some(title_search) = query.title_search {
            search_query = search_query.with_query(&title_search);
        }

        // Set pagination
        let page = (query.offset.unwrap_or(0) / query.limit.unwrap_or(100)) + 1;
        search_query = search_query.with_pagination(page as u32, query.limit.unwrap_or(100) as u32);

        // Set sorting
        let sort_by = match query.order_by.as_deref() {
            Some("title") => SortBy::Title,
            Some("artist") => SortBy::Artist,
            Some("album") => SortBy::Album,
            Some("rating") => SortBy::Rating,
            Some("created_at") => SortBy::CreatedAt,
            _ => SortBy::CreatedAt,
        };

        let direction = match query.order_direction.as_deref() {
            Some("ASC") => SortDirection::Asc,
            _ => SortDirection::Desc,
        };

        search_query = search_query.with_sort(sort_by, direction);

        // Set filters
        search_query.filters.artist = query.artist;
        search_query.filters.album = query.album;
        search_query.filters.album_artist = query.album_artist;
        search_query.filters.genre = query.genre;
        search_query.filters.year = query.year;
        search_query.filters.rating_min = query.rating_min;
        search_query.filters.rating_max = query.rating_max;
        search_query.filters.bpm_min = query.bpm_min;
        search_query.filters.bpm_max = query.bpm_max;
        search_query.filters.duration_min = query.duration_min;
        search_query.filters.duration_max = query.duration_max;
        search_query.filters.favorites_only = query.favorites_only;
        search_query.filters.has_thumbnail = query.has_thumbnail;
        search_query.filters.has_waveform = query.has_waveform;
        search_query.filters.tags = query.tags;
        search_query.filters.created_after = query.created_after;
        search_query.filters.updated_after = query.updated_after;
        search_query.filters.metadata_filter = query.metadata_filter;
        search_query.filters.key_signature = query.key_signature;
        search_query.filters.media_blob_id = query.media_blob_id;

        search_query
    }

    /// Simple song listing (non-search)
    pub async fn list_songs(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<Song>> {
        let limit = limit.unwrap_or(100) as i32;
        let offset = offset.unwrap_or(0) as i32;

        let songs = sqlx::query_as::<_, Song>(
            "SELECT * FROM songs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Query songs with filtering and pagination
    pub async fn query_songs(&self, query: SongQuery) -> Result<Vec<Song>> {
        let limit = query.limit.unwrap_or(100);
        let offset = query.offset.unwrap_or(0);

        // Build the SQL query with filtering
        let mut sql = "SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids, title, artist, album, album_artist, track_number, disc_number, duration, genre, sub_genres, year, bpm, key_signature, rating, is_favorite, tags, metadata, processing_status, processing_notes, deleted_at, deleted_by, created_at, updated_at, version FROM songs WHERE 1=1".to_string();
        let mut bind_count = 0;

        // Add filters
        if let Some(_artist) = &query.artist {
            bind_count += 1;
            sql.push_str(&format!(" AND artist = ${}", bind_count));
        }

        if let Some(_album) = &query.album {
            bind_count += 1;
            sql.push_str(&format!(" AND album = ${}", bind_count));
        }

        if let Some(_album_artist) = &query.album_artist {
            bind_count += 1;
            sql.push_str(&format!(" AND album_artist = ${}", bind_count));
        }

        if let Some(_genre) = &query.genre {
            bind_count += 1;
            sql.push_str(&format!(" AND genre = ${}", bind_count));
        }

        if let Some(_title_search) = &query.title_search {
            bind_count += 1;
            sql.push_str(&format!(" AND title ILIKE ${}", bind_count));
        }

        if let Some(_year) = query.year {
            bind_count += 1;
            sql.push_str(&format!(" AND year = ${}", bind_count));
        }

        if let Some(_rating_min) = query.rating_min {
            bind_count += 1;
            sql.push_str(&format!(" AND rating >= ${}", bind_count));
        }

        if let Some(_rating_max) = query.rating_max {
            bind_count += 1;
            sql.push_str(&format!(" AND rating <= ${}", bind_count));
        }

        if let Some(_bpm_min) = query.bpm_min {
            bind_count += 1;
            sql.push_str(&format!(" AND bpm >= ${}", bind_count));
        }

        if let Some(_bmp_max) = query.bpm_max {
            bind_count += 1;
            sql.push_str(&format!(" AND bpm <= ${}", bind_count));
        }

        if let Some(_duration_min) = query.duration_min {
            bind_count += 1;
            sql.push_str(&format!(
                " AND EXTRACT(EPOCH FROM duration) >= ${}",
                bind_count
            ));
        }

        if let Some(_duration_max) = query.duration_max {
            bind_count += 1;
            sql.push_str(&format!(
                " AND EXTRACT(EPOCH FROM duration) <= ${}",
                bind_count
            ));
        }

        if let Some(_favorites_only) = query.favorites_only {
            if _favorites_only {
                sql.push_str(" AND is_favorite = true");
            }
        }

        if let Some(_has_thumbnail) = query.has_thumbnail {
            if _has_thumbnail {
                sql.push_str(" AND thumbnail_blob_id IS NOT NULL");
            } else {
                sql.push_str(" AND thumbnail_blob_id IS NULL");
            }
        }

        if let Some(_has_waveform) = query.has_waveform {
            if _has_waveform {
                sql.push_str(" AND waveform_blob_id IS NOT NULL");
            } else {
                sql.push_str(" AND waveform_blob_id IS NULL");
            }
        }

        if let Some(_created_after) = query.created_after {
            bind_count += 1;
            sql.push_str(&format!(" AND created_at > ${}", bind_count));
        }

        if let Some(_updated_after) = query.updated_after {
            bind_count += 1;
            sql.push_str(&format!(" AND updated_at > ${}", bind_count));
        }

        if let Some(_key_signature) = &query.key_signature {
            bind_count += 1;
            sql.push_str(&format!(" AND key_signature = ${}", bind_count));
        }

        if let Some(_media_blob_id) = &query.media_blob_id {
            bind_count += 1;
            sql.push_str(&format!(" AND media_blob_id = ${}", bind_count));
        }

        // Add ordering
        let order_by = query.order_by.as_deref().unwrap_or("created_at");
        let order_direction = query.order_direction.as_deref().unwrap_or("DESC");
        sql.push_str(&format!(" ORDER BY {} {}", order_by, order_direction));

        // Add pagination
        bind_count += 1;
        sql.push_str(&format!(" LIMIT ${}", bind_count));
        bind_count += 1;
        sql.push_str(&format!(" OFFSET ${}", bind_count));

        // Build and execute the query
        let mut query_builder = sqlx::query_as::<_, Song>(&sql);

        // Bind parameters in the same order they were added
        if let Some(artist) = &query.artist {
            query_builder = query_builder.bind(artist);
        }
        if let Some(album) = &query.album {
            query_builder = query_builder.bind(album);
        }
        if let Some(album_artist) = &query.album_artist {
            query_builder = query_builder.bind(album_artist);
        }
        if let Some(genre) = &query.genre {
            query_builder = query_builder.bind(genre);
        }
        if let Some(title_search) = &query.title_search {
            query_builder = query_builder.bind(format!("%{}%", title_search));
        }
        if let Some(year) = query.year {
            query_builder = query_builder.bind(year);
        }
        if let Some(rating_min) = query.rating_min {
            query_builder = query_builder.bind(rating_min);
        }
        if let Some(rating_max) = query.rating_max {
            query_builder = query_builder.bind(rating_max);
        }
        if let Some(bpm_min) = query.bpm_min {
            query_builder = query_builder.bind(bpm_min);
        }
        if let Some(bpm_max) = query.bpm_max {
            query_builder = query_builder.bind(bpm_max);
        }
        if let Some(duration_min) = query.duration_min {
            query_builder = query_builder.bind(duration_min);
        }
        if let Some(duration_max) = query.duration_max {
            query_builder = query_builder.bind(duration_max);
        }
        if let Some(created_after) = query.created_after {
            query_builder = query_builder.bind(created_after);
        }
        if let Some(updated_after) = query.updated_after {
            query_builder = query_builder.bind(updated_after);
        }
        if let Some(key_signature) = &query.key_signature {
            query_builder = query_builder.bind(key_signature);
        }
        if let Some(media_blob_id) = &query.media_blob_id {
            query_builder = query_builder.bind(media_blob_id);
        }

        // Bind pagination parameters
        query_builder = query_builder.bind(limit);
        query_builder = query_builder.bind(offset);

        query_builder
            .fetch_all(&self.pool)
            .await
            .map_err(MusicRepositoryError::Database)
    }

    /// Create a new song
    pub async fn create_song(&self, params: CreateSong) -> Result<Song> {
        params
            .validate()
            .map_err(|e| MusicRepositoryError::Validation(e.to_string()))?;

        let song = sqlx::query_as::<_, Song>(
            r#"
            INSERT INTO songs (
                media_blob_id, title, artist, album, album_artist, track_number, disc_number,
                duration, genre, year, bpm, key_signature, rating, is_favorite, tags, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *
            "#,
        )
        .bind(&params.media_blob_id)
        .bind(&params.title)
        .bind(&params.artist)
        .bind(&params.album)
        .bind(&params.album_artist)
        .bind(params.track_number)
        .bind(params.disc_number)
        .bind(params.duration)
        .bind(&params.genre)
        .bind(params.year)
        .bind(params.bpm)
        .bind(&params.key_signature)
        .bind(params.rating)
        .bind(params.is_favorite.unwrap_or(false))
        .bind(&params.tags)
        .bind(&params.metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(song)
    }

    /// Update a song's favorite status
    pub async fn update_song_favorite(&self, id: Uuid, is_favorite: bool) -> Result<Song> {
        let song = sqlx::query_as::<_, Song>(
            "UPDATE songs SET is_favorite = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING *"
        )
        .bind(is_favorite)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(MusicRepositoryError::SongNotFound(id))?;

        Ok(song)
    }

    /// Update a song's rating
    pub async fn update_song_rating(&self, id: Uuid, rating: Option<i32>) -> Result<Song> {
        if let Some(r) = rating {
            if !(1..=5).contains(&r) {
                return Err(MusicRepositoryError::Validation(
                    "Rating must be between 1 and 5".to_string(),
                ));
            }
        }

        let song = sqlx::query_as::<_, Song>(
            "UPDATE songs SET rating = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING *"
        )
        .bind(rating)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(MusicRepositoryError::SongNotFound(id))?;

        Ok(song)
    }

    /// Soft delete a song
    pub async fn delete_song(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE songs SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL"
        )
        .bind(deleted_by)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    // User preference operations

    /// Update user song preferences (favorite status and/or rating)
    pub async fn update_user_song_preference(
        &self,
        user_id: Uuid,
        song_id: Uuid,
        request: UpdateUserPreferenceRequest,
    ) -> Result<UserSongPreference> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let preference = sqlx::query_as::<_, UserSongPreference>(
            "SELECT * FROM upsert_user_song_preference($1, $2, $3, $4)",
        )
        .bind(user_id)
        .bind(song_id)
        .bind(request.is_favorite)
        .bind(request.rating)
        .fetch_one(&self.pool)
        .await?;

        Ok(preference)
    }

    /// Bulk update user song preferences for multiple songs
    pub async fn bulk_update_user_preferences(
        &self,
        user_id: Uuid,
        request: BulkUpdatePreferencesRequest,
    ) -> Result<Vec<UserSongPreference>> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let mut preferences = Vec::new();

        for song_id in request.song_ids {
            let preference = self
                .update_user_song_preference(user_id, song_id, request.updates.clone())
                .await?;
            preferences.push(preference);
        }

        Ok(preferences)
    }

    /// Bulk update song metadata for multiple songs (admin-only)
    pub async fn bulk_update_songs(&self, request: BulkUpdateSongsRequest) -> Result<Vec<Song>> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let mut updated_songs = Vec::new();

        // Process metadata updates if any are specified
        let has_metadata_updates = request.updates.title.is_some()
            || request.updates.artist.is_some()
            || request.updates.album.is_some()
            || request.updates.album_artist.is_some()
            || request.updates.track_number.is_some()
            || request.updates.disc_number.is_some()
            || request.updates.genre.is_some()
            || request.updates.sub_genres.is_some()
            || request.updates.year.is_some()
            || request.updates.bpm.is_some()
            || request.updates.key_signature.is_some()
            || request.updates.thumbnail_blob_id.is_some()
            || request.updates.metadata.is_some();

        if has_metadata_updates {
            // Update metadata fields for all songs
            match self
                .bulk_update_metadata(&request.song_ids, &request.updates)
                .await
            {
                Ok(songs) => updated_songs.extend(songs),
                Err(e) => {
                    tracing::error!("Failed to update metadata for songs: {:?}", e);
                }
            }
        }

        // Process tag operations if specified
        if let Some(tag_operation) = request.updates.tags {
            for song_id in &request.song_ids {
                match self.apply_tag_operation(*song_id, &tag_operation).await {
                    Ok(song) => {
                        // If we already updated metadata, replace the existing entry
                        if let Some(pos) = updated_songs.iter().position(|s| s.id == song.id) {
                            updated_songs[pos] = song;
                        } else {
                            updated_songs.push(song);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to update tags for song {}: {:?}", song_id, e);
                        // Continue with other songs, don't fail entire operation
                    }
                }
            }
        }

        Ok(updated_songs)
    }

    /// Bulk update metadata fields for multiple songs
    async fn bulk_update_metadata(
        &self,
        song_ids: &[Uuid],
        updates: &BulkSongUpdates,
    ) -> Result<Vec<Song>> {
        if song_ids.is_empty() {
            return Ok(Vec::new());
        }

        let songs = sqlx::query_as::<_, Song>(
            r#"
            UPDATE songs
            SET
                title = COALESCE($1, title),
                artist = COALESCE($2, artist),
                album = COALESCE($3, album),
                album_artist = COALESCE($4, album_artist),
                track_number = COALESCE($5, track_number),
                disc_number = COALESCE($6, disc_number),
                genre = COALESCE($7, genre),
                sub_genres = COALESCE($8, sub_genres),
                year = COALESCE($9, year),
                bpm = COALESCE($10, bpm),
                key_signature = COALESCE($11, key_signature),
                thumbnail_blob_id = COALESCE($12, thumbnail_blob_id),
                metadata = COALESCE($13, metadata),
                updated_at = NOW()
            WHERE id = ANY($14)
            RETURNING *
            "#,
        )
        .bind(&updates.title)
        .bind(&updates.artist)
        .bind(&updates.album)
        .bind(&updates.album_artist)
        .bind(updates.track_number)
        .bind(updates.disc_number)
        .bind(&updates.genre)
        .bind(&updates.sub_genres)
        .bind(updates.year)
        .bind(updates.bpm)
        .bind(&updates.key_signature)
        .bind(&updates.thumbnail_blob_id)
        .bind(&updates.metadata)
        .bind(song_ids)
        .fetch_all(&self.pool)
        .await
        .map_err(MusicRepositoryError::Database)?;

        Ok(songs)
    }

    /// Apply tag operation to a single song
    async fn apply_tag_operation(
        &self,
        song_id: Uuid,
        operation: &BulkTagOperation,
    ) -> Result<Song> {
        match operation {
            BulkTagOperation::Replace { tags } => {
                // Replace all tags with new ones
                let song = sqlx::query_as::<_, Song>(
                    r#"
                    UPDATE songs
                    SET tags = $1, updated_at = NOW()
                    WHERE id = $2 AND deleted_at IS NULL
                    RETURNING *
                    "#,
                )
                .bind(tags)
                .bind(song_id)
                .fetch_one(&self.pool)
                .await?;
                Ok(song)
            }
            BulkTagOperation::Add { tags } => {
                // Add tags to existing ones (using array concatenation and deduplication)
                let song = sqlx::query_as::<_, Song>(
                    r#"
                    UPDATE songs
                    SET tags = array(SELECT DISTINCT unnest(tags || $1)),
                        updated_at = NOW()
                    WHERE id = $2 AND deleted_at IS NULL
                    RETURNING *
                    "#,
                )
                .bind(tags)
                .bind(song_id)
                .fetch_one(&self.pool)
                .await?;
                Ok(song)
            }
            BulkTagOperation::Remove { tags } => {
                // Remove specific tags from existing ones
                let song = sqlx::query_as::<_, Song>(
                    r#"
                    UPDATE songs
                    SET tags = array(SELECT unnest(tags) EXCEPT SELECT unnest($1)),
                        updated_at = NOW()
                    WHERE id = $2 AND deleted_at IS NULL
                    RETURNING *
                    "#,
                )
                .bind(tags)
                .bind(song_id)
                .fetch_one(&self.pool)
                .await?;
                Ok(song)
            }
        }
    }

    /// Update song's MusicBrainz metadata in the JSONB field, preserving other metadata
    pub async fn update_song_musicbrainz_metadata(
        &self,
        song_id: Uuid,
        musicbrainz_data: &serde_json::Value,
    ) -> Result<Song> {
        let song = sqlx::query_as::<_, Song>(
            r#"
            UPDATE songs
            SET
                metadata = jsonb_set(
                    COALESCE(metadata, '{}'),
                    '{musicbrainz}',
                    $1
                ),
                updated_at = NOW()
            WHERE id = $2 AND deleted_at IS NULL
            RETURNING *
            "#,
        )
        .bind(musicbrainz_data)
        .bind(song_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(MusicRepositoryError::SongNotFound(song_id))?;

        Ok(song)
    }

    /// Search songs with user preferences included
    pub async fn search_songs_with_user_context(
        &self,
        user_id: Option<Uuid>,
        query: SongQuery,
    ) -> Result<Vec<SongWithUserPrefs>> {
        // for now, use the helper function we created in the database
        let songs = sqlx::query_as::<_, SongWithUserPrefs>(
            "SELECT * FROM get_songs_with_user_preferences($1, $2, $3, $4, $5, $6)",
        )
        .bind(user_id)
        .bind(query.limit.unwrap_or(50) as i32)
        .bind(query.offset.unwrap_or(0) as i32)
        .bind(query.order_by.unwrap_or_else(|| "created_at".to_string()))
        .bind(query.order_direction.unwrap_or_else(|| "desc".to_string()))
        .bind(query.favorites_only.unwrap_or(false))
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    // Playlist operations

    /// Get a playlist by ID
    pub async fn get_playlist(&self, id: Uuid) -> Result<Playlist> {
        let playlist = sqlx::query_as::<_, Playlist>(
            "SELECT * FROM playlists WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(MusicRepositoryError::PlaylistNotFound(id))?;

        Ok(playlist)
    }

    // Playlist preference operations

    /// Update user playlist preference
    pub async fn update_user_playlist_preference(
        &self,
        user_id: Uuid,
        playlist_id: Uuid,
        request: UpdateUserPlaylistPreferenceRequest,
    ) -> Result<UserPlaylistPreference> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let preference = sqlx::query_as::<_, UserPlaylistPreference>(
            "SELECT * FROM upsert_user_playlist_preference($1, $2, $3)",
        )
        .bind(user_id)
        .bind(playlist_id)
        .bind(request.is_favorite)
        .fetch_one(&self.pool)
        .await?;

        Ok(preference)
    }

    /// Get user playlist preferences
    pub async fn get_user_playlist_preferences(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserPlaylistPreference>> {
        let preferences = sqlx::query_as::<_, UserPlaylistPreference>(
            "SELECT * FROM user_playlist_preferences WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(preferences)
    }

    /// Get playlists with user context (preferences and ownership)
    pub async fn get_playlists_with_user_context(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<PlaylistWithUserContext>> {
        let playlists = sqlx::query_as::<_, PlaylistWithUserContext>(
            "SELECT * FROM get_playlists_with_user_context($1)",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(playlists)
    }

    // Playlist ownership operations

    /// Set playlist owner
    pub async fn set_playlist_owner(
        &self,
        playlist_id: Uuid,
        owner_user_id: Uuid,
    ) -> Result<PlaylistOwnership> {
        let ownership =
            sqlx::query_as::<_, PlaylistOwnership>("SELECT * FROM set_playlist_owner($1, $2)")
                .bind(playlist_id)
                .bind(owner_user_id)
                .fetch_one(&self.pool)
                .await?;

        Ok(ownership)
    }

    /// Get user owned playlists
    pub async fn get_user_owned_playlists(&self, user_id: Uuid) -> Result<Vec<Playlist>> {
        let playlists = sqlx::query_as::<_, Playlist>("SELECT * FROM get_user_owned_playlists($1)")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(playlists)
    }

    /// Transfer playlist ownership
    pub async fn transfer_playlist_ownership(
        &self,
        playlist_id: Uuid,
        request: TransferPlaylistOwnershipRequest,
    ) -> Result<PlaylistOwnership> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let ownership = sqlx::query_as::<_, PlaylistOwnership>(
            "SELECT * FROM transfer_playlist_ownership($1, $2, $3)",
        )
        .bind(playlist_id)
        .bind(request.from_user_id)
        .bind(request.to_user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(ownership)
    }

    // Album favorite operations

    /// Bulk favorite all songs in an album
    pub async fn bulk_favorite_album(
        &self,
        user_id: Uuid,
        request: BulkFavoriteAlbumRequest,
    ) -> Result<Vec<UserSongPreference>> {
        request
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        // Get all songs in the album
        let song_ids = sqlx::query_scalar!(
            "SELECT id FROM songs WHERE album = $1 AND deleted_at IS NULL",
            request.album
        )
        .fetch_all(&self.pool)
        .await?;

        // Bulk update preferences for all songs
        let mut preferences = Vec::new();
        for song_id in song_ids {
            let pref_request = UpdateUserPreferenceRequest {
                is_favorite: Some(request.is_favorite),
                rating: None, // keep existing rating
            };
            let pref = self
                .update_user_song_preference(user_id, song_id, pref_request)
                .await?;
            preferences.push(pref);
        }

        Ok(preferences)
    }

    /// Get album favorite status for a user
    pub async fn get_album_favorite_status(
        &self,
        user_id: Uuid,
        album: String,
    ) -> Result<AlbumFavoriteStatus> {
        let result = sqlx::query!(
            r#"
            SELECT
                COUNT(s.id) as total_songs,
                COUNT(CASE WHEN usp.is_favorite = true THEN 1 END) as favorited_songs
            FROM songs s
            LEFT JOIN user_song_preferences usp ON s.id = usp.song_id AND usp.user_id = $1
            WHERE s.album = $2 AND s.deleted_at IS NULL
            "#,
            user_id,
            album
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(AlbumFavoriteStatus {
            album,
            total_songs: result.total_songs.unwrap_or(0) as u32,
            favorited_songs: result.favorited_songs.unwrap_or(0) as u32,
            is_fully_favorited: result.total_songs == result.favorited_songs
                && result.total_songs.unwrap_or(0) > 0,
        })
    }

    /// Bulk favorite all songs in a playlist
    pub async fn bulk_favorite_playlist_songs(
        &self,
        user_id: Uuid,
        playlist_id: Uuid,
        is_favorite: bool,
    ) -> Result<Vec<UserSongPreference>> {
        let preferences = sqlx::query_as::<_, UserSongPreference>(
            "SELECT * FROM bulk_favorite_playlist_songs($1, $2, $3)",
        )
        .bind(user_id)
        .bind(playlist_id)
        .bind(is_favorite)
        .fetch_all(&self.pool)
        .await?;

        Ok(preferences)
    }

    /// Find playlists by title (exact or partial match)
    pub async fn find_playlists_by_title(
        &self,
        title: &str,
        exact_match: bool,
    ) -> Result<Vec<Playlist>> {
        let sql = if exact_match {
            "SELECT * FROM playlists WHERE title = $1 AND deleted_at IS NULL ORDER BY updated_at DESC"
        } else {
            "SELECT * FROM playlists WHERE title ILIKE $1 AND deleted_at IS NULL ORDER BY updated_at DESC"
        };

        let bind_value = if exact_match {
            title.to_string()
        } else {
            format!("%{}%", title)
        };

        let playlists = sqlx::query_as::<_, Playlist>(sql)
            .bind(bind_value)
            .fetch_all(&self.pool)
            .await?;

        Ok(playlists)
    }

    /// Query playlists with filtering and pagination
    #[allow(unused_variables)] // Variables used for dynamic SQL building
    pub async fn query_playlists(&self, query: PlaylistQuery) -> Result<Vec<PlaylistWithCount>> {
        let mut sql = String::from(
            r#"
            SELECT p.*, COUNT(ps.id) as song_count
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            LEFT JOIN songs s ON ps.song_id = s.id AND s.deleted_at IS NULL
            WHERE p.deleted_at IS NULL
            "#,
        );

        let mut bind_count = 0;

        if let Some(title_search) = &query.title_search {
            bind_count += 1;
            sql.push_str(&format!(" AND p.title ILIKE ${}", bind_count));
        }

        if let Some(true) = query.public_only {
            sql.push_str(" AND p.is_public = true");
        }

        if let Some(client_id) = &query.client_id {
            bind_count += 1;
            sql.push_str(&format!(" AND p.client_id = ${}", bind_count));
        }

        if let Some(created_after) = query.created_after {
            bind_count += 1;
            sql.push_str(&format!(" AND p.created_at > ${}", bind_count));
        }

        if let Some(updated_after) = query.updated_after {
            bind_count += 1;
            sql.push_str(&format!(" AND p.updated_at > ${}", bind_count));
        }

        // GROUP BY
        sql.push_str(" GROUP BY p.id ORDER BY p.updated_at DESC");

        if let Some(limit) = query.limit {
            bind_count += 1;
            sql.push_str(&format!(" LIMIT ${}", bind_count));
        }

        if let Some(offset) = query.offset {
            bind_count += 1;
            sql.push_str(&format!(" OFFSET ${}", bind_count));
        }

        // Build query with bindings
        let mut query_builder = sqlx::query(&sql);

        if let Some(title_search) = &query.title_search {
            query_builder = query_builder.bind(format!("%{}%", title_search));
        }
        if let Some(client_id) = &query.client_id {
            query_builder = query_builder.bind(client_id);
        }
        if let Some(created_after) = query.created_after {
            query_builder = query_builder.bind(created_after);
        }
        if let Some(updated_after) = query.updated_after {
            query_builder = query_builder.bind(updated_after);
        }
        if let Some(limit) = query.limit {
            query_builder = query_builder.bind(limit);
        }
        if let Some(offset) = query.offset {
            query_builder = query_builder.bind(offset);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let playlists = rows
            .into_iter()
            .map(|row| {
                let playlist = Playlist {
                    id: row.get("id"),
                    title: row.get("title"),
                    description: row.get("description"),
                    client_id: row.get("client_id"),
                    is_public: row.get("is_public"),
                    is_collaborative: row.get("is_collaborative"),
                    media_blob_id: row.get("media_blob_id"),
                    thumbnail_blob_id: row.get("thumbnail_blob_id"),
                    metadata: row.get("metadata"),
                    deleted_at: row.get("deleted_at"),
                    deleted_by: row.get("deleted_by"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    version: row.get("version"),
                };

                let song_count: i64 = row.get("song_count");

                PlaylistWithCount {
                    playlist,
                    song_count,
                }
            })
            .collect();

        Ok(playlists)
    }

    /// Create a new playlist
    pub async fn create_playlist(&self, params: CreatePlaylist) -> Result<Playlist> {
        params
            .validate()
            .map_err(|e| MusicRepositoryError::Validation(e.to_string()))?;

        // Check for duplicate title
        let existing = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM playlists WHERE title = $1 AND deleted_at IS NULL)",
        )
        .bind(&params.title)
        .fetch_one(&self.pool)
        .await?;

        if existing {
            return Err(MusicRepositoryError::DuplicatePlaylistTitle(
                params.title.clone(),
            ));
        }

        let playlist = sqlx::query_as::<_, Playlist>(
            r#"
            INSERT INTO playlists (title, description, client_id, is_public, is_collaborative, metadata, media_blob_id, thumbnail_blob_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&params.title)
        .bind(&params.description)
        .bind(&params.client_id)
        .bind(params.is_public.unwrap_or(false))
        .bind(params.is_collaborative.unwrap_or(false))
        .bind(params.metadata.unwrap_or(serde_json::json!({})))
        .bind(&params.media_blob_id)
        .bind(&params.thumbnail_blob_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(playlist)
    }

    /// Update a playlist
    pub async fn update_playlist(&self, id: Uuid, params: UpdatePlaylist) -> Result<Playlist> {
        params
            .validate()
            .map_err(|e| MusicRepositoryError::Validation(e.to_string()))?;

        // If updating title, check for duplicates
        if let Some(new_title) = &params.title {
            let existing = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM playlists WHERE title = $1 AND id != $2 AND deleted_at IS NULL)",
            )
            .bind(new_title)
            .bind(id)
            .fetch_one(&self.pool)
            .await?;

            if existing {
                return Err(MusicRepositoryError::DuplicatePlaylistTitle(
                    new_title.clone(),
                ));
            }
        }

        let mut sql = String::from("UPDATE playlists SET updated_at = NOW()");
        let mut bind_count = 0;

        if params.title.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", title = ${}", bind_count));
        }

        if params.description.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", description = ${}", bind_count));
        }

        if params.is_public.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", is_public = ${}", bind_count));
        }

        if params.is_collaborative.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", is_collaborative = ${}", bind_count));
        }

        if params.metadata.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", metadata = ${}", bind_count));
        }

        if params.media_blob_id.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", media_blob_id = ${}", bind_count));
        }

        if params.thumbnail_blob_id.is_some() {
            bind_count += 1;
            sql.push_str(&format!(", thumbnail_blob_id = ${}", bind_count));
        }

        bind_count += 1;
        sql.push_str(&format!(
            " WHERE id = ${} AND deleted_at IS NULL RETURNING *",
            bind_count
        ));

        // Build query with bindings
        let mut query_builder = sqlx::query_as::<_, Playlist>(&sql);

        if let Some(title) = &params.title {
            query_builder = query_builder.bind(title);
        }
        if let Some(description) = &params.description {
            query_builder = query_builder.bind(description);
        }
        if let Some(is_public) = params.is_public {
            query_builder = query_builder.bind(is_public);
        }
        if let Some(is_collaborative) = params.is_collaborative {
            query_builder = query_builder.bind(is_collaborative);
        }
        if let Some(metadata) = &params.metadata {
            query_builder = query_builder.bind(metadata);
        }
        if let Some(media_blob_id) = &params.media_blob_id {
            query_builder = query_builder.bind(media_blob_id);
        }
        if let Some(thumbnail_blob_id) = &params.thumbnail_blob_id {
            query_builder = query_builder.bind(thumbnail_blob_id);
        }
        query_builder = query_builder.bind(id);

        let playlist = query_builder
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MusicRepositoryError::PlaylistNotFound(id))?;

        Ok(playlist)
    }

    /// Soft delete a playlist
    pub async fn delete_playlist(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE playlists SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL"
        )
        .bind(deleted_by)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Get songs in a playlist
    pub async fn get_playlist_songs(&self, playlist_id: Uuid) -> Result<Vec<PlaylistSongDetail>> {
        let rows = sqlx::query(
            r#"
            SELECT
                ps.id as playlist_song_id,
                ps.position,
                ps.created_at as added_at,
                ps.added_by_client_id,
                s.*
            FROM playlist_songs ps
            JOIN songs s ON ps.song_id = s.id
            WHERE ps.playlist_id = $1
            AND ps.deleted_at IS NULL
            AND s.deleted_at IS NULL
            ORDER BY ps.position
            "#,
        )
        .bind(playlist_id)
        .fetch_all(&self.pool)
        .await?;

        let songs = rows
            .into_iter()
            .map(|row| {
                let song = Song {
                    id: row.get("id"),
                    media_blob_id: row.get("media_blob_id"),
                    thumbnail_blob_id: row.get("thumbnail_blob_id"),
                    waveform_blob_id: row.get("waveform_blob_id"),
                    thumbnail_blob_ids: row.get("thumbnail_blob_ids"),
                    title: row.get("title"),
                    artist: row.get("artist"),
                    album: row.get("album"),
                    album_artist: row.get("album_artist"),
                    track_number: row.get("track_number"),
                    disc_number: row.get("disc_number"),
                    duration: row.get("duration"),
                    genre: row.get("genre"),
                    sub_genres: row.get("sub_genres"),
                    year: row.get("year"),
                    bpm: row.get("bpm"),
                    key_signature: row.get("key_signature"),
                    rating: row.get("rating"),
                    is_favorite: row.get("is_favorite"),
                    tags: row.get("tags"),
                    metadata: row.get("metadata"),
                    processing_status: row.get("processing_status"),
                    processing_notes: row.get("processing_notes"),
                    deleted_at: row.get("deleted_at"),
                    deleted_by: row.get("deleted_by"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    version: row.get("version"),
                };

                PlaylistSongDetail {
                    position: row.get("position"),
                    added_at: row.get("added_at"),
                    added_by_client_id: row.get("added_by_client_id"),
                    song,
                }
            })
            .collect();

        Ok(songs)
    }

    /// Add songs to a playlist
    pub async fn add_songs_to_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: &[Uuid],
        client_id: Option<String>,
    ) -> Result<Vec<PlaylistSong>> {
        let mut added_songs = Vec::new();

        for &song_id in song_ids {
            // Get the next position
            let next_position = sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1",
            )
            .bind(playlist_id)
            .fetch_one(&self.pool)
            .await?;

            let playlist_song = sqlx::query_as::<_, PlaylistSong>(
                "INSERT INTO playlist_songs (playlist_id, song_id, position, added_by_client_id) VALUES ($1, $2, $3, $4) RETURNING *"
            )
            .bind(playlist_id)
            .bind(song_id)
            .bind(next_position)
            .bind(&client_id)
            .fetch_one(&self.pool)
            .await?;

            added_songs.push(playlist_song);
        }

        Ok(added_songs)
    }

    /// Remove songs from a playlist (soft delete)
    pub async fn remove_songs_from_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: &[Uuid],
        user_id: Uuid,
    ) -> Result<u64> {
        let mut total_removed = 0;

        for &song_id in song_ids {
            let result = sqlx::query(
                "UPDATE playlist_songs SET deleted_at = NOW(), deleted_by = $3
                 WHERE playlist_id = $1 AND song_id = $2 AND deleted_at IS NULL",
            )
            .bind(playlist_id)
            .bind(song_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

            total_removed += result.rows_affected();
        }

        // Reorder positions to fill gaps (only for active songs)
        sqlx::query(
            r#"
            UPDATE playlist_songs
            SET position = new_position
            FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY position) as new_position
                FROM playlist_songs
                WHERE playlist_id = $1 AND deleted_at IS NULL
            ) AS numbered
            WHERE playlist_songs.id = numbered.id
            "#,
        )
        .bind(playlist_id)
        .execute(&self.pool)
        .await?;

        Ok(total_removed)
    }

    /// Get song count in a playlist
    pub async fn get_playlist_song_count(&self, playlist_id: Uuid) -> Result<i64> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM playlist_songs ps JOIN songs s ON ps.song_id = s.id WHERE ps.playlist_id = $1 AND ps.deleted_at IS NULL AND s.deleted_at IS NULL"
        )
        .bind(playlist_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Check if a song is in a playlist
    pub async fn is_song_in_playlist(&self, playlist_id: Uuid, song_id: Uuid) -> Result<bool> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM playlist_songs ps JOIN songs s ON ps.song_id = s.id WHERE ps.playlist_id = $1 AND ps.song_id = $2 AND ps.deleted_at IS NULL AND s.deleted_at IS NULL)"
        )
        .bind(playlist_id)
        .bind(song_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(exists)
    }

    /// Get playlist summaries using the playlist_summary view
    pub async fn get_playlist_summaries(&self, limit: Option<i64>) -> Result<Vec<PlaylistSummary>> {
        let mut query = "SELECT * FROM playlist_summary ORDER BY created_at DESC".to_string();

        if let Some(limit) = limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }

        let summaries = sqlx::query_as::<_, PlaylistSummary>(&query)
            .fetch_all(&self.pool)
            .await?;

        Ok(summaries)
    }

    /// Get complete playlist data using playlist_complete view
    pub async fn get_playlist_complete(&self, playlist_id: Uuid) -> Result<PlaylistComplete> {
        let playlist =
            sqlx::query_as::<_, PlaylistComplete>("SELECT * FROM playlist_complete WHERE id = $1")
                .bind(playlist_id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(MusicRepositoryError::PlaylistNotFound(playlist_id))?;

        Ok(playlist)
    }

    /// Get playlist songs using the get_playlist_songs function
    pub async fn get_playlist_songs_with_media(
        &self,
        playlist_id: Uuid,
    ) -> Result<Vec<PlaylistSongWithMedia>> {
        let songs = sqlx::query_as::<_, PlaylistSongWithMedia>(
            "SELECT * FROM get_playlist_songs($1) ORDER BY position",
        )
        .bind(playlist_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Update song position in playlist (the trigger will handle position management)
    pub async fn update_playlist_song_position(
        &self,
        playlist_id: Uuid,
        song_id: Uuid,
        new_position: i32,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND song_id = $3",
        )
        .bind(new_position)
        .bind(playlist_id)
        .bind(song_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Move song to different position in playlist
    pub async fn move_playlist_song(
        &self,
        playlist_id: Uuid,
        song_id: Uuid,
        new_position: i32,
    ) -> Result<()> {
        self.update_playlist_song_position(playlist_id, song_id, new_position)
            .await
    }

    /// Get songs by album order using the SQL function
    pub async fn get_songs_by_album_order(
        &self,
        album_filter: Option<String>,
        artist_filter: Option<String>,
        max_results: Option<i32>,
    ) -> Result<Vec<AlbumTrack>> {
        let tracks =
            sqlx::query_as::<_, AlbumTrack>("SELECT * FROM get_songs_by_album_order($1, $2, $3)")
                .bind(album_filter)
                .bind(artist_filter)
                .bind(max_results.unwrap_or(100))
                .fetch_all(&self.pool)
                .await?;

        Ok(tracks)
    }

    /// Get album summaries
    pub async fn get_album_summaries(&self, limit: Option<i64>) -> Result<Vec<AlbumSummary>> {
        tracing::debug!("get_album_summaries called with limit: {:?}", limit);

        let mut query =
            "SELECT * FROM album_summary ORDER BY year DESC NULLS LAST, album".to_string();

        if let Some(limit) = limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }

        tracing::debug!("Executing query: {}", query);

        let albums = sqlx::query_as::<_, AlbumSummary>(&query)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| {
                tracing::error!("Database error in get_album_summaries: {:?}", e);
                e
            })?;

        tracing::debug!("Retrieved {} albums from database", albums.len());
        Ok(albums)
    }

    /// Get album tracks using the SQL function
    pub async fn get_album_tracks(
        &self,
        album_name: &str,
        artist_name: Option<&str>,
    ) -> Result<Vec<AlbumTrack>> {
        let tracks = sqlx::query_as::<_, AlbumTrack>("SELECT * FROM get_album_tracks($1, $2)")
            .bind(album_name)
            .bind(artist_name)
            .fetch_all(&self.pool)
            .await?;

        Ok(tracks)
    }

    /// Get artist albums using the SQL function
    pub async fn get_artist_albums(
        &self,
        artist_name: &str,
        max_results: Option<i32>,
    ) -> Result<Vec<ArtistAlbum>> {
        let albums = sqlx::query_as::<_, ArtistAlbum>("SELECT * FROM get_artist_albums($1, $2)")
            .bind(artist_name)
            .bind(max_results.unwrap_or(50))
            .fetch_all(&self.pool)
            .await?;

        Ok(albums)
    }

    /// Reorder entire playlist by providing new song order
    pub async fn reorder_playlist(
        &self,
        playlist_id: Uuid,
        song_ids_ordered: &[Uuid],
    ) -> Result<()> {
        // Start transaction to ensure atomicity
        let mut tx = self.pool.begin().await?;

        // Update positions for all songs in the playlist
        for (index, &song_id) in song_ids_ordered.iter().enumerate() {
            let new_position = (index + 1) as i32;

            sqlx::query(
                "UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND song_id = $3",
            )
            .bind(new_position)
            .bind(playlist_id)
            .bind(song_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Add song at specific position (trigger will handle shifting)
    pub async fn add_song_at_position(
        &self,
        playlist_id: Uuid,
        song_id: Uuid,
        position: i32,
        client_id: Option<String>,
    ) -> Result<PlaylistSong> {
        let playlist_song = sqlx::query_as::<_, PlaylistSong>(
            "INSERT INTO playlist_songs (playlist_id, song_id, position, added_by_client_id) VALUES ($1, $2, $3, $4) RETURNING *"
        )
        .bind(playlist_id)
        .bind(song_id)
        .bind(position)
        .bind(&client_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(playlist_song)
    }

    /// Get comprehensive database statistics for CLI status commands
    pub async fn get_database_stats(&self) -> Result<MusicDatabaseStats> {
        // Count songs
        let song_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
            .fetch_one(&self.pool)
            .await?;

        // Count media blobs
        let media_blob_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_blobs")
            .fetch_one(&self.pool)
            .await?;

        // Count thumbnail blobs
        let thumbnail_blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM songs WHERE thumbnail_blob_id IS NOT NULL AND deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(MusicDatabaseStats {
            song_count,
            media_blob_count,
            thumbnail_blob_count,
            scan_session_count: 0,
        })
    }

    /// Get recent songs with thumbnail status for debugging
    pub async fn get_recent_songs_with_thumbnails(
        &self,
        limit: i64,
    ) -> Result<Vec<RecentSongWithThumbnail>> {
        let songs = sqlx::query_as::<_, RecentSongWithThumbnail>(
            r#"
            SELECT
                id, title, artist, album, thumbnail_blob_id, created_at,
                CASE WHEN thumbnail_blob_id IS NOT NULL THEN true ELSE false END as has_thumbnail
            FROM songs
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Get thumbnail blob ID for a specific song
    pub async fn get_song_thumbnail_id(&self, song_id: Uuid) -> Result<Option<String>> {
        let thumbnail_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT thumbnail_blob_id FROM songs WHERE id = $1",
        )
        .bind(song_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(thumbnail_id)
    }

    /// Get available tags with pagination and usage counts
    pub async fn get_available_tags(
        &self,
        page: u32,
        page_size: u32,
    ) -> Result<Vec<(String, u32)>> {
        let offset = (page - 1) * page_size;

        // Use a query that works with PostgreSQL text[] arrays
        let tags = match sqlx::query_as::<_, (String, i64)>(
            r#"
            SELECT tag_value, COUNT(*) as usage_count
            FROM (
                SELECT unnest(s.tags) as tag_value
                FROM songs s
                WHERE s.tags IS NOT NULL
                  AND array_length(s.tags, 1) > 0
                  AND s.deleted_at IS NULL
            ) tag_counts
            WHERE tag_value IS NOT NULL AND tag_value != ''
            GROUP BY tag_value
            ORDER BY usage_count DESC, tag_value ASC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await
        {
            Ok(tags) => tags,
            Err(e) => {
                tracing::error!("Failed to fetch available tags: {:?}", e);
                // Return empty result on error instead of propagating
                return Ok(vec![]);
            }
        };

        Ok(tags
            .into_iter()
            .map(|(tag, count)| (tag, count as u32))
            .collect())
    }

    /// Get total count of unique tags
    pub async fn get_total_tags_count(&self) -> Result<u32> {
        let count = match sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(DISTINCT tag_value)
            FROM (
                SELECT unnest(s.tags) as tag_value
                FROM songs s
                WHERE s.tags IS NOT NULL
                  AND array_length(s.tags, 1) > 0
                  AND s.deleted_at IS NULL
            ) all_tags
            WHERE tag_value IS NOT NULL AND tag_value != ''
            "#,
        )
        .fetch_one(&self.pool)
        .await
        {
            Ok(count) => count,
            Err(e) => {
                tracing::error!("Failed to get total tags count: {:?}", e);
                // Return 0 on error instead of propagating
                return Ok(0);
            }
        };

        Ok(count as u32)
    }

    /// Create a song record with full metadata (used during scanning)
    pub async fn create_song_with_metadata(
        &self,
        media_blob_id: &str,
        title: &str,
        artist: Option<&str>,
        album: Option<&str>,
        album_artist: Option<&str>,
        track_number: Option<i32>,
        disc_number: Option<i32>,
        duration: Option<std::time::Duration>,
        genre: Option<&str>,
        year: Option<i32>,
        thumbnail_blob_id: Option<&str>,
        waveform_blob_id: Option<&str>,
    ) -> Result<Song> {
        let duration_interval = duration.map(|d| format!("{} seconds", d.as_secs()));

        let song = sqlx::query_as::<_, Song>(
            r#"
            INSERT INTO songs (
                media_blob_id, title, artist, album, album_artist, track_number, disc_number,
                duration, genre, year, thumbnail_blob_id, waveform_blob_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::interval, $9, $10, $11, $12)
            RETURNING *
            "#,
        )
        .bind(media_blob_id)
        .bind(title)
        .bind(artist)
        .bind(album)
        .bind(album_artist)
        .bind(track_number)
        .bind(disc_number)
        .bind(duration_interval)
        .bind(genre)
        .bind(year)
        .bind(thumbnail_blob_id)
        .bind(waveform_blob_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(song)
    }

    /// Create a song record with full metadata including waveform (used during scanning)
    pub async fn create_song_with_waveform_metadata(
        &self,
        media_blob_id: &str,
        title: &str,
        artist: Option<&str>,
        album: Option<&str>,
        album_artist: Option<&str>,
        track_number: Option<i32>,
        disc_number: Option<i32>,
        duration: Option<std::time::Duration>,
        genre: Option<&str>,
        year: Option<i32>,
        thumbnail_blob_id: Option<&str>,
        waveform_blob_id: Option<&str>,
    ) -> Result<Song> {
        let duration_interval = duration.map(|d| format!("{} seconds", d.as_secs()));

        let song = sqlx::query_as::<_, Song>(
            r#"
            INSERT INTO songs (
                media_blob_id, title, artist, album, album_artist, track_number, disc_number,
                duration, genre, year, thumbnail_blob_id, waveform_blob_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::interval, $9, $10, $11, $12)
            RETURNING *
            "#,
        )
        .bind(media_blob_id)
        .bind(title)
        .bind(artist)
        .bind(album)
        .bind(album_artist)
        .bind(track_number)
        .bind(disc_number)
        .bind(duration_interval)
        .bind(genre)
        .bind(year)
        .bind(thumbnail_blob_id)
        .bind(waveform_blob_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(song)
    }

    /// Update thumbnail_blob_ids array for a song (used for directory album art)
    pub async fn update_song_thumbnail_blob_ids(
        &self,
        song_id: Uuid,
        thumbnail_blob_ids: &[String],
    ) -> Result<()> {
        sqlx::query("UPDATE songs SET thumbnail_blob_ids = $1, updated_at = NOW() WHERE id = $2")
            .bind(thumbnail_blob_ids)
            .bind(song_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Get songs in a directory that are missing thumbnails
    pub async fn get_songs_without_thumbnails_by_paths(
        &self,
        file_paths: &[String],
    ) -> Result<Vec<Uuid>> {
        if file_paths.is_empty() {
            return Ok(Vec::new());
        }

        let songs = sqlx::query(
            r#"
            SELECT s.id
            FROM songs s
            JOIN media_blobs mb ON s.media_blob_id = mb.id
            WHERE mb.local_path = ANY($1)
            AND s.thumbnail_blob_id IS NULL
            AND s.deleted_at IS NULL
            "#,
        )
        .bind(file_paths)
        .fetch_all(&self.pool)
        .await?;

        let song_ids = songs
            .into_iter()
            .map(|row| row.get::<Uuid, _>("id"))
            .collect();

        Ok(song_ids)
    }

    /// Get songs with pagination
    pub async fn get_songs_paginated(&self, limit: i64, offset: i64) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            r#"
            SELECT * FROM songs
            WHERE deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Get songs for musicbrainz batch scanning with various filters
    pub async fn get_songs_for_batch_scan(
        &self,
        limit: i64,
        offset: i64,
        unscanned_only: bool,
        rescan_updated: bool,
        force_rescan: bool,
        artist: Option<&str>,
        album: Option<&str>,
        missing_metadata: Option<&str>,
    ) -> Result<Vec<Song>> {
        let mut sql = String::from("SELECT * FROM songs WHERE deleted_at IS NULL");
        let mut params: Vec<String> = Vec::new();

        // filter by scan status
        if unscanned_only && !force_rescan {
            sql.push_str(
                " AND (metadata->>'musicbrainz' IS NULL OR metadata->>'musicbrainz' = '{}')",
            );
        } else if rescan_updated && !force_rescan {
            // TODO: add logic to compare updated_at with last scan timestamp
            sql.push_str(" AND updated_at > (metadata->'musicbrainz'->>'scanned_at')::timestamp");
        }

        // filter by artist
        if let Some(artist_filter) = artist {
            sql.push_str(" AND artist ILIKE $");
            sql.push_str(&(params.len() + 1).to_string());
            params.push(format!("%{}%", artist_filter));
        }

        // filter by album
        if let Some(album_filter) = album {
            sql.push_str(" AND album ILIKE $");
            sql.push_str(&(params.len() + 1).to_string());
            params.push(format!("%{}%", album_filter));
        }

        // filter by missing metadata
        if let Some(metadata_field) = missing_metadata {
            match metadata_field {
                "artist" => sql.push_str(" AND (artist IS NULL OR artist = '')"),
                "album" => sql.push_str(" AND (album IS NULL OR album = '')"),
                "genre" => sql.push_str(" AND (genre IS NULL OR genre = '')"),
                "title" => sql.push_str(" AND (title IS NULL OR title = '')"),
                _ => {
                    return Err(MusicRepositoryError::Validation(format!(
                        "unsupported missing metadata field: {}",
                        metadata_field
                    )))
                }
            }
        }

        sql.push_str(" ORDER BY created_at ASC LIMIT $");
        sql.push_str(&(params.len() + 1).to_string());
        sql.push_str(" OFFSET $");
        sql.push_str(&(params.len() + 2).to_string());

        // execute the built query with parameters
        let mut query = sqlx::query_as::<_, Song>(&sql);

        // add string parameters in order
        for param in params {
            query = query.bind(param);
        }

        // add integer parameters at the end
        query = query.bind(limit);
        query = query.bind(offset);

        let songs = query.fetch_all(&self.pool).await?;
        Ok(songs)
    }

    /// Find songs by album name
    pub async fn find_songs_by_album(&self, album: &str) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            "SELECT * FROM songs WHERE album ILIKE $1 AND deleted_at IS NULL ORDER BY track_number, title"
        )
        .bind(format!("%{}%", album))
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Find songs by artist and album name
    pub async fn find_songs_by_artist_and_album(
        &self,
        artist: &str,
        album: &str,
    ) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            "SELECT * FROM songs WHERE artist ILIKE $1 AND album ILIKE $2 AND deleted_at IS NULL ORDER BY track_number, title"
        )
        .bind(format!("%{}%", artist))
        .bind(format!("%{}%", album))
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Get songs with missing or poor metadata
    pub async fn get_songs_with_missing_metadata(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            r#"
            SELECT * FROM songs
            WHERE deleted_at IS NULL
            AND (
                artist IS NULL
                OR album IS NULL
                OR duration IS NULL
                OR artist = ''
                OR album = ''
            )
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Get songs by media blob ID
    pub async fn get_songs_by_media_blob_id(&self, media_blob_id: &str) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            r#"
            SELECT * FROM songs
            WHERE media_blob_id = $1
            AND deleted_at IS NULL
            "#,
        )
        .bind(media_blob_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Update song metadata fields
    pub async fn update_song_metadata(
        &self,
        song_id: Uuid,
        artist: Option<&str>,
        album: Option<&str>,
        album_artist: Option<&str>,
        track_number: Option<i32>,
        disc_number: Option<i32>,
        duration: Option<std::time::Duration>,
        genre: Option<&str>,
        year: Option<i32>,
    ) -> Result<Song> {
        let duration_interval = duration.map(|d| format!("{} seconds", d.as_secs()));

        let song = sqlx::query_as::<_, Song>(
            r#"
            UPDATE songs
            SET
                artist = COALESCE($1, artist),
                album = COALESCE($2, album),
                album_artist = COALESCE($3, album_artist),
                track_number = COALESCE($4, track_number),
                disc_number = COALESCE($5, disc_number),
                duration = COALESCE($6::interval, duration),
                genre = COALESCE($7, genre),
                year = COALESCE($8, year),
                updated_at = NOW()
            WHERE id = $9
            RETURNING *
            "#,
        )
        .bind(artist)
        .bind(album)
        .bind(album_artist)
        .bind(track_number)
        .bind(disc_number)
        .bind(duration_interval)
        .bind(genre)
        .bind(year)
        .bind(song_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(song)
    }

    /// Safely reorder playlist using the SQL function that handles triggers
    pub async fn reorder_playlist_by_function(
        &self,
        playlist_id: Uuid,
        song_ids_ordered: &[Uuid],
    ) -> Result<()> {
        sqlx::query!(
            "SELECT reorder_playlist_positions($1, $2)",
            playlist_id,
            song_ids_ordered
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get count of songs in the database
    pub async fn get_song_count(&self) -> Result<i64> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
            .fetch_one(&self.pool)
            .await?;

        Ok(count)
    }

    pub async fn get_playlist_count(&self) -> Result<i64> {
        let count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlists WHERE deleted_at IS NULL")
                .fetch_one(&self.pool)
                .await?;

        Ok(count)
    }

    /// Get count of scan sessions
    pub async fn get_scan_session_count(&self) -> Result<i64> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM music_scan_sessions")
            .fetch_one(&self.pool)
            .await?;

        Ok(count)
    }

    // Generation methods

    /// Get songs for waveform generation
    pub async fn get_songs_for_waveform_generation(
        &self,
        limit: i32,
        force: bool,
    ) -> Result<Vec<Song>> {
        let sql = if force {
            "SELECT * FROM songs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1"
        } else {
            "SELECT * FROM songs WHERE deleted_at IS NULL AND waveform_blob_id IS NULL ORDER BY created_at DESC LIMIT $1"
        };

        let songs = sqlx::query_as::<_, Song>(sql)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        Ok(songs)
    }

    /// Get songs for directory art generation
    pub async fn get_songs_for_directory_art_generation(
        &self,
        limit: i32,
        force: bool,
    ) -> Result<Vec<Song>> {
        let sql = if force {
            "SELECT * FROM songs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1"
        } else {
            "SELECT * FROM songs WHERE deleted_at IS NULL AND thumbnail_blob_id IS NULL ORDER BY created_at DESC LIMIT $1"
        };

        let songs = sqlx::query_as::<_, Song>(sql)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        Ok(songs)
    }

    /// Update song with waveform blob ID
    pub async fn update_song_waveform_blob_id(
        &self,
        song_id: Uuid,
        waveform_blob_id: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE songs SET waveform_blob_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(waveform_blob_id)
            .bind(song_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Update song with thumbnail blob ID (only if currently null)
    pub async fn update_song_thumbnail_blob_id_if_null(
        &self,
        song_id: Uuid,
        thumbnail_blob_id: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE songs SET thumbnail_blob_id = $1, updated_at = NOW() WHERE id = $2 AND thumbnail_blob_id IS NULL")
            .bind(thumbnail_blob_id)
            .bind(song_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    // Scanner methods

    /// Check if song has thumbnail
    pub async fn song_has_thumbnail(&self, song_id: Uuid) -> Result<bool> {
        let has_thumbnail = sqlx::query_scalar::<_, bool>(
            "SELECT thumbnail_blob_id IS NOT NULL FROM songs WHERE id = $1",
        )
        .bind(song_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(has_thumbnail)
    }

    /// Get song's media blob ID
    pub async fn get_song_media_blob_id(&self, song_id: Uuid) -> Result<String> {
        let media_blob_id =
            sqlx::query_scalar::<_, String>("SELECT media_blob_id FROM songs WHERE id = $1")
                .bind(song_id)
                .fetch_one(&self.pool)
                .await?;

        Ok(media_blob_id)
    }

    /// Find song by media blob ID and update its thumbnail if null
    pub async fn link_thumbnail_to_song_by_media_blob(
        &self,
        media_blob_id: &str,
        thumbnail_id: &str,
    ) -> Result<Option<Uuid>> {
        let song_result = sqlx::query!(
            "SELECT id FROM songs WHERE media_blob_id = $1 AND thumbnail_blob_id IS NULL LIMIT 1",
            media_blob_id
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(song_row) = song_result {
            sqlx::query!(
                "UPDATE songs SET thumbnail_blob_id = $1, updated_at = NOW() WHERE id = $2",
                thumbnail_id,
                song_row.id
            )
            .execute(&self.pool)
            .await?;

            Ok(Some(song_row.id))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_song_query_construction() {
        let query = SongQuery {
            favorites_only: Some(true),
            artist: Some("Queen".to_string()),
            limit: Some(10),
            ..Default::default()
        };

        assert_eq!(query.favorites_only, Some(true));
        assert_eq!(query.artist, Some("Queen".to_string()));
        assert_eq!(query.limit, Some(10));
    }

    #[test]
    fn test_create_playlist_validation() {
        let create_playlist = CreatePlaylist {
            title: "Test Playlist".to_string(),
            description: Some("A test playlist".to_string()),
            client_id: None,
            is_public: Some(true),
            is_collaborative: Some(false),
            metadata: None,
            media_blob_id: None,
            thumbnail_blob_id: None,
        };

        assert!(create_playlist.validate().is_ok());
    }
}
