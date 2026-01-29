//! genre service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateGenreRequest, CreateSubGenreRequest, Genre, GenreStat, SubGenre};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new genre
pub async fn create_genre(req: CreateGenreRequest) -> GrimoireResponse<Genre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
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
            return GrimoireResponse::failure("Failed to create genre", vec![ErrorDetail::from(e)])
        }
    };

    let genre = Genre {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
    };

    GrimoireResponse::success("Genre created successfully", genre)
}

/// list all genres
pub async fn list_genres() -> GrimoireResponse<Vec<Genre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
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
            return GrimoireResponse::failure("Failed to list genres", vec![ErrorDetail::from(e)])
        }
    };

    let genres = rows.into_iter().map(|row| Genre {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
    }).collect();

    GrimoireResponse::success("Genres retrieved successfully", genres)
}

/// query genres by name (for autocomplete)
pub async fn query_genres(search: &str) -> GrimoireResponse<Vec<Genre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
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
            return GrimoireResponse::failure("Failed to query genres", vec![ErrorDetail::from(e)])
        }
    };

    let genres = rows.into_iter().map(|row| Genre {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
    }).collect();

    GrimoireResponse::success("Genre search completed successfully", genres)
}

/// get genre by id
pub async fn get_genre(id: &str) -> GrimoireResponse<Genre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
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
            return GrimoireResponse::failure("Failed to get genre", vec![ErrorDetail::from(e)])
        }
    };

    match row_opt {
        Some(row) => {
            let genre = Genre {
                id: row.id,
                name: row.name,
                created_at: row.created_at,
            };
            GrimoireResponse::success("Genre retrieved successfully", genre)
        },
        None => {
            let err = GrimoireError::GenreNotFound { id: id.to_string() };
            GrimoireResponse::failure("Genre not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// create a new sub-genre
pub async fn create_sub_genre(req: CreateSubGenreRequest) -> GrimoireResponse<SubGenre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let sub_genre = match sqlx::query_as!(
        SubGenre,
        r#"INSERT INTO sub_genrez (name, parent_genre_id, created_at)
         VALUES (?, ?, unixepoch())
         RETURNING
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!""#,
        req.name,
        req.parent_genre_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to create sub-genre",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Sub-genre created successfully", sub_genre)
}

/// list all sub-genres
pub async fn list_sub_genres() -> GrimoireResponse<Vec<SubGenre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let sub_genres = match sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE deleted_at IS NULL
           ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list sub-genres",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Sub-genres retrieved successfully", sub_genres)
}

/// get sub-genre by id
pub async fn get_sub_genre(id: &str) -> GrimoireResponse<SubGenre> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let sub_genre_opt = match sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get sub-genre", vec![ErrorDetail::from(e)])
        }
    };

    match sub_genre_opt {
        Some(sub_genre) => GrimoireResponse::success("Sub-genre retrieved successfully", sub_genre),
        None => {
            let err = GrimoireError::SubGenreNotFound { id: id.to_string() };
            GrimoireResponse::failure("Sub-genre not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// get genre statistics (song counts, album counts, etc.)
pub async fn get_genre_stats() -> GrimoireResponse<Vec<GenreStat>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // For now, return basic stats from denormalized song data
    // TODO: Replace with normalized genre relationships when implemented
    let stats = match sqlx::query_as!(
        GenreStat,
        r#"SELECT
            g.name as "name!",
            COUNT(a.id) as "song_count!",
            0 as "album_count!",
            0 as "artist_count!",
            0 as "total_duration!"
           FROM genrez g
           LEFT JOIN albumz a ON a.genre_id = g.id AND a.deleted_at IS NULL
           WHERE g.deleted_at IS NULL
           GROUP BY g.id, g.name
           ORDER BY g.name ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get genre stats",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Genre stats retrieved successfully", stats)
}

/// find or create sub-genre by name (with parent genre)
pub async fn find_or_create_sub_genre(
    name: String,
    parent_genre_id: String,
) -> GrimoireResponse<(SubGenre, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // try to find existing sub-genre (case-insensitive, with same parent)
    let existing = match sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND parent_genre_id = ? AND deleted_at IS NULL"#,
        name,
        parent_genre_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query sub-genre",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if let Some(sub_genre) = existing {
        return GrimoireResponse::success("Sub-genre found", (sub_genre, false));
    }

    // create new sub-genre
    let response = create_sub_genre(CreateSubGenreRequest {
        name,
        parent_genre_id: Some(parent_genre_id),
    })
    .await;

    if !response.success {
        return GrimoireResponse::failure("Failed to create sub-genre", response.errors);
    }

    let sub_genre = match response.data {
        Some(sg) => sg,
        None => return GrimoireResponse::failure("No sub-genre returned after creation", vec![]),
    };

    GrimoireResponse::success("Sub-genre created successfully", (sub_genre, true))
}

/// list sub-genres for a parent genre
pub async fn list_sub_genres_for_genre(parent_genre_id: &str) -> GrimoireResponse<Vec<SubGenre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let sub_genres = match sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE parent_genre_id = ? AND deleted_at IS NULL
           ORDER BY name ASC"#,
        parent_genre_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query sub-genres",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Sub-genre search completed successfully", sub_genres)
}

/// query sub-genres by name (for autocomplete)
pub async fn query_sub_genres(search: &str) -> GrimoireResponse<Vec<SubGenre>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let search_pattern = format!("%{}%", search);

    let sub_genres = match sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE name LIKE ? AND deleted_at IS NULL
           ORDER BY name ASC
           LIMIT 50"#,
        search_pattern
    )
    .fetch_all(&pool)
    .await
    {
        Ok(sg) => sg,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query sub-genres",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Sub-genre search completed successfully", sub_genres)
}

/// delete sub-genre by id
pub async fn delete_sub_genre(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Soft-delete the sub-genre
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let rows_affected = match sqlx::query!(
        "UPDATE sub_genrez SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete sub-genre",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::SubGenreNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Sub-genre not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success("Sub-genre deleted successfully", ())
}
