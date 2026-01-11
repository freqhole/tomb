//! service functions for compound music operations
//! high-level workflows that coordinate multiple domain operations

use super::models::{
    AlbumImportRequest, AlbumImportResult, ArtistImportRequest, BulkImportRequest,
    BulkImportResult, BulkImportSummary, CreateSongWithMetadataRequest, ImportSongRequest,
    ImportSongResult, SongImportError, SongImportErrorType,
};
use crate::database;
use crate::error::{ErrorDetail, GrimoireResult};
use crate::music::entities::{
    albums, artists, genres, songs, Album, Artist, CreateAlbumRequest, CreateArtistRequest,
    CreateGenreRequest, CreateSongRequest, Genre, Playlist, Song,
};
use crate::GrimoireResponse;

/// import a song with full metadata, creating related entities as needed
pub async fn import_song_with_metadata(
    req: ImportSongRequest,
) -> GrimoireResponse<ImportSongResult> {
    let _start_time = std::time::Instant::now();

    // 1. Find or create artist
    let (artist, created_new_artist) = if let Some(artist_name) = &req.artist_name {
        let artist_req = ArtistImportRequest {
            name: artist_name.clone(),
            created_by: req.created_by.clone(),
        };
        let (artist, created) = match find_or_create_artist(artist_req).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "artist_creation_failed",
                        "Artist Creation Failed",
                        "Failed to find or create artist",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to import song", errors);
            }
        };
        (Some(artist), created)
    } else {
        (None, false)
    };

    // 2. Find or create genre
    let (genre, created_new_genre) = if let Some(genre_name) = &req.genre_name {
        let (genre, created) = match find_or_create_genre(genre_name.clone()).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "genre_creation_failed",
                        "Genre Creation Failed",
                        "Failed to find or create genre",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to import song", errors);
            }
        };
        (Some(genre), created)
    } else {
        (None, false)
    };

    // 3. Find or create album
    let (album, created_new_album) = if let Some(album_title) = &req.album_title {
        // Has album metadata - create/find real album
        let album_req = AlbumImportRequest {
            title: album_title.clone(),
            album_type: Some("album".to_string()),
            release_date: req.year.map(|y| y.to_string()),
            release_date_precision: req.year.map(|_| "year".to_string()),
            label: None,
            genre_id: genre.as_ref().map(|g| g.id.clone()),
            year: req.year,
            created_by: req.created_by.clone(),
        };
        let (album, created) = match find_or_create_album(album_req).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "album_creation_failed",
                        "Album Creation Failed",
                        "Failed to find or create album",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to import song", errors);
            }
        };
        (Some(album), created)
    } else if let Some(artist) = &artist {
        // Has artist but no album - create artist-specific "Unknown Album"
        let unknown_album_req = AlbumImportRequest {
            title: "Unknown Album".to_string(),
            album_type: Some("album".to_string()),
            release_date: req.year.map(|y| y.to_string()),
            release_date_precision: req.year.map(|_| "year".to_string()),
            label: None,
            genre_id: genre.as_ref().map(|g| g.id.clone()),
            year: req.year,
            created_by: req.created_by.clone(),
        };
        let (album, created) =
            match find_or_create_album_for_artist(unknown_album_req, &artist.id).await {
                Ok(result) => result,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "Failed to find or create unknown album",
                        vec![e.into()],
                    )
                }
            };
        (Some(album), created)
    } else {
        // No artist, no album - will create "Unknown Artist" + their "Unknown Album" later
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

    let song = match songs::create_song(song_req).await {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to create song", vec![e.into()]),
    };

    // 5. Create relationships (artist_songz, album_songz, artist_albumz)
    if let Some(artist) = &artist {
        if let Err(e) = create_artist_song_relationship(&artist.id, &song.id).await {
            return GrimoireResponse::failure(
                "Failed to create artist-song relationship",
                vec![e.into()],
            );
        }
    }

    if let Some(album) = &album {
        if let Err(e) = create_album_song_relationship(&album.id, &song.id).await {
            return GrimoireResponse::failure(
                "Failed to create album-song relationship",
                vec![e.into()],
            );
        }
    }

    // Create artist-album relationship if both exist
    if let (Some(artist), Some(album)) = (&artist, &album) {
        if let Err(e) = create_artist_album_relationship(&artist.id, &album.id).await {
            return GrimoireResponse::failure(
                "Failed to create artist-album relationship",
                vec![e.into()],
            );
        }
    }

    GrimoireResponse::success(
        "Song imported successfully",
        ImportSongResult {
            song,
            artist,
            album,
            genre,
            created_new_artist,
            created_new_album,
            created_new_genre,
        },
    )
}

