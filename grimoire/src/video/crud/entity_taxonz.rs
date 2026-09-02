//! generalized entity <-> taxon links (video's usage of the shared
//! `entity_taxonz` table)

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// entity_type values video rows use when writing to the generalized
/// `entity_taxonz`/`playlist_itemz`/`playback_progressz` tables. those
/// columns are plain TEXT (no SQL CHECK - polymorphic FKs aren't
/// expressible in sqlite), validated against this enum in rust instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoEntityType {
    Video,
    VideoSeries,
    VideoSeason,
}

impl VideoEntityType {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoEntityType::Video => "video",
            VideoEntityType::VideoSeries => "video_series",
            VideoEntityType::VideoSeason => "video_season",
        }
    }

    pub fn parse(s: &str) -> Result<Self, GrimoireError> {
        match s {
            "video" => Ok(VideoEntityType::Video),
            "video_series" => Ok(VideoEntityType::VideoSeries),
            "video_season" => Ok(VideoEntityType::VideoSeason),
            other => Err(GrimoireError::InvalidEntityType {
                entity_type: other.to_string(),
            }),
        }
    }
}

/// a single entity <-> taxon link row
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct EntityTaxonLink {
    pub entity_type: String,
    pub entity_id: String,
    pub taxon_id: String,
    pub origin: String,
    pub confidence: Option<f64>,
    pub created_at: i64,
    pub created_by: Option<String>,
}

/// link a video-domain entity to a taxon. `origin` distinguishes sources
/// (e.g. "user", "musicbrainz") so the same entity+taxon can be linked by
/// multiple providers without conflict; re-linking the same
/// (entity, taxon, origin) updates the confidence instead of erroring.
pub async fn add_entity_taxon(
    entity_type: VideoEntityType,
    entity_id: &str,
    taxon_id: &str,
    origin: &str,
    confidence: Option<f64>,
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
    if let Err(e) = sqlx::query!(
        "INSERT INTO entity_taxonz (entity_type, entity_id, taxon_id, origin, confidence, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (entity_type, entity_id, taxon_id, origin) DO UPDATE SET confidence = excluded.confidence",
        entity_type_str,
        entity_id,
        taxon_id,
        origin,
        confidence,
        created_by
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure("Failed to add entity taxon", vec![ErrorDetail::from(e)]);
    }

    GrimoireResponse::success_unit("Entity taxon added successfully")
}

/// remove a single entity <-> taxon link
pub async fn remove_entity_taxon(
    entity_type: VideoEntityType,
    entity_id: &str,
    taxon_id: &str,
    origin: &str,
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
        "DELETE FROM entity_taxonz WHERE entity_type = ? AND entity_id = ? AND taxon_id = ? AND origin = ?",
        entity_type_str,
        entity_id,
        taxon_id,
        origin
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to remove entity taxon",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Entity taxon removed successfully")
}

/// list every taxon linked to a video-domain entity, across all origins
pub async fn list_entity_taxons(
    entity_type: VideoEntityType,
    entity_id: &str,
) -> GrimoireResponse<Vec<EntityTaxonLink>> {
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
    let links = match sqlx::query_as!(
        EntityTaxonLink,
        r#"SELECT
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            taxon_id as "taxon_id!",
            origin as "origin!",
            confidence,
            created_at as "created_at!",
            created_by
         FROM entity_taxonz
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY created_at ASC"#,
        entity_type_str,
        entity_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(links) => links,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list entity taxons",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Entity taxons retrieved successfully", links)
}
