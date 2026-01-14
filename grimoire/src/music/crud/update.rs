//! update operations for songs and related entities
//! supports single and bulk updates with relationship management

use super::models::{
    AlbumImportRequest, ArtistImportRequest, FavoriteTargetType, RatingTargetType,
    UpdateSongsRequest, UpdateSongsResult,
};
use crate::blob_data::{convert_to_webp, create_image_blob_from_webp_data};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::media_blobz::BlobType;
use crate::music::crud::{find_or_create_album, find_or_create_artist, find_or_create_genre};
use crate::music::entities::genres::{create_sub_genre, CreateSubGenreRequest};
use crate::music::entities::tags::{
    add_album_tags, find_or_create_tags, remove_album_tags, replace_album_tags,
};
use crate::music::entities::{songs, SubGenre};
use crate::response::GrimoireResponse;

/// update songs with optional fields and relationships
pub async fn update_songs(req: UpdateSongsRequest) -> GrimoireResponse<UpdateSongsResult> {
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![err.into()]);
        }
    };

    // validate song_ids not empty
    if req.song_ids.is_empty() {
        return GrimoireResponse::failure(
            "Validation failed",
            vec![GrimoireError::Validation {
                field: "song_ids".to_string(),
                message: "song_ids cannot be empty".to_string(),
            }
            .into()],
        );
    }

    // verify all songs exist
    for song_id in &req.song_ids {
        let song_response = songs::get_song(song_id).await;
        if !song_response.success {
            return GrimoireResponse::failure(
                &format!("Song not found: {}", song_id),
                song_response.errors,
            );
        }
    }

    // handle thumbnail if provided
    let thumbnail_blob_id = if let Some(file_path) = req.thumbnail_from_file {
        // read file and convert to webp
        let image_data = match tokio::fs::read(&file_path).await {
            Ok(data) => data,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to read thumbnail file",
                    vec![GrimoireError::ProcessingFailed {
                        message: format!("Failed to read thumbnail file: {}", e),
                    }
                    .into()],
                );
            }
        };

        let webp_data = match convert_to_webp(&image_data) {
            Ok(data) => data,
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to convert thumbnail to webp",
                    vec![err.into()],
                );
            }
        };

        // create or find blob
        let metadata = serde_json::json!({
            "type": "thumbnail",
            "source": "user_upload",
            "format": "webp"
        });

        match create_image_blob_from_webp_data(
            webp_data,
            BlobType::Original,
            None, // no parent blob
            metadata,
            req.updated_by.clone(),
        )
        .await
        {
            response if response.success => match response.data {
                Some(blob_id) => Some(blob_id),
                None => {
                    return GrimoireResponse::failure(
                        "Failed to create thumbnail blob: no data returned",
                        vec![],
                    );
                }
            },
            response => {
                return GrimoireResponse::failure(
                    "Failed to create thumbnail blob",
                    response.errors,
                );
            }
        }
    } else if let Some(bytes) = req.thumbnail_from_bytes {
        let webp_data = match convert_to_webp(bytes.as_ref()) {
            Ok(data) => data,
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to convert thumbnail to webp",
                    vec![err.into()],
                );
            }
        };

        let metadata = serde_json::json!({
            "type": "thumbnail",
            "source": "user_upload",
            "format": "webp"
        });

        match create_image_blob_from_webp_data(
            webp_data,
            BlobType::Original,
            None, // no parent blob
            metadata,
            req.updated_by.clone(),
        )
        .await
        {
            response if response.success => match response.data {
                Some(blob_id) => Some(blob_id),
                None => {
                    return GrimoireResponse::failure(
                        "Failed to create thumbnail blob from bytes: no data returned",
                        vec![],
                    );
                }
            },
            response => {
                return GrimoireResponse::failure(
                    "Failed to create thumbnail blob from bytes",
                    response.errors,
                );
            }
        }
    } else if let Some(blob_id) = req.thumbnail_blob_id {
        Some(blob_id)
    } else {
        None
    };

    // resolve relationships first (find or create once, reuse for all songs)
    let artist = if let Some(artist_req) = req.artist {
        let import_req = ArtistImportRequest {
            name: artist_req.name,
            created_by: req.updated_by.clone(),
        };
        match find_or_create_artist(import_req).await {
            GrimoireResponse {
                success: true,
                data: Some((artist, _)),
                ..
            } => Some(artist),
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
                return GrimoireResponse::failure("Failed to update songs", errors);
            }
        }
    } else {
        None
    };

    let genre = if let Some(genre_name) = req.genre {
        match find_or_create_genre(genre_name).await {
            GrimoireResponse {
                success: true,
                data: Some((genre, _)),
                ..
            } => Some(genre),
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
                return GrimoireResponse::failure("Failed to update songs", errors);
            }
        }
    } else {
        None
    };

    // handle sub-genre (creates sub-genre linked to parent genre)
    let sub_genre = if let Some(sub_genre_name) = req.sub_genre {
        // sub-genre requires a genre to be set
        if genre.is_none() {
            return GrimoireResponse::failure(
                "Validation failed",
                vec![GrimoireError::Validation {
                    field: "sub_genre".to_string(),
                    message: "cannot set sub_genre without setting genre first".to_string(),
                }
                .into()],
            );
        }

        let parent_genre_id = genre.as_ref().unwrap().id.clone();

        // check if sub-genre already exists
        let existing = match sqlx::query_as!(
            SubGenre,
            r#"SELECT
                id as "id!",
                name as "name!",
                parent_genre_id,
                created_at as "created_at!"
               FROM sub_genrez
               WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND parent_genre_id = ?"#,
            sub_genre_name,
            parent_genre_id
        )
        .fetch_optional(&pool)
        .await
        {
            Ok(result) => result,
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to check for existing sub-genre",
                    vec![err.into()],
                );
            }
        };

        if let Some(existing_sub_genre) = existing {
            Some(existing_sub_genre)
        } else {
            // create new sub-genre
            let sub_genre_req = CreateSubGenreRequest {
                name: sub_genre_name,
                parent_genre_id: Some(parent_genre_id),
            };
            let sub_genre_response = create_sub_genre(sub_genre_req).await;
            if !sub_genre_response.success {
                return GrimoireResponse::failure(
                    "Failed to create sub-genre",
                    sub_genre_response.errors,
                );
            }
            match sub_genre_response.data {
                Some(new_sub_genre) => Some(new_sub_genre),
                None => {
                    return GrimoireResponse::failure(
                        "No sub-genre returned after creation",
                        vec![],
                    );
                }
            }
        }
    } else {
        None
    };

    let album = if let Some(album_req) = req.album {
        let import_req = AlbumImportRequest {
            title: album_req.title,
            album_type: album_req.album_type,
            release_date: album_req.release_date,
            release_date_precision: album_req.release_date_precision,
            label: album_req.label,
            genre_id: genre.as_ref().map(|g| g.id.clone()),
            year: album_req.year,
            created_by: req.updated_by.clone(),
        };
        match find_or_create_album(import_req).await {
            GrimoireResponse {
                success: true,
                data: Some((album, _)),
                ..
            } => Some(album),
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
                return GrimoireResponse::failure("Failed to update songs", errors);
            }
        }
    } else {
        None
    };

    // update song table fields if any provided
    let has_song_updates = req.title.is_some()
        || req.track_number.is_some()
        || req.disc_number.is_some()
        || req.duration.is_some()
        || req.year.is_some()
        || req.bpm.is_some()
        || req.key_signature.is_some()
        || req.lyrics.is_some()
        || req.metadata.is_some()
        || thumbnail_blob_id.is_some();

    if has_song_updates {
        // build dynamic update using COALESCE pattern
        for song_id in &req.song_ids {
            let result = sqlx::query!(
                r#"UPDATE songz SET
                    title = COALESCE(?, title),
                    track_number = COALESCE(?, track_number),
                    disc_number = COALESCE(?, disc_number),
                    duration = COALESCE(?, duration),
                    year = COALESCE(?, year),
                    bpm = COALESCE(?, bpm),
                    key_signature = COALESCE(?, key_signature),
                    lyrics = COALESCE(?, lyrics),
                    metadata = COALESCE(?, metadata),
                    thumbnail_blob_id = COALESCE(?, thumbnail_blob_id),
                    updated_by = COALESCE(?, updated_by),
                    updated_at = unixepoch()
                WHERE id = ?"#,
                req.title,
                req.track_number,
                req.disc_number,
                req.duration,
                req.year,
                req.bpm,
                req.key_signature,
                req.lyrics,
                req.metadata,
                thumbnail_blob_id,
                req.updated_by,
                song_id
            )
            .execute(&pool)
            .await;

            if let Err(e) = result {
                return GrimoireResponse::failure(
                    &format!("Failed to update song {}", song_id),
                    vec![GrimoireError::Database(e).into()],
                );
            }
        }
    }

    // update artist relationships if provided
    if let Some(ref artist) = artist {
        // batch delete old relationships
        for song_id in &req.song_ids {
            if let Err(err) = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "Failed to delete old artist relationships",
                    vec![err.into()],
                );
            }
        }

        // batch insert new relationships
        for song_id in &req.song_ids {
            if let Err(err) = sqlx::query!(
                "INSERT INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
                artist.id,
                song_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to create artist relationships",
                    vec![err.into()],
                );
            }
        }
    }

    // update album relationships if provided
    if let Some(ref album) = album {
        // batch delete old relationships
        for song_id in &req.song_ids {
            if let Err(err) = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "Failed to delete old album relationships",
                    vec![err.into()],
                );
            }
        }

        // batch insert new relationships
        for song_id in &req.song_ids {
            if let Err(err) = sqlx::query!(
                "INSERT INTO album_songz (album_id, song_id) VALUES (?, ?)",
                album.id,
                song_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to create album relationships",
                    vec![err.into()],
                );
            }
        }
    }

    // create artist-album relationship if both updated
    if let (Some(ref artist), Some(ref album)) = (&artist, &album) {
        // use INSERT OR IGNORE to avoid duplicates
        if let Err(err) = sqlx::query!(
            "INSERT OR IGNORE INTO artist_albumz (artist_id, album_id) VALUES (?, ?)",
            artist.id,
            album.id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to create artist-album relationship",
                vec![err.into()],
            );
        }
    }

    // handle tag operations (album-level)
    let mut tags_modified = false;
    if let Some(ref album) = album {
        if let Some(tag_names) = req.add_tags {
            let tags_response = find_or_create_tags(tag_names).await;
            if !tags_response.success {
                return GrimoireResponse::failure(
                    "Failed to find or create tags",
                    tags_response.errors,
                );
            }
            let tags = match tags_response.data {
                Some(t) => t,
                None => {
                    return GrimoireResponse::failure("No tags returned after creation", vec![])
                }
            };
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            let add_tags_response = add_album_tags(&album.id, tag_ids).await;
            if !add_tags_response.success {
                return GrimoireResponse::failure("Failed to add tags", add_tags_response.errors);
            }
            tags_modified = true;
        }

        if let Some(tag_names) = req.remove_tags {
            let tags_response = find_or_create_tags(tag_names).await;
            if !tags_response.success {
                return GrimoireResponse::failure(
                    "Failed to find or create tags",
                    tags_response.errors,
                );
            }
            let tags = match tags_response.data {
                Some(t) => t,
                None => return GrimoireResponse::failure("No tags returned", vec![]),
            };
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            let remove_tags_response = remove_album_tags(&album.id, tag_ids).await;
            if !remove_tags_response.success {
                return GrimoireResponse::failure(
                    "Failed to remove tags",
                    remove_tags_response.errors,
                );
            }
            tags_modified = true;
        }

        if let Some(tag_names) = req.replace_tags {
            let tags_response = find_or_create_tags(tag_names).await;
            if !tags_response.success {
                return GrimoireResponse::failure(
                    "Failed to find or create tags",
                    tags_response.errors,
                );
            }
            let tags = match tags_response.data {
                Some(t) => t,
                None => return GrimoireResponse::failure("No tags returned", vec![]),
            };
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            let replace_tags_response = replace_album_tags(&album.id, tag_ids).await;
            if !replace_tags_response.success {
                return GrimoireResponse::failure(
                    "Failed to replace tags",
                    replace_tags_response.errors,
                );
            }
            tags_modified = true;
        }
    }

    // handle favorites if provided
    if let Some(ref user_id) = req.user_id {
        if let Some(ref fav_req) = req.set_favorite {
            let target_type = fav_req.target_type.as_str();

            for song_id in &req.song_ids {
                // determine target_id based on type
                let target_id = match fav_req.target_type {
                    FavoriteTargetType::Song => song_id.clone(),
                    FavoriteTargetType::Artist => {
                        if let Some(ref artist) = artist {
                            artist.id.clone()
                        } else {
                            continue;
                        }
                    }
                    FavoriteTargetType::Album => {
                        if let Some(ref album) = album {
                            album.id.clone()
                        } else {
                            continue;
                        }
                    }
                };

                if fav_req.is_favorite {
                    // insert or ignore
                    if let Err(err) = sqlx::query!(
                        r#"INSERT OR IGNORE INTO user_favoritez (user_id, target_type, target_id, created_at)
                        VALUES (?, ?, ?, unixepoch())"#,
                        user_id,
                        target_type,
                        target_id
                    )
                    .execute(&pool)
                    .await
                    {
                        return GrimoireResponse::failure("Failed to set favorite", vec![err.into()]);
                    }
                } else {
                    // remove favorite
                    if let Err(err) = sqlx::query!(
                        r#"DELETE FROM user_favoritez
                        WHERE user_id = ? AND target_type = ? AND target_id = ?"#,
                        user_id,
                        target_type,
                        target_id
                    )
                    .execute(&pool)
                    .await
                    {
                        return GrimoireResponse::failure(
                            "Failed to remove favorite",
                            vec![err.into()],
                        );
                    }
                }
            }
        }
    }

    // handle ratings if provided
    if let Some(ref user_id) = req.user_id {
        if let Some(ref rating_req) = req.set_rating {
            // validate rating
            if rating_req.rating < 1 || rating_req.rating > 5 {
                return GrimoireResponse::failure(
                    "Validation failed",
                    vec![GrimoireError::Validation {
                        field: "rating".to_string(),
                        message: "rating must be between 1 and 5".to_string(),
                    }
                    .into()],
                );
            }

            let target_type = rating_req.target_type.as_str();

            for song_id in &req.song_ids {
                // determine target_id based on type
                let target_id = match rating_req.target_type {
                    RatingTargetType::Song => song_id.clone(),
                    RatingTargetType::Artist => {
                        if let Some(ref artist) = artist {
                            artist.id.clone()
                        } else {
                            continue;
                        }
                    }
                    RatingTargetType::Album => {
                        if let Some(ref album) = album {
                            album.id.clone()
                        } else {
                            continue;
                        }
                    }
                };

                // upsert rating
                if let Err(err) = sqlx::query!(
                    r#"INSERT INTO user_ratingz (user_id, target_type, target_id, rating, created_at, updated_at)
                    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
                    ON CONFLICT(user_id, target_type, target_id)
                    DO UPDATE SET rating = ?, updated_at = unixepoch()"#,
                    user_id,
                    target_type,
                    target_id,
                    rating_req.rating,
                    rating_req.rating
                )
                .execute(&pool)
                .await
                {
                    return GrimoireResponse::failure("Failed to set rating", vec![err.into()]);
                }
            }
        }
    }

    GrimoireResponse::success(
        format!("Updated {} song(s)", req.song_ids.len()),
        UpdateSongsResult {
            songs_updated: req.song_ids.len() as u32,
            songs_failed: vec![],
            artist,
            album,
            genre,
            sub_genre,
            thumbnail_blob_id,
            tags_modified,
        },
    )
}
