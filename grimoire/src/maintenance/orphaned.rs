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

/// summary of orphaned artist cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedArtistsSummary {
    pub artists_found: u32,
    pub artists_deleted: u32,
    pub artist_names: Vec<String>,
}

/// summary of orphaned album cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedAlbumsSummary {
    pub albums_found: u32,
    pub albums_deleted: u32,
    pub album_titles: Vec<String>,
}

/// summary of orphaned video series cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedVideoSeriesSummary {
    pub series_found: u32,
    pub series_deleted: u32,
    pub series_titles: Vec<String>,
}

/// summary of orphaned (non-genre) taxon cleanup operation
#[derive(Debug, Clone, Serialize)]
pub struct OrphanedTaxonsSummary {
    pub taxons_found: u32,
    pub taxons_deleted: u32,
    pub taxon_labels: Vec<String>,
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

/// find and optionally delete orphaned artists
///
/// orphaned artists have zero rows in `artist_albumz` AND zero rows in
/// `artist_songz` - no album or song references them at all.
pub async fn cleanup_orphaned_artists(dry_run: bool) -> GrimoireResponse<OrphanedArtistsSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let orphaned_artists = match sqlx::query!(
        r#"
        SELECT id, name FROM artistz
        WHERE id NOT IN (SELECT DISTINCT artist_id FROM artist_albumz)
          AND id NOT IN (SELECT DISTINCT artist_id FROM artist_songz)
        ORDER BY name
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure("failed to query orphaned artists", vec![e.into()])
        }
    };

    let artist_names: Vec<String> = orphaned_artists
        .iter()
        .map(|row| row.name.clone())
        .collect();
    let artists_found = orphaned_artists.len() as u32;
    let mut artists_deleted = 0u32;

    if !dry_run && !orphaned_artists.is_empty() {
        for row in orphaned_artists {
            match sqlx::query!("DELETE FROM artistz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => artists_deleted += 1,
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    GrimoireResponse::success(
        "orphaned artists cleanup completed",
        OrphanedArtistsSummary {
            artists_found,
            artists_deleted,
            artist_names,
        },
    )
}

/// find and optionally delete orphaned albums
///
/// orphaned albums have zero rows in `album_songz` - no song references
/// them at all (a tracklist-less album is nothing to play).
pub async fn cleanup_orphaned_albums(dry_run: bool) -> GrimoireResponse<OrphanedAlbumsSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let orphaned_albums = match sqlx::query!(
        r#"
        SELECT id, title FROM albumz
        WHERE id NOT IN (SELECT DISTINCT album_id FROM album_songz)
        ORDER BY title
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure("failed to query orphaned albums", vec![e.into()])
        }
    };

    let album_titles: Vec<String> = orphaned_albums
        .iter()
        .map(|row| row.title.clone())
        .collect();
    let albums_found = orphaned_albums.len() as u32;
    let mut albums_deleted = 0u32;

    if !dry_run && !orphaned_albums.is_empty() {
        for row in orphaned_albums {
            match sqlx::query!("DELETE FROM albumz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => albums_deleted += 1,
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    GrimoireResponse::success(
        "orphaned albums cleanup completed",
        OrphanedAlbumsSummary {
            albums_found,
            albums_deleted,
            album_titles,
        },
    )
}

/// find and optionally delete orphaned video series
///
/// orphaned series have zero rows in `videoz` referencing them via
/// `series_id` - `video_seasonz` can't outlive its series anyway
/// (`ON DELETE CASCADE`), so videos are the only reference that matters.
pub async fn cleanup_orphaned_video_series(
    dry_run: bool,
) -> GrimoireResponse<OrphanedVideoSeriesSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let orphaned_series = match sqlx::query!(
        r#"
        SELECT id, title FROM video_seriez
        WHERE id NOT IN (
            SELECT DISTINCT series_id FROM videoz WHERE series_id IS NOT NULL
        )
        ORDER BY title
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query orphaned video series",
                vec![e.into()],
            )
        }
    };

    let series_titles: Vec<String> = orphaned_series
        .iter()
        .map(|row| row.title.clone())
        .collect();
    let series_found = orphaned_series.len() as u32;
    let mut series_deleted = 0u32;

    if !dry_run && !orphaned_series.is_empty() {
        for row in orphaned_series {
            match sqlx::query!("DELETE FROM video_seriez WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => series_deleted += 1,
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    GrimoireResponse::success(
        "orphaned video series cleanup completed",
        OrphanedVideoSeriesSummary {
            series_found,
            series_deleted,
            series_titles,
        },
    )
}

/// find and optionally delete orphaned taxons (every kind EXCEPT genre -
/// see `cleanup_orphaned_genres` for that one, kept separate so the two
/// summaries don't double-count the same rows).
///
/// orphaned taxons have zero rows in `album_taxonz` AND zero rows in
/// `entity_taxonz` - albums use the former, video (and any future
/// domain) uses the latter (see migrations/057_entity_taxonz.sql).
pub async fn cleanup_orphaned_taxons(dry_run: bool) -> GrimoireResponse<OrphanedTaxonsSummary> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let orphaned_taxons = match sqlx::query!(
        r#"
        SELECT t.id as "id!", t.label as "label!" FROM taxonz t
        JOIN taxon_kindz k ON k.id = t.kind_id AND k.slug != 'genre'
        WHERE t.id NOT IN (SELECT DISTINCT taxon_id FROM album_taxonz)
          AND t.id NOT IN (SELECT DISTINCT taxon_id FROM entity_taxonz)
        ORDER BY t.label
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure("failed to query orphaned taxons", vec![e.into()])
        }
    };

    let taxon_labels: Vec<String> = orphaned_taxons
        .iter()
        .map(|row| row.label.clone())
        .collect();
    let taxons_found = orphaned_taxons.len() as u32;
    let mut taxons_deleted = 0u32;

    if !dry_run && !orphaned_taxons.is_empty() {
        for row in orphaned_taxons {
            match sqlx::query!("DELETE FROM taxonz WHERE id = ?", row.id)
                .execute(&pool)
                .await
            {
                Ok(_) => taxons_deleted += 1,
                Err(_) => {
                    // continue on error - summary will show partial deletion
                }
            }
        }
    }

    GrimoireResponse::success(
        "orphaned taxons cleanup completed",
        OrphanedTaxonsSummary {
            taxons_found,
            taxons_deleted,
            taxon_labels,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // these are integration tests in disguise — they require a real
    // sqlite database with the full schema applied (tagz, album_tagz,
    // taxonz, taxon_kindz, album_taxonz). #[ignore] keeps them out of
    // the default unit-test run; invoke with
    // `cargo test -p grimoire --lib -- --ignored test_cleanup_orphaned`
    // against a provisioned data_dir to exercise them.
    #[tokio::test]
    #[ignore = "needs a real db with schema applied"]
    async fn test_cleanup_orphaned_tags_dry_run() {
        crate::config::init_config_for_tests();
        // dry run should not delete anything
        let result = cleanup_orphaned_tags(true).await;
        assert!(result.success);
    }

    #[tokio::test]
    #[ignore = "needs a real db with schema applied"]
    async fn test_cleanup_orphaned_genres_dry_run() {
        crate::config::init_config_for_tests();
        let result = cleanup_orphaned_genres(true).await;
        assert!(result.success);
    }
}
