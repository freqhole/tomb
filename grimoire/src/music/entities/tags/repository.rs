//! tag service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{AddAlbumsTagsRequest, CreateTagRequest, Tag};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::normalize_name;
use crate::response::GrimoireResponse;

/// create a new tag
pub async fn create_tag(req: CreateTagRequest) -> GrimoireResponse<Tag> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let tag = match sqlx::query_as!(
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
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("Failed to create tag", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Tag created successfully", tag)
}

/// find existing tag by normalized name or create new one
pub async fn find_or_create_tag(name: String) -> GrimoireResponse<(Tag, bool)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let normalized = normalize_name(&name);

    // try to find existing tag (case-insensitive)
    let existing = match sqlx::query_as!(
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
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query tag", vec![ErrorDetail::from(e)])
        }
    };

    if let Some(tag) = existing {
        return GrimoireResponse::success("Tag found", (tag, false));
    }

    // create new tag
    let response = create_tag(CreateTagRequest { name }).await;
    if !response.success {
        return GrimoireResponse::failure("Failed to create tag", response.errors);
    }

    let tag = match response.data {
        Some(t) => t,
        None => return GrimoireResponse::failure("No tag returned after creation", vec![]),
    };

    GrimoireResponse::success("Tag created successfully", (tag, true))
}

/// find or create multiple tags
pub async fn find_or_create_tags(names: Vec<String>) -> GrimoireResponse<Vec<Tag>> {
    let mut tags = Vec::new();
    for name in names {
        let response = find_or_create_tag(name).await;
        if !response.success {
            return GrimoireResponse::failure("Failed to find or create tag", response.errors);
        }
        if let Some((tag, _)) = response.data {
            tags.push(tag);
        }
    }
    GrimoireResponse::success("Tags found or created successfully", tags)
}

/// list all tags
pub async fn list_tags() -> GrimoireResponse<Vec<Tag>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let tags = match sqlx::query_as!(
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
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list tags", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Tags retrieved successfully", tags)
}

/// query tags by name (for autocomplete)
pub async fn query_tags(search: &str) -> GrimoireResponse<Vec<Tag>> {
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

    let tags = match sqlx::query_as!(
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
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query tags", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Tag search completed successfully", tags)
}

/// get tag by id
pub async fn get_tag(id: &str) -> GrimoireResponse<Tag> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let tag_opt = match sqlx::query_as!(
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
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get tag", vec![ErrorDetail::from(e)])
        }
    };

    match tag_opt {
        Some(tag) => GrimoireResponse::success("Tag retrieved successfully", tag),
        None => {
            let err = GrimoireError::TagNotFound { id: id.to_string() };
            GrimoireResponse::failure("Tag not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// delete tag by id (removes relationships too)
pub async fn delete_tag(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Soft-delete the tag
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let rows_affected = match sqlx::query!(
        "UPDATE tagz SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure("Failed to delete tag", vec![ErrorDetail::from(e)])
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::TagNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Tag not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success("Tag deleted successfully", ())
}

/// get tags for multiple albums (returns union of all tags)
pub async fn get_albums_tags(album_ids: Vec<String>) -> GrimoireResponse<Vec<Tag>> {
    if album_ids.is_empty() {
        return GrimoireResponse::success("No albums provided", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // build placeholders for IN clause
    let placeholders = album_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        r#"SELECT DISTINCT
            t.id as id,
            t.name as name,
            t.created_at as created_at
           FROM tagz t
           INNER JOIN album_tagz at ON at.tag_id = t.id
           WHERE at.album_id IN ({}) AND t.deleted_at IS NULL
           ORDER BY t.name ASC"#,
        placeholders
    );

    let mut query_builder = sqlx::query_as::<_, Tag>(&query);
    for album_id in album_ids {
        query_builder = query_builder.bind(album_id);
    }

    let tags = match query_builder.fetch_all(&pool).await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get album tags",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Album tags retrieved successfully", tags)
}

/// add tags to multiple albums
pub async fn add_albums_tags(req: AddAlbumsTagsRequest) -> GrimoireResponse<()> {
    // validate that at least one is provided
    if req.tag_ids.is_empty() && req.tag_names.is_empty() {
        return GrimoireResponse::failure("must provide either tag_ids or tag_names", vec![]);
    }

    if req.album_ids.is_empty() {
        return GrimoireResponse::failure("must provide at least one album_id", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let mut tag_ids = req.tag_ids;

    // handle tag_names by finding or creating them
    if !req.tag_names.is_empty() {
        let tags_response = find_or_create_tags(req.tag_names).await;
        if !tags_response.success {
            return GrimoireResponse::failure(
                "Failed to find or create tags",
                tags_response.errors,
            );
        }
        if let Some(tags) = tags_response.data {
            tag_ids.extend(tags.into_iter().map(|t| t.id));
        }
    }

    // apply tags to all albums
    for album_id in req.album_ids {
        for tag_id in &tag_ids {
            if let Err(e) = sqlx::query!(
                "INSERT OR IGNORE INTO album_tagz (album_id, tag_id) VALUES (?, ?)",
                album_id,
                tag_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to add album tag",
                    vec![ErrorDetail::from(e)],
                );
            }
        }
    }

    GrimoireResponse::success("Album tags added successfully", ())
}

/// remove tags from multiple albums
pub async fn remove_albums_tags(
    album_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> GrimoireResponse<()> {
    if album_ids.is_empty() {
        return GrimoireResponse::failure("must provide at least one album_id", vec![]);
    }

    if tag_ids.is_empty() {
        return GrimoireResponse::failure("must provide at least one tag_id", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for album_id in album_ids {
        for tag_id in &tag_ids {
            if let Err(e) = sqlx::query!(
                "DELETE FROM album_tagz WHERE album_id = ? AND tag_id = ?",
                album_id,
                tag_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to remove album tag",
                    vec![ErrorDetail::from(e)],
                );
            }
        }
    }

    GrimoireResponse::success("Album tags removed successfully", ())
}

/// replace all tags for multiple albums
pub async fn replace_albums_tags(
    album_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> GrimoireResponse<()> {
    if album_ids.is_empty() {
        return GrimoireResponse::failure("must provide at least one album_id", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // remove all existing tags from all albums
    for album_id in &album_ids {
        if let Err(e) = sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
            .execute(&pool)
            .await
        {
            return GrimoireResponse::failure(
                "Failed to remove existing album tags",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    // add new tags to all albums
    let response = add_albums_tags(AddAlbumsTagsRequest {
        album_ids,
        tag_ids,
        tag_names: vec![],
    })
    .await;
    if !response.success {
        return GrimoireResponse::failure("Failed to add new album tags", response.errors);
    }

    GrimoireResponse::success("Album tags replaced successfully", ())
}
