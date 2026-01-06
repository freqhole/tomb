//! service functions for compound music operations
//! high-level workflows that coordinate multiple domain operations

use super::models::{
    AlbumImportRequest, AlbumImportResult, ArtistImportRequest, BulkImportRequest,
    BulkImportResult, BulkImportSummary, CreateSongWithMetadataRequest, ImportSongRequest,
    ImportSongResult, SongImportError, SongImportErrorType,
};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::entities::{
    albums, artists, genres, songs, Album, Artist, CreateAlbumRequest, CreateArtistRequest,
    CreateGenreRequest, CreateSongRequest, Genre, Playlist, Song,
};

/// import a song with full metadata, creating related entities as needed
pub async fn import_song_with_metadata(req: ImportSongRequest) -> GrimoireResult<ImportSongResult> {
    let _start_time = std::time::Instant::now();

    // 1. Find or create artist
    let (artist, created_new_artist) = if let Some(artist_name) = &req.artist_name {
        let artist_req = ArtistImportRequest {
            name: artist_name.clone(),
            created_by: req.created_by.clone(),
        };
        let (artist, created) = find_or_create_artist(artist_req).await?;
        (Some(artist), created)
    } else {
        (None, false)
    };

    // 2. Find or create genre
    let (genre, created_new_genre) = if let Some(genre_name) = &req.genre_name {
        let (genre, created) = find_or_create_genre(genre_name.clone()).await?;
        (Some(genre), created)
    } else {
        (None, false)
    };

    // 3. Find or create album
    let (album, created_new_album) = if let Some(album_title) = &req.album_title {
        let album_req = AlbumImportRequest {
            title: album_title.clone(),
            album_type: Some("album".to_string()),
            release_date: req.year.map(|y| y.to_string()),
            release_date_precision: req.year.map(|_| "year".to_string()),
            label: None,
            genre_rowid: genre.as_ref().map(|g| g.rowid),
            year: req.year,
            created_by: req.created_by.clone(),
        };
        let (album, created) = find_or_create_album(album_req).await?;
        (Some(album), created)
    } else {
        (None, false)
    };

    // 4. Create the song
    let song_req = CreateSongRequest {
        media_blob_id: req.media_blob_id,
        title: req.title,
        track_number: req.track_number,
        disc_number: req.disc_number,
        duration: req.duration,
        year: req.year,
        bpm: req.bpm,
        key_signature: req.key_signature,
        lyrics: req.lyrics,
        created_by: req.created_by,
    };

    let song = songs::create_song(song_req).await?;

    // 5. Create relationships (artist_songz, album_songz, artist_albumz)
    if let Some(artist) = &artist {
        create_artist_song_relationship(artist.rowid, song.rowid).await?;
    }

    if let Some(album) = &album {
        create_album_song_relationship(album.rowid, song.rowid).await?;
    }

    // Create artist-album relationship if both exist
    if let (Some(artist), Some(album)) = (&artist, &album) {
        create_artist_album_relationship(artist.rowid, album.rowid).await?;
    }

    Ok(ImportSongResult {
        song,
        artist,
        album,
        genre,
        created_new_artist,
        created_new_album,
        created_new_genre,
    })
}

