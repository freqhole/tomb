//! album update operations
//! handles complex updates including artist re-scoping and date parsing

use super::models::{Album, UpdateAlbumRequest};
use crate::database;
use crate::error::ErrorDetail;
use crate::music::crud::create_or_update::{
    find_or_create_album_for_artist, find_or_create_artist, find_or_create_genre,
};
use crate::music::crud::delete::{delete_album_if_unused, delete_artist_if_unused};
use crate::music::crud::ArtistImportRequest;
use crate::music::crud::ImageMetadata;
use crate::music::entities::genres;
use crate::music::EntityUrl;
use crate::response::GrimoireResponse;
use crate::JsonVec;

/// parse flexible release date string and validate format
/// supports: "2023", "2023-06", "2023-06-15"
/// returns the normalized date string if valid
fn parse_release_date(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty date string".to_string());
    }

    // try to parse as year only: "2023"
    if let Ok(year) = trimmed.parse::<i64>() {
        if year >= 1000 && year <= 9999 {
            return Ok(trimmed.to_string());
        }
    }

    // try to parse as year-month: "2023-06"
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() == 2 {
        if let (Ok(year), Ok(month)) = (parts[0].parse::<i64>(), parts[1].parse::<u32>()) {
            if year >= 1000 && year <= 9999 && month >= 1 && month <= 12 {
                return Ok(trimmed.to_string());
            }
        }
    }

    // try to parse as year-month-day: "2023-06-15"
    if parts.len() == 3 {
        if let (Ok(year), Ok(month), Ok(day)) = (
            parts[0].parse::<i64>(),
            parts[1].parse::<u32>(),
            parts[2].parse::<u32>(),
        ) {
            if year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31 {
                return Ok(trimmed.to_string());
            }
        }
    }

    Err(format!(
        "invalid date format '{}', expected YYYY, YYYY-MM, or YYYY-MM-DD",
        trimmed
    ))
}

