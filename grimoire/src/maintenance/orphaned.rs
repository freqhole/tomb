//! cleanup utilities for orphaned tags and genres
//!
//! provides functions to find and delete database records that are no longer
//! referenced by any albums or songs.

use crate::database;
use crate::response::GrimoireResponse;
use serde::Serialize;

/// summary of orphaned tag cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedTagsSummary {
    pub tags_found: u32,
    pub tags_deleted: u32,
    pub tag_names: Vec<String>,
}

/// summary of orphaned genre cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedGenresSummary {
    pub genres_found: u32,
    pub genres_deleted: u32,
    pub genre_names: Vec<String>,
}

/// find and optionally delete orphaned tags
///
/// orphaned tags are tags that exist in the `tagz` table but have no
/// corresponding entries in the `album_tagz` junction table
pub async fn cleanup_orphaned_tags(dry_run: bool) -> GrimoireResponse<OrphanedTagsSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // find orphaned tags
    let orphaned_tags = match sqlx::query!(
        r#"
        SELECT id, name FROM tagz
        WHERE id NOT IN (SELECT DISTINCT tag_id FROM album_tagz)
        ORDER BY name
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(tags) => tags,
        Err(e) => {
            return GrimoireResponse::failure("failed to query orphaned tags", vec![e.into()])
        }
    };

    let tag_names: Vec<String> = orphaned_tags.iter().map(|row| row.name.clone()).collect();

    let tags_found = orphaned_tags.len() as u32;
    let mut tags_deleted = 0u32;

    if !dry_run && !orphaned_tags.is_empty() {
        for row in orphaned_tags {
            match sqlx::query!("DELETE FROM tagz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    tags_deleted += 1;
                }
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    let summary = OrphanedTagsSummary {
        tags_found,
        tags_deleted,
        tag_names,
    };

    GrimoireResponse::success("orphaned tags cleanup completed", summary)
}

/// find and optionally delete orphaned genres
///
/// orphaned genres are genre-kind taxons that exist in the `taxonz` table
/// but are not referenced by any album in the `album_taxonz` junction table
pub async fn cleanup_orphaned_genres(dry_run: bool) -> GrimoireResponse<OrphanedGenresSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // find orphaned genre-taxons (not used by any album via album_taxonz)
    let orphaned_genres = match sqlx::query!(
        r#"
        SELECT t.id as "id!", t.label as "name!" FROM taxonz t
        JOIN taxon_kindz k ON k.id = t.kind_id AND k.slug = 'genre'
        WHERE t.id NOT IN (SELECT DISTINCT taxon_id FROM album_taxonz)
        ORDER BY t.label
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(genres) => genres,
        Err(e) => {
            return GrimoireResponse::failure("failed to query orphaned genres", vec![e.into()])
        }
    };

    let genre_names: Vec<String> = orphaned_genres.iter().map(|row| row.name.clone()).collect();

    let genres_found = orphaned_genres.len() as u32;
    let mut genres_deleted = 0u32;

    if !dry_run && !orphaned_genres.is_empty() {
        for row in orphaned_genres {
            match sqlx::query!("DELETE FROM taxonz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    genres_deleted += 1;
                }
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    let summary = OrphanedGenresSummary {
        genres_found,
        genres_deleted,
        genre_names,
    };

    GrimoireResponse::success("orphaned genres cleanup completed", summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cleanup_orphaned_tags_dry_run() {
        // dry run should not delete anything
        let result = cleanup_orphaned_tags(true).await;
        assert!(result.success);
    }

    #[tokio::test]
    async fn test_cleanup_orphaned_genres_dry_run() {
        let result = cleanup_orphaned_genres(true).await;
        assert!(result.success);
    }
}