/// find existing artist by name or create new one
pub async fn find_or_create_artist(req: ArtistImportRequest) -> GrimoireResult<(Artist, bool)> {
    let pool = database::connect_music().await?;

    // Try to find existing artist by name (case-insensitive)
    let existing = sqlx::query_as!(
        Artist,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            name as "name!",
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM artistz
           WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL
           LIMIT 1"#,
        req.name
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(artist) = existing {
        Ok((artist, false))
    } else {
        let create_req = CreateArtistRequest {
            name: req.name,
            created_by: req.created_by,
        };
        let artist = artists::create_artist(create_req).await?;
        Ok((artist, true))
    }
}

/// find existing album by title or create new one
pub async fn find_or_create_album(req: AlbumImportRequest) -> GrimoireResult<(Album, bool)> {
    let pool = database::connect_music().await?;

    // Try to find existing album by title (case-insensitive)
    let existing = sqlx::query_as!(
        Album,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            album_type as "album_type!",
            release_date,
            release_date_precision,
            label,
            genre_rowid,
            song_count as "song_count!",
            total_duration as "total_duration!",
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM albumz
           WHERE LOWER(title) = LOWER(?) AND deleted_at IS NULL
           LIMIT 1"#,
        req.title
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(album) = existing {
        Ok((album, false))
    } else {
        let create_req = CreateAlbumRequest {
            title: req.title,
            album_type: req.album_type,
            release_date: req.release_date,
            release_date_precision: req.release_date_precision,
            label: req.label,
            genre_rowid: req.genre_rowid,
            created_by: req.created_by,
        };
        let album = albums::create_album(create_req).await?;
        Ok((album, true))
    }
}

/// find existing genre by name or create new one
pub async fn find_or_create_genre(name: String) -> GrimoireResult<(Genre, bool)> {
    let pool = database::connect_music().await?;

    // Try to find existing genre by name (case-insensitive)
    let existing = sqlx::query_as!(
        Genre,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE LOWER(name) = LOWER(?)
           LIMIT 1"#,
        name
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(genre) = existing {
        Ok((genre, false))
    } else {
        let create_req = CreateGenreRequest { name };
        let genre = genres::create_genre(create_req).await?;
        Ok((genre, true))
    }
}

/// create relationship between artist and song
async fn create_artist_song_relationship(artist_rowid: i64, song_rowid: i64) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO artist_songz (artist_rowid, song_rowid) VALUES (?, ?)",
        artist_rowid,
        song_rowid
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// create relationship between album and song
async fn create_album_song_relationship(album_rowid: i64, song_rowid: i64) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO album_songz (album_rowid, song_rowid) VALUES (?, ?)",
        album_rowid,
        song_rowid
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// create relationship between artist and album
async fn create_artist_album_relationship(
    artist_rowid: i64,
    album_rowid: i64,
) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO artist_albumz (artist_rowid, album_rowid) VALUES (?, ?)",
        artist_rowid,
        album_rowid
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// create a song with guaranteed artist and album (simpler version)
pub async fn create_song_with_artist_and_album(
    req: CreateSongWithMetadataRequest,
) -> GrimoireResult<ImportSongResult> {
    let import_req = ImportSongRequest {
        media_blob_id: req.media_blob_id,
        title: req.title,
        artist_name: Some(req.artist_name),
        album_title: Some(req.album_title),
        genre_name: req.genre_name,
        track_number: req.track_number,
        disc_number: req.disc_number,
        duration: req.duration,
        year: req.year,
        bpm: None,
        key_signature: None,
        lyrics: None,
        created_by: req.created_by,
    };

    import_song_with_metadata(import_req).await
}

/// bulk import multiple songs with error handling
pub async fn bulk_import_songs(req: BulkImportRequest) -> GrimoireResult<BulkImportResult> {
    let start_time = std::time::Instant::now();
    let mut successful_imports = Vec::new();
    let mut failed_imports = Vec::new();

    let mut new_artists_created = 0;
    let mut new_albums_created = 0;
    let mut new_genres_created = 0;

    let total_songs = req.songs.len();

    for song_req in req.songs {
        match import_song_with_metadata(song_req.clone()).await {
            Ok(result) => {
                if result.created_new_artist {
                    new_artists_created += 1;
                }
                if result.created_new_album {
                    new_albums_created += 1;
                }
                if result.created_new_genre {
                    new_genres_created += 1;
                }
                successful_imports.push(result);
            }
            Err(err) => {
                let error_type = match err {
                    GrimoireError::MediaBlobNotFound { .. } => {
                        SongImportErrorType::MediaBlobNotFound
                    }
                    GrimoireError::SongNotFound { .. } => SongImportErrorType::DuplicateSong,
                    GrimoireError::ArtistNotFound { .. } => {
                        SongImportErrorType::ArtistCreationFailed
                    }
                    GrimoireError::AlbumNotFound { .. } => SongImportErrorType::AlbumCreationFailed,
                    GrimoireError::GenreNotFound { .. } => SongImportErrorType::GenreCreationFailed,
                    GrimoireError::Database(_) => SongImportErrorType::DatabaseError,
                    _ => SongImportErrorType::ValidationError,
                };

                failed_imports.push(SongImportError {
                    request: song_req,
                    error: err.to_string(),
                    error_type,
                });

                if !req.continue_on_error {
                    break;
                }
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let summary = BulkImportSummary {
        total_songs,
        successful_songs: successful_imports.len(),
        failed_songs: failed_imports.len(),
        new_artists_created,
        new_albums_created,
        new_genres_created,
        duration_ms,
    };

    Ok(BulkImportResult {
        successful_imports,
        failed_imports,
        summary,
    })
}

/// find playlist by name or create new one
pub async fn get_or_create_playlist_by_name(
    name: &str,
    is_public: Option<bool>,
    created_by_rowid: Option<i64>,
) -> GrimoireResult<(Playlist, bool)> {
    let pool = database::connect_music().await?;

    // Try to find existing playlist by name (case-insensitive)
    let existing = sqlx::query_as!(
        Playlist,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            thumbnail_blob_id,
            created_by_rowid,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM playlistz
           WHERE LOWER(title) = LOWER(?)
           LIMIT 1"#,
        name
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(playlist) = existing {
        Ok((playlist, false))
    } else {
        use crate::music::entities::playlists::{create_playlist, CreatePlaylistRequest};

        let create_req = CreatePlaylistRequest {
            title: name.to_string(),
            description: None,
            is_public,
            created_by_rowid,
        };
        let playlist = create_playlist(create_req).await?;
        Ok((playlist, true))
    }
}

/// update song relationships after metadata changes
pub async fn update_song_with_relationships(
    song_id: &str,
    new_artist_name: Option<String>,
    new_album_title: Option<String>,
    new_genre_name: Option<String>,
) -> GrimoireResult<ImportSongResult> {
    let pool = database::connect_music().await?;

    // Get the song
    let song = songs::get_song(song_id).await?;

    // Remove old relationships
    sqlx::query!("DELETE FROM artist_songz WHERE song_rowid = ?", song.rowid)
        .execute(&pool)
        .await?;

    sqlx::query!("DELETE FROM album_songz WHERE song_rowid = ?", song.rowid)
        .execute(&pool)
        .await?;

    // Create new relationships
    let (artist, created_new_artist) = if let Some(artist_name) = new_artist_name {
        let artist_req = ArtistImportRequest {
            name: artist_name,
            created_by: None,
        };
        let (artist, created) = find_or_create_artist(artist_req).await?;
        create_artist_song_relationship(artist.rowid, song.rowid).await?;
        (Some(artist), created)
    } else {
        (None, false)
    };

    let (genre, created_new_genre) = if let Some(genre_name) = new_genre_name {
        let (genre, created) = find_or_create_genre(genre_name).await?;
        (Some(genre), created)
    } else {
        (None, false)
    };

    let (album, created_new_album) = if let Some(album_title) = new_album_title {
        let album_req = AlbumImportRequest {
            title: album_title,
            album_type: Some("album".to_string()),
            release_date: None,
            release_date_precision: None,
            label: None,
            genre_rowid: genre.as_ref().map(|g| g.rowid),
            year: None,
            created_by: None,
        };
        let (album, created) = find_or_create_album(album_req).await?;
        create_album_song_relationship(album.rowid, song.rowid).await?;
        (Some(album), created)
    } else {
        (None, false)
    };

    // Create artist-album relationship if both exist
    if let (Some(artist), Some(album)) = (&artist, &album) {
        create_artist_album_relationship(artist.rowid, album.rowid).await?;
    }

    Ok(ImportSongResult {
        song,
        artist,
        album,
        genre,
        created_new_artist,
        created_new_album,
        created_new_genre,
    })
}

/// import an entire album with all songs and relationships
pub async fn import_album_with_songs(
    album_req: AlbumImportRequest,
    song_requests: Vec<ImportSongRequest>,
) -> GrimoireResult<AlbumImportResult> {
    // Find or create the album
    let (album, created_new_album) = find_or_create_album(album_req).await?;

    // Import all songs for this album
    let bulk_req = BulkImportRequest {
        songs: song_requests,
        continue_on_error: true,
        created_by: None,
    };

    let bulk_result = bulk_import_songs(bulk_req).await?;

    // Extract the songs and related entities
    let songs: Vec<Song> = bulk_result
        .successful_imports
        .iter()
        .map(|r| r.song.clone())
        .collect();
    let artist = bulk_result
        .successful_imports
        .first()
        .and_then(|r| r.artist.clone());
    let genre = bulk_result
        .successful_imports
        .first()
        .and_then(|r| r.genre.clone());

    Ok(AlbumImportResult {
        album,
        songs,
        artist,
        genre,
        created_new_artist: bulk_result.summary.new_artists_created > 0,
        created_new_album,
        created_new_genre: bulk_result.summary.new_genres_created > 0,
        songs_added: bulk_result.summary.successful_songs,
    })
}
