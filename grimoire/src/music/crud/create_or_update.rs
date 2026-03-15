//! service functions for compound music operations
//! high-level workflows that coordinate multiple domain operations

use super::models::{
    AlbumImportRequest, ArtistImportRequest, BulkImportRequest, BulkImportResult,
    BulkImportSummary, CreateSongWithMetadataRequest, ImageMetadata, ImportSongRequest,
    ImportSongResult, SongImportError, SongImportErrorType,
};
use crate::config;
use crate::database;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::jobs::apply_directory_tags_for_file;
use crate::media_blobz::get_media_blob;
use crate::music::analytics::feed_events::upsert_album_feed_event;
use crate::music::entities::{
    albums, artists, genres, songs, Album, Artist, CreateAlbumRequest, CreateArtistRequest,
    CreateGenreRequest, CreateSongRequest, Genre, Playlist,
};
use crate::music::EntityUrl;
use crate::GrimoireResponse;
use crate::JsonVec;
use std::sync::Mutex;

// global duplicate report tracker (CSV rows accumulated during scan)
static DUPLICATE_REPORT: Mutex<Option<Vec<DuplicateReportRow>>> = Mutex::new(None);

/// duplicate report row for CSV export
#[derive(Debug, Clone)]
struct DuplicateReportRow {
    skipped_file_path: String,
    artist: String,
    album: String,
    title: String,
    disc_number: i64,
    track_number: i64,
    duration_ms: i64,
    existing_song_id: String,
    existing_file_path: Option<String>,
}

/// initialize duplicate report tracking (call at start of scan)
pub fn init_duplicate_report() {
    let config = config::get_config();
    if config.media.generate_scan_duplicate_report {
        *DUPLICATE_REPORT.lock().unwrap() = Some(Vec::new());
    }
}

/// write duplicate report to CSV file (call at end of scan)
pub fn write_duplicate_report() -> Result<(), std::io::Error> {
    let config = config::get_config();
    if !config.media.generate_scan_duplicate_report {
        return Ok(());
    }

    let rows = DUPLICATE_REPORT.lock().unwrap().take();
    if let Some(rows) = rows {
        if rows.is_empty() {
            return Ok(());
        }

        let report_path = config.data_dir.join("duplicate_report.csv");
        let row_count = rows.len(); // save length before consuming
        let mut wtr = csv::Writer::from_path(&report_path)?;

        // write header
        wtr.write_record(&[
            "skipped_file_path",
            "artist",
            "album",
            "title",
            "disc_number",
            "track_number",
            "duration_ms",
            "existing_song_id",
            "existing_file_path",
        ])?;

        // write rows
        for row in rows {
            wtr.write_record(&[
                &row.skipped_file_path,
                &row.artist,
                &row.album,
                &row.title,
                &row.disc_number.to_string(),
                &row.track_number.to_string(),
                &row.duration_ms.to_string(),
                &row.existing_song_id,
                &row.existing_file_path.unwrap_or_default(),
            ])?;
        }

        wtr.flush()?;
        tracing::info!(
            "wrote duplicate report: {} rows to {:?}",
            row_count,
            report_path
        );
    }

    Ok(())
}

