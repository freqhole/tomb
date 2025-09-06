//! Music module for CLI commands
//!
//! This module provides CLI commands for:
//! - Scanning music directories
//! - Managing playlists
//! - Playing music
//! - Managing music libraries

pub mod commands;
pub mod generation;
pub mod library;
pub mod playlist;
pub mod scanner;
pub mod search;
pub mod sync;

// Re-export the main command enum
pub use commands::MusicCommands;

use grimoire::music::MusicService;
use grimoire::{AppConfig, DatabaseConnection};

impl MusicCommands {
    /// Execute the music command
    pub async fn handle(&self, db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        // Load config from file instead of using defaults
        let (config, _secrets) = match AppConfig::from_files("assets/config/config.jsonc", None) {
            Ok((config, secrets)) => (config, secrets),
            Err(_) => {
                println!("⚠️  Could not load config file, using defaults");
                (AppConfig::default(), None)
            }
        };
        let service = MusicService::new(db, &config);

        match self {
            Self::Scan {
                path,
                name,
                depth,
                batch_size,
                extensions,
                max_size_mb,
            } => {
                scanner::handle_scan(
                    &service,
                    path.clone(),
                    name.clone(),
                    *depth,
                    *batch_size,
                    extensions.clone(),
                    *max_size_mb,
                )
                .await
            }
            Self::Resume { session_id } => scanner::handle_resume(&service, *session_id).await,
            Self::Status { active, verbose } => {
                sync::handle_status(&service, *active, *verbose).await
            }
            Self::Info { session_id } => sync::handle_info(&service, *session_id).await,
            Self::Cancel { session_id } => sync::handle_cancel(&service, *session_id).await,
            Self::Cleanup { days } => sync::handle_cleanup(&service, *days).await,
            Self::Test => library::handle_test(&service).await,
            Self::Songs {
                favorites,
                artist,
                album,
                limit,
                offset,
                user_id,
            } => {
                library::handle_songs(
                    &service,
                    *favorites,
                    artist.clone(),
                    album.clone(),
                    *limit,
                    *offset,
                    user_id.clone(),
                )
                .await
            }
            Self::Playlists { public, verbose } => {
                playlist::handle_playlists(&service, *public, *verbose).await
            }
            Self::CreatePlaylist {
                title,
                description,
                public,
                songs,
            } => {
                playlist::handle_create_playlist(
                    &service,
                    title.clone(),
                    description.clone(),
                    *public,
                    songs.clone(),
                )
                .await
            }
            Self::AddToPlaylist { playlist, songs } => {
                playlist::handle_add_to_playlist(&service, playlist.clone(), songs.clone()).await
            }
            Self::AddToPlaylistByTitle {
                title,
                songs,
                description,
                public,
            } => {
                playlist::handle_add_to_playlist_by_title(
                    &service,
                    title.clone(),
                    songs.clone(),
                    description.clone(),
                    *public,
                )
                .await
            }
            Self::RemoveFromPlaylist { playlist, songs } => {
                playlist::handle_remove_from_playlist(&service, playlist.clone(), songs.clone())
                    .await
            }
            Self::ShowPlaylist {
                playlist,
                verbose,
                user_id,
            } => {
                playlist::handle_show_playlist(
                    &service,
                    playlist.clone(),
                    *verbose,
                    user_id.clone(),
                )
                .await
            }
            Self::DeletePlaylist { playlist, force } => {
                playlist::handle_delete_playlist(&service, playlist.clone(), *force).await
            }
            Self::MoveSong {
                playlist,
                song_id,
                position,
            } => playlist::handle_move_song(&service, playlist.clone(), *song_id, *position).await,
            Self::ReorderPlaylist { playlist, song_ids } => {
                playlist::handle_reorder_playlist(&service, playlist.clone(), song_ids.clone())
                    .await
            }
            Self::PlaylistSummaries { limit } => {
                playlist::handle_playlist_summaries(&service, *limit).await
            }
            Self::Albums { limit } => library::handle_albums(&service, *limit).await,
            Self::AlbumTracks { album, artist } => {
                library::handle_album_tracks(&service, album.clone(), artist.clone()).await
            }
            Self::ArtistAlbums { artist, limit } => {
                library::handle_artist_albums(&service, artist.clone(), *limit).await
            }
            Self::PlaylistFromAlbum {
                album,
                artist,
                title,
                public,
            } => {
                playlist::handle_playlist_from_album(
                    &service,
                    album.clone(),
                    artist.clone(),
                    title.clone(),
                    *public,
                )
                .await
            }
            Self::PlaySong { song_id, visualize } => {
                library::handle_play_song(&service, song_id.clone(), *visualize).await
            }
            Self::PlayPlaylist { playlist, shuffle } => {
                playlist::handle_play_playlist(&service, playlist.clone(), *shuffle).await
            }
            Self::Play { shuffle } => library::handle_interactive_play(&service, *shuffle).await,
            Self::PlayDirect { playlist, shuffle } => {
                playlist::handle_direct_play(&service, playlist.clone(), *shuffle).await
            }
            Self::GenerateWaveforms { limit, force } => {
                generation::handle_generate_waveforms(&service, *limit, *force).await
            }
            Self::BackfillWaveforms { batch_size, force } => {
                generation::handle_backfill_waveforms(&service, *batch_size, *force).await
            }
            Self::GenerateDirectoryArt { limit, force } => {
                generation::handle_generate_directory_art(&service, *limit, *force).await
            }
            Self::BackfillDirectoryArt { batch_size, force } => {
                generation::handle_backfill_directory_art(&service, *batch_size, *force).await
            }
            Self::BackfillMetadata { batch_size, force } => {
                generation::handle_backfill_metadata(&service, *batch_size, *force).await
            }
            Self::Search {
                query,
                structured,
                search_type,
                limit,
                verbose,
                songs_only,
                page,
                user_id,
            } => {
                search::handle_search(
                    &service,
                    query.clone(),
                    *structured,
                    search_type.clone(),
                    *limit,
                    *verbose,
                    *songs_only,
                    *page,
                    user_id.clone(),
                )
                .await
            }
            Self::Suggest { query, limit } => {
                search::handle_suggest(&service, query.clone(), *limit).await
            }
        }
    }
}
