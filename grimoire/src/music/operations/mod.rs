//! compound music operations for common workflows
//! high-level functions that coordinate multiple domain operations

mod models;
mod service;

// re-export public types
pub use models::{
    AlbumImportRequest, AlbumImportResult, ArtistImportRequest, BulkImportRequest,
    BulkImportResult, CreateSongWithMetadataRequest, ImportSongRequest, ImportSongResult,
    SongImportError,
};
pub use service::{
    bulk_import_songs, create_song_with_artist_and_album, find_or_create_album,
    find_or_create_artist, find_or_create_genre, get_or_create_playlist_by_name,
    import_album_with_songs, import_song_with_metadata, update_song_with_relationships,
};

// compound operations that handle common workflows:
//
// 1. import_song_with_metadata() - creates song + artist + album + genre in one call
// 2. create_song_with_artist_and_album() - ensures related entities exist
// 3. bulk_import_songs() - processes multiple files with relationships
// 4. find_or_create_artist() - deduplication helper
// 5. find_or_create_album() - deduplication helper
// 6. find_or_create_genre() - deduplication helper
// 7. update_song_with_relationships() - updates song + creates missing relationships
// 8. import_album_with_songs() - creates album + all songs + relationships
// 9. get_or_create_playlist_by_name() - playlist management helper
//
// These functions handle the complexity of:
// - creating multiple related entities atomically
// - deduplication (don't create duplicate artists/albums)
// - relationship management (artist_songz, album_songz tables)
// - error handling across multiple operations
// - maintaining data consistency
