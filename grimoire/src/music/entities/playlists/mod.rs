//! playlists module
//! handles playlist domain logic

mod models;
mod repository;

// re-export public types
pub use models::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, Playlist, PlaylistSong, PlaylistWithCount,
};
pub use repository::{
    add_songs_to_playlist, create_playlist, delete_playlist, get_playlist, get_playlist_songs,
    remove_songs_from_playlist, update_song_position,
};