/// update an album's metadata
/// handles complex artist re-scoping if artist_name changes
pub async fn update_album(req: UpdateAlbumRequest) -> GrimoireResponse<Album> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // verify album exists (including deleted ones)
    let existing_album = match sqlx::query!(
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
        FROM albumz
        WHERE id = ?"#,
        req.album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(row)) => Album {
            id: row.id,
            title: row.title,
            album_type: row.album_type,
            release_date: row.release_date,
            label: row.label,
            genres: None,
            song_count: row.song_count,
            total_duration: row.total_duration,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            deleted_by: row.deleted_by,
            created_by: row.created_by,
            updated_by: row.updated_by,
            images: None,
            urls: None,
        },
        Ok(None) => {
            return GrimoireResponse::failure(
                "album not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "Not Found",
                    "album not found",
                )],
            )
        }
        Err(e) => return GrimoireResponse::failure("failed to query album", vec![e.into()]),
    };

    // if album was deleted, undelete it
    if existing_album.deleted_at.is_some() {
        if let Err(e) = sqlx::query!(
            "UPDATE albumz SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch(), updated_by = ? WHERE id = ?",
            req.updated_by,
            req.album_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure("failed to undelete album", vec![e.into()]);
        }
    }

    // validate album type if provided
    if let Some(ref album_type) = req.album_type {
        if !["album", "single", "compilation"].contains(&album_type.as_str()) {
            return GrimoireResponse::failure(
                "invalid album type",
                vec![ErrorDetail::new(
                    "invalid_album_type",
                    "Invalid Album Type",
                    "album_type must be one of: album, single, compilation",
                )],
            );
        }
    }

    // parse release date if provided
    let parsed_date = if let Some(ref date_str) = req.release_date {
        match parse_release_date(date_str) {
            Ok(date) => Some(date),
            Err(e) => {
                return GrimoireResponse::failure(
                    "invalid release date format",
                    vec![ErrorDetail::new(
                        "invalid_date",
                        "Invalid Date",
                        &format!("{}", e),
                    )],
                )
            }
        }
    } else {
        None
    };

    // resolve genres - combine existing IDs with newly created genres
    let genre_ids_to_set: Option<Vec<String>> = {
        let mut all_ids: Vec<String> = Vec::new();
        let mut has_any_genre_input = false;

        // first, validate and add existing genre IDs
        if let Some(ref genre_ids) = req.genre_ids {
            has_any_genre_input = true;
            for genre_id in genre_ids {
                match sqlx::query_scalar!(
                    r#"SELECT id as "id!" FROM genrez WHERE id = ? AND deleted_at IS NULL"#,
                    genre_id
                )
                .fetch_optional(&pool)
                .await
                {
                    Ok(Some(id)) => {
                        if !all_ids.contains(&id) {
                            all_ids.push(id);
                        }
                    }
                    Ok(None) => {
                        return GrimoireResponse::failure(
                            "genre not found",
                            vec![ErrorDetail::new(
                                "genre_not_found",
                                "Genre Not Found",
                                &format!("genre with id '{}' does not exist", genre_id),
                            )],
                        )
                    }
                    Err(e) => {
                        return GrimoireResponse::failure("failed to query genre", vec![e.into()])
                    }
                }
            }
        }

        // then, find or create genres by name and add their IDs
        if let Some(ref genre_names) = req.genres {
            has_any_genre_input = true;
            for genre_name in genre_names {
                match find_or_create_genre(genre_name.clone()).await {
                    GrimoireResponse {
                        success: true,
                        data: Some((genre, _)),
                        ..
                    } => {
                        if !all_ids.contains(&genre.id) {
                            all_ids.push(genre.id);
                        }
                    }
                    response => {
                        return GrimoireResponse::failure(
                            "failed to find or create genre",
                            response.errors,
                        )
                    }
                }
            }
        }

        if has_any_genre_input {
            Some(all_ids)
        } else {
            None
        }
    };

    // handle artist change - this is the complex part
    let (new_album_id, _old_album_id, _old_artist_ids) = if req.artist_id.is_some()
        || req.artist_name.is_some()
    {
        // get all songs in the current album
        let song_ids: Vec<String> = match sqlx::query_scalar!(
            "SELECT song_id FROM album_songz WHERE album_id = ?",
            req.album_id
        )
        .fetch_all(&pool)
        .await
        {
            Ok(ids) => ids,
            Err(e) => {
                return GrimoireResponse::failure("failed to get album songs", vec![e.into()])
            }
        };

        if song_ids.is_empty() {
            return GrimoireResponse::failure(
                "cannot change artist on album with no songs",
                vec![ErrorDetail::new(
                    "no_songs",
                    "No Songs",
                    "album must have songs to change artist",
                )],
            );
        }

        // collect old artist ids for cleanup
        let mut old_artist_ids = Vec::new();
        for song_id in &song_ids {
            if let Ok(Some(artist_id)) = sqlx::query_scalar!(
                "SELECT artist_id FROM artist_songz WHERE song_id = ?",
                song_id
            )
            .fetch_optional(&pool)
            .await
            {
                old_artist_ids.push(artist_id);
            }
        }

        // resolve new artist: prefer artist_id, fallback to artist_name
        let new_artist = if let Some(artist_id) = req.artist_id {
            // artist_id provided - fetch it directly or undelete if deleted
            match sqlx::query_as!(
                crate::music::entities::Artist,
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
                FROM artistz WHERE id = ?"#,
                artist_id
            )
            .fetch_optional(&pool)
            .await
            {
                Ok(Some(mut artist)) => {
                    // if deleted, undelete it
                    if artist.deleted_at.is_some() {
                        if let Err(e) = sqlx::query!(
                            "UPDATE artistz SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch(), updated_by = ? WHERE id = ?",
                            req.updated_by,
                            artist_id
                        )
                        .execute(&pool)
                        .await
                        {
                            return GrimoireResponse::failure(
                                "failed to undelete artist",
                                vec![e.into()],
                            );
                        }
                        artist.deleted_at = None;
                        artist.deleted_by = None;
                    }
                    artist
                }
                Ok(None) => {
                    return GrimoireResponse::failure(
                        "artist not found",
                        vec![ErrorDetail::new(
                            "not_found",
                            "Not Found",
                            &format!("artist with id {} not found", artist_id),
                        )],
                    )
                }
                Err(e) => {
                    return GrimoireResponse::failure("failed to query artist", vec![e.into()])
                }
            }
        } else if let Some(artist_name) = req.artist_name {
            // artist_name provided - find/create/undelete
            // first check for deleted artist with this name
            let deleted_artist = sqlx::query_as!(
                crate::music::entities::Artist,
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
                WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NOT NULL
                LIMIT 1"#,
                artist_name
            )
            .fetch_optional(&pool)
            .await;

            if let Ok(Some(deleted)) = deleted_artist {
                // undelete existing artist
                if let Err(e) = sqlx::query!(
                    "UPDATE artistz SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch(), updated_by = ? WHERE id = ?",
                    req.updated_by,
                    deleted.id
                )
                .execute(&pool)
                .await
                {
                    return GrimoireResponse::failure(
                        "failed to undelete artist",
                        vec![e.into()],
                    );
                }
                crate::music::entities::Artist {
                    id: deleted.id,
                    name: deleted.name,
                    bio: deleted.bio,
                    created_at: deleted.created_at,
                    updated_at: deleted.updated_at,
                    deleted_at: None,
                    deleted_by: None,
                    created_by: deleted.created_by,
                    updated_by: req.updated_by.clone(),
                    images: None,
                    urls: None,
                }
            } else {
                // find or create new artist
                let new_artist_result = match find_or_create_artist(ArtistImportRequest {
                    name: artist_name.clone(),
                    created_by: req.updated_by.clone(),
                })
                .await
                {
                    GrimoireResponse {
                        success: true,
                        data: Some((artist, was_created)),
                        ..
                    } => (artist, was_created),
                    response => {
                        return GrimoireResponse::failure(
                            "failed to find or create artist",
                            response.errors,
                        )
                    }
                };

                // if a new artist was created, copy bio and images from old artist(s)
                if new_artist_result.1 && !old_artist_ids.is_empty() {
                    // try to find an old artist with bio or images to copy from
                    for old_artist_id in &old_artist_ids {
                        // copy bio from first old artist that has one
                        if let Ok(Some(old_bio)) = sqlx::query_scalar!(
                            "SELECT bio FROM artistz WHERE id = ? AND bio IS NOT NULL",
                            old_artist_id
                        )
                        .fetch_optional(&pool)
                        .await
                        {
                            let _ = sqlx::query!(
                                "UPDATE artistz SET bio = ? WHERE id = ?",
                                old_bio,
                                new_artist_result.0.id
                            )
                            .execute(&pool)
                            .await;
                            break;
                        }
                    }

                    // copy images from all old artists
                    for old_artist_id in &old_artist_ids {
                        let _ = sqlx::query!(
                                "INSERT OR IGNORE INTO artist_imagez (artist_id, media_blob_id, is_primary)
                             SELECT ?, media_blob_id, is_primary
                             FROM artist_imagez
                             WHERE artist_id = ?",
                                new_artist_result.0.id,
                                old_artist_id
                            )
                            .execute(&pool)
                            .await;
                    }
                }

                new_artist_result.0
            }
        } else {
            unreachable!("either artist_id or artist_name must be Some");
        };

        // create new album scoped to new artist
        let new_album_title = req.title.clone().unwrap_or(existing_album.title.clone());
        let new_album = match find_or_create_album_for_artist(
            crate::music::crud::AlbumImportRequest {
                title: new_album_title,
                album_type: req
                    .album_type
                    .clone()
                    .or(Some(existing_album.album_type.clone())),
                release_date: parsed_date.clone().or(existing_album.release_date.clone()),
                label: req.label.clone().or(existing_album.label.clone()),
                genre_ids: None, // genres handled via junction table
                created_by: req.updated_by.clone(),
            },
            &new_artist.id,
        )
        .await
        {
            Ok((album, _)) => album,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to create album for new artist",
                    vec![e.into()],
                )
            }
        };

        // copy images from old album to new album
        if let Err(e) = sqlx::query!(
            "INSERT INTO album_imagez (album_id, media_blob_id, is_primary)
             SELECT ?, media_blob_id, is_primary
             FROM album_imagez
             WHERE album_id = ?",
            new_album.id,
            existing_album.id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure("failed to copy images to new album", vec![e.into()]);
        }

        // copy genres from old album to new album
        if let Err(e) = sqlx::query!(
            "INSERT OR IGNORE INTO album_genrez (album_id, genre_id)
             SELECT ?, genre_id
             FROM album_genrez
             WHERE album_id = ?",
            new_album.id,
            existing_album.id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure("failed to copy genres to new album", vec![e.into()]);
        }

        // move all songs to new album and new artist
        for song_id in &song_ids {
            // update artist relationship
            if let Err(e) = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "failed to delete old artist relationship",
                    vec![e.into()],
                );
            }

            if let Err(e) = sqlx::query!(
                "INSERT INTO artist_songz (artist_id, song_id) VALUES (?, ?)",
                new_artist.id,
                song_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "failed to create new artist relationship",
                    vec![e.into()],
                );
            }

            // update album relationship
            if let Err(e) = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "failed to delete old album relationship",
                    vec![e.into()],
                );
            }

            if let Err(e) = sqlx::query!(
                "INSERT INTO album_songz (album_id, song_id) VALUES (?, ?)",
                new_album.id,
                song_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "failed to create new album relationship",
                    vec![e.into()],
                );
            }
        }

        // cleanup orphaned old album and artists
        let _ = delete_album_if_unused(&req.album_id).await;
        for old_artist_id in &old_artist_ids {
            if old_artist_id != &new_artist.id {
                let _ = delete_artist_if_unused(old_artist_id).await;
            }
        }

        (new_album.id, Some(req.album_id.clone()), old_artist_ids)
    } else {
        // no artist change, use existing album id
        (req.album_id.clone(), None, Vec::new())
    };

    // update the album record (either the new one or existing one)
    let _final_album = match sqlx::query!(
        r#"UPDATE albumz
        SET title = COALESCE(?, title),
            album_type = COALESCE(?, album_type),
            release_date = COALESCE(?, release_date),
            label = COALESCE(?, label),
            updated_by = COALESCE(?, updated_by),
            updated_at = unixepoch()
        WHERE id = ?"#,
        req.title,
        req.album_type,
        parsed_date,
        req.label,
        req.updated_by,
        new_album_id
    )
    .execute(&pool)
    .await
    {
        Ok(album) => album,
        Err(e) => return GrimoireResponse::failure("failed to update album", vec![e.into()]),
    };

    // update genre relationships if provided
    if let Some(genre_ids) = genre_ids_to_set {
        match genres::set_album_genres(&new_album_id, &genre_ids).await {
            GrimoireResponse { success: true, .. } => {}
            response => {
                return GrimoireResponse::failure("failed to update album genres", response.errors)
            }
        }
    }

    // update entity URLs if provided (replace all existing)
    if let Some(ref entity_urls) = req.entity_urls {
        // delete existing URLs for this album
        if let Err(err) = sqlx::query!(
            "DELETE FROM entity_urlz WHERE entity_type = 'album' AND entity_id = ?",
            new_album_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "failed to delete existing entity URLs",
                vec![err.into()],
            );
        }

        // insert new URLs
        for url in entity_urls {
            if url.url.trim().is_empty() {
                continue;
            }
            if let Err(err) = sqlx::query!(
                r#"INSERT INTO entity_urlz (entity_type, entity_id, name, url)
                VALUES ('album', ?, ?, ?)"#,
                new_album_id,
                url.name,
                url.url
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure("failed to create entity URL", vec![err.into()]);
            }
        }
    }

    // re-fetch the album with all related data
    super::get_album(&new_album_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_release_date_year_only() {
        let result = parse_release_date("2023");
        assert!(result.is_ok());
        let (date, precision, year) = result.unwrap();
        assert_eq!(date, "2023");
        assert_eq!(precision, "year");
        assert_eq!(year, 2023);
    }

    #[test]
    fn test_parse_release_date_year_month() {
        let result = parse_release_date("2023-06");
        assert!(result.is_ok());
        let (date, precision, year) = result.unwrap();
        assert_eq!(date, "2023-06");
        assert_eq!(precision, "month");
        assert_eq!(year, 2023);
    }

    #[test]
    fn test_parse_release_date_full() {
        let result = parse_release_date("2023-06-15");
        assert!(result.is_ok());
        let (date, precision, year) = result.unwrap();
        assert_eq!(date, "2023-06-15");
        assert_eq!(precision, "day");
        assert_eq!(year, 2023);
    }

    #[test]
    fn test_parse_release_date_invalid() {
        assert!(parse_release_date("").is_err());
        assert!(parse_release_date("not a date").is_err());
        assert!(parse_release_date("2023-13-01").is_err()); // invalid month
        assert!(parse_release_date("2023-06-32").is_err()); // invalid day
    }
}
