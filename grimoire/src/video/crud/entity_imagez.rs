//! generalized entity <-> image links (video's usage of the shared
//! `entity_imagez` table) - gives video/video_series the same
//! multi-image + set-primary UX album/artist/playlist/song already have
//! via their own dedicated `*_imagez` tables, without a third near-copy
//! of that table for a brand new pair of entity types.
//!
//! `videoz`/`video_seriez` also keep their own denormalized
//! `poster_blob_id` column (read directly by most display code, e.g.
//! grid tiles/player thumbnails) - every function here keeps that column
//! in sync with whichever image is currently primary, so none of that
//! existing display code needs to change.

use crate::database;
use crate::error::ErrorDetail;
use crate::media_blobz::BlobType;
use crate::music::crud::ImageMetadata;
use crate::response::GrimoireResponse;

use super::entity_taxonz::VideoEntityType;

/// keep `videoz`/`video_seriez`/`video_seasonz`.poster_blob_id in sync
/// with whichever image is currently primary for that entity (or clear
/// it when there isn't one).
async fn sync_poster_blob_id(
    pool: &sqlx::SqlitePool,
    entity_type: VideoEntityType,
    entity_id: &str,
    poster_blob_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    match entity_type {
        VideoEntityType::Video => {
            sqlx::query!(
                "UPDATE videoz SET poster_blob_id = ? WHERE id = ?",
                poster_blob_id,
                entity_id
            )
            .execute(pool)
            .await?;
        }
        VideoEntityType::VideoSeries => {
            sqlx::query!(
                "UPDATE video_seriez SET poster_blob_id = ? WHERE id = ?",
                poster_blob_id,
                entity_id
            )
            .execute(pool)
            .await?;
        }
        VideoEntityType::VideoSeason => {
            sqlx::query!(
                "UPDATE video_seasonz SET poster_blob_id = ? WHERE id = ?",
                poster_blob_id,
                entity_id
            )
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// every image currently linked to an entity, most-recent first.
pub async fn list_entity_images(
    entity_type: VideoEntityType,
    entity_id: &str,
) -> GrimoireResponse<Vec<ImageMetadata>> {
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
    let rows = match sqlx::query!(
        r#"SELECT media_blob_id, is_primary, blob_type
         FROM entity_imagez
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY is_primary DESC, created_at DESC"#,
        entity_type_str,
        entity_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list entity images",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let images = rows
        .into_iter()
        .map(|r| ImageMetadata {
            blob_id: r.media_blob_id,
            is_primary: if r.is_primary != 0 { 1 } else { 0 },
            blob_type: BlobType::from(r.blob_type),
        })
        .collect();

    GrimoireResponse::success("Entity images retrieved successfully", images)
}

/// add an image to an entity, mirroring `add_album_image`'s "smart
/// primary" behavior: the first image for an entity is always primary
/// regardless of the hint, later images honor `is_primary_hint`
/// (default false).
pub async fn add_entity_image(
    entity_type: VideoEntityType,
    entity_id: &str,
    media_blob_id: &str,
    is_primary_hint: Option<bool>,
    blob_type: BlobType,
    created_by: Option<&str>,
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

    let existing_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_imagez WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let is_primary = existing_count == 0 || is_primary_hint.unwrap_or(false);

    if is_primary {
        if let Err(e) = sqlx::query!(
            "UPDATE entity_imagez SET is_primary = 0 WHERE entity_type = ? AND entity_id = ?",
            entity_type_str,
            entity_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to unset existing primary images",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    let blob_type_str = blob_type.as_str();
    if let Err(e) = sqlx::query!(
        "INSERT INTO entity_imagez (entity_type, entity_id, media_blob_id, is_primary, blob_type, created_by)
         VALUES (?, ?, ?, ?, ?, ?)",
        entity_type_str,
        entity_id,
        media_blob_id,
        is_primary,
        blob_type_str,
        created_by
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure("Failed to add entity image", vec![ErrorDetail::from(e)]);
    }

    if is_primary {
        if let Err(e) =
            sync_poster_blob_id(&pool, entity_type, entity_id, Some(media_blob_id)).await
        {
            return GrimoireResponse::failure(
                "Failed to sync poster blob id",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    GrimoireResponse::success_unit("Entity image added successfully")
}

/// remove an image from an entity. when the removed image was primary,
/// the most recently added remaining image (if any) is promoted.
pub async fn remove_entity_image(
    entity_type: VideoEntityType,
    entity_id: &str,
    media_blob_id: &str,
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

    let removed_was_primary = sqlx::query_scalar!(
        "SELECT is_primary FROM entity_imagez WHERE entity_type = ? AND entity_id = ? AND media_blob_id = ?",
        entity_type_str,
        entity_id,
        media_blob_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .map(|v| v != 0)
    .unwrap_or(false);

    let result = match sqlx::query!(
        "DELETE FROM entity_imagez WHERE entity_type = ? AND entity_id = ? AND media_blob_id = ?",
        entity_type_str,
        entity_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to remove entity image",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if result.rows_affected() == 0 {
        return GrimoireResponse::failure("Image not found for entity", vec![]);
    }

    if removed_was_primary {
        // exclude waveform entries - they're not valid poster/thumbnail
        // candidates, even though they share this same gallery table.
        let replacement = sqlx::query_scalar!(
            "SELECT media_blob_id FROM entity_imagez
             WHERE entity_type = ? AND entity_id = ? AND blob_type != 'waveform'
             ORDER BY created_at DESC LIMIT 1",
            entity_type_str,
            entity_id
        )
        .fetch_optional(&pool)
        .await
        .unwrap_or(None);

        if let Some(new_primary_blob_id) = &replacement {
            if let Err(e) = sqlx::query!(
                "UPDATE entity_imagez SET is_primary = 1 WHERE entity_type = ? AND entity_id = ? AND media_blob_id = ?",
                entity_type_str,
                entity_id,
                new_primary_blob_id
            )
            .execute(&pool)
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to promote replacement primary image",
                    vec![ErrorDetail::from(e)],
                );
            }
        }

        if let Err(e) =
            sync_poster_blob_id(&pool, entity_type, entity_id, replacement.as_deref()).await
        {
            return GrimoireResponse::failure(
                "Failed to sync poster blob id",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    GrimoireResponse::success_unit("Entity image removed successfully")
}

/// set an already-linked image as the entity's primary image.
pub async fn set_primary_entity_image(
    entity_type: VideoEntityType,
    entity_id: &str,
    media_blob_id: &str,
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
        "UPDATE entity_imagez SET is_primary = 0 WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to unset existing primary images",
            vec![ErrorDetail::from(e)],
        );
    }

    let result = match sqlx::query!(
        "UPDATE entity_imagez SET is_primary = 1 WHERE entity_type = ? AND entity_id = ? AND media_blob_id = ?",
        entity_type_str,
        entity_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to set primary image",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if result.rows_affected() == 0 {
        return GrimoireResponse::failure("Image not found for entity", vec![]);
    }

    if let Err(e) = sync_poster_blob_id(&pool, entity_type, entity_id, Some(media_blob_id)).await {
        return GrimoireResponse::failure(
            "Failed to sync poster blob id",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Primary image updated")
}
