//! Playlist service
//!
//! This module provides high-level business logic for playlist operations,
//! wrapping the repository layer with validation, error handling, and
//! business rules enforcement.

use crate::music::models::{
    AlbumSummary, AlbumTrack, ArtistAlbum, BulkUpdatePreferencesRequest, BulkUpdateSongsRequest,
    CreatePlaylist, Playlist, PlaylistComplete, PlaylistQuery, PlaylistSongDetail,
    PlaylistSongWithMedia, PlaylistSummary, PlaylistWithCount, Song, SongQuery, UpdatePlaylist,
    UpdateUserPreferenceRequest, UserSongPreference,
};
use crate::music::repository::{MusicRepository, MusicRepositoryError};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PlaylistServiceError {
    #[error("Repository error: {0}")]
    Repository(#[from] MusicRepositoryError),
    #[error("Playlist not found: {0}")]
    PlaylistNotFound(String),
    #[error(
        "Multiple playlists found with title '{0}'. Please be more specific or use playlist ID."
    )]
    MultiplePlaylistsFound(String),
    #[error("Song not found: {0}")]
    SongNotFound(Uuid),
    #[error("Business logic error: {0}")]
    BusinessLogic(String),
    #[error("Validation error: {0}")]
    Validation(String),
}

pub type Result<T> = std::result::Result<T, PlaylistServiceError>;

/// High-level service for playlist operations
pub struct PlaylistService {
    repository: MusicRepository,
}

impl PlaylistService {
    /// Create a new playlist service
    pub fn new(repository: MusicRepository) -> Self {
        Self { repository }
    }

    /// Get the underlying repository
    pub fn repository(&self) -> &MusicRepository {
        &self.repository
    }

    // Song operations

