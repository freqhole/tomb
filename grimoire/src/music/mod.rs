//! music domain module
//!
//! provides simple api for managing songs, artists, albums, playlists, and genres
//! encapsulates all database logic internally

pub mod albums;
pub mod artists;
pub mod genres;
pub mod operations;
pub mod playlists;
pub mod songs;

// re-export all public types from submodules
pub use albums::{Album, CreateAlbumRequest};
pub use artists::{Artist, CreateArtistRequest};
pub use genres::{
    CreateGenreRequest, CreateSubGenreRequest, Genre, GenreStat, GenreStatsResponse, SubGenre,
};
pub use operations::{
    AlbumImportRequest, AlbumImportResult, ArtistImportRequest, BulkImportRequest,
    BulkImportResult, CreateSongWithMetadataRequest, ImportSongRequest, ImportSongResult,
    SongImportError,
};
pub use playlists::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, Playlist, PlaylistSong, PlaylistWithCount,
};
pub use songs::{CreateSongRequest, Song};

// re-export service functions from submodules
pub use albums::{create_album, delete_album, get_album, list_albums};
pub use artists::{create_artist, get_artist, list_artists};
pub use genres::{
    create_genre, create_sub_genre, get_genre, get_genre_stats, get_sub_genre, list_genres,
    list_sub_genres,
};
pub use operations::{
    bulk_import_songs, create_song_with_artist_and_album, find_or_create_album,
    find_or_create_artist, find_or_create_genre, get_or_create_playlist_by_name,
    import_album_with_songs, import_song_with_metadata, update_song_with_relationships,
};
pub use playlists::{
    add_songs_to_playlist, create_playlist, delete_playlist, get_playlist, get_playlist_songs,
    list_playlists, remove_songs_from_playlist,
};
pub use songs::{create_song, get_song, list_songs};
