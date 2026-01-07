//! genre service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateGenreRequest, CreateSubGenreRequest, Genre, GenreStat, SubGenre};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new genre
pub async fn create_genre(req: CreateGenreRequest) -> GrimoireResult<Genre> {
    let pool = database::connect().await?;

    let genre = sqlx::query_as!(
        Genre,
        r#"INSERT INTO genrez (name, created_at)
         VALUES (?, unixepoch())
         RETURNING
            id as "id!",
            name as "name!",
            created_at as "created_at!""#,
        req.name
    )
    .fetch_one(&pool)
    .await?;

    Ok(genre)
}

/// list all genres
pub async fn list_genres() -> GrimoireResult<Vec<Genre>> {
    let pool = database::connect().await?;

    let genres = sqlx::query_as!(
        Genre,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(genres)
}

/// query genres by name (for autocomplete)
pub async fn query_genres(search: &str) -> GrimoireResult<Vec<Genre>> {
    let pool = database::connect().await?;
    let search_pattern = format!("%{}%", search);

    let genres = sqlx::query_as!(
        Genre,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE name LIKE ?
           ORDER BY name ASC
           LIMIT 50"#,
        search_pattern
    )
    .fetch_all(&pool)
    .await?;

    Ok(genres)
}

/// get genre by id
pub async fn get_genre(id: &str) -> GrimoireResult<Genre> {
    let pool = database::connect().await?;

    let genre = sqlx::query_as!(
        Genre,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM genrez
           WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::GenreNotFound { id: id.to_string() })?;

    Ok(genre)
}

/// create a new sub-genre
pub async fn create_sub_genre(req: CreateSubGenreRequest) -> GrimoireResult<SubGenre> {
    let pool = database::connect().await?;

    let sub_genre = sqlx::query_as!(
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
    .await?;

    Ok(sub_genre)
}

/// list all sub-genres
pub async fn list_sub_genres() -> GrimoireResult<Vec<SubGenre>> {
    let pool = database::connect().await?;

    let sub_genres = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(sub_genres)
}

/// get sub-genre by id
pub async fn get_sub_genre(id: &str) -> GrimoireResult<SubGenre> {
    let pool = database::connect().await?;

    let sub_genre = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::SubGenreNotFound { id: id.to_string() })?;

    Ok(sub_genre)
}

/// get genre statistics (song counts, album counts, etc.)
pub async fn get_genre_stats() -> GrimoireResult<Vec<GenreStat>> {
    let pool = database::connect().await?;

    // For now, return basic stats from denormalized song data
    // TODO: Replace with normalized genre relationships when implemented
    let stats = sqlx::query_as!(
        GenreStat,
        r#"SELECT
            g.name as "name!",
            COUNT(a.id) as "song_count!",
            0 as "album_count!",
            0 as "artist_count!",
            0 as "total_duration!"
           FROM genrez g
           LEFT JOIN albumz a ON a.genre_id = g.id AND a.deleted_at IS NULL
           GROUP BY g.id, g.name
           ORDER BY g.name ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(stats)
}

/// find or create sub-genre by name (with parent genre)
pub async fn find_or_create_sub_genre(
    name: String,
    parent_genre_id: String,
) -> GrimoireResult<(SubGenre, bool)> {
    let pool = database::connect().await?;

    // try to find existing sub-genre (case-insensitive, with same parent)
    let existing = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND parent_genre_id = ?"#,
        name,
        parent_genre_id
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(sub_genre) = existing {
        return Ok((sub_genre, false));
    }

    // create new sub-genre
    let sub_genre = create_sub_genre(CreateSubGenreRequest {
        name,
        parent_genre_id: Some(parent_genre_id),
    })
    .await?;
    Ok((sub_genre, true))
}

/// list sub-genres for a parent genre
pub async fn list_sub_genres_for_genre(parent_genre_id: &str) -> GrimoireResult<Vec<SubGenre>> {
    let pool = database::connect().await?;

    let sub_genres = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE parent_genre_id = ?
           ORDER BY name ASC"#,
        parent_genre_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(sub_genres)
}

/// query sub-genres by name (for autocomplete)
pub async fn query_sub_genres(search: &str) -> GrimoireResult<Vec<SubGenre>> {
    let pool = database::connect().await?;
    let search_pattern = format!("%{}%", search);

    let sub_genres = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            id as "id!",
            name as "name!",
            parent_genre_id,
            created_at as "created_at!"
           FROM sub_genrez
           WHERE name LIKE ?
           ORDER BY name ASC
           LIMIT 50"#,
        search_pattern
    )
    .fetch_all(&pool)
    .await?;

    Ok(sub_genres)
}

/// delete sub-genre by id
pub async fn delete_sub_genre(id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!("DELETE FROM sub_genrez WHERE id = ?", id)
        .execute(&pool)
        .await?
        .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::SubGenreNotFound { id: id.to_string() });
    }

    Ok(())
}
