//! generalized entity <-> tag links (video's usage of the shared
//! `entity_tagz` table). mirrors `entity_taxonz.rs`'s shape, but simpler -
//! tags have no origin/confidence concept, just a flat many-to-many.
//! reuses the existing `music::entities::tags` module for the tag rows
//! themselves (find-or-create by name, list, etc.) - only the entity <->
//! tag link is video-specific here.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use super::entity_taxonz::VideoEntityType;
use crate::database;
use crate::error::ErrorDetail;
use crate::music::entities::tags::{find_or_create_tag, Tag};
use crate::response::GrimoireResponse;

/// a single entity <-> tag link row
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct EntityTagLink {
    pub entity_type: String,
    pub entity_id: String,
    pub tag_id: String,
    pub created_at: i64,
    pub created_by: Option<String>,
}

/// link a video-domain entity to a tag by name (finds or creates the tag
/// row first, then links it - mirrors how album tagging works today).
/// re-linking the same (entity, tag) is a no-op.
pub async fn add_entity_tag(
    entity_type: VideoEntityType,
    entity_id: &str,
    tag_name: &str,
    created_by: Option<String>,
) -> GrimoireResponse<Tag> {
    let tag_response = find_or_create_tag(tag_name.to_string()).await;
    if !tag_response.success {
        return GrimoireResponse::failure("Failed to find or create tag", tag_response.errors);
    }
    let (tag, _) = match tag_response.data {
        Some(t) => t,
        None => return GrimoireResponse::failure("No tag returned after creation", vec![]),
    };

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    if let Err(e) = sqlx::query!(
        "INSERT INTO entity_tagz (entity_type, entity_id, tag_id, created_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (entity_type, entity_id, tag_id) DO NOTHING",
        entity_type_str,
        entity_id,
        tag.id,
        created_by
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure("Failed to add entity tag", vec![ErrorDetail::from(e)]);
    }

    GrimoireResponse::success("Entity tag added successfully", tag)
}

/// remove a single entity <-> tag link
pub async fn remove_entity_tag(
    entity_type: VideoEntityType,
    entity_id: &str,
    tag_id: &str,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    if let Err(e) = sqlx::query!(
        "DELETE FROM entity_tagz WHERE entity_type = ? AND entity_id = ? AND tag_id = ?",
        entity_type_str,
        entity_id,
        tag_id
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to remove entity tag",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Entity tag removed successfully")
}

/// list every tag linked to a video-domain entity
pub async fn list_entity_tags(
    entity_type: VideoEntityType,
    entity_id: &str,
) -> GrimoireResponse<Vec<Tag>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    let tags = match sqlx::query_as!(
        Tag,
        r#"SELECT
            t.id as "id!",
            t.name as "name!",
            t.created_at as "created_at!"
         FROM tagz t
         JOIN entity_tagz et ON et.tag_id = t.id
         WHERE et.entity_type = ? AND et.entity_id = ? AND t.deleted_at IS NULL
         ORDER BY t.name ASC"#,
        entity_type_str,
        entity_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(tags) => tags,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list entity tags",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Entity tags retrieved successfully", tags)
}

/// tag usage count across a set of entities - lets a caller show "on all
/// selected / on some / on none" state for a multi-select bulk edit bar.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct EntityTagCount {
    pub tag_id: String,
    pub tag_name: String,
    pub tag_created_at: i64,
    pub count: i64,
}

/// list every tag used by any of the given entities, with a per-tag count
/// of how many of those entities carry it (mirrors album's
/// `get_albums_tags`, but returns counts too instead of just distinct tags,
/// so a single request can drive a bulk "all/some/none" tag picker).
pub async fn get_entities_tags(
    entity_type: VideoEntityType,
    entity_ids: &[String],
) -> GrimoireResponse<Vec<EntityTagCount>> {
    if entity_ids.is_empty() {
        return GrimoireResponse::success("No entities provided", vec![]);
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

    let entity_type_str = entity_type.as_str();
    let placeholders = entity_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        r#"SELECT
            t.id as tag_id,
            t.name as tag_name,
            t.created_at as tag_created_at,
            COUNT(*) as count
           FROM tagz t
           INNER JOIN entity_tagz et ON et.tag_id = t.id
           WHERE et.entity_type = ? AND et.entity_id IN ({}) AND t.deleted_at IS NULL
           GROUP BY t.id
           ORDER BY t.name ASC"#,
        placeholders
    );

    let mut query_builder = sqlx::query_as::<_, EntityTagCount>(&query).bind(entity_type_str);
    for entity_id in entity_ids {
        query_builder = query_builder.bind(entity_id);
    }

    let tags = match query_builder.fetch_all(&pool).await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get entity tags",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Entity tags retrieved successfully", tags)
}

