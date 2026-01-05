//! artist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{Artist, CreateArtistRequest};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new artist
pub async fn create_artist(req: CreateArtistRequest) -> GrimoireResult<Artist> {
    let pool = database::connect_music().await?;

    let artist = sqlx::query_as!(
        Artist,
        r#"INSERT INTO artistz (name, created_by, updated_by)
         VALUES (?, ?, ?)
         RETURNING rowid as "rowid!", id as "id!", name as "name!",
                   created_at as "created_at!", updated_at as "updated_at!",
                   deleted_at, deleted_by, created_by, updated_by"#,
        req.name,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(artist)
}

/// list all artists (non-deleted only)
pub async fn list_artists() -> GrimoireResult<Vec<Artist>> {
    let pool = database::connect_music().await?;

    let artists = sqlx::query_as!(
        Artist,
        r#"SELECT rowid as "rowid!", id as "id!", name as "name!",
                  created_at as "created_at!", updated_at as "updated_at!",
                  deleted_at, deleted_by, created_by, updated_by
           FROM artistz
           WHERE deleted_at IS NULL
           ORDER BY name ASC
           LIMIT 100"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(artists)
}

/// get artist by id
pub async fn get_artist(id: &str) -> GrimoireResult<Artist> {
    let pool = database::connect_music().await?;

    let artist = sqlx::query_as!(
        Artist,
        r#"SELECT rowid as "rowid!", id as "id!", name as "name!",
                  created_at as "created_at!", updated_at as "updated_at!",
                  deleted_at, deleted_by, created_by, updated_by
           FROM artistz
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::ArtistNotFound { id: id.to_string() })?;

    Ok(artist)
}

/// soft delete an artist
pub async fn delete_artist(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    let rows_affected = sqlx::query!(
        "UPDATE artistz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::ArtistNotFound { id: id.to_string() });
    }

    Ok(())
}
