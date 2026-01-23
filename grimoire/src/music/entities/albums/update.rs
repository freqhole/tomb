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
use crate::music::entities::genres::{create_sub_genre, CreateSubGenreRequest};
use crate::music::entities::SubGenre;
use crate::response::GrimoireResponse;

/// parse flexible release date string into (release_date, precision, year)
/// supports: "2023", "2023-06", "2023-06-15"
fn parse_release_date(input: &str) -> Result<(String, String, i64), String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty date string".to_string());
    }

    // try to parse as year only: "2023"
    if let Ok(year) = trimmed.parse::<i64>() {
        if year >= 1000 && year <= 9999 {
            return Ok((trimmed.to_string(), "year".to_string(), year));
        }
    }

    // try to parse as year-month: "2023-06"
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() == 2 {
        if let (Ok(year), Ok(month)) = (parts[0].parse::<i64>(), parts[1].parse::<u32>()) {
            if year >= 1000 && year <= 9999 && month >= 1 && month <= 12 {
                return Ok((trimmed.to_string(), "month".to_string(), year));
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
                return Ok((trimmed.to_string(), "day".to_string(), year));
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
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // verify album exists (including deleted ones)
    let existing_album = match sqlx::query_as!(
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
        WHERE id = ?"#,
        req.album_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(album)) => album,
        Ok(None) => {
            return GrimoireResponse::failure(
                "Album not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "Not Found",
                    "Album not found",
                )],
            )
        }
        Err(e) => return GrimoireResponse::failure("Failed to query album", vec![e.into()]),
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
            return GrimoireResponse::failure("Failed to undelete album", vec![e.into()]);
        }
    }

    // validate album type if provided
    if let Some(ref album_type) = req.album_type {
        if !["album", "single", "compilation"].contains(&album_type.as_str()) {
            return GrimoireResponse::failure(
                "Invalid album type",
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
            Ok((date, precision, year)) => Some((date, precision, year)),
            Err(e) => {
                return GrimoireResponse::failure(
                    "Invalid release date format",
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

    // handle genre if provided
    let genre = if let Some(genre_name) = req.genre {
        match find_or_create_genre(genre_name).await {
            GrimoireResponse {
                success: true,
                data: Some((genre, _)),
                ..
            } => Some(genre),
            response => {
                return GrimoireResponse::failure("Failed to find or create genre", response.errors)
            }
        }
    } else {
        None
    };

    // handle sub-genres if provided
    let sub_genres = if let Some(sub_genre_names) = req.sub_genres {
        if sub_genre_names.is_empty() {
            Vec::new()
        } else {
            // validate that genre is set (either in request or existing album)
            let parent_genre_id = if let Some(ref g) = genre {
                g.id.clone()
            } else if let Some(ref existing_genre_id) = existing_album.genre_id {
                existing_genre_id.clone()
            } else {
                return GrimoireResponse::failure(
                    "Cannot set sub-genres without a genre",
                    vec![ErrorDetail::new(
                        "missing_genre",
                        "Missing Genre",
                        "sub-genres require a parent genre to be set first",
                    )],
                );
            };

            let mut created_sub_genres = Vec::new();
            for sub_genre_name in sub_genre_names {
                // check if sub-genre exists
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
                .await;

                let sub_genre = match existing {
                    Ok(Some(sg)) => sg,
                    Ok(None) => {
                        // create new sub-genre
                        let create_req = CreateSubGenreRequest {
                            name: sub_genre_name.clone(),
                            parent_genre_id: Some(parent_genre_id.clone()),
                        };
                        match create_sub_genre(create_req).await {
                            GrimoireResponse {
                                success: true,
                                data: Some(sg),
                                ..
                            } => sg,
                            response => {
                                return GrimoireResponse::failure(
                                    "Failed to create sub-genre",
                                    response.errors,
                                )
                            }
                        }
                    }
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "Failed to query sub-genre",
                            vec![e.into()],
                        )
                    }
                };

                created_sub_genres.push(sub_genre);
            }
            created_sub_genres
        }
    } else {
        Vec::new()
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
                return GrimoireResponse::failure("Failed to get album songs", vec![e.into()])
            }
        };

        if song_ids.is_empty() {
            return GrimoireResponse::failure(
                "Cannot change artist on album with no songs",
                vec![ErrorDetail::new(
                    "no_songs",
                    "No Songs",
                    "Album must have songs to change artist",
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
                    created_at as "created_at!",
                    updated_at as "updated_at!",
                    deleted_at,
                    deleted_by,
                    created_by,
                    updated_by
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
                                "Failed to undelete artist",
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
                        "Artist not found",
                        vec![ErrorDetail::new(
                            "not_found",
                            "Not Found",
                            &format!("Artist with id {} not found", artist_id),
                        )],
                    )
                }
                Err(e) => {
                    return GrimoireResponse::failure("Failed to query artist", vec![e.into()])
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
                    created_at as "created_at!",
                    updated_at as "updated_at!",
                    deleted_at,
                    deleted_by,
                    created_by,
                    updated_by
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
                        "Failed to undelete artist",
                        vec![e.into()],
                    );
                }
                crate::music::entities::Artist {
                    id: deleted.id,
                    name: deleted.name,
                    created_at: deleted.created_at,
                    updated_at: deleted.updated_at,
                    deleted_at: None,
                    deleted_by: None,
                    created_by: deleted.created_by,
                    updated_by: req.updated_by.clone(),
                }
            } else {
                // find or create new artist
                match find_or_create_artist(ArtistImportRequest {
                    name: artist_name.clone(),
                    created_by: req.updated_by.clone(),
                })
                .await
                {
                    GrimoireResponse {
                        success: true,
                        data: Some((artist, _)),
                        ..
                    } => artist,
                    response => {
                        return GrimoireResponse::failure(
                            "Failed to find or create artist",
                            response.errors,
                        )
                    }
                }
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
                release_date: parsed_date
                    .as_ref()
                    .map(|(d, _, _)| d.clone())
                    .or(existing_album.release_date.clone()),
                release_date_precision: parsed_date
                    .as_ref()
                    .map(|(_, p, _)| p.clone())
                    .or(existing_album.release_date_precision.clone()),
                label: req.label.clone().or(existing_album.label.clone()),
                genre_id: genre
                    .as_ref()
                    .map(|g| g.id.clone())
                    .or(existing_album.genre_id.clone()),
                year: parsed_date.as_ref().map(|(_, _, y)| *y),
                created_by: req.updated_by.clone(),
            },
            &new_artist.id,
        )
        .await
        {
            Ok((album, _)) => album,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to create album for new artist",
                    vec![e.into()],
                )
            }
        };

        // move all songs to new album and new artist
        for song_id in &song_ids {
            // update artist relationship
            if let Err(e) = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "Failed to delete old artist relationship",
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
                    "Failed to create new artist relationship",
                    vec![e.into()],
                );
            }

            // update album relationship
            if let Err(e) = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&pool)
                .await
            {
                return GrimoireResponse::failure(
                    "Failed to delete old album relationship",
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
                    "Failed to create new album relationship",
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

    // extract date values before query to avoid temporary borrow issues
    let release_date_value = parsed_date.as_ref().map(|(d, _, _)| d.clone());
    let release_date_precision_value = parsed_date.as_ref().map(|(_, p, _)| p.clone());
    let year_value = parsed_date.as_ref().map(|(_, _, y)| *y);
    let genre_id_value = genre.as_ref().map(|g| g.id.clone());

    // update the album record (either the new one or existing one)
    let final_album = match sqlx::query_as!(
        Album,
        r#"UPDATE albumz
        SET title = COALESCE(?, title),
            album_type = COALESCE(?, album_type),
            release_date = COALESCE(?, release_date),
            release_date_precision = COALESCE(?, release_date_precision),
            label = COALESCE(?, label),
            genre_id = COALESCE(?, genre_id),
            updated_by = COALESCE(?, updated_by),
            updated_at = unixepoch()
        WHERE id = ?
        RETURNING
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
            updated_by"#,
        req.title,
        req.album_type,
        release_date_value,
        release_date_precision_value,
        req.label,
        genre_id_value,
        req.updated_by,
        new_album_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(album) => album,
        Err(e) => return GrimoireResponse::failure("Failed to update album", vec![e.into()]),
    };

    // update sub-genre relationships if provided
    if !sub_genres.is_empty() {
        // clear existing sub-genres for this album
        if let Err(e) = sqlx::query!(
            "DELETE FROM album_sub_genrez WHERE album_id = ?",
            new_album_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure("Failed to clear old sub-genres", vec![e.into()]);
        }

        // add new sub-genres
        for sub_genre in &sub_genres {
            if let Err(e) = sqlx::query!(
                "INSERT INTO album_sub_genrez (album_id, sub_genre_id) VALUES (?, ?)",
                new_album_id,
                sub_genre.id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to add sub-genre relationship",
                    vec![e.into()],
                );
            }
        }
    }

    // if release date changed, update all songs in album with the extracted year
    if let Some(year) = year_value {
        if let Err(e) = sqlx::query!(
            r#"UPDATE songz
            SET year = ?,
                updated_at = unixepoch()
            WHERE id IN (SELECT song_id FROM album_songz WHERE album_id = ?)"#,
            year,
            new_album_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure("Failed to update song years", vec![e.into()]);
        }
    }

    GrimoireResponse::success("Album updated successfully", final_album)
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
