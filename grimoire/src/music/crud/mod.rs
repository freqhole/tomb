//! high-level music workflow operations
//! coordinates multiple entities for complex business logic

mod create_or_update;
mod deduplication;
mod delete;
mod models;
mod query;
mod query_playlists;
mod update;

// re-export public types
pub use models::{
    AlbumImportRequest, AlbumImportResult, AlbumQueryResult, ArtistImportRequest,
    ArtistQueryResult, BulkImportRequest, BulkImportResult, CreateSongWithMetadataRequest,
    ImportSongRequest, ImportSongResult, PlaylistQueryResult, QueryParams, QueryResult,
    SongImportError, SongQueryResult,
};

// re-export update types and functions
pub use update::{
    update_songs, FavoriteTargetType, RatingTargetType, SetFavoriteRequest, SetRatingRequest,
    UpdateAlbumRequest, UpdateArtistRequest, UpdateSongsRequest, UpdateSongsResult,
};

// re-export playlist types
pub use crate::music::entities::playlists::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, Playlist, PlaylistSong, UpdatePlaylistRequest,
};

// re-export main workflow functions with cleaner names
pub use create_or_update::{
    bulk_import_songs,
    create_song_with_artist_and_album,
    find_or_create_album,
    find_or_create_artist,
    find_or_create_genre,
    get_or_create_playlist_by_name,
    import_album_with_songs,
    import_song_with_metadata as add_song, // renamed for cleaner API
    update_song_with_relationships,
};

// re-export query operations
pub use query::{
    list_albums_by_artist,
    list_recent_songs,
    list_songs_by_album,
    list_songs_by_artist,
    list_songs_by_genre,
    // new unified query API
    query_albums,
    query_artists,
    query_genres,
    query_songs,
    search_songs,
};

// re-export playlist query operations
pub use query_playlists::{query_playlist_songs, query_playlists};

// re-export playlist CRUD operations
pub use crate::music::entities::playlists::{
    add_songs_to_playlist, create_playlist, create_thumbnail_from_bytes,
    create_thumbnail_from_file, delete_playlist, get_playlist, get_playlist_songs,
    remove_playlist_thumbnail, remove_songs_from_playlist, update_playlist, update_song_position,
    update_songs_position,
};

// re-export delete operations
pub use delete::{
    cleanup_deleted_entities, delete_album_if_unused, delete_artist_if_unused,
    delete_genre_if_unused, delete_song, remove_song_from_all_playlists,
};

// re-export deduplication utilities
pub use deduplication::{
    albums_match, artists_match, genres_match, normalize_album_title, normalize_artist_name,
    normalize_genre_name, normalize_name,
};

// High-level workflow operations that handle:
//
// CREATE/UPDATE operations:
// - add_song() - creates song + artist + album + genre in one call
// - find_or_create_artist() - case-insensitive artist deduplication
// - find_or_create_album() - case-insensitive album deduplication
// - find_or_create_genre() - case-insensitive genre deduplication
// - bulk_import_songs() - processes multiple files with relationships
// - update_song_with_relationships() - updates song + creates missing relationships
//
// QUERY operations:
// - query_songs() - unified query API with FTS, filters, pagination
// - query_artists() - unified artist queries with aggregated stats
// - query_albums() - unified album queries with metadata
// - query_genres() - unified genre queries
// - search_songs() - (legacy) full-text search across entities
// - list_songs_by_artist() - (legacy) complex queries with joins
// - list_albums_by_artist() - (legacy) artist discography with stats
// - list_recent_songs() - (legacy) recently added songs with metadata
//
// DELETE operations:
// - delete_song() - soft delete with relationship cleanup
// - delete_artist_if_unused() - conditional artist cleanup
// - delete_playlist() - playlist removal with associations
// - cleanup_deleted_entities() - hard delete old soft-deleted records
//
// DEDUPLICATION utilities:
// - normalize_name() - case-insensitive name normalization
// - artists_match() - artist name comparison
// - albums_match() - album title comparison
//
// These functions coordinate multiple entities/repositories and handle:
// - Multi-table transactions and consistency
// - Case-insensitive deduplication
// - Relationship management (artist_songz, album_songz tables)
// - Error handling across complex workflows
