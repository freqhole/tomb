//! update operations for songs and related entities
//! supports single and bulk updates with relationship management

use super::models::{
    AlbumImportRequest, ArtistImportRequest, FavoriteTargetType, RatingTargetType,
    UpdateSongsRequest, UpdateSongsResult,
};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::create_or_update::{
    find_or_create_album_for_artist, find_or_create_artist, find_or_create_genre,
    get_current_album_for_song, get_current_artist_for_song,
};
use crate::music::crud::delete::{delete_album_if_unused, delete_artist_if_unused};
use crate::music::entities::albums::get_album;
use crate::music::entities::artists::get_artist;
use crate::music::entities::songs;
use crate::music::entities::tags::{
    add_albums_tags, find_or_create_tags, remove_albums_tags, replace_albums_tags,
};
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

    // resolve relationships first (find or create once, reuse for all songs)
    // track whether artist was explicitly provided (before moving req.artist)
    let artist_explicitly_provided = req.artist.is_some() || req.artist_id.is_some();

    // resolve artist: prefer artist_id (direct lookup), then artist (name-based find_or_create),
    // then fall back to current artist if album is changing
    let artist = if let Some(ref artist_id) = req.artist_id {
        // artist_id provided — fetch directly by ID
        let response = get_artist(artist_id).await;
        match response.data {
            Some(artist) => Some(artist),
            None => {
                return GrimoireResponse::failure(
                    &format!("artist not found: {}", artist_id),
                    vec![ErrorDetail::new(
                        "artist_not_found",
                        "Artist Not Found",
                        &format!("no artist with id '{}'", artist_id),
                    )],
                );
            }
        }
    } else if let Some(artist_req) = req.artist {
        // user is explicitly changing the artist
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
    } else if req.album.is_some() && req.album_id.is_none() {
        // user is changing album by name but not artist - need current artist for scoping
        match get_current_artist_for_song(&req.song_ids[0]).await {
            Ok(Some(artist)) => Some(artist),
            Ok(None) => {
                // song has no artist, create "Unknown Artist"
                let unknown_artist_req = ArtistImportRequest {
                    name: "Unknown Artist".to_string(),
                    created_by: req.updated_by.clone(),
                };
                match find_or_create_artist(unknown_artist_req).await {
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
                                "Failed to find or create Unknown Artist",
                            )]
                        } else {
                            response.errors
                        };
                        return GrimoireResponse::failure("Failed to update songs", errors);
                    }
                }
            }
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to get current artist for song",
                    vec![e.into()],
                );
            }
        }
    } else {
        None
    };

    // resolve genre if provided
    let genre = if let Some(genre_name) = req.genre {
        let response = find_or_create_genre(genre_name).await;
        if !response.success {
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
        response.data.map(|(g, _)| g)
    } else {
        None
    };

    // handle album: prefer album_id (direct lookup), then album (name-based find_or_create),
    // then re-scope current album if artist changed
    let album = if let Some(ref album_id) = req.album_id {
        // album_id provided — fetch directly by ID, skip find_or_create
        let response = get_album(album_id).await;
        match response.data {
            Some(album) => Some(album),
            None => {
                return GrimoireResponse::failure(
                    &format!("album not found: {}", album_id),
                    vec![ErrorDetail::new(
                        "album_not_found",
                        "Album Not Found",
                        &format!("no album with id '{}'", album_id),
                    )],
                );
            }
        }
    } else if let Some(album_req) = req.album {
        // user explicitly provided new album
        if let Some(ref artist) = artist {
            let import_req = AlbumImportRequest {
                title: album_req.title,
                album_type: album_req.album_type,
                release_date: album_req.release_date,
                label: album_req.label,
                genre_ids: genre.as_ref().map(|g| vec![g.id.clone()]),
                created_by: req.updated_by.clone(),
            };
            match find_or_create_album_for_artist(import_req, &artist.id).await {
                Ok((album, _created)) => Some(album),
                Err(e) => {
                    return GrimoireResponse::failure(
                        "Failed to find or create album",
                        vec![e.into()],
                    );
                }
            }
        } else {
            // shouldn't happen but handle gracefully
            return GrimoireResponse::failure(
                "Cannot set album without artist context",
                vec![ErrorDetail::new(
                    "missing_artist",
                    "Missing Artist",
                    "Album updates require artist context",
                )],
            );
        }
    } else if artist_explicitly_provided {
        // user changed artist but not album - need to re-scope current album to new artist
        match get_current_album_for_song(&req.song_ids[0]).await {
            Ok(Some(current_album)) => {
                // re-create this album scoped to the new artist
                let new_artist = artist.as_ref().unwrap();
                let import_req = AlbumImportRequest {
                    title: current_album.title.clone(),
                    album_type: current_album.album_type.clone().into(),
                    release_date: current_album.release_date.clone(),
                    label: current_album.label.clone(),
                    genre_ids: current_album
                        .genres
                        .as_ref()
                        .map(|g| g.0.iter().map(|r| r.id.clone()).collect()),
                    created_by: req.updated_by.clone(),
                };
                match find_or_create_album_for_artist(import_req, &new_artist.id).await {
                    Ok((album, _created)) => Some(album),
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to re-scope album to new artist",
                            vec![e.into()],
                        );
                    }
                }
            }
            Ok(None) => {
                // no current album, create "Unknown Album" for new artist
                let new_artist = artist.as_ref().unwrap();
                let import_req = AlbumImportRequest {
                    title: "Unknown Album".to_string(),
                    album_type: Some("album".to_string()),
                    release_date: None,
                    label: None,
                    genre_ids: genre.as_ref().map(|g| vec![g.id.clone()]),
                    created_by: req.updated_by.clone(),
                };
                match find_or_create_album_for_artist(import_req, &new_artist.id).await {
                    Ok((album, _created)) => Some(album),
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to create Unknown Album for new artist",
                            vec![e.into()],
                        );
                    }
                }
            }
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to get current album for song",
                    vec![e.into()],
                );
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
        || req.track_artist.is_some()
        || req.year.is_some()
        || req.bpm.is_some()
        || req.lyrics.is_some()
        || req.metadata.is_some();

    if has_song_updates {
        // build dynamic update using COALESCE pattern
        for song_id in &req.song_ids {
            // prepare metadata update using json_patch if metadata is provided
            let metadata_str = req
                .metadata
                .as_ref()
                .map(|m| serde_json::to_string(m).unwrap_or_else(|_| "{}".to_string()));

            let result = sqlx::query!(
                r#"UPDATE songz SET
                    title = COALESCE(?, title),
                    track_number = COALESCE(?, track_number),
                    disc_number = COALESCE(?, disc_number),
                    duration = COALESCE(?, duration),
                    bpm = COALESCE(?, bpm),
                    track_artist = COALESCE(?, track_artist),
                    lyrics = COALESCE(?, lyrics),
                    metadata = CASE
                        WHEN ? IS NOT NULL THEN json_patch(COALESCE(metadata, '{}'), ?)
                        ELSE metadata
                    END,
                    updated_by = COALESCE(?, updated_by),
                    updated_at = unixepoch()
                WHERE id = ?"#,
                req.title,
                req.track_number,
                req.disc_number,
                req.duration,
                req.bpm,
                req.track_artist,
                req.lyrics,
                metadata_str,
                metadata_str,
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
        // collect old artist ids for orphan cleanup
        let mut old_artist_ids = Vec::new();
        for song_id in &req.song_ids {
            if let Ok(old_artist_id) = sqlx::query_scalar!(
                "SELECT artist_id FROM artist_songz WHERE song_id = ?",
                song_id
            )
            .fetch_optional(&pool)
            .await
            {
                if let Some(id) = old_artist_id {
                    old_artist_ids.push(id);
                }
            }
        }

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

        // cleanup orphaned artists
        for old_artist_id in old_artist_ids {
            if old_artist_id != artist.id {
                let _ = delete_artist_if_unused(&old_artist_id).await;
            }
        }
    }

    // update album relationships if provided
    if let Some(ref album) = album {
        // collect old album ids for orphan cleanup
        let mut old_album_ids = Vec::new();
        for song_id in &req.song_ids {
            if let Ok(old_album_id) = sqlx::query_scalar!(
                "SELECT album_id FROM album_songz WHERE song_id = ?",
                song_id
            )
            .fetch_optional(&pool)
            .await
            {
                if let Some(id) = old_album_id {
                    old_album_ids.push(id);
                }
            }
        }

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

        // cleanup orphaned albums
        for old_album_id in old_album_ids {
            if old_album_id != album.id {
                let _ = delete_album_if_unused(&old_album_id).await;
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
            let add_tags_response =
                add_albums_tags(crate::music::entities::tags::AddAlbumsTagsRequest {
                    album_ids: vec![album.id.clone()],
                    tag_ids,
                    tag_names: vec![],
                })
                .await;
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
            let remove_tags_response = remove_albums_tags(vec![album.id.clone()], tag_ids).await;
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
            let replace_tags_response = replace_albums_tags(vec![album.id.clone()], tag_ids).await;
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

    // handle entity_urls if provided
    if let Some(ref entity_urls) = req.entity_urls {
        for song_id in &req.song_ids {
            // delete existing URLs for this song
            if let Err(err) = sqlx::query!(
                "DELETE FROM entity_urlz WHERE entity_type = 'song' AND entity_id = ?",
                song_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to delete existing entity URLs",
                    vec![err.into()],
                );
            }

            // insert new URLs
            for url in entity_urls {
                // skip empty URLs
                if url.url.trim().is_empty() {
                    continue;
                }

                // id has DEFAULT (lower(hex(randomblob(8)))) so we omit it
                if let Err(err) = sqlx::query!(
                    r#"INSERT INTO entity_urlz (entity_type, entity_id, name, url)
                    VALUES ('song', ?, ?, ?)"#,
                    song_id,
                    url.name,
                    url.url
                )
                .execute(&pool)
                .await
                {
                    return GrimoireResponse::failure(
                        "Failed to create entity URL",
                        vec![err.into()],
                    );
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
            tags_modified,
        },
    )
}