/// import a song with full metadata, creating related entities as needed
pub async fn import_song_with_metadata(
    req: ImportSongRequest,
) -> GrimoireResponse<ImportSongResult> {
    let _start_time = std::time::Instant::now();

    // 0. Check for duplicate songs (skip if artist + album + title + track/disc + duration match)
    // only check if config enables it and we have valid artist, album, and a positive duration
    let config = config::get_config();
    if config.media.skip_duplicates {
        if let (Some(artist_name), Some(album_title), Some(duration)) =
            (&req.artist_name, &req.album_title, &req.duration)
        {
            // only perform duplicate check if duration is a valid positive number
            if *duration > 0 {
                let dup_check_start = std::time::Instant::now();
                let pool = match database::connect().await {
                    Ok(p) => p,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to connect to database",
                            vec![e.into()],
                        );
                    }
                };

                // check for existing song with same artist, album, title, track/disc, and similar duration (±3 seconds)
                let duration_tolerance_ms = 3000; // 3 seconds
                let duration_min = duration - duration_tolerance_ms;
                let duration_max = duration + duration_tolerance_ms;

                let existing_song = sqlx::query!(
                    r#"
                SELECT s.id as "id!", s.title as "title!", s.duration, mb.local_path,
                       alb.id as "album_id!", alb.title as "album_title!"
                FROM songz s
                JOIN artist_songz asz ON asz.song_id = s.id
                JOIN artistz a ON a.id = asz.artist_id
                JOIN album_songz als ON als.song_id = s.id
                JOIN albumz alb ON alb.id = als.album_id
                LEFT JOIN media_blobz mb ON mb.id = s.media_blob_id
                WHERE LOWER(a.name) = LOWER(?)
                  AND LOWER(alb.title) = LOWER(?)
                  AND LOWER(s.title) = LOWER(?)
                  AND s.track_number = ?
                  AND s.disc_number = ?
                  AND s.duration BETWEEN ? AND ?
                  AND s.deleted_at IS NULL
                LIMIT 1
                "#,
                    artist_name,
                    album_title,
                    req.title,
                    req.track_number,
                    req.disc_number,
                    duration_min,
                    duration_max
                )
                .fetch_optional(&pool)
                .await;

                let dup_check_elapsed = dup_check_start.elapsed();
                tracing::debug!("duplicate check took {:?}", dup_check_elapsed);

                if let Ok(Some(existing)) = existing_song {
                    let duration_str = existing
                        .duration
                        .map(|d| format!("{}ms", d))
                        .unwrap_or_else(|| "unknown".to_string());

                    tracing::info!(
                        "skipping duplicate song: artist='{}', album='{}', track {}/{}, title='{}', duration={} (existing song_id: {})",
                        artist_name,
                        album_title,
                        req.disc_number,
                        req.track_number,
                        req.title,
                        duration_str,
                        existing.id
                    );

                    // add to duplicate report if enabled
                    if config.media.generate_scan_duplicate_report {
                        if let Ok(mut report) = DUPLICATE_REPORT.lock() {
                            if let Some(ref mut rows) = *report {
                                rows.push(DuplicateReportRow {
                                    skipped_file_path: req.media_blob_id.clone(), // this is actually the file path in this context
                                    artist: artist_name.clone(),
                                    album: album_title.clone(),
                                    title: req.title.clone(),
                                    disc_number: req.disc_number,
                                    track_number: req.track_number,
                                    duration_ms: *duration,
                                    existing_song_id: existing.id.clone(),
                                    existing_file_path: existing.local_path.clone(),
                                });
                            }
                        }
                    }

                    // apply directory tag rules to album even for duplicates
                    // this ensures tags are applied during rescan after rules are added
                    if let Some(local_path) = &existing.local_path {
                        let tag_result =
                            apply_directory_tags_for_file(&existing.album_id, local_path).await;
                        if tag_result.success {
                            if let Some(applied_tags) = &tag_result.data {
                                if !applied_tags.is_empty() {
                                    tracing::debug!(
                                        "applied {} directory tags to album '{}' for duplicate song",
                                        applied_tags.len(),
                                        existing.album_title
                                    );
                                }
                            }
                        }
                    }

                    // skip this import - duplicate found
                    // return an error that signals duplicate detection
                    return GrimoireResponse::failure(
                        "Duplicate song detected and skipped",
                        vec![ErrorDetail::new(
                            "duplicate_song",
                            "Duplicate Song",
                            format!(
                                "Song with artist '{}', album '{}', disc {}, track {}, and similar duration already exists (song_id: {})",
                                artist_name, album_title, req.disc_number, req.track_number, existing.id
                            ),
                        )],
                    );
                }
            }
        }
    }

    // 1. Find or create artist
    let (mut artist, created_new_artist) = if let Some(artist_name) = &req.artist_name {
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

    // 2. Find or create genres (split on comma for multiple genres)
    let (genres, created_any_genre) = if let Some(genre_name) = &req.genre_name {
        // split genre string on comma to support multiple genres
        let genre_names: Vec<String> = genre_name
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let mut found_genres = Vec::new();
        let mut created_any = false;

        for name in genre_names {
            match find_or_create_genre(name.clone()).await {
                GrimoireResponse {
                    success: true,
                    data: Some((genre, created)),
                    ..
                } => {
                    if created {
                        created_any = true;
                    }
                    found_genres.push(genre);
                }
                response => {
                    let errors = if response.errors.is_empty() {
                        vec![ErrorDetail::new(
                            "genre_creation_failed",
                            "Genre Creation Failed",
                            &format!("failed to find or create genre: {}", name),
                        )]
                    } else {
                        response.errors
                    };
                    return GrimoireResponse::failure("failed to import song", errors);
                }
            }
        }
        (found_genres, created_any)
    } else {
        (Vec::new(), false)
    };

    // 3. Find or create album
    let (album, created_new_album) = if let Some(album_title) = &req.album_title {
        // if we have album but no artist, create "Unknown Artist" first
        if artist.is_none() {
            let unknown_artist_req = ArtistImportRequest {
                name: "Unknown Artist".to_string(),
                created_by: req.created_by.clone(),
            };
            let (unknown_artist, _created) = match find_or_create_artist(unknown_artist_req).await {
                GrimoireResponse {
                    success: true,
                    data: Some(result),
                    ..
                } => result,
                response => {
                    let errors = if response.errors.is_empty() {
                        vec![ErrorDetail::new(
                            "artist_creation_failed",
                            "Unknown Artist Creation Failed",
                            "failed to find or create unknown artist",
                        )]
                    } else {
                        response.errors
                    };
                    return GrimoireResponse::failure("failed to import song", errors);
                }
            };
            artist = Some(unknown_artist);
        }

        // now we have an artist, create album scoped to that artist
        let genre_ids: Option<Vec<String>> = if genres.is_empty() {
            None
        } else {
            Some(genres.iter().map(|g| g.id.clone()).collect())
        };
        let album_req = AlbumImportRequest {
            title: album_title.clone(),
            album_type: Some(if req.is_compilation {
                "compilation".to_string()
            } else {
                "album".to_string()
            }),
            release_date: req.year.map(|y| y.to_string()),
            label: None,
            genre_ids,
            created_by: req.created_by.clone(),
        };
        let (album, created) =
            match find_or_create_album_for_artist(album_req, &artist.as_ref().unwrap().id).await {
                Ok(result) => result,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "Failed to find or create album",
                        vec![e.into()],
                    )
                }
            };

        (Some(album), created)
    } else if let Some(artist) = &artist {
        // Has artist but no album - create artist-specific "Unknown Album"
        let genre_ids: Option<Vec<String>> = if genres.is_empty() {
            None
        } else {
            Some(genres.iter().map(|g| g.id.clone()).collect())
        };
        let unknown_album_req = AlbumImportRequest {
            title: "Unknown Album".to_string(),
            album_type: Some("album".to_string()),
            release_date: req.year.map(|y| y.to_string()),
            label: None,
            genre_ids,
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
        // No artist, no album - create "Unknown Artist" and their "Unknown Album"
        let unknown_artist_req = ArtistImportRequest {
            name: "Unknown Artist".to_string(),
            created_by: req.created_by.clone(),
        };
        let (unknown_artist, created) = match find_or_create_artist(unknown_artist_req).await {
            GrimoireResponse {
                success: true,
                data: Some(result),
                ..
            } => result,
            response => {
                let errors = if response.errors.is_empty() {
                    vec![ErrorDetail::new(
                        "artist_creation_failed",
                        "Unknown Artist Creation Failed",
                        "failed to find or create unknown artist",
                    )]
                } else {
                    response.errors
                };
                return GrimoireResponse::failure("failed to import song", errors);
            }
        };

        let genre_ids: Option<Vec<String>> = if genres.is_empty() {
            None
        } else {
            Some(genres.iter().map(|g| g.id.clone()).collect())
        };
        let unknown_album_req = AlbumImportRequest {
            title: "Unknown Album".to_string(),
            album_type: Some("album".to_string()),
            release_date: req.year.map(|y| y.to_string()),
            label: None,
            genre_ids,
            created_by: req.created_by.clone(),
        };
        let (unknown_album, album_created) =
            match find_or_create_album_for_artist(unknown_album_req, &unknown_artist.id).await {
                Ok(result) => result,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to find or create unknown album",
                        vec![e.into()],
                    )
                }
            };

        // Update artist to Some for relationship creation
        artist = Some(unknown_artist);
        (Some(unknown_album), album_created || created)
    };

    // 4. Create the song
    let song_req = CreateSongRequest {
        media_blob_id: req.media_blob_id,
        title: req.title,
        track_number: req.track_number,
        disc_number: req.disc_number,
        duration: req.duration,
        bpm: req.bpm,
        track_artist: req.track_artist,
        metadata: req.metadata,
        lyrics: req.lyrics,
        created_by: req.created_by,
    };

    let song_response = songs::create_song(song_req).await;
    if !song_response.success {
        return GrimoireResponse::failure("Failed to create song", song_response.errors);
    }
    let song = match song_response.data {
        Some(s) => s,
        None => return GrimoireResponse::failure("No song returned after creation", vec![]),
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

    // 6. Apply directory tag rules to album if applicable
    if let Some(album) = &album {
        // get file path from media blob to check directory tag rules
        if let Ok(media_blob) = get_media_blob(&song.media_blob_id).await {
            if let Some(local_path) = &media_blob.local_path {
                let tag_result = apply_directory_tags_for_file(&album.id, local_path).await;
                if tag_result.success {
                    if let Some(applied_tags) = &tag_result.data {
                        if !applied_tags.is_empty() {
                            tracing::debug!(
                                "applied {} directory tags to album '{}' from file '{}'",
                                applied_tags.len(),
                                album.title,
                                local_path
                            );
                        }
                    }
                }
            }
        }
    }

    GrimoireResponse::success(
        "Song imported successfully",
        ImportSongResult {
            song,
            artist,
            album,
            genres,
            created_new_artist,
            created_new_album,
            created_new_genre: created_any_genre,
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
            bio,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            NULL as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>"
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
        let artist_response = artists::create_artist(create_req).await;
        if !artist_response.success {
            return GrimoireResponse::failure("Failed to create artist", artist_response.errors);
        }
        let artist = match artist_response.data {
            Some(a) => a,
            None => return GrimoireResponse::failure("No artist returned after creation", vec![]),
        };
        GrimoireResponse::success("Artist created successfully", (artist, true))
    }
}

/// find existing album by title or create new one

/// get current artist for a song (returns first artist if multiple exist)
pub async fn get_current_artist_for_song(song_id: &str) -> GrimoireResult<Option<Artist>> {
    let pool = database::connect().await?;

    let artist_id = sqlx::query_scalar!(
        "SELECT artist_id FROM artist_songz WHERE song_id = ? LIMIT 1",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(artist_id) = artist_id {
        let artist = sqlx::query_as!(
            Artist,
            r#"SELECT
                id as "id!",
                name as "name!",
                bio,
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                deleted_by,
                created_by,
                updated_by,
                NULL as "images?: JsonVec<ImageMetadata>",
                NULL as "urls?: JsonVec<EntityUrl>"
            FROM artistz WHERE id = ? AND deleted_at IS NULL"#,
            artist_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(artist)
    } else {
        Ok(None)
    }
}

/// get current album for a song (returns first album if multiple exist)
pub async fn get_current_album_for_song(song_id: &str) -> GrimoireResult<Option<Album>> {
    let pool = database::connect().await?;

    let album_id = sqlx::query_scalar!(
        "SELECT album_id FROM album_songz WHERE song_id = ? LIMIT 1",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(album_id) = album_id {
        let album = sqlx::query!(
            r#"SELECT
                id as "id!",
                title as "title!",
                album_type as "album_type!",
                release_date,
                label,
                song_count as "song_count!",
                total_duration as "total_duration!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                deleted_by,
                created_by,
                updated_by
            FROM albumz WHERE id = ? AND deleted_at IS NULL"#,
            album_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(album.map(|row| Album {
            id: row.id,
            title: row.title,
            album_type: row.album_type,
            release_date: row.release_date,
            label: row.label,
            genres: None,
            images: None,
            urls: None,
            song_count: row.song_count,
            total_duration: row.total_duration,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            deleted_by: row.deleted_by,
            created_by: row.created_by,
            updated_by: row.updated_by,
            created_by_username: None,
            updated_by_username: None,
        }))
    } else {
        Ok(None)
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
        let genre_response = genres::create_genre(create_req).await;
        if !genre_response.success {
            return GrimoireResponse::failure("Failed to create genre", genre_response.errors);
        }
        let genre = match genre_response.data {
            Some(g) => g,
            None => return GrimoireResponse::failure("No genre returned after creation", vec![]),
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
pub async fn find_or_create_album_for_artist(
    req: AlbumImportRequest,
    artist_id: &str,
) -> GrimoireResult<(Album, bool)> {
    let pool = database::connect().await?;

    // Look for existing album by this specific artist with the same title
    let existing = sqlx::query!(
        r#"SELECT
            al.id as "id!",
            al.title as "title!",
            al.album_type as "album_type!",
            al.release_date,
            al.label,
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

    if let Some(row) = existing {
        Ok((
            Album {
                id: row.id,
                title: row.title,
                album_type: row.album_type,
                release_date: row.release_date,
                label: row.label,
                genres: None,
                images: None,
                urls: None,
                song_count: row.song_count,
                total_duration: row.total_duration,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
                deleted_by: row.deleted_by,
                created_by: row.created_by,
                updated_by: row.updated_by,
                created_by_username: None,
                updated_by_username: None,
            },
            false,
        ))
    } else {
        // Create new album for this artist
        let created_by = req.created_by.clone(); // save for feed event
        let create_req = CreateAlbumRequest {
            title: req.title,
            album_type: req.album_type,
            release_date: req.release_date,
            label: req.label,
            created_by: req.created_by,
        };
        let album_response = albums::create_album(create_req).await;
        if !album_response.success {
            return Err(GrimoireError::ProcessingFailed {
                message: album_response.message,
            });
        }
        let album = match album_response.data {
            Some(a) => a,
            None => {
                return Err(GrimoireError::ProcessingFailed {
                    message: "No album returned after creation".to_string(),
                })
            }
        };

        // Create artist-album relationship immediately
        create_artist_album_relationship(artist_id, &album.id).await?;

        // Add genres to the junction table if provided
        if let Some(genre_ids) = req.genre_ids {
            for genre_id in &genre_ids {
                let _ = sqlx::query!(
                    "INSERT OR IGNORE INTO album_genrez (album_id, genre_id) VALUES (?, ?)",
                    album.id,
                    genre_id
                )
                .execute(&pool)
                .await;
            }
        }

        // create feed event for new album (async, fire-and-forget)
        if let Some(ref user_id) = created_by {
            let aid = album.id.clone();
            let uid = user_id.clone();
            tokio::spawn(async move {
                // lookup username
                if let Ok(pool) = database::connect().await {
                    if let Ok(Some(username)) =
                        sqlx::query_scalar!("SELECT username FROM user_accountz WHERE id = ?", uid)
                            .fetch_optional(&pool)
                            .await
                    {
                        let _ = upsert_album_feed_event(&aid, &uid, &username, 1).await;
                    }
                }
            });
        }

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
        track_artist: None,
        metadata: None,
        lyrics: None,
        created_by: req.created_by,
        is_compilation: false,
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
            NULL as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>",
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
        let playlist_response = create_playlist(create_req).await;
        if !playlist_response.success {
            return GrimoireResponse::failure(
                "Failed to create playlist",
                playlist_response.errors,
            );
        }
        let playlist = match playlist_response.data {
            Some(p) => p,
            None => {
                return GrimoireResponse::failure("No playlist returned after creation", vec![])
            }
        };
        GrimoireResponse::success("Playlist created successfully", (playlist, true))
    }
}

/// add a URL to an entity (artist, album, song, playlist)
/// will not duplicate if the same URL already exists for this entity
pub async fn add_entity_url(
    entity_type: &str,
    entity_id: &str,
    name: Option<String>,
    url: &str,
) -> GrimoireResult<Option<String>> {
    let pool = database::connect().await?;

    // check if this URL already exists for this entity
    let existing = sqlx::query!(
        r#"SELECT id FROM entity_urlz
           WHERE entity_type = ? AND entity_id = ? AND url = ?"#,
        entity_type,
        entity_id,
        url
    )
    .fetch_optional(&pool)
    .await?;

    if existing.is_some() {
        // URL already exists, skip
        return Ok(None);
    }

    // insert the new URL
    let result = sqlx::query!(
        r#"INSERT INTO entity_urlz (entity_type, entity_id, name, url)
           VALUES (?, ?, ?, ?)
           RETURNING id as "id!""#,
        entity_type,
        entity_id,
        name,
        url
    )
    .fetch_one(&pool)
    .await?;

    Ok(Some(result.id))
}

/// extract URLs from a text string (like ID3 comment tag)
/// looks for http:// or https:// prefixes and extracts the full URL
pub fn extract_urls_from_text(text: &str) -> Vec<String> {
    let mut urls = Vec::new();

    // simple regex-like extraction: find http:// or https:// and grab until whitespace or end
    for word in text.split_whitespace() {
        if word.starts_with("http://") || word.starts_with("https://") {
            // clean up trailing punctuation that might be attached
            let url = word.trim_end_matches(|c: char| {
                c == ',' || c == '.' || c == ')' || c == ']' || c == '>'
            });
            if !url.is_empty() {
                urls.push(url.to_string());
            }
        }
    }

    urls
}

/// extract the domain name from a URL for use as a label
/// e.g. "https://some-artist.bandcamp.com/album/test" -> "bandcamp"
pub fn extract_url_domain_label(url: &str) -> Option<String> {
    // parse the URL and extract the host
    let url_lower = url.to_lowercase();

    // strip protocol
    let without_protocol = url_lower
        .strip_prefix("https://")
        .or_else(|| url_lower.strip_prefix("http://"))?;

    // get the host part (before the first /)
    let host = without_protocol.split('/').next()?;

    // remove www. prefix if present
    let host = host.strip_prefix("www.").unwrap_or(host);

    // extract meaningful domain label
    // for subdomains like "artist.bandcamp.com", we want "bandcamp"
    // for regular domains like "discogs.com", we want "discogs"
    let parts: Vec<&str> = host.split('.').collect();

    if parts.len() >= 2 {
        // check for known services with subdomains
        let known_services = [
            "bandcamp",
            "soundcloud",
            "spotify",
            "youtube",
            "youtu",
            "discogs",
            "musicbrainz",
            "lastfm",
            "beatport",
            "apple",
            "amazon",
            "deezer",
            "tidal",
            "facebook",
            "instagram",
            "twitter",
            "wikipedia",
        ];

        // look if any of the parts match a known service
        for part in &parts {
            if known_services.contains(part) {
                return Some(part.to_string());
            }
        }

        // fallback: use the second-to-last part (main domain name)
        // e.g., "example.com" -> "example", "sub.example.co.uk" -> "example"
        let idx = if parts.len() >= 3
            && (parts[parts.len() - 1] == "uk"
                || parts[parts.len() - 1] == "au"
                || parts[parts.len() - 1] == "jp")
        {
            parts.len().saturating_sub(3)
        } else {
            parts.len().saturating_sub(2)
        };

        Some(parts[idx].to_string())
    } else {
        // just one part? return it
        Some(host.to_string())
    }
}