    /// Get a song by ID
    pub async fn get_song(&self, id: Uuid) -> Result<Song> {
        self.repository
            .get_song(id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Query songs with filtering and pagination
    pub async fn query_songs(&self, query: SongQuery) -> Result<Vec<Song>> {
        self.repository
            .query_songs(query)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Update a song's favorite status
    pub async fn toggle_song_favorite(&self, id: Uuid) -> Result<Song> {
        // Get current song to check favorite status
        let song = self.get_song(id).await?;
        let new_favorite_status = !song.is_favorite;

        self.repository
            .update_song_favorite(id, new_favorite_status)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Set a song's favorite status
    pub async fn set_song_favorite(&self, id: Uuid, is_favorite: bool) -> Result<Song> {
        self.repository
            .update_song_favorite(id, is_favorite)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Rate a song
    pub async fn rate_song(&self, id: Uuid, rating: Option<i32>) -> Result<Song> {
        if let Some(r) = rating {
            if !(1..=5).contains(&r) {
                return Err(PlaylistServiceError::Validation(
                    "Rating must be between 1 and 5".to_string(),
                ));
            }
        }

        self.repository
            .update_song_rating(id, rating)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Set a user's song favorite status
    pub async fn set_user_song_favorite(
        &self,
        user_id: Uuid,
        song_id: Uuid,
        is_favorite: bool,
    ) -> Result<UserSongPreference> {
        let request = UpdateUserPreferenceRequest {
            is_favorite: Some(is_favorite),
            rating: None,
        };

        self.repository
            .update_user_song_preference(user_id, song_id, request)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Rate a song for a specific user
    pub async fn rate_user_song(
        &self,
        user_id: Uuid,
        song_id: Uuid,
        rating: Option<i32>,
    ) -> Result<UserSongPreference> {
        if let Some(r) = rating {
            if !(1..=5).contains(&r) {
                return Err(PlaylistServiceError::Validation(
                    "rating must be between 1 and 5".to_string(),
                ));
            }
        }

        let request = UpdateUserPreferenceRequest {
            is_favorite: None,
            rating,
        };

        self.repository
            .update_user_song_preference(user_id, song_id, request)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Bulk update user preferences for multiple songs
    pub async fn bulk_update_user_preferences(
        &self,
        user_id: Uuid,
        request: BulkUpdatePreferencesRequest,
    ) -> Result<Vec<UserSongPreference>> {
        self.repository
            .bulk_update_user_preferences(user_id, request)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Bulk update song metadata for multiple songs (admin-only)
    pub async fn bulk_update_songs(&self, request: BulkUpdateSongsRequest) -> Result<Vec<Song>> {
        self.repository
            .bulk_update_songs(request)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    // Playlist operations

    /// Get a playlist by ID
    pub async fn get_playlist(&self, id: Uuid) -> Result<Playlist> {
        self.repository
            .get_playlist(id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Find a playlist by title or ID
    /// This is the main method used by CLI for flexible playlist lookup
    pub async fn find_playlist_by_title_or_id(&self, input: &str) -> Result<Playlist> {
        // First try to parse as UUID
        if let Ok(playlist_id) = input.parse::<Uuid>() {
            match self.repository.get_playlist(playlist_id).await {
                Ok(playlist) => return Ok(playlist),
                Err(MusicRepositoryError::PlaylistNotFound(_)) => {
                    // Continue to title search
                }
                Err(e) => return Err(PlaylistServiceError::Repository(e)),
            }
        }

        // Try exact title match first
        let exact_matches = self
            .repository
            .find_playlists_by_title(input, true)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        if exact_matches.len() == 1 {
            return Ok(exact_matches.into_iter().next().unwrap());
        }

        if exact_matches.len() > 1 {
            return Err(PlaylistServiceError::MultiplePlaylistsFound(
                input.to_string(),
            ));
        }

        // Try partial title match
        let partial_matches = self
            .repository
            .find_playlists_by_title(input, false)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        if partial_matches.is_empty() {
            return Err(PlaylistServiceError::PlaylistNotFound(input.to_string()));
        }

        if partial_matches.len() == 1 {
            return Ok(partial_matches.into_iter().next().unwrap());
        }

        // Multiple partial matches - return error with suggestion
        Err(PlaylistServiceError::MultiplePlaylistsFound(
            input.to_string(),
        ))
    }

    /// Get multiple playlist candidates for user selection
    /// Used when find_playlist_by_title_or_id returns multiple matches
    pub async fn get_playlist_candidates(&self, input: &str) -> Result<Vec<Playlist>> {
        // Try exact title match first
        let exact_matches = self
            .repository
            .find_playlists_by_title(input, true)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        if !exact_matches.is_empty() {
            return Ok(exact_matches);
        }

        // Try partial title match
        let partial_matches = self
            .repository
            .find_playlists_by_title(input, false)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        Ok(partial_matches)
    }

    /// Query playlists with filtering and pagination
    pub async fn query_playlists(&self, query: PlaylistQuery) -> Result<Vec<PlaylistWithCount>> {
        self.repository
            .query_playlists(query)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Create a new playlist
    pub async fn create_playlist(&self, params: CreatePlaylist) -> Result<Playlist> {
        self.repository
            .create_playlist(params)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Create a playlist and optionally add initial songs
    pub async fn create_playlist_with_songs(
        &self,
        params: CreatePlaylist,
        song_ids: Option<Vec<Uuid>>,
        client_id: Option<String>,
    ) -> Result<(Playlist, Vec<Uuid>)> {
        // Create the playlist
        let playlist = self.create_playlist(params).await?;

        let mut added_song_ids = Vec::new();

        // Add songs if provided
        if let Some(song_ids) = song_ids {
            for song_id in song_ids {
                // Verify song exists before adding
                match self.get_song(song_id).await {
                    Ok(_) => {
                        match self
                            .repository
                            .add_songs_to_playlist(playlist.id, &[song_id], client_id.clone())
                            .await
                        {
                            Ok(_) => added_song_ids.push(song_id),
                            Err(MusicRepositoryError::SongAlreadyInPlaylist) => {
                                // Skip if already in playlist (shouldn't happen with new playlist but just in case)
                                continue;
                            }
                            Err(e) => return Err(PlaylistServiceError::Repository(e)),
                        }
                    }
                    Err(PlaylistServiceError::Repository(MusicRepositoryError::SongNotFound(
                        _,
                    ))) => {
                        // Skip non-existent songs but continue processing others
                        continue;
                    }
                    Err(e) => return Err(e),
                }
            }
        }

        Ok((playlist, added_song_ids))
    }

    /// Update a playlist
    pub async fn update_playlist(&self, id: Uuid, params: UpdatePlaylist) -> Result<Playlist> {
        self.repository
            .update_playlist(id, params)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Delete a playlist
    pub async fn delete_playlist(&self, id: Uuid, deleted_by: Option<Uuid>) -> Result<bool> {
        self.repository
            .delete_playlist(id, deleted_by)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Delete a playlist by title or ID
    pub async fn delete_playlist_by_title_or_id(
        &self,
        input: &str,
        deleted_by: Option<Uuid>,
    ) -> Result<Playlist> {
        let playlist = self.find_playlist_by_title_or_id(input).await?;

        self.repository
            .delete_playlist(playlist.id, deleted_by)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        Ok(playlist)
    }

    // Playlist song operations

    /// Get songs in a playlist
    pub async fn get_playlist_songs(&self, playlist_id: Uuid) -> Result<Vec<PlaylistSongDetail>> {
        // Verify playlist exists
        self.get_playlist(playlist_id).await?;

        self.repository
            .get_playlist_songs(playlist_id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get songs in a playlist by title or ID
    pub async fn get_playlist_songs_by_title_or_id(
        &self,
        input: &str,
    ) -> Result<Vec<PlaylistSongDetail>> {
        let playlist = self.find_playlist_by_title_or_id(input).await?;
        self.get_playlist_songs(playlist.id).await
    }

    /// Add songs to a playlist
    pub async fn add_songs_to_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: Vec<Uuid>,
        client_id: Option<String>,
    ) -> Result<(Vec<Uuid>, Vec<Uuid>)> {
        let mut added_songs = Vec::new();
        let mut skipped_songs = Vec::new();

        for song_id in song_ids {
            // Check if song exists
            match self.get_song(song_id).await {
                Ok(_) => {
                    // Check if already in playlist
                    match self
                        .repository
                        .is_song_in_playlist(playlist_id, song_id)
                        .await
                    {
                        Ok(true) => {
                            skipped_songs.push(song_id);
                            continue;
                        }
                        Ok(false) => {
                            // Add the song
                            match self
                                .repository
                                .add_songs_to_playlist(playlist_id, &[song_id], client_id.clone())
                                .await
                            {
                                Ok(_) => added_songs.push(song_id),
                                Err(e) => return Err(PlaylistServiceError::Repository(e)),
                            }
                        }
                        Err(e) => return Err(PlaylistServiceError::Repository(e)),
                    }
                }
                Err(PlaylistServiceError::Repository(MusicRepositoryError::SongNotFound(_))) => {
                    skipped_songs.push(song_id);
                }
                Err(e) => return Err(e),
            }
        }

        Ok((added_songs, skipped_songs))
    }

    /// Add songs to a playlist by title or ID
    pub async fn add_songs_to_playlist_by_title_or_id(
        &self,
        playlist_input: &str,
        song_ids: Vec<Uuid>,
        client_id: Option<String>,
    ) -> Result<(Playlist, Vec<Uuid>, Vec<Uuid>)> {
        let playlist = self.find_playlist_by_title_or_id(playlist_input).await?;
        let (added, skipped) = self
            .add_songs_to_playlist(playlist.id, song_ids, client_id)
            .await?;
        Ok((playlist, added, skipped))
    }

    /// Remove songs from a playlist
    pub async fn remove_songs_from_playlist(
        &self,
        playlist_id: Uuid,
        song_ids: Vec<Uuid>,
    ) -> Result<(u64, Vec<Uuid>)> {
        let mut not_found_songs = Vec::new();
        let mut valid_song_ids = Vec::new();

        // Filter out songs that don't exist or aren't in the playlist
        for song_id in song_ids {
            match self
                .repository
                .is_song_in_playlist(playlist_id, song_id)
                .await
            {
                Ok(true) => valid_song_ids.push(song_id),
                Ok(false) => not_found_songs.push(song_id),
                Err(_) => not_found_songs.push(song_id),
            }
        }

        let removed_count = if !valid_song_ids.is_empty() {
            self.repository
                .remove_songs_from_playlist(playlist_id, &valid_song_ids)
                .await
                .map_err(PlaylistServiceError::Repository)?
        } else {
            0
        };

        Ok((removed_count, not_found_songs))
    }

    /// Remove songs from a playlist by title or ID
    pub async fn remove_songs_from_playlist_by_title_or_id(
        &self,
        playlist_input: &str,
        song_ids: Vec<Uuid>,
    ) -> Result<(Playlist, u64, Vec<Uuid>)> {
        let playlist = self.find_playlist_by_title_or_id(playlist_input).await?;
        let (removed_count, not_found) = self
            .remove_songs_from_playlist(playlist.id, song_ids)
            .await?;
        Ok((playlist, removed_count, not_found))
    }

    /// Get the number of songs in a playlist
    pub async fn get_playlist_song_count(&self, playlist_id: Uuid) -> Result<i64> {
        self.repository
            .get_playlist_song_count(playlist_id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Check if a song is in a playlist
    pub async fn is_song_in_playlist(&self, playlist_id: Uuid, song_id: Uuid) -> Result<bool> {
        self.repository
            .is_song_in_playlist(playlist_id, song_id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    // Utility methods

    /// Parse comma-separated song IDs from string
    pub fn parse_song_ids(&self, song_ids_str: &str) -> Result<Vec<Uuid>> {
        song_ids_str
            .split(',')
            .map(|s| {
                s.trim()
                    .parse::<Uuid>()
                    .map_err(|_| PlaylistServiceError::Validation(format!("Invalid UUID: {}", s)))
            })
            .collect()
    }

    /// Validate that all song IDs exist
    pub async fn validate_song_ids(&self, song_ids: &[Uuid]) -> Result<Vec<Uuid>> {
        let mut valid_ids = Vec::new();
        for &song_id in song_ids {
            match self.get_song(song_id).await {
                Ok(_) => valid_ids.push(song_id),
                Err(PlaylistServiceError::Repository(MusicRepositoryError::SongNotFound(_))) => {
                    return Err(PlaylistServiceError::SongNotFound(song_id));
                }
                Err(e) => return Err(e),
            }
        }
        Ok(valid_ids)
    }

    // SQL View and Function Methods

    /// Get playlist summaries using the SQL view
    pub async fn get_playlist_summaries(&self, limit: Option<i64>) -> Result<Vec<PlaylistSummary>> {
        self.repository
            .get_playlist_summaries(limit)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get complete playlist data using SQL view
    pub async fn get_playlist_complete(&self, playlist_id: Uuid) -> Result<PlaylistComplete> {
        self.repository
            .get_playlist_complete(playlist_id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get complete playlist data by title or ID
    pub async fn get_playlist_complete_by_title_or_id(
        &self,
        input: &str,
    ) -> Result<PlaylistComplete> {
        let playlist = self.find_playlist_by_title_or_id(input).await?;
        self.get_playlist_complete(playlist.id).await
    }

    /// Get playlist songs with media info using SQL function
    pub async fn get_playlist_songs_with_media(
        &self,
        playlist_id: Uuid,
    ) -> Result<Vec<PlaylistSongWithMedia>> {
        self.repository
            .get_playlist_songs_with_media(playlist_id)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get playlist songs with media info by title or ID
    pub async fn get_playlist_songs_with_media_by_title_or_id(
        &self,
        input: &str,
    ) -> Result<Vec<PlaylistSongWithMedia>> {
        let playlist = self.find_playlist_by_title_or_id(input).await?;
        self.get_playlist_songs_with_media(playlist.id).await
    }

    /// Move song to different position in playlist
    pub async fn move_playlist_song(
        &self,
        playlist_id: Uuid,
        song_id: Uuid,
        to_position: i32,
    ) -> Result<()> {
        // Validate that the song exists in the playlist
        if !self
            .repository
            .is_song_in_playlist(playlist_id, song_id)
            .await?
        {
            return Err(PlaylistServiceError::BusinessLogic(
                "Song not found in playlist".to_string(),
            ));
        }

        self.repository
            .move_playlist_song(playlist_id, song_id, to_position)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Move song in playlist by title or ID
    pub async fn move_playlist_song_by_title_or_id(
        &self,
        playlist_input: &str,
        song_id: Uuid,
        to_position: i32,
    ) -> Result<Playlist> {
        let playlist = self.find_playlist_by_title_or_id(playlist_input).await?;
        self.move_playlist_song(playlist.id, song_id, to_position)
            .await?;
        Ok(playlist)
    }

    /// Reorder entire playlist
    pub async fn reorder_playlist(
        &self,
        playlist_id: Uuid,
        song_ids_ordered: &[Uuid],
    ) -> Result<()> {
        // Verify playlist exists
        self.get_playlist(playlist_id).await?;

        // Validate all song IDs exist in the playlist
        for &song_id in song_ids_ordered {
            if !self
                .repository
                .is_song_in_playlist(playlist_id, song_id)
                .await?
            {
                return Err(PlaylistServiceError::BusinessLogic(format!(
                    "Song {} not found in playlist",
                    song_id
                )));
            }
        }

        self.repository
            .reorder_playlist_by_function(playlist_id, song_ids_ordered)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Reorder playlist by title or ID
    pub async fn reorder_playlist_by_title_or_id(
        &self,
        playlist_input: &str,
        song_ids_ordered: &[Uuid],
    ) -> Result<Playlist> {
        let playlist = self.find_playlist_by_title_or_id(playlist_input).await?;
        self.reorder_playlist(playlist.id, song_ids_ordered).await?;
        Ok(playlist)
    }

    /// Add song at specific position
    pub async fn add_song_at_position(
        &self,
        playlist_id: Uuid,
        song_id: Uuid,
        position: i32,
        client_id: Option<String>,
    ) -> Result<()> {
        // Verify playlist and song exist
        self.get_playlist(playlist_id).await?;
        self.get_song(song_id).await?;

        // Check if song is already in playlist
        if self
            .repository
            .is_song_in_playlist(playlist_id, song_id)
            .await?
        {
            return Err(PlaylistServiceError::BusinessLogic(
                "Song already in playlist".to_string(),
            ));
        }

        self.repository
            .add_song_at_position(playlist_id, song_id, position, client_id)
            .await
            .map_err(PlaylistServiceError::Repository)?;

        Ok(())
    }

    /// Get songs by album order using SQL function
    pub async fn get_songs_by_album_order(
        &self,
        album_filter: Option<String>,
        artist_filter: Option<String>,
        max_results: Option<i32>,
    ) -> Result<Vec<AlbumTrack>> {
        self.repository
            .get_songs_by_album_order(album_filter, artist_filter, max_results)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get album summaries
    pub async fn get_album_summaries(&self, limit: Option<i64>) -> Result<Vec<AlbumSummary>> {
        self.repository
            .get_album_summaries(limit)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get album tracks
    pub async fn get_album_tracks(
        &self,
        album_name: &str,
        artist_name: Option<&str>,
    ) -> Result<Vec<AlbumTrack>> {
        self.repository
            .get_album_tracks(album_name, artist_name)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Get artist albums
    pub async fn get_artist_albums(
        &self,
        artist_name: &str,
        max_results: Option<i32>,
    ) -> Result<Vec<ArtistAlbum>> {
        self.repository
            .get_artist_albums(artist_name, max_results)
            .await
            .map_err(PlaylistServiceError::Repository)
    }

    /// Create playlist from album tracks
    pub async fn create_playlist_from_album(
        &self,
        playlist_title: String,
        album_name: &str,
        artist_name: Option<&str>,
        is_public: Option<bool>,
        client_id: Option<String>,
    ) -> Result<Playlist> {
        // Get album tracks in order
        let tracks = self.get_album_tracks(album_name, artist_name).await?;

        if tracks.is_empty() {
            return Err(PlaylistServiceError::BusinessLogic(
                "No tracks found for album".to_string(),
            ));
        }

        // Create playlist
        let create_params = CreatePlaylist {
            title: playlist_title,
            description: Some(format!(
                "Album: {} {}",
                album_name,
                artist_name.map(|a| format!("by {}", a)).unwrap_or_default()
            )),
            client_id: client_id.clone(),
            is_public,
            is_collaborative: Some(false),
            metadata: None,
            media_blob_id: None,
            thumbnail_blob_id: None,
        };

        let playlist = self.create_playlist(create_params).await?;

        // Add tracks in order
        let song_ids: Vec<Uuid> = tracks.into_iter().map(|t| t.song_id).collect();
        self.add_songs_to_playlist(playlist.id, song_ids, client_id)
            .await?;

        Ok(playlist)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_song_ids_valid() {
        // Create a mock service for testing parse_song_ids
        // We don't need a real database connection for this test
        let uuid1 = Uuid::new_v4();
        let uuid2 = Uuid::new_v4();
        let input = format!("{}, {}", uuid1, uuid2);

        // Test the parsing logic directly
        let result: std::result::Result<Vec<Uuid>, PlaylistServiceError> = input
            .split(',')
            .map(|s| {
                s.trim()
                    .parse::<Uuid>()
                    .map_err(|_| PlaylistServiceError::Validation(format!("Invalid UUID: {}", s)))
            })
            .collect();

        let parsed_ids = result.unwrap();
        assert_eq!(parsed_ids.len(), 2);
        assert!(parsed_ids.contains(&uuid1));
        assert!(parsed_ids.contains(&uuid2));
    }

    #[test]
    fn test_parse_song_ids_invalid() {
        // Test invalid UUID parsing
        let input = "invalid-uuid";
        let result: std::result::Result<Vec<Uuid>, PlaylistServiceError> = input
            .split(',')
            .map(|s| {
                s.trim()
                    .parse::<Uuid>()
                    .map_err(|_| PlaylistServiceError::Validation(format!("Invalid UUID: {}", s)))
            })
            .collect();

        assert!(result.is_err());
    }
}
