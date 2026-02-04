//! genre service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateGenreRequest, Genre, GenreStat, GenreWithStats};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new genre
pub async fn create_genre(req: CreateGenreRequest) -> GrimoireResponse<Genre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let row = match sqlx::query!(
        r#"INSERT INTO genrez (name, created_at)
         VALUES (?, unixepoch())
         RETURNING
            id as "id!",
            name as "name!",
            created_at as "created_at!""#,
        req.name
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to create genre", vec![ErrorDetail::from(e)])
        }
    };

    let genre = Genre {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
    };

    GrimoireResponse::success("genre created successfully", genre)
}

/// list all genres
pub async fn list_genres() -> GrimoireResponse<Vec<Genre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE deleted_at IS NULL
           ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to list genres", vec![ErrorDetail::from(e)])
        }
    };

    let genres = rows
        .into_iter()
        .map(|row| Genre {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        })
        .collect();

    GrimoireResponse::success("genres retrieved successfully", genres)
}

/// list all genres with stats
pub async fn list_genres_with_stats() -> GrimoireResponse<Vec<GenreWithStats>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let genres = match sqlx::query_as!(
        GenreWithStats,
        r#"SELECT
            genre_id as "id!",
            genre_name as "name!",
            genre_created_at as "created_at!",
            album_count as "album_count!",
            song_count as "song_count!",
            total_duration as "total_duration!"
           FROM genre_query_view
           ORDER BY genre_name ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(g) => g,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list genres with stats",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("genres retrieved successfully", genres)
}

/// query genres by name (for autocomplete)
pub async fn query_genres(search: &str) -> GrimoireResponse<Vec<Genre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let search_pattern = format!("%{}%", search);

    let rows = match sqlx::query!(
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE name LIKE ? AND deleted_at IS NULL
           ORDER BY name ASC
           LIMIT 50"#,
        search_pattern
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to query genres", vec![ErrorDetail::from(e)])
        }
    };

    let genres = rows
        .into_iter()
        .map(|row| Genre {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        })
        .collect();

    GrimoireResponse::success("genre search completed successfully", genres)
}

/// get genre by id
pub async fn get_genre(id: &str) -> GrimoireResponse<Genre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let row_opt = match sqlx::query!(
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to get genre", vec![ErrorDetail::from(e)])
        }
    };

    match row_opt {
        Some(row) => {
            let genre = Genre {
                id: row.id,
                name: row.name,
                created_at: row.created_at,
            };
            GrimoireResponse::success("genre retrieved successfully", genre)
        }
        None => {
            let err = GrimoireError::GenreNotFound { id: id.to_string() };
            GrimoireResponse::failure("genre not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// get genre statistics (song counts, album counts, etc.)
pub async fn get_genre_stats() -> GrimoireResponse<Vec<GenreStat>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let stats = match sqlx::query_as!(
        GenreStat,
        r#"SELECT
            genre_name as "name!",
            song_count as "song_count!",
            album_count as "album_count!",
            0 as "artist_count!",
            total_duration as "total_duration!"
           FROM genre_query_view
           ORDER BY genre_name ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get genre stats",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("genre stats retrieved successfully", stats)
}

/// find or create genre by name
pub async fn find_or_create_genre(name: &str) -> GrimoireResponse<(Genre, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let trimmed_name = name.trim();

    // try to find existing genre (case-insensitive)
    let existing = match sqlx::query!(
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE LOWER(TRIM(name)) = LOWER(?) AND deleted_at IS NULL"#,
        trimmed_name
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to query genre", vec![ErrorDetail::from(e)])
        }
    };

    if let Some(row) = existing {
        let genre = Genre {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        };
        return GrimoireResponse::success("genre found", (genre, false));
    }

    // create new genre
    let response = create_genre(CreateGenreRequest {
        name: trimmed_name.to_string(),
    })
    .await;

    if !response.success {
        return GrimoireResponse::failure("failed to create genre", response.errors);
    }

    let genre = match response.data {
        Some(g) => g,
        None => return GrimoireResponse::failure("no genre returned after creation", vec![]),
    };

    GrimoireResponse::success("genre created successfully", (genre, true))
}

/// add a genre to an album
pub async fn add_genre_to_album(album_id: &str, genre_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!(
        "INSERT OR IGNORE INTO album_genrez (album_id, genre_id) VALUES (?, ?)",
        album_id,
        genre_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("genre added to album", ()),
        Err(e) => {
            GrimoireResponse::failure("failed to add genre to album", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove a genre from an album
pub async fn remove_genre_from_album(album_id: &str, genre_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!(
        "DELETE FROM album_genrez WHERE album_id = ? AND genre_id = ?",
        album_id,
        genre_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("genre removed from album", ()),
        Err(e) => GrimoireResponse::failure(
            "failed to remove genre from album",
            vec![ErrorDetail::from(e)],
        ),
    }
}

/// set all genres for an album (replaces existing)
pub async fn set_album_genres(album_id: &str, genre_ids: &[String]) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // remove all existing genres
    if let Err(e) = sqlx::query!("DELETE FROM album_genrez WHERE album_id = ?", album_id)
        .execute(&pool)
        .await
    {
        return GrimoireResponse::failure(
            "failed to clear album genres",
            vec![ErrorDetail::from(e)],
        );
    }

    // add new genres
    for genre_id in genre_ids {
        if let Err(e) = sqlx::query!(
            "INSERT INTO album_genrez (album_id, genre_id) VALUES (?, ?)",
            album_id,
            genre_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "failed to add genre to album",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    GrimoireResponse::success("album genres updated", ())
}

/// get all genre IDs for an album
pub async fn get_album_genre_ids(album_id: &str) -> GrimoireResponse<Vec<String>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let ids = match sqlx::query_scalar!(
        r#"SELECT genre_id as "genre_id!" FROM album_genrez WHERE album_id = ?"#,
        album_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get album genres",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("album genres retrieved", ids)
}

/// delete genre by id (soft delete)
pub async fn delete_genre(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let rows_affected = match sqlx::query!(
        "UPDATE genrez SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure("failed to delete genre", vec![ErrorDetail::from(e)])
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::GenreNotFound { id: id.to_string() };
        return GrimoireResponse::failure("genre not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success("genre deleted successfully", ())
}
