//! generalized, entity-type-agnostic playlist items
//!
//! `playlist_itemz` is a single, cross-domain table: any `TaggableEntity`
//! variant (song, video, video_series, video_season, ...) can be a playlist
//! member here, sharing one global position/ordering space per playlist.
//! previously this lived under `crate::video::crud::playlist_itemz` (only
//! video ever wrote to it), but songs need it too. music's own
//! playlist-membership functions
//! (`crate::music::entities::playlists::repository`) delegate to
//! `playlist_itemz` under the hood for song membership; this module is the
//! shared, domain-neutral core both sides call into for generic
//! (non-song-specific) operations.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::entities::TaggableEntity;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

/// a single playlist item row
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct PlaylistItem {
    pub id: String,
    pub playlist_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub position: i64,
    pub added_at: i64,
    pub added_by: Option<String>,
}

/// add an entity to a playlist. pass `position = None` to auto-append at
/// the end - `trg_playlist_itemz_auto_append` handles the numbering.
pub async fn add_playlist_item(
    playlist_id: &str,
    entity_type: TaggableEntity,
    entity_id: &str,
    position: Option<i64>,
    added_by: Option<String>,
) -> GrimoireResponse<PlaylistItem> {
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
    let position = position.unwrap_or(0);
    if let Err(e) = sqlx::query!(
        "INSERT INTO playlist_itemz (playlist_id, entity_type, entity_id, position, added_by)
         VALUES (?, ?, ?, ?, ?)",
        playlist_id,
        entity_type_str,
        entity_id,
        position,
        added_by
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to add playlist item",
            vec![ErrorDetail::from(e)],
        );
    }

    // read back after insert so the auto-append trigger's final position is
    // reflected, rather than relying on RETURNING/trigger ordering.
    let item = match sqlx::query_as!(
        PlaylistItem,
        r#"SELECT
            id as "id!",
            playlist_id as "playlist_id!",
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            position as "position!",
            added_at as "added_at!",
            added_by
         FROM playlist_itemz
         WHERE playlist_id = ? AND entity_type = ? AND entity_id = ?"#,
        playlist_id,
        entity_type_str,
        entity_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(item) => item,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to read back playlist item",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlist item added successfully", item)
}

/// remove an entity from a playlist
pub async fn remove_playlist_item(
    playlist_id: &str,
    entity_type: TaggableEntity,
    entity_id: &str,
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
        "DELETE FROM playlist_itemz WHERE playlist_id = ? AND entity_type = ? AND entity_id = ?",
        playlist_id,
        entity_type_str,
        entity_id
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to remove playlist item",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Playlist item removed successfully")
}

/// reorder every item in a playlist. `ordered_refs` must contain the
/// complete set of (entity_type, entity_id) refs currently in the
/// playlist, in the desired new order - position is assigned as
/// `index + 1` for each. no `UNIQUE` constraint exists on
/// `(playlist_id, position)` (only `(playlist_id, entity_type,
/// entity_id)`), so a straightforward per-row update loop is safe.
pub async fn reorder_playlist_items(
    playlist_id: &str,
    ordered_refs: &[(TaggableEntity, String)],
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

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to begin transaction",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for (index, (entity_type, entity_id)) in ordered_refs.iter().enumerate() {
        let position = (index as i64) + 1;
        let entity_type_str = entity_type.as_str();
        if let Err(e) = sqlx::query!(
            "UPDATE playlist_itemz
             SET position = ?
             WHERE playlist_id = ? AND entity_type = ? AND entity_id = ?",
            position,
            playlist_id,
            entity_type_str,
            entity_id
        )
        .execute(&mut *tx)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to set playlist item position",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure(
            "Failed to commit transaction",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Playlist items reordered successfully")
}

/// list items in a playlist, ordered by position
pub async fn list_playlist_items(playlist_id: &str) -> GrimoireResponse<Vec<PlaylistItem>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let items = match sqlx::query_as!(
        PlaylistItem,
        r#"SELECT
            id as "id!",
            playlist_id as "playlist_id!",
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            position as "position!",
            added_at as "added_at!",
            added_by
         FROM playlist_itemz
         WHERE playlist_id = ?
         ORDER BY position ASC"#,
        playlist_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(items) => items,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list playlist items",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlist items retrieved successfully", items)
}
