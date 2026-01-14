//! playlists module
//! handles playlist domain logic

mod models;
mod repository;
mod thumbnail_helpers;

// re-export public types
pub use models::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest, GetPlaylistRequest,
    Playlist, PlaylistSong, RemovePlaylistThumbnailRequest, RemoveSongsFromPlaylistRequest,
    ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
};
pub use repository::{
    add_songs_to_playlist, create_playlist, delete_playlist, get_playlist, get_playlist_songs,
    list_playlists, remove_playlist_thumbnail, remove_songs_from_playlist, update_playlist,
    update_song_position, update_songs_position,
};
pub use thumbnail_helpers::{create_thumbnail_from_bytes, create_thumbnail_from_file};
