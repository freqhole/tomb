//! update operations for songs and related entities
//! supports single and bulk updates with relationship management

use super::models::{
    AlbumImportRequest, ArtistImportRequest, FavoriteTargetType, RatingTargetType,
    UpdateSongsRequest, UpdateSongsResult,
};
use crate::blob_data::{convert_to_webp, create_image_blob_from_webp_data};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::crud::{find_or_create_album, find_or_create_artist, find_or_create_genre};
use crate::music::entities::genres::{create_sub_genre, CreateSubGenreRequest};
use crate::music::entities::tags::{
    add_album_tags, find_or_create_tags, remove_album_tags, replace_album_tags,
};
use crate::music::entities::{songs, SubGenre};

/// update songs with optional fields and relationships
pub async fn update_songs(req: UpdateSongsRequest) -> GrimoireResult<UpdateSongsResult> {
    let pool = database::connect().await?;

    // validate song_ids not empty
    if req.song_ids.is_empty() {
        return Err(GrimoireError::Validation {
            field: "song_ids".to_string(),
            message: "song_ids cannot be empty".to_string(),
        });
    }

    // verify all songs exist
    for song_id in &req.song_ids {
        let _ = songs::get_song(song_id).await?;
    }

    // handle thumbnail if provided
    let thumbnail_blob_id = if let Some(file_path) = req.thumbnail_from_file {
        // read file and convert to webp
        let image_data =
            tokio::fs::read(&file_path)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to read thumbnail file: {}", e),
                })?;
        let webp_data = convert_to_webp(&image_data)?;

        // create or find blob
        let metadata = serde_json::json!({
            "type": "thumbnail",
            "source": "user_upload",
            "format": "webp"
        });

        Some(
            create_image_blob_from_webp_data(
                webp_data,
                "original",
                None, // no parent blob
                metadata,
                req.updated_by.clone(),
            )
            .await?,
        )
    } else if let Some(bytes) = req.thumbnail_from_bytes {
        let webp_data = convert_to_webp(&bytes)?;
        let metadata = serde_json::json!({
            "type": "thumbnail",
            "source": "user_upload",
            "format": "webp"
        });

        Some(
            create_image_blob_from_webp_data(
                webp_data,
                "original",
                None,
                metadata,
                req.updated_by.clone(),
            )
            .await?,
        )
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
        let (artist, _) = find_or_create_artist(import_req).await?;
        Some(artist)
    } else {
        None
    };

    let genre = if let Some(genre_name) = req.genre {
        let (genre, _) = find_or_create_genre(genre_name).await?;
        Some(genre)
    } else {
        None
    };

    // handle sub-genre (creates sub-genre linked to parent genre)
    let sub_genre = if let Some(sub_genre_name) = req.sub_genre {
        // sub-genre requires a genre to be set
        if genre.is_none() {
            return Err(GrimoireError::Validation {
                field: "sub_genre".to_string(),
                message: "cannot set sub_genre without setting genre first".to_string(),
            });
        }

        let parent_genre_id = genre.as_ref().unwrap().id.clone();

        // check if sub-genre already exists
        let existing = sqlx::query_as!(
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
        .await?;

        if let Some(existing_sub_genre) = existing {
            Some(existing_sub_genre)
        } else {
            // create new sub-genre
            let sub_genre_req = CreateSubGenreRequest {
                name: sub_genre_name,
                parent_genre_id: Some(parent_genre_id),
            };
            let new_sub_genre = create_sub_genre(sub_genre_req).await?;
            Some(new_sub_genre)
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
        let (album, _) = find_or_create_album(import_req).await?;
        Some(album)
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
                return Err(GrimoireError::Database(e));
            }
        }
    }

    // update artist relationships if provided
    if let Some(ref artist) = artist {
        // batch delete old relationships
        for song_id in &req.song_ids {
            sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await?;
        }

        // batch insert new relationships
        for song_id in &req.song_ids {
            sqlx::query!(
                "INSERT INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
                artist.id,
                song_id
            )
            .execute(&pool)
            .await?;
        }
    }

    // update album relationships if provided
    if let Some(ref album) = album {
        // batch delete old relationships
        for song_id in &req.song_ids {
            sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await?;
        }

        // batch insert new relationships
        for song_id in &req.song_ids {
            sqlx::query!(
                "INSERT INTO album_songz (album_id, song_id) VALUES (?, ?)",
                album.id,
                song_id
            )
            .execute(&pool)
            .await?;
        }
    }

    // create artist-album relationship if both updated
    if let (Some(ref artist), Some(ref album)) = (&artist, &album) {
        // use INSERT OR IGNORE to avoid duplicates
        sqlx::query!(
            "INSERT OR IGNORE INTO artist_albumz (artist_id, album_id) VALUES (?, ?)",
            artist.id,
            album.id
        )
        .execute(&pool)
        .await?;
    }

    // handle tag operations (album-level)
    let mut tags_modified = false;
    if let Some(ref album) = album {
        if let Some(tag_names) = req.add_tags {
            let tags = find_or_create_tags(tag_names).await?;
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            add_album_tags(&album.id, tag_ids).await?;
            tags_modified = true;
        }

        if let Some(tag_names) = req.remove_tags {
            let tags = find_or_create_tags(tag_names).await?;
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            remove_album_tags(&album.id, tag_ids).await?;
            tags_modified = true;
        }

        if let Some(tag_names) = req.replace_tags {
            let tags = find_or_create_tags(tag_names).await?;
            let tag_ids: Vec<String> = tags.iter().map(|t| t.id.clone()).collect();
            replace_album_tags(&album.id, tag_ids).await?;
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
                    sqlx::query!(
                        r#"INSERT OR IGNORE INTO user_favoritez (user_id, target_type, target_id, created_at)
                        VALUES (?, ?, ?, unixepoch())"#,
                        user_id,
                        target_type,
                        target_id
                    )
                    .execute(&pool)
                    .await?;
                } else {
                    // remove favorite
                    sqlx::query!(
                        r#"DELETE FROM user_favoritez
                        WHERE user_id = ? AND target_type = ? AND target_id = ?"#,
                        user_id,
                        target_type,
                        target_id
                    )
                    .execute(&pool)
                    .await?;
                }
            }
        }
    }

    // handle ratings if provided
    if let Some(ref user_id) = req.user_id {
        if let Some(ref rating_req) = req.set_rating {
            // validate rating
            if rating_req.rating < 1 || rating_req.rating > 5 {
                return Err(GrimoireError::Validation {
                    field: "rating".to_string(),
                    message: "rating must be between 1 and 5".to_string(),
                });
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
                sqlx::query!(
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
                .await?;
            }
        }
    }

    Ok(UpdateSongsResult {
        songs_updated: req.song_ids.len(),
        songs_failed: vec![],
        artist,
        album,
        genre,
        sub_genre,
        thumbnail_blob_id,
        tags_modified,
    })
}
