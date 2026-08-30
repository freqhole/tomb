//! generalized entity <-> url links (video's usage of the shared
//! `entity_urlz` table, previously music-only via each entity's own
//! `urls`/`entity_urls` fields)

use crate::database;
use crate::error::ErrorDetail;
use crate::music::crud::EntityUrl;
use crate::response::GrimoireResponse;

use super::entity_taxonz::VideoEntityType;

/// add a named link to a video-domain entity
pub async fn add_entity_url(
    entity_type: VideoEntityType,
    entity_id: &str,
    name: Option<String>,
    url: &str,
    created_by: Option<String>,
) -> GrimoireResponse<EntityUrl> {
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
    let id = match sqlx::query!(
        "INSERT INTO entity_urlz (entity_type, entity_id, name, url, created_by)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id",
        entity_type_str,
        entity_id,
        name,
        url,
        created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => row.id,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to add entity url",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success(
        "Entity url added successfully",
        EntityUrl {
            id,
            name,
            url: url.to_string(),
        },
    )
}

/// remove a single entity <-> url link by its row id
pub async fn remove_entity_url(
    entity_type: VideoEntityType,
    entity_id: &str,
    id: &str,
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
        "DELETE FROM entity_urlz WHERE id = ? AND entity_type = ? AND entity_id = ?",
        id,
        entity_type_str,
        entity_id
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to remove entity url",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Entity url removed successfully")
}

/// list every url linked to a video-domain entity
pub async fn list_entity_urls(
    entity_type: VideoEntityType,
    entity_id: &str,
) -> GrimoireResponse<Vec<EntityUrl>> {
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
    let urls = match sqlx::query_as!(
        EntityUrl,
        r#"SELECT
            id as "id?",
            name,
            url as "url!"
         FROM entity_urlz
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY created_at ASC"#,
        entity_type_str,
        entity_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(urls) => urls,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list entity urls",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Entity urls retrieved successfully", urls)
}