/// find existing artist by name or create new one
pub async fn find_or_create_artist(req: ArtistImportRequest) -> GrimoireResponse<(Artist, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Try to find existing artist by name (case-insensitive)
    let existing = match sqlx::query_as!(
        Artist,
        r#"SELECT
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
    .await
    {
        Ok(e) => e,
        Err(e) => return GrimoireResponse::failure("Failed to query artist", vec![e.into()]),
    };

    if let Some(artist) = existing {
        GrimoireResponse::success("Artist found", (artist, false))
    } else {
        let create_req = CreateArtistRequest {
            name: req.name,
            created_by: req.created_by,
        };
        let artist = match artists::create_artist(create_req).await {
            Ok(a) => a,
            Err(e) => return GrimoireResponse::failure("Failed to create artist", vec![e.into()]),
        };
        GrimoireResponse::success("Artist created successfully", (artist, true))
    }
}

/// find existing album by title or create new one
pub async fn find_or_create_album(req: AlbumImportRequest) -> GrimoireResponse<(Album, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Try to find existing album by title (case-insensitive)
    let existing = match sqlx::query_as!(
        Album,
        r#"SELECT
            id as "id!",
            title as "title!",
            album_type as "album_type!",
            release_date,
            release_date_precision,
            label,
            genre_id,
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
    .await
    {
        Ok(e) => e,
        Err(e) => return GrimoireResponse::failure("Failed to query album", vec![e.into()]),
    };

    if let Some(album) = existing {
        GrimoireResponse::success("Album found", (album, false))
    } else {
        let create_req = CreateAlbumRequest {
            title: req.title,
            album_type: req.album_type,
            release_date: req.release_date,
            release_date_precision: req.release_date_precision,
            label: req.label,
            genre_id: req.genre_id,
            created_by: req.created_by,
        };
        let album = match albums::create_album(create_req).await {
            Ok(a) => a,
            Err(e) => return GrimoireResponse::failure("Failed to create album", vec![e.into()]),
        };
        GrimoireResponse::success("Album created successfully", (album, true))
    }
}

/// find existing genre by name or create new one
pub async fn find_or_create_genre(name: String) -> GrimoireResponse<(Genre, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Try to find existing genre by name (case-insensitive)
    let existing = match sqlx::query_as!(
        Genre,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE LOWER(name) = LOWER(?)
           LIMIT 1"#,
        name
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(e) => e,
        Err(e) => return GrimoireResponse::failure("Failed to query genre", vec![e.into()]),
    };

    if let Some(genre) = existing {
        GrimoireResponse::success("Genre found", (genre, false))
    } else {
        let create_req = CreateGenreRequest { name };
        let genre = match genres::create_genre(create_req).await {
            Ok(g) => g,
            Err(e) => return GrimoireResponse::failure("Failed to create genre", vec![e.into()]),
        };
        GrimoireResponse::success("Genre created successfully", (genre, true))
    }
}

/// create relationship between artist and song
async fn create_artist_song_relationship(artist_id: &str, song_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
        artist_id,
        song_id
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// create relationship between album and song
async fn create_album_song_relationship(album_id: &str, song_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO album_songz (album_id, song_id) VALUES (?, ?)",
        album_id,
        song_id
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// create relationship between artist and album
async fn create_artist_album_relationship(artist_id: &str, album_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    sqlx::query!(
        "INSERT OR IGNORE INTO artist_albumz (artist_id, album_id) VALUES (?, ?)",
        artist_id,
        album_id
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// find existing album for specific artist or create new one (for artist-specific "Unknown Album")
async fn find_or_create_album_for_artist(
    req: AlbumImportRequest,
    artist_id: &str,
) -> GrimoireResult<(Album, bool)> {
    let pool = database::connect().await?;

    // Look for existing album by this specific artist with the same title
    let existing = sqlx::query_as!(
        Album,
        r#"SELECT
            al.id as "id!",
            al.title as "title!",
            al.album_type as "album_type!",
            al.release_date,
            al.release_date_precision,
            al.label,
            al.genre_id,
            al.song_count as "song_count!",
            al.total_duration as "total_duration!",
            al.created_at as "created_at!",
            al.updated_at as "updated_at!",
            al.deleted_at,
            al.deleted_by,
            al.created_by,
            al.updated_by
           FROM albumz al
           JOIN artist_albumz aa ON al.id = aa.album_id
           WHERE LOWER(al.title) = LOWER(?) AND aa.artist_id = ? AND al.deleted_at IS NULL
           LIMIT 1"#,
        req.title,
        artist_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(album) = existing {
        Ok((album, false))
    } else {
        // Create new album for this artist
        let create_req = CreateAlbumRequest {
            title: req.title,
            album_type: req.album_type,
            release_date: req.release_date,
            release_date_precision: req.release_date_precision,
            label: req.label,
            genre_id: req.genre_id,
            created_by: req.created_by,
        };
        let album = albums::create_album(create_req).await?;

        // Create artist-album relationship immediately
        create_artist_album_relationship(artist_id, &album.id).await?;

        Ok((album, true))
    }
}

/// create a song with guaranteed artist and album (simpler version)
pub async fn create_song_with_artist_and_album(
    req: CreateSongWithMetadataRequest,
) -> GrimoireResponse<ImportSongResult> {
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
pub async fn bulk_import_songs(req: BulkImportRequest) -> GrimoireResponse<BulkImportResult> {
    let start_time = std::time::Instant::now();
    let mut successful_imports = Vec::new();
    let mut failed_imports = Vec::new();

    let mut new_artists_created = 0;
    let mut new_albums_created = 0;
    let mut new_genres_created = 0;

    let total_songs = req.songs.len();

    for song_req in req.songs {
        match import_song_with_metadata(song_req.clone()).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => {
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
            response => {
                // Extract error message from response
                let error_message = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message.clone()
                };

                // Determine error type based on error_type field in ErrorDetail
                let error_type = if !response.errors.is_empty() {
                    match response.errors[0].error_type.as_str() {
                        "media_blob_not_found" => SongImportErrorType::MediaBlobNotFound,
                        "song_not_found" => SongImportErrorType::DuplicateSong,
                        "artist_not_found" | "artist_creation_failed" => {
                            SongImportErrorType::ArtistCreationFailed
                        }
                        "album_not_found" | "album_creation_failed" => {
                            SongImportErrorType::AlbumCreationFailed
                        }
                        "genre_not_found" | "genre_creation_failed" => {
                            SongImportErrorType::GenreCreationFailed
                        }
                        "database" => SongImportErrorType::DatabaseError,
                        _ => SongImportErrorType::ValidationError,
                    }
                } else {
                    SongImportErrorType::ValidationError
                };

                failed_imports.push(SongImportError {
                    request: song_req,
                    error: error_message,
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

    GrimoireResponse::success(
        "Bulk import completed",
        BulkImportResult {
            successful_imports,
            failed_imports,
            summary,
        },
    )
}

/// find playlist by name or create new one
pub async fn get_or_create_playlist_by_name(
    name: &str,
    is_public: Option<bool>,
    created_by_id: Option<String>,
) -> GrimoireResponse<(Playlist, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Try to find existing playlist by name (case-insensitive)
    let existing = match sqlx::query_as!(
        Playlist,
        r#"SELECT
            p.id as "id!",
            p.title as "title!",
            p.description,
            p.is_public as "is_public!",
            p.thumbnail_blob_id,
            p.created_by_id,
            p.created_at as "created_at!",
            p.updated_at as "updated_at!",
            p.deleted_at,
            p.deleted_by,
            p.created_by,
            p.updated_by,
            COALESCE(COUNT(ps.song_id), 0) as "song_count!: i64"
           FROM playlistz p
           LEFT JOIN playlist_songz ps ON p.id = ps.playlist_id
           WHERE LOWER(p.title) = LOWER(?)
           GROUP BY p.id
           LIMIT 1"#,
        name
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(e) => e,
        Err(e) => return GrimoireResponse::failure("Failed to query playlist", vec![e.into()]),
    };

    if let Some(playlist) = existing {
        GrimoireResponse::success("Playlist found", (playlist, false))
    } else {
        use crate::music::entities::playlists::{create_playlist, CreatePlaylistRequest};

        let create_req = CreatePlaylistRequest {
            title: Some(name.to_string()),
            description: None,
            is_public,
            created_by_id,
        };
        let playlist = match create_playlist(create_req).await {
            Ok(p) => p,
            Err(e) => {
                return GrimoireResponse::failure("Failed to create playlist", vec![e.into()])
            }
        };
        GrimoireResponse::success("Playlist created successfully", (playlist, true))
    }
}

/// update song relationships after metadata changes
pub async fn update_song_with_relationships(
    song_id: &str,
    new_artist_name: Option<String>,
    new_album_title: Option<String>,
    new_genre_name: Option<String>,
) -> GrimoireResponse<ImportSongResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get the song
    let song = match songs::get_song(song_id).await {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to get song", vec![e.into()]),
    };

    // Remove old relationships
    if let Err(e) = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song.id)
        .execute(&pool)
        .await
    {
        return GrimoireResponse::failure("Failed to delete artist relationships", vec![e.into()]);
    }

    if let Err(e) = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song.id)
        .execute(&pool)
        .await
    {
        return GrimoireResponse::failure("Failed to delete album relationships", vec![e.into()]);
    }

    // Create new relationships
    let (artist, created_new_artist) = if let Some(artist_name) = new_artist_name {
        let artist_req = ArtistImportRequest {
            name: artist_name,
            created_by: None,
        };
        let (artist, created) = match find_or_create_artist(artist_req).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "artist_creation_failed",
                        "Artist Creation Failed",
                        "Failed to find or create artist",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to update song relationships", errors);
            }
        };
        if let Err(e) = create_artist_song_relationship(&artist.id, &song.id).await {
            return GrimoireResponse::failure(
                "Failed to create artist-song relationship",
                vec![e.into()],
            );
        }
        (Some(artist), created)
    } else {
        (None, false)
    };

    let (genre, created_new_genre) = if let Some(genre_name) = new_genre_name {
        let (genre, created) = match find_or_create_genre(genre_name).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "genre_creation_failed",
                        "Genre Creation Failed",
                        "Failed to find or create genre",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to update song relationships", errors);
            }
        };
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
            genre_id: genre.as_ref().map(|g| g.id.clone()),
            year: None,
            created_by: None,
        };
        let (album, created) = match find_or_create_album(album_req).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "album_creation_failed",
                        "Album Creation Failed",
                        "Failed to find or create album",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("Failed to update song relationships", errors);
            }
        };
        if let Err(e) = create_album_song_relationship(&album.id, &song.id).await {
            return GrimoireResponse::failure(
                "Failed to create album-song relationship",
                vec![e.into()],
            );
        }
        (Some(album), created)
    } else {
        (None, false)
    };

    // Create artist-album relationship if both exist
    if let (Some(artist), Some(album)) = (&artist, &album) {
        if let Err(e) = create_artist_album_relationship(&artist.id, &album.id).await {
            return GrimoireResponse::failure(
                "Failed to create artist-album relationship",
                vec![e.into()],
            );
        }
    }

    GrimoireResponse::success(
        "Song relationships updated successfully",
        ImportSongResult {
            song,
            artist,
            album,
            genre,
            created_new_artist,
            created_new_album,
            created_new_genre,
        },
    )
}

/// import an entire album with all songs and relationships
pub async fn import_album_with_songs(
    album_req: AlbumImportRequest,
    song_requests: Vec<ImportSongRequest>,
) -> GrimoireResponse<AlbumImportResult> {
    // Find or create the album
    let (album, created_new_album) = match find_or_create_album(album_req).await {
        GrimoireResponse {
            success: true,
            data: Some(result),
            ..
        } => result,
        response => {
            let errors = if response.errors.is_empty() {
                vec![ErrorDetail::new(
                    "album_creation_failed",
                    "Album Creation Failed",
                    "Failed to find or create album",
                )]
            } else {
                response.errors
            };
            return GrimoireResponse::failure("Failed to import album", errors);
        }
    };

    // Import all songs for this album
    let bulk_req = BulkImportRequest {
        songs: song_requests,
        continue_on_error: true,
        created_by: None,
    };

    let bulk_result = match bulk_import_songs(bulk_req).await {
        GrimoireResponse {
            success: true,
            data: Some(result),
            ..
        } => result,
        response => {
            let errors = if response.errors.is_empty() {
                vec![ErrorDetail::new(
                    "bulk_import_failed",
                    "Bulk Import Failed",
                    "Failed to import songs",
                )]
            } else {
                response.errors
            };
            return GrimoireResponse::failure("Failed to import album", errors);
        }
    };

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

    GrimoireResponse::success(
        "Album imported successfully",
        AlbumImportResult {
            album,
            songs,
            artist,
            genre,
            created_new_artist: bulk_result.summary.new_artists_created > 0,
            created_new_album,
            created_new_genre: bulk_result.summary.new_genres_created > 0,
            songs_added: bulk_result.summary.successful_songs,
        },
    )
}
