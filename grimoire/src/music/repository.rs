//! Music domain repository
//!
//! This module provides database access layer for songs and playlists,
//! including CRUD operations and queries with proper error handling.

use crate::music::models::{
    AlbumSummary, AlbumTrack, ArtistAlbum, CreatePlaylist, CreateSong, MusicDatabaseStats,
    Playlist, PlaylistComplete, PlaylistQuery, PlaylistSong, PlaylistSongDetail,
    PlaylistSongWithMedia, PlaylistSummary, PlaylistWithCount, RecentSongWithThumbnail, Song,
    SongQuery, SongWithMedia, UpdatePlaylist,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

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
    pub async fn query_songs(&self, query: SongQuery) -> Result<Vec<Song>> {
        let mut sql = String::from("SELECT * FROM songs WHERE deleted_at IS NULL");
        let mut bind_count = 0;

        if let Some(true) = query.favorites_only {
            sql.push_str(" AND is_favorite = true");
        }

        if query.artist.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND artist ILIKE ${}", bind_count));
        }

        if query.album.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND album ILIKE ${}", bind_count));
        }

        if query.genre.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND genre ILIKE ${}", bind_count));
        }

        if query.year.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND year = ${}", bind_count));
        }

        if query.rating_min.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND rating >= ${}", bind_count));
        }

        if query.title_search.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND title ILIKE ${}", bind_count));
        }

        if query.tags.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND tags && ${}", bind_count));
        }

        if query.created_after.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND created_at > ${}", bind_count));
        }

        if query.updated_after.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND updated_at > ${}", bind_count));
        }

        sql.push_str(" ORDER BY artist, album, track_number, title");

        if query.offset.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" OFFSET ${}", bind_count));
        }

        if query.limit.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" LIMIT ${}", bind_count));
        }

        let mut query_builder = sqlx::query_as::<_, Song>(&sql);

        if let Some(ref artist) = query.artist {
            query_builder = query_builder.bind(format!("%{}%", artist));
        }
        if let Some(ref album) = query.album {
            query_builder = query_builder.bind(format!("%{}%", album));
        }
        if let Some(ref genre) = query.genre {
            query_builder = query_builder.bind(format!("%{}%", genre));
        }
        if let Some(year) = query.year {
            query_builder = query_builder.bind(year);
        }
        if let Some(rating_min) = query.rating_min {
            query_builder = query_builder.bind(rating_min);
        }
        if let Some(ref title_search) = query.title_search {
            query_builder = query_builder.bind(format!("%{}%", title_search));
        }
        if let Some(ref tags) = query.tags {
            query_builder = query_builder.bind(tags);
        }
        if let Some(created_after) = query.created_after {
            query_builder = query_builder.bind(created_after);
        }
        if let Some(updated_after) = query.updated_after {
            query_builder = query_builder.bind(updated_after);
        }
        if let Some(offset) = query.offset {
            query_builder = query_builder.bind(offset);
        }
        if let Some(limit) = query.limit {
            query_builder = query_builder.bind(limit);
        }

        let songs = query_builder.fetch_all(&self.pool).await?;
        Ok(songs)
    }

    /// Create a new song
    pub async fn create_song(&self, params: CreateSong) -> Result<Song> {
        params
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        let song = sqlx::query_as::<_, Song>(
            r#"
            INSERT INTO songs (
                media_blob_id, thumbnail_blob_id, waveform_blob_id,
                title, artist, album, album_artist, track_number, disc_number,
                duration, genre, year, bpm, key_signature, rating, is_favorite,
                tags, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
            "#,
        )
        .bind(params.media_blob_id)
        .bind(params.thumbnail_blob_id)
        .bind(params.waveform_blob_id)
        .bind(params.title)
        .bind(params.artist)
        .bind(params.album)
        .bind(params.album_artist)
        .bind(params.track_number)
        .bind(params.disc_number)
        .bind(params.duration)
        .bind(params.genre)
        .bind(params.year)
        .bind(params.bpm)
        .bind(params.key_signature)
        .bind(params.rating)
        .bind(params.is_favorite.unwrap_or(false))
        .bind(params.tags.unwrap_or_default())
        .bind(params.metadata.unwrap_or(serde_json::Value::Null))
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

    /// Find playlists by title (exact or partial match)
    pub async fn find_playlists_by_title(
        &self,
        title: &str,
        exact_match: bool,
    ) -> Result<Vec<Playlist>> {
        let query = if exact_match {
            "SELECT * FROM playlists WHERE title = $1 AND deleted_at IS NULL ORDER BY created_at DESC"
        } else {
            "SELECT * FROM playlists WHERE title ILIKE $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10"
        };

        let search_term = if exact_match {
            title.to_string()
        } else {
            format!("%{}%", title)
        };

        let playlists = sqlx::query_as::<_, Playlist>(query)
            .bind(search_term)
            .fetch_all(&self.pool)
            .await?;

        Ok(playlists)
    }

    /// Query playlists with filtering and pagination
    pub async fn query_playlists(&self, query: PlaylistQuery) -> Result<Vec<PlaylistWithCount>> {
        let mut sql = String::from(
            r#"
            SELECT p.*, COUNT(ps.song_id) as song_count
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            WHERE p.deleted_at IS NULL
            "#,
        );
        let mut bind_count = 0;

        if let Some(true) = query.public_only {
            sql.push_str(" AND p.is_public = true");
        }

        if query.client_id.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND p.client_id = ${}", bind_count));
        }

        if query.title_search.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND p.title ILIKE ${}", bind_count));
        }

        if query.created_after.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND p.created_at > ${}", bind_count));
        }

        if query.updated_after.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" AND p.updated_at > ${}", bind_count));
        }

        sql.push_str(" GROUP BY p.id ORDER BY p.created_at DESC");

        if query.offset.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" OFFSET ${}", bind_count));
        }

        if query.limit.is_some() {
            bind_count += 1;
            sql.push_str(&format!(" LIMIT ${}", bind_count));
        }

        let mut query_builder = sqlx::query(&sql);

        if let Some(ref client_id) = query.client_id {
            query_builder = query_builder.bind(client_id);
        }
        if let Some(ref title_search) = query.title_search {
            query_builder = query_builder.bind(format!("%{}%", title_search));
        }
        if let Some(created_after) = query.created_after {
            query_builder = query_builder.bind(created_after);
        }
        if let Some(updated_after) = query.updated_after {
            query_builder = query_builder.bind(updated_after);
        }
        if let Some(offset) = query.offset {
            query_builder = query_builder.bind(offset);
        }
        if let Some(limit) = query.limit {
            query_builder = query_builder.bind(limit);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut playlists = Vec::new();
        for row in rows {
            let playlist = Playlist {
                id: row.get("id"),
                media_blob_id: row.get("media_blob_id"),
                thumbnail_blob_id: row.get("thumbnail_blob_id"),
                title: row.get("title"),
                description: row.get("description"),
                client_id: row.get("client_id"),
                is_public: row.get("is_public"),
                is_collaborative: row.get("is_collaborative"),
                metadata: row.get("metadata"),
                deleted_at: row.get("deleted_at"),
                deleted_by: row.get("deleted_by"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                version: row.get("version"),
            };
            let song_count: i64 = row.get("song_count");

            playlists.push(PlaylistWithCount {
                playlist,
                song_count,
            });
        }

        Ok(playlists)
    }

    /// Create a new playlist
    pub async fn create_playlist(&self, params: CreatePlaylist) -> Result<Playlist> {
        params
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        // Check for duplicate title
        if !self
            .find_playlists_by_title(&params.title, true)
            .await?
            .is_empty()
        {
            return Err(MusicRepositoryError::DuplicatePlaylistTitle(params.title));
        }

        let playlist = sqlx::query_as::<_, Playlist>(
            r#"
            INSERT INTO playlists (title, description, client_id, is_public, is_collaborative, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(params.title)
        .bind(params.description)
        .bind(params.client_id)
        .bind(params.is_public.unwrap_or(false))
        .bind(params.is_collaborative.unwrap_or(false))
        .bind(params.metadata.unwrap_or(serde_json::Value::Null))
        .fetch_one(&self.pool)
        .await?;

        Ok(playlist)
    }

    /// Update a playlist
    pub async fn update_playlist(&self, id: Uuid, params: UpdatePlaylist) -> Result<Playlist> {
        params
            .validate()
            .map_err(MusicRepositoryError::Validation)?;

        // Check for duplicate title if updating title
        if let Some(ref new_title) = params.title {
            let existing = self.find_playlists_by_title(new_title, true).await?;
            if !existing.is_empty() && existing[0].id != id {
                return Err(MusicRepositoryError::DuplicatePlaylistTitle(
                    new_title.clone(),
                ));
            }
        }

        let mut sql = String::from("UPDATE playlists SET updated_at = NOW()");
        let mut param_count = 0;

        if params.title.is_some() {
            param_count += 1;
            sql.push_str(&format!(", title = ${}", param_count));
        }
        if params.description.is_some() {
            param_count += 1;
            sql.push_str(&format!(", description = ${}", param_count));
        }
        if params.is_public.is_some() {
            param_count += 1;
            sql.push_str(&format!(", is_public = ${}", param_count));
        }
        if params.is_collaborative.is_some() {
            param_count += 1;
            sql.push_str(&format!(", is_collaborative = ${}", param_count));
        }
        if params.metadata.is_some() {
            param_count += 1;
            sql.push_str(&format!(", metadata = ${}", param_count));
        }

        param_count += 1;
        sql.push_str(&format!(
            " WHERE id = ${} AND deleted_at IS NULL RETURNING *",
            param_count
        ));

        let mut query_builder = sqlx::query_as::<_, Playlist>(&sql);

        if let Some(ref title) = params.title {
            query_builder = query_builder.bind(title);
        }
        if let Some(ref description) = params.description {
            query_builder = query_builder.bind(description);
        }
        if let Some(is_public) = params.is_public {
            query_builder = query_builder.bind(is_public);
        }
        if let Some(is_collaborative) = params.is_collaborative {
            query_builder = query_builder.bind(is_collaborative);
        }
        if let Some(ref metadata) = params.metadata {
            query_builder = query_builder.bind(metadata);
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

    // Playlist song operations

    /// Get songs in a playlist
    pub async fn get_playlist_songs(&self, playlist_id: Uuid) -> Result<Vec<PlaylistSongDetail>> {
        let rows = sqlx::query(
            r#"
            SELECT
                ps.position, ps.created_at as added_at, ps.added_by_client_id,
                s.*
            FROM playlist_songs ps
            JOIN songs s ON ps.song_id = s.id
            WHERE ps.playlist_id = $1 AND s.deleted_at IS NULL
            ORDER BY ps.position
            "#,
        )
        .bind(playlist_id)
        .fetch_all(&self.pool)
        .await?;

        let mut playlist_songs = Vec::new();
        for row in rows {
            let song = Song {
                id: row.get("id"),
                media_blob_id: row.get("media_blob_id"),
                thumbnail_blob_id: row.get("thumbnail_blob_id"),
                waveform_blob_id: row.get("waveform_blob_id"),
                title: row.get("title"),
                artist: row.get("artist"),
                album: row.get("album"),
                album_artist: row.get("album_artist"),
                track_number: row.get("track_number"),
                disc_number: row.get("disc_number"),
                duration: row.get("duration"),
                genre: row.get("genre"),
                year: row.get("year"),
                bpm: row.get("bpm"),
                key_signature: row.get("key_signature"),
                rating: row.get("rating"),
                is_favorite: row.get("is_favorite"),
                tags: row.get("tags"),
                metadata: row.get("metadata"),
                deleted_at: row.get("deleted_at"),
                deleted_by: row.get("deleted_by"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                version: row.get("version"),
            };

            playlist_songs.push(PlaylistSongDetail {
                position: row.get("position"),
                song,
                added_at: row.get("added_at"),
                added_by_client_id: row.get("added_by_client_id"),
            });
        }

        Ok(playlist_songs)
    }

    /// Add songs to a playlist
    pub async fn add_songs_to_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: &[Uuid],
        client_id: Option<String>,
    ) -> Result<Vec<PlaylistSong>> {
        // Verify playlist exists
        self.get_playlist(playlist_id).await?;

        // Get current max position
        let max_position: Option<i32> =
            sqlx::query_scalar("SELECT MAX(position) FROM playlist_songs WHERE playlist_id = $1")
                .bind(playlist_id)
                .fetch_one(&self.pool)
                .await?;

        let mut next_position = max_position.unwrap_or(0) + 1;
        let mut added_songs = Vec::new();

        for &song_id in song_ids {
            // Verify song exists
            self.get_song(song_id).await?;

            // Check if already in playlist
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2)"
            )
            .bind(playlist_id)
            .bind(song_id)
            .fetch_one(&self.pool)
            .await?;

            if exists {
                return Err(MusicRepositoryError::SongAlreadyInPlaylist);
            }

            // Add song to playlist
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
            next_position += 1;
        }

        Ok(added_songs)
    }

    /// Remove songs from a playlist
    pub async fn remove_songs_from_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: &[Uuid],
    ) -> Result<u64> {
        let mut total_removed = 0;

        for &song_id in song_ids {
            let result =
                sqlx::query("DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2")
                    .bind(playlist_id)
                    .bind(song_id)
                    .execute(&self.pool)
                    .await?;

            total_removed += result.rows_affected();
        }

        // Reorder positions to fill gaps
        sqlx::query(
            r#"
            UPDATE playlist_songs
            SET position = new_position
            FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY position) as new_position
                FROM playlist_songs
                WHERE playlist_id = $1
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
            "SELECT COUNT(*) FROM playlist_songs ps JOIN songs s ON ps.song_id = s.id WHERE ps.playlist_id = $1 AND s.deleted_at IS NULL"
        )
        .bind(playlist_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Check if a song is in a playlist
    pub async fn is_song_in_playlist(&self, playlist_id: Uuid, song_id: Uuid) -> Result<bool> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM playlist_songs ps JOIN songs s ON ps.song_id = s.id WHERE ps.playlist_id = $1 AND ps.song_id = $2 AND s.deleted_at IS NULL)"
        )
        .bind(playlist_id)
        .bind(song_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(exists)
    }

    // SQL View and Function Methods

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
        let songs =
            sqlx::query_as::<_, PlaylistSongWithMedia>("SELECT * FROM get_playlist_songs($1)")
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
        to_position: i32,
    ) -> Result<()> {
        self.update_playlist_song_position(playlist_id, song_id, to_position)
            .await
    }

    /// Get songs by album order using the SQL function
    pub async fn get_songs_by_album_order(
        &self,
        album_filter: Option<String>,
        artist_filter: Option<String>,
        max_results: Option<i32>,
    ) -> Result<Vec<Song>> {
        let songs = sqlx::query_as::<_, Song>(
            "SELECT s.* FROM get_songs_by_album_order($1, $2, $3) gsao JOIN songs s ON gsao.song_id = s.id"
        )
        .bind(album_filter)
        .bind(artist_filter)
        .bind(max_results.unwrap_or(100))
        .fetch_all(&self.pool)
        .await?;

        Ok(songs)
    }

    /// Get album summaries
    pub async fn get_album_summaries(&self, limit: Option<i64>) -> Result<Vec<AlbumSummary>> {
        let mut query =
            "SELECT * FROM album_summary ORDER BY year DESC NULLS LAST, album".to_string();

        if let Some(limit) = limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }

        let albums = sqlx::query_as::<_, AlbumSummary>(&query)
            .fetch_all(&self.pool)
            .await?;

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

    // Administrative and operational methods

    /// Get comprehensive database statistics for CLI status commands
    pub async fn get_database_stats(&self) -> Result<MusicDatabaseStats> {
        // Count songs
        let song_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
            .fetch_one(&self.pool)
            .await?;

        // Count media blobs from music CLI
        let media_blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_blobs WHERE source_client_id = 'music-cli'",
        )
        .fetch_one(&self.pool)
        .await?;

        // Count thumbnail blobs from music CLI
        let thumbnail_blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM media_blobs WHERE source_client_id = 'music-cli-thumbnail'",
        )
        .fetch_one(&self.pool)
        .await?;

        // Count scan sessions
        let scan_session_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM music_scan_sessions")
                .fetch_one(&self.pool)
                .await?;

        Ok(MusicDatabaseStats {
            song_count,
            media_blob_count,
            thumbnail_blob_count,
            scan_session_count,
        })
    }

    /// Get recent songs with thumbnail status for debugging
    pub async fn get_recent_songs_with_thumbnails(
        &self,
        limit: i64,
    ) -> Result<Vec<RecentSongWithThumbnail>> {
        let songs = sqlx::query_as::<_, RecentSongWithThumbnail>(
            r#"
            SELECT id, title, artist, album, thumbnail_blob_id
            FROM songs
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

    /// Create a song record with full metadata (used during scanning)
    pub async fn create_song_with_metadata(
        &self,
        media_blob_id: &str,
        thumbnail_blob_id: Option<&str>,
        title: String,
        artist: Option<String>,
        album: Option<String>,
        album_artist: Option<String>,
        track_number: Option<i32>,
        disc_number: Option<i32>,
        genre: Option<String>,
        year: Option<i32>,
        metadata: serde_json::Value,
    ) -> Result<Uuid> {
        let song_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO songs (
                media_blob_id, thumbnail_blob_id, title, artist, album, album_artist,
                track_number, disc_number, genre, year, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
            "#,
        )
        .bind(media_blob_id)
        .bind(thumbnail_blob_id)
        .bind(title)
        .bind(artist)
        .bind(album)
        .bind(album_artist)
        .bind(track_number)
        .bind(disc_number)
        .bind(genre)
        .bind(year)
        .bind(metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(song_id)
    }

    /// Create a song record with full metadata including waveform (used during scanning)
    pub async fn create_song_with_waveform_metadata(
        &self,
        media_blob_id: &str,
        thumbnail_blob_id: Option<&str>,
        waveform_blob_id: Option<&str>,
        title: String,
        artist: Option<String>,
        album: Option<String>,
        album_artist: Option<String>,
        track_number: Option<i32>,
        disc_number: Option<i32>,
        genre: Option<String>,
        year: Option<i32>,
        metadata: serde_json::Value,
    ) -> Result<Uuid> {
        let song_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO songs (
                media_blob_id, thumbnail_blob_id, waveform_blob_id, title, artist, album, album_artist,
                track_number, disc_number, genre, year, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
            "#,
        )
        .bind(media_blob_id)
        .bind(thumbnail_blob_id)
        .bind(waveform_blob_id)
        .bind(title)
        .bind(artist)
        .bind(album)
        .bind(album_artist)
        .bind(track_number)
        .bind(disc_number)
        .bind(genre)
        .bind(year)
        .bind(metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(song_id)
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

    /// Get count of scan sessions
    pub async fn get_scan_session_count(&self) -> Result<i64> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM music_scan_sessions")
            .fetch_one(&self.pool)
            .await?;

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests would require a test database setup
    // For now they are placeholder tests

    #[tokio::test]
    async fn test_song_query_construction() {
        let query = SongQuery {
            favorites_only: Some(true),
            artist: Some("Queen".to_string()),
            limit: Some(10),
            ..Default::default()
        };

        // Test that query fields are properly set
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
        };

        assert!(create_playlist.validate().is_ok());
    }
}
