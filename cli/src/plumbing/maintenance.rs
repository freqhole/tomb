//! Maintenance operations CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::blob_data::{backfill_thumbnails, count_blobs_needing_thumbnails};
use grimoire::maintenance::{cleanup_orphaned_genres, cleanup_orphaned_tags};
use serde::Serialize;

/// Combined summary for all cleanup operations
#[derive(Serialize)]
struct AllCleanupSummary {
    tags: grimoire::maintenance::OrphanedTagsSummary,
    genres: grimoire::maintenance::OrphanedGenresSummary,
    total_found: u32,
    total_deleted: u32,
}

#[derive(Subcommand)]
pub enum MaintenanceAction {
    /// Cleanup orphaned tags
    CleanupOrphanedTags {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Cleanup orphaned genres
    CleanupOrphanedGenres {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Run all cleanup operations
    CleanupAll {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Generate sized thumbnails (50px, 200px) for images without them
    BackfillThumbnails {
        /// Maximum number of blobs to process
        #[arg(long)]
        limit: Option<u32>,
        /// Show what would be processed without actually generating
        #[arg(long)]
        dry_run: bool,
    },
}

/// Handle maintenance commands
pub async fn handle_command(action: MaintenanceAction) -> CommandOutput<serde_json::Value> {
    match action {
        MaintenanceAction::CleanupOrphanedTags { dry_run } => {
            let response = cleanup_orphaned_tags(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::CleanupOrphanedGenres { dry_run } => {
            let response = cleanup_orphaned_genres(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::CleanupAll { dry_run } => {
            // Cleanup tags
            let tags_response = cleanup_orphaned_tags(dry_run).await;
            if !tags_response.success {
                return CommandOutput::failure(tags_response.message, tags_response.errors, ());
            }
            let Some(tags_summary) = tags_response.data else {
                return CommandOutput::failure("No tags summary data returned", vec![], ());
            };

            // Cleanup genres
            let genres_response = cleanup_orphaned_genres(dry_run).await;
            if !genres_response.success {
                return CommandOutput::failure(genres_response.message, genres_response.errors, ());
            }
            let Some(genres_summary) = genres_response.data else {
                return CommandOutput::failure("No genres summary data returned", vec![], ());
            };

            // Create combined summary
            let total_found = tags_summary.tags_found + genres_summary.genres_found;
            let total_deleted = tags_summary.tags_deleted + genres_summary.genres_deleted;

            let combined = AllCleanupSummary {
                tags: tags_summary,
                genres: genres_summary,
                total_found,
                total_deleted,
            };

            let message = if dry_run {
                format!(
                    "Found {} total orphaned records (dry run, nothing deleted)",
                    total_found
                )
            } else {
                format!(
                    "Deleted {} of {} orphaned records",
                    total_deleted, total_found
                )
            };

            CommandOutput::success(message, combined)
        }

        MaintenanceAction::BackfillThumbnails { limit, dry_run } => {
            if dry_run {
                // just count what would be processed (doesn't load all rows)
                let response = count_blobs_needing_thumbnails().await;

                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }

                let Some(total) = response.data else {
                    return CommandOutput::failure("No data returned", vec![], ());
                };

                let to_process = limit.map(|l| l.min(total)).unwrap_or(total);

                let summary = serde_json::json!({
                    "dry_run": true,
                    "blobs_needing_thumbnails": total,
                    "will_process": to_process,
                    "limit": limit,
                });

                let message = format!(
                    "Found {} blobs needing thumbnails, will process {} (dry run)",
                    total, to_process
                );

                CommandOutput::success(message, summary)
            } else {
                // actually generate thumbnails
                let response = backfill_thumbnails(limit, None).await;

                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }

                let Some(result) = response.data else {
                    return CommandOutput::failure("No result data returned", vec![], ());
                };

                CommandOutput::success(response.message, result)
            }
        }
    }
}
