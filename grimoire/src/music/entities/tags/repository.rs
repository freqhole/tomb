//! tag service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateTagRequest, Tag};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::crud::normalize_name;

/// create a new tag
pub async fn create_tag(req: CreateTagRequest) -> GrimoireResult<Tag> {
    let pool = database::connect().await?;

    let tag = sqlx::query_as!(
        Tag,
        r#"INSERT INTO tagz (name, created_at)
         VALUES (?, unixepoch())
         RETURNING
            id as "id!",
            name as "name!",
            created_at as "created_at!""#,
        req.name
    )
    .fetch_one(&pool)
    .await?;

    Ok(tag)
}

/// find existing tag by normalized name or create new one
pub async fn find_or_create_tag(name: String) -> GrimoireResult<(Tag, bool)> {
    let pool = database::connect().await?;
    let normalized = normalize_name(&name);

    // try to find existing tag (case-insensitive)
    let existing = sqlx::query_as!(
        Tag,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM tagz
           WHERE LOWER(TRIM(name)) = ? AND deleted_at IS NULL"#,
        normalized
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(tag) = existing {
        return Ok((tag, false));
    }

    // create new tag
    let tag = create_tag(CreateTagRequest { name }).await?;
    Ok((tag, true))
}

/// find or create multiple tags
pub async fn find_or_create_tags(names: Vec<String>) -> GrimoireResult<Vec<Tag>> {
    let mut tags = Vec::new();
    for name in names {
        let (tag, _) = find_or_create_tag(name).await?;
        tags.push(tag);
    }
    Ok(tags)
}

/// list all tags
pub async fn list_tags() -> GrimoireResult<Vec<Tag>> {
    let pool = database::connect().await?;

    let tags = sqlx::query_as!(
        Tag,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM tagz
           WHERE deleted_at IS NULL
           ORDER BY name ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(tags)
}

/// query tags by name (for autocomplete)
pub async fn query_tags(search: &str) -> GrimoireResult<Vec<Tag>> {
    let pool = database::connect().await?;
    let search_pattern = format!("%{}%", search);

    let tags = sqlx::query_as!(
        Tag,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM tagz
           WHERE name LIKE ? AND deleted_at IS NULL
           ORDER BY name ASC
           LIMIT 50"#,
        search_pattern
    )
    .fetch_all(&pool)
    .await?;

    Ok(tags)
}

/// get tag by id
pub async fn get_tag(id: &str) -> GrimoireResult<Tag> {
    let pool = database::connect().await?;

    let tag = sqlx::query_as!(
        Tag,
        r#"SELECT
            id as "id!",
            name as "name!",
            created_at as "created_at!"
           FROM tagz
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::TagNotFound { id: id.to_string() })?;

    Ok(tag)
}

/// delete tag by id (removes relationships too)
pub async fn delete_tag(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    // Soft-delete the tag
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let rows_affected = sqlx::query!(
        "UPDATE tagz SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::TagNotFound { id: id.to_string() });
    }

    Ok(())
}

/// get tags for an album
pub async fn get_album_tags(album_id: &str) -> GrimoireResult<Vec<Tag>> {
    let pool = database::connect().await?;

    let tags = sqlx::query_as!(
        Tag,
        r#"SELECT
            t.id as "id!",
            t.name as "name!",
            t.created_at as "created_at!"
           FROM tagz t
           INNER JOIN album_tagz at ON at.tag_id = t.id
           WHERE at.album_id = ? AND t.deleted_at IS NULL
           ORDER BY t.name ASC"#,
        album_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(tags)
}

/// add tags to an album
pub async fn add_album_tags(album_id: &str, tag_ids: Vec<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    for tag_id in tag_ids {
        sqlx::query!(
            "INSERT OR IGNORE INTO album_tagz (album_id, tag_id) VALUES (?, ?)",
            album_id,
            tag_id
        )
        .execute(&pool)
        .await?;
    }

    Ok(())
}

/// remove tags from an album
pub async fn remove_album_tags(album_id: &str, tag_ids: Vec<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    for tag_id in tag_ids {
        sqlx::query!(
            "DELETE FROM album_tagz WHERE album_id = ? AND tag_id = ?",
            album_id,
            tag_id
        )
        .execute(&pool)
        .await?;
    }

    Ok(())
}

/// replace all tags for an album
pub async fn replace_album_tags(album_id: &str, tag_ids: Vec<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    // remove all existing tags
    sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
        .execute(&pool)
        .await?;

    // add new tags
    add_album_tags(album_id, tag_ids).await?;

    Ok(())
}