/// list every tag currently used by at least one entity of the given
/// type, with a per-tag count of how many entities carry it - unlike
/// `get_entities_tags`, this isn't scoped to a specific set of entity ids,
/// so it's used to drive the video domain's top-nav tag filter picker
/// (which otherwise reused music's global `list_tags`, showing every tag
/// in the system - including ones never applied to a video - since
/// `tagz` is a shared vocabulary across domains).
pub async fn list_entity_type_tags(
    entity_type: VideoEntityType,
) -> GrimoireResponse<Vec<EntityTagCount>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    let tags = match sqlx::query_as::<_, EntityTagCount>(
        r#"SELECT
            t.id as tag_id,
            t.name as tag_name,
            t.created_at as tag_created_at,
            COUNT(*) as count
           FROM tagz t
           INNER JOIN entity_tagz et ON et.tag_id = t.id
           WHERE et.entity_type = ? AND t.deleted_at IS NULL
           GROUP BY t.id
           ORDER BY t.name ASC"#,
    )
    .bind(entity_type_str)
    .fetch_all(&pool)
    .await
    {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list entity type tags",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Entity type tags retrieved successfully", tags)
}

/// link every given entity to a tag (found-or-created by name). used by
/// the bulk edit bar for adding a tag across a multi-selection in one
/// call - a single-entity add is just a one-element `entity_ids`.
pub async fn add_entities_tags(
    entity_type: VideoEntityType,
    entity_ids: &[String],
    tag_names: &[String],
    created_by: Option<String>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    for tag_name in tag_names {
        let tag_response = find_or_create_tag(tag_name.clone()).await;
        if !tag_response.success {
            return GrimoireResponse::failure("Failed to find or create tag", tag_response.errors);
        }
        let (tag, _) = match tag_response.data {
            Some(t) => t,
            None => return GrimoireResponse::failure("No tag returned after creation", vec![]),
        };

        for entity_id in entity_ids {
            if let Err(e) = sqlx::query!(
                "INSERT INTO entity_tagz (entity_type, entity_id, tag_id, created_by)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (entity_type, entity_id, tag_id) DO NOTHING",
                entity_type_str,
                entity_id,
                tag.id,
                created_by
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to add entity tag",
                    vec![ErrorDetail::from(e)],
                );
            }
        }
    }

    GrimoireResponse::success_unit("Entity tags added successfully")
}

/// unlink every given entity from every given tag id - the bulk
/// counterpart to `remove_entity_tag`.
pub async fn remove_entities_tags(
    entity_type: VideoEntityType,
    entity_ids: &[String],
    tag_ids: &[String],
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let entity_type_str = entity_type.as_str();
    for entity_id in entity_ids {
        for tag_id in tag_ids {
            if let Err(e) = sqlx::query!(
                "DELETE FROM entity_tagz WHERE entity_type = ? AND entity_id = ? AND tag_id = ?",
                entity_type_str,
                entity_id,
                tag_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to remove entity tag",
                    vec![ErrorDetail::from(e)],
                );
            }
        }
    }

    GrimoireResponse::success_unit("Entity tags removed successfully")
}

/// apply directory tag rules (`crate::jobs::add_directory_tags`) to a
/// video-domain entity based on its source file path - the video-domain
/// counterpart to `crate::jobs::apply_directory_tags_for_file` (which
/// writes into `album_tagz`). called during import once the entity id
/// and on-disk file path are both known. a no-op if no rules match.
pub async fn apply_directory_tags_for_entity_file(
    entity_type: VideoEntityType,
    entity_id: &str,
    file_path: &str,
    created_by: Option<String>,
) -> GrimoireResponse<Vec<String>> {
    let tags_response = crate::jobs::get_tags_for_file_path(file_path).await;
    if !tags_response.success {
        return GrimoireResponse::failure(tags_response.message, tags_response.errors);
    }
    let tags = tags_response.data.unwrap_or_default();
    if tags.is_empty() {
        return GrimoireResponse::success("no directory tag rules apply".to_string(), vec![]);
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

    let entity_type_str = entity_type.as_str();
    let mut applied_tag_ids = Vec::new();
    for tag in &tags {
        let result = sqlx::query!(
            "INSERT INTO entity_tagz (entity_type, entity_id, tag_id, created_by)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (entity_type, entity_id, tag_id) DO NOTHING",
            entity_type_str,
            entity_id,
            tag.id,
            created_by
        )
        .execute(&pool)
        .await;

        match result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    applied_tag_ids.push(tag.id.clone());
                }
            }
            Err(e) => {
                tracing::warn!(
                    "failed to apply directory tag {} to {} {}: {}",
                    tag.id,
                    entity_type_str,
                    entity_id,
                    e
                );
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "applied {} directory tags to {} {}",
            applied_tag_ids.len(),
            entity_type_str,
            entity_id
        ),
        applied_tag_ids,
    )
}
