//! image management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::music::entities::albums::{add_album_image, clear_album_images, remove_album_image, set_primary_album_image};
use grimoire::music::entities::artists::{add_artist_image, clear_artist_images, remove_artist_image, set_primary_artist_image};
use grimoire::music::entities::playlists::{add_playlist_image, clear_playlist_images, remove_playlist_image, set_primary_playlist_image};
use grimoire::music::entities::songs::{add_song_image, clear_song_images, remove_song_image, set_primary_song_image};

#[derive(Subcommand)]
pub enum ImageAction {
    /// Add an image to a song
    AddSongImage {
        /// Song ID
        #[arg(long)]
        song_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
        /// Set as primary image
        #[arg(long)]
        is_primary: bool,
    },
    /// Remove an image from a song
    RemoveSongImage {
        /// Song ID
        #[arg(long)]
        song_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Set primary image for a song
    SetPrimarySongImage {
        /// Song ID
        #[arg(long)]
        song_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Clear all images from a song
    ClearSongImages {
        /// Song ID
        #[arg(long)]
        song_id: String,
    },

    /// Add an image to an album
    AddAlbumImage {
        /// Album ID
        #[arg(long)]
        album_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
        /// Set as primary image
        #[arg(long)]
        is_primary: bool,
    },
    /// Remove an image from an album
    RemoveAlbumImage {
        /// Album ID
        #[arg(long)]
        album_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Set primary image for an album
    SetPrimaryAlbumImage {
        /// Album ID
        #[arg(long)]
        album_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Clear all images from an album
    ClearAlbumImages {
        /// Album ID
        #[arg(long)]
        album_id: String,
    },

    /// Add an image to an artist
    AddArtistImage {
        /// Artist ID
        #[arg(long)]
        artist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
        /// Set as primary image
        #[arg(long)]
        is_primary: bool,
    },
    /// Remove an image from an artist
    RemoveArtistImage {
        /// Artist ID
        #[arg(long)]
        artist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Set primary image for an artist
    SetPrimaryArtistImage {
        /// Artist ID
        #[arg(long)]
        artist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Clear all images from an artist
    ClearArtistImages {
        /// Artist ID
        #[arg(long)]
        artist_id: String,
    },

    /// Add an image to a playlist
    AddPlaylistImage {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
        /// Set as primary image
        #[arg(long)]
        is_primary: bool,
    },
    /// Remove an image from a playlist
    RemovePlaylistImage {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Set primary image for a playlist
    SetPrimaryPlaylistImage {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
        /// Media blob ID
        #[arg(long)]
        blob_id: String,
    },
    /// Clear all images from a playlist
    ClearPlaylistImages {
        /// Playlist ID
        #[arg(long)]
        playlist_id: String,
    },
}

impl ImageAction {
    pub async fn execute(&self) -> CommandOutput<serde_json::Value> {
        match self {
            // song image operations
            ImageAction::AddSongImage { song_id, blob_id, is_primary } => {
                let response = add_song_image(song_id, blob_id, *is_primary, None).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::RemoveSongImage { song_id, blob_id } => {
                let response = remove_song_image(song_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::SetPrimarySongImage { song_id, blob_id } => {
                let response = set_primary_song_image(song_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::ClearSongImages { song_id } => {
                let response = clear_song_images(song_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }

            // album image operations
            ImageAction::AddAlbumImage { album_id, blob_id, is_primary } => {
                let response = add_album_image(album_id, blob_id, *is_primary, None).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::RemoveAlbumImage { album_id, blob_id } => {
                let response = remove_album_image(album_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::SetPrimaryAlbumImage { album_id, blob_id } => {
                let response = set_primary_album_image(album_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::ClearAlbumImages { album_id } => {
                let response = clear_album_images(album_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }

            // artist image operations
            ImageAction::AddArtistImage { artist_id, blob_id, is_primary } => {
                let response = add_artist_image(artist_id, blob_id, *is_primary, None).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::RemoveArtistImage { artist_id, blob_id } => {
                let response = remove_artist_image(artist_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::SetPrimaryArtistImage { artist_id, blob_id } => {
                let response = set_primary_artist_image(artist_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::ClearArtistImages { artist_id } => {
                let response = clear_artist_images(artist_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }

            // playlist image operations
            ImageAction::AddPlaylistImage { playlist_id, blob_id, is_primary } => {
                let response = add_playlist_image(playlist_id, blob_id, *is_primary, None).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::RemovePlaylistImage { playlist_id, blob_id } => {
                let response = remove_playlist_image(playlist_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::SetPrimaryPlaylistImage { playlist_id, blob_id } => {
                let response = set_primary_playlist_image(playlist_id, blob_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
            ImageAction::ClearPlaylistImages { playlist_id } => {
                let response = clear_playlist_images(playlist_id).await;
                if response.success {
                    CommandOutput::success(response.message, ())
                } else {
                    CommandOutput::failure(response.message, vec![], ())
                }
            }
        }
    }
}
