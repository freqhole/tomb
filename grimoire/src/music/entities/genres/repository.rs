//! genre service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateGenreRequest, CreateSubGenreRequest, Genre, GenreStat, SubGenre};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new genre
pub async fn create_genre(req: CreateGenreRequest) -> GrimoireResult<Genre> {
    let pool = database::connect_music().await?;

    let genre = sqlx::query_as!(
        Genre,
        r#"INSERT INTO genrez (name, created_at)
         VALUES (?, unixepoch())
         RETURNING
            rowid as "rowid!",
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
    let pool = database::connect_music().await?;

    let genres = sqlx::query_as!(
        Genre,
        r#"SELECT
            rowid as "rowid!",
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

/// get genre by id
pub async fn get_genre(id: &str) -> GrimoireResult<Genre> {
    let pool = database::connect_music().await?;

    let genre = sqlx::query_as!(
        Genre,
        r#"SELECT
            rowid as "rowid!",
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
    let pool = database::connect_music().await?;

    let sub_genre = sqlx::query_as!(
        SubGenre,
        r#"INSERT INTO sub_genrez (name, parent_genre_rowid, created_at)
         VALUES (?, ?, unixepoch())
         RETURNING
            rowid as "rowid!",
            id as "id!",
            name as "name!",
            parent_genre_rowid,
            created_at as "created_at!""#,
        req.name,
        req.parent_genre_rowid
    )
    .fetch_one(&pool)
    .await?;

    Ok(sub_genre)
}

/// list all sub-genres
pub async fn list_sub_genres() -> GrimoireResult<Vec<SubGenre>> {
    let pool = database::connect_music().await?;

    let sub_genres = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            name as "name!",
            parent_genre_rowid,
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
    let pool = database::connect_music().await?;

    let sub_genre = sqlx::query_as!(
        SubGenre,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            name as "name!",
            parent_genre_rowid,
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
    let pool = database::connect_music().await?;

    // For now, return basic stats from denormalized song data
    // TODO: Replace with normalized genre relationships when implemented
    let stats = sqlx::query_as!(
        GenreStat,
        r#"SELECT
            g.name as "name!",
            COUNT(a.rowid) as "song_count!",
            0 as "album_count!",
            0 as "artist_count!",
            0 as "total_duration!"
           FROM genrez g
           LEFT JOIN albumz a ON a.genre_rowid = g.rowid AND a.deleted_at IS NULL
           GROUP BY g.rowid, g.name
           ORDER BY g.name ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(stats)
}
