//! Cleanup utilities for orphaned tags, genres, and sub-genres
//!
//! Provides functions to find and delete database records that are no longer
//! referenced by any albums or songs.

use crate::database;
use crate::response::GrimoireResponse;
use serde::Serialize;

/// Summary of orphaned tag cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedTagsSummary {
    pub tags_found: u32,
    pub tags_deleted: u32,
    pub tag_names: Vec<String>,
}

/// Summary of orphaned genre cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedGenresSummary {
    pub genres_found: u32,
    pub genres_deleted: u32,
    pub genre_names: Vec<String>,
}

/// Summary of orphaned sub-genre cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedSubGenresSummary {
    pub sub_genres_found: u32,
    pub sub_genres_deleted: u32,
    pub sub_genre_names: Vec<String>,
}

/// Find and optionally delete orphaned tags
///
/// Orphaned tags are tags that exist in the `tagz` table but have no
/// corresponding entries in the `album_tagz` junction table (i.e., no
/// albums are using these tags).
///
/// # Arguments
/// * `dry_run` - If true, only finds orphans without deleting them
///
/// # Returns
/// Summary containing the list of orphaned tag names and deletion status
pub async fn cleanup_orphaned_tags(dry_run: bool) -> GrimoireResponse<OrphanedTagsSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Find orphaned tags
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
            return GrimoireResponse::failure("Failed to query orphaned tags", vec![e.into()])
        }
    };

    let tag_names: Vec<String> = orphaned_tags.iter().map(|row| row.name.clone()).collect();

    let tags_found = orphaned_tags.len() as u32;
    let mut tags_deleted = 0u32;

    if !dry_run && !orphaned_tags.is_empty() {
        // Delete orphaned tags
        for row in orphaned_tags {
            match sqlx::query!("DELETE FROM tagz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    tags_deleted += 1;
                }
                Err(_) => {
                    // Continue on error - summary will show partial deletion
                }
            }
        }
    }

    let summary = OrphanedTagsSummary {
        tags_found,
        tags_deleted,
        tag_names,
    };

    GrimoireResponse::success("Orphaned tags cleanup completed", summary)
}

/// Find and optionally delete orphaned genres
///
/// Orphaned genres are genres that exist in the `genrez` table but are not
/// referenced by any album in the `albumz` table (via the `genre_id` column).
///
/// # Arguments
/// * `dry_run` - If true, only finds orphans without deleting them
///
/// # Returns
/// Summary containing the list of orphaned genre names and deletion status
pub async fn cleanup_orphaned_genres(dry_run: bool) -> GrimoireResponse<OrphanedGenresSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Find orphaned genres (not used by albums AND not used as parent by sub-genres)
    let orphaned_genres = match sqlx::query!(
        r#"
        SELECT id, name FROM genrez
        WHERE id NOT IN (
            SELECT DISTINCT genre_id FROM albumz
            WHERE genre_id IS NOT NULL
        )
        AND id NOT IN (
            SELECT DISTINCT parent_genre_id FROM sub_genrez
            WHERE parent_genre_id IS NOT NULL
        )
        ORDER BY name
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(genres) => genres,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query orphaned genres", vec![e.into()])
        }
    };

    let genre_names: Vec<String> = orphaned_genres.iter().map(|row| row.name.clone()).collect();

    let genres_found = orphaned_genres.len() as u32;
    let mut genres_deleted = 0u32;

    if !dry_run && !orphaned_genres.is_empty() {
        // Delete orphaned genres
        for row in orphaned_genres {
            match sqlx::query!("DELETE FROM genrez WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    genres_deleted += 1;
                }
                Err(_) => {
                    // Continue on error - summary will show partial deletion
                }
            }
        }
    }

    let summary = OrphanedGenresSummary {
        genres_found,
        genres_deleted,
        genre_names,
    };

    GrimoireResponse::success("Orphaned genres cleanup completed", summary)
}

/// Find and optionally delete orphaned sub-genres
///
/// Orphaned sub-genres are sub-genres that exist in the `sub_genrez` table
/// but whose `parent_genre_id` references a genre that no longer exists in
/// the `genrez` table.
///
/// # Arguments
/// * `dry_run` - If true, only finds orphans without deleting them
///
/// # Returns
/// Summary containing the list of orphaned sub-genre names and deletion status
pub async fn cleanup_orphaned_sub_genres(
    dry_run: bool,
) -> GrimoireResponse<OrphanedSubGenresSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Find orphaned sub-genres (parent genre doesn't exist)
    let orphaned_sub_genres = match sqlx::query!(
        r#"
        SELECT id, name FROM sub_genrez
        WHERE parent_genre_id NOT IN (SELECT id FROM genrez)
        ORDER BY name
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(sub_genres) => sub_genres,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query orphaned sub-genres", vec![e.into()])
        }
    };

    let sub_genre_names: Vec<String> = orphaned_sub_genres
        .iter()
        .map(|row| row.name.clone())
        .collect();

    let sub_genres_found = orphaned_sub_genres.len() as u32;
    let mut sub_genres_deleted = 0u32;

    if !dry_run && !orphaned_sub_genres.is_empty() {
        // Delete orphaned sub-genres
        for row in orphaned_sub_genres {
            match sqlx::query!("DELETE FROM sub_genrez WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    sub_genres_deleted += 1;
                }
                Err(_) => {
                    // Continue on error - summary will show partial deletion
                }
            }
        }
    }

    let summary = OrphanedSubGenresSummary {
        sub_genres_found,
        sub_genres_deleted,
        sub_genre_names,
    };

    GrimoireResponse::success("Orphaned sub-genres cleanup completed", summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_cleanup_orphaned_tags_dry_run() {
        let response = cleanup_orphaned_tags(true).await;
        assert!(response.success);
        let summary = response.data.unwrap();
        assert_eq!(summary.tags_deleted, 0); // Dry run should not delete
    }

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_cleanup_orphaned_genres_dry_run() {
        let response = cleanup_orphaned_genres(true).await;
        assert!(response.success);
        let summary = response.data.unwrap();
        assert_eq!(summary.genres_deleted, 0); // Dry run should not delete
    }

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_cleanup_orphaned_sub_genres_dry_run() {
        let response = cleanup_orphaned_sub_genres(true).await;
        assert!(response.success);
        let summary = response.data.unwrap();
        assert_eq!(summary.sub_genres_deleted, 0); // Dry run should not delete
    }
}
