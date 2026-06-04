//! high-level music workflow operations
//! coordinates multiple entities for complex business logic

pub mod create_or_update;
mod deduplication;
pub mod delete;
mod models;
mod query;
mod query_favorites;
mod query_playlists;
mod update;
mod user_prefs;

// re-export public types
pub use models::{
    AlbumImportRequest, AlbumImportResult, AlbumQueryResult, AlbumStatusCounts, AlbumsQueryResult,
    ArtistImportRequest, ArtistQueryResult, ArtistsQueryResult, BulkImportRequest,
    BulkImportResult, CreateSongWithMetadataRequest, EntityUrl, FavoriteAlbumResult,
    FavoriteArtistResult, FavoriteItem, FavoritePlaylistResult, FavoriteSongResult, ImageMetadata,
    ImportSongRequest, ImportSongResult, PlaylistQueryResult, PlaylistSongResult,
    PlaylistSongsQueryResult, PlaylistsQueryResult, QueryParams, QueryPlaylistSongsRequest,
    QueryResult, SongImportError, SongQueryResult, SongUpdateError, SongsQueryResult,
};

// re-export update types from models
pub use models::{
    FavoriteTargetType, RatingTargetType, SetFavoriteRequest, SetRatingRequest, UpdateAlbumRequest,
    UpdateArtistRequest, UpdateSongsRequest, UpdateSongsResult,
};

// re-export api request/response types
pub use models::{
    BulkClearSongArtworkRequest, BulkClearSongArtworkResponse, BulkDeleteSongsRequest,
    BulkDeleteSongsResponse, DeleteAlbumRequest, DeleteAlbumResponse, DeleteArtistRequest,
    DeleteArtistResponse, DeleteSongRequest, DeleteSongResponse, GetAlbumRequest, GetArtistRequest,
    GetRatingStatsRequest, ListBelovedRequest, ListBelovedResponse, ListFavoritesRequest,
    ListFavoritesResponse, RatingStats, RecentSongsRequest, RemoveRatingRequest,
    RemoveRatingResponse, SetFavoriteResponse, SetRatingResponse,
};

// re-export update functions
pub use update::update_songs;

// re-export playlist types
pub use crate::music::entities::playlists::{
    AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest, Playlist,
    PlaylistSong, RemovePlaylistThumbnailRequest, RemoveSongsFromPlaylistRequest,
    ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
};

// re-export main workflow functions with cleaner names
pub use create_or_update::{
    add_entity_url,
    bulk_import_songs,
    create_song_with_artist_and_album,
    extract_url_domain_label,
    extract_urls_from_text,
    find_or_create_artist,
    find_or_create_genre,
    get_or_create_playlist_by_name,
    import_song_with_metadata as add_song, // renamed for cleaner API
    // duplicate report functions
    init_duplicate_report,
    parse_external_url,
    write_duplicate_report,
};

// re-export query operations
pub use query::{
    list_albums_by_artist,
    list_recent_songs,
    list_songs_by_album,
    list_songs_by_artist,
    list_songs_by_genre,
    // new unified query API
    query_album_status_counts,
    query_albums,
    query_artists,
    query_songs,
    search_songs,
    // shared view-row + mapper, used by relations.rs (phase 11) to
    // reuse the same enriched (album + artist + favorites) shape as
    // `query_albums` for the cross-remote walk routes.
    AlbumViewRow,
};

// re-export user-prefs apply helpers — relations.rs (phase 11) needs
// `apply_user_preferences_albums` to layer favorites/ratings onto
// walk-fetched albums.
pub use user_prefs::apply_user_preferences_albums;

// re-export favorites query operations
pub use query_favorites::query_favorites;

// re-export playlist query operations
pub use query_playlists::{
    list_user_playlists, query_playlist_songs, query_playlists, search_playlists,
};

// re-export playlist CRUD operations
pub use crate::music::entities::playlists::{
    add_songs_to_playlist, create_playlist, delete_playlist, get_playlist, get_playlist_songs,
    list_playlists, remove_playlist_thumbnail, remove_songs_from_playlist, update_playlist,
    update_song_position, update_songs_position,
};

// re-export album operations
pub use crate::music::entities::albums::{delete_album, get_album, list_albums};

// re-export artist operations
pub use crate::music::entities::artists::{delete_artist, get_artist, list_artists};

// re-export song operations
pub use crate::music::entities::songs::{
    bulk_clear_song_artwork, bulk_delete_songs, delete_song, list_songs,
};

// genres are now stored as taxons (kind=genre) in `taxonz`. consumers
// drive everything through `entities::taxonomy` (`find_or_create_taxon`,
// `query_taxons`, `add_album_taxon`, ...). the legacy `entities::genres`
// module was deleted; the only crud-level holdover is the
// `find_or_create_genre` shim in `create_or_update.rs` which still
// returns the legacy `Genre` shape so `ImportSongResult` etc. keep
// their existing wire format.

// re-export tag operations
pub use crate::music::entities::tags::{
    delete_tag, get_albums_tags, get_tag, list_tags, query_tags as search_tags,
};

// re-export delete operations
pub use delete::{delete_album_if_unused, delete_artist_if_unused, remove_song_from_all_playlists};

// re-export deduplication utilities
pub use deduplication::{
    albums_match, artists_match, normalize_album_title, normalize_artist_name, normalize_name,
};

// High-level workflow operations that handle:
//
// CREATE/UPDATE operations:
// - add_song() - creates song + artist + album + genre in one call
// - find_or_create_artist() - case-insensitive artist deduplication
// - find_or_create_genre() - case-insensitive genre deduplication
// - bulk_import_songs() - processes multiple files with relationships
// - update_songs() - updates songs with optional fields and relationships
//
// QUERY operations:
// - query_songs() - unified query API with FTS, filters, pagination
// - query_artists() - unified artist queries with aggregated stats
// - query_albums() - unified album queries with metadata
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
