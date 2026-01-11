//! Maintenance operations CLI commands

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::maintenance::{
    cleanup_orphaned_genres, cleanup_orphaned_sub_genres, cleanup_orphaned_tags,
};
use clap::Subcommand;
use serde::Serialize;

/// Combined summary for all cleanup operations
#[derive(Serialize)]
struct AllCleanupSummary {
    tags: crate::maintenance::OrphanedTagsSummary,
    genres: crate::maintenance::OrphanedGenresSummary,
    sub_genres: crate::maintenance::OrphanedSubGenresSummary,
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
    /// Cleanup orphaned sub-genres
    CleanupOrphanedSubGenres {
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
}

/// Handle maintenance commands
pub async fn handle_command(action: MaintenanceAction, _format: OutputFormat) -> CommandOutput<()> {
    match action {
        MaintenanceAction::CleanupOrphanedTags { dry_run } => {
            let response = cleanup_orphaned_tags(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary).map_data(|_| ())
        }

        MaintenanceAction::CleanupOrphanedGenres { dry_run } => {
            let response = cleanup_orphaned_genres(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary).map_data(|_| ())
        }

        MaintenanceAction::CleanupOrphanedSubGenres { dry_run } => {
            let response = cleanup_orphaned_sub_genres(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary).map_data(|_| ())
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

            // Cleanup sub-genres
            let sub_genres_response = cleanup_orphaned_sub_genres(dry_run).await;
            if !sub_genres_response.success {
                return CommandOutput::failure(
                    sub_genres_response.message,
                    sub_genres_response.errors,
                    (),
                );
            }
            let Some(sub_genres_summary) = sub_genres_response.data else {
                return CommandOutput::failure("No sub-genres summary data returned", vec![], ());
            };

            // Create combined summary
            let total_found = tags_summary.tags_found
                + genres_summary.genres_found
                + sub_genres_summary.sub_genres_found;
            let total_deleted = tags_summary.tags_deleted
                + genres_summary.genres_deleted
                + sub_genres_summary.sub_genres_deleted;

            let combined = AllCleanupSummary {
                tags: tags_summary,
                genres: genres_summary,
                sub_genres: sub_genres_summary,
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

            CommandOutput::success(message, combined).map_data(|_| ())
        }
    }
}
