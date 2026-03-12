//! playlists module
//! handles playlist domain logic

mod models;
mod repository;

// re-export public types
pub use models::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest, GetPlaylistRequest,
    Playlist, PlaylistSong, RemovePlaylistThumbnailRequest,
    RemoveSongsFromPlaylistRequest, ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
};
pub use repository::{
    add_playlist_image, add_songs_to_playlist, clear_playlist_images, compute_playlist_etag,
    create_playlist, delete_playlist, get_playlist, get_playlist_images, get_playlist_songs,
    list_playlists, remove_playlist_image, remove_playlist_thumbnail,
    remove_songs_from_playlist, set_primary_playlist_image, update_playlist,
    update_song_position, update_songs_position,
};
