//! Maintenance operations CLI commands

use crate::cli::utils::OutputFormat;
use crate::error::{GrimoireError, GrimoireResult};
use crate::maintenance::{
    cleanup_orphaned_genres, cleanup_orphaned_sub_genres, cleanup_orphaned_tags,
};
use crate::response::GrimoireResponse;
use clap::Subcommand;

// Temporary adapter to convert GrimoireResponse to Result for CLI compatibility
// TODO: Phase 5 will update CLI to use GrimoireResponse directly
fn to_result<T>(response: GrimoireResponse<T>) -> GrimoireResult<T> {
    if response.success {
        response
            .data
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "Response succeeded but contained no data".to_string(),
            })
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        Err(GrimoireError::ProcessingFailed {
            message: format!("{}: {}", response.message, error_messages.join(", ")),
        })
    }
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
pub async fn handle_command(
    action: MaintenanceAction,
    _format: OutputFormat,
) -> GrimoireResult<()> {
    match action {
        MaintenanceAction::CleanupOrphanedTags { dry_run } => {
            println!("Finding orphaned tags...");
            let summary = to_result(cleanup_orphaned_tags(dry_run).await)?;

            println!("\n=== Orphaned Tags Summary ===");
            println!("Tags found: {}", summary.tags_found);

            if summary.tags_found > 0 {
                println!("\nOrphaned tags:");
                for name in &summary.tag_names {
                    println!("  - {}", name);
                }

                if dry_run {
                    println!("\n[DRY RUN] No tags were deleted. Run without --dry-run to delete.");
                } else {
                    println!("\nTags deleted: {}", summary.tags_deleted);
                    if summary.tags_deleted < summary.tags_found {
                        println!(
                            "Warning: {} tags failed to delete",
                            summary.tags_found - summary.tags_deleted
                        );
                    }
                }
            } else {
                println!("No orphaned tags found.");
            }
        }

        MaintenanceAction::CleanupOrphanedGenres { dry_run } => {
            println!("Finding orphaned genres...");
            let summary = to_result(cleanup_orphaned_genres(dry_run).await)?;

            println!("\n=== Orphaned Genres Summary ===");
            println!("Genres found: {}", summary.genres_found);

            if summary.genres_found > 0 {
                println!("\nOrphaned genres:");
                for name in &summary.genre_names {
                    println!("  - {}", name);
                }

                if dry_run {
                    println!(
                        "\n[DRY RUN] No genres were deleted. Run without --dry-run to delete."
                    );
                } else {
                    println!("\nGenres deleted: {}", summary.genres_deleted);
                    if summary.genres_deleted < summary.genres_found {
                        println!(
                            "Warning: {} genres failed to delete",
                            summary.genres_found - summary.genres_deleted
                        );
                    }
                }
            } else {
                println!("No orphaned genres found.");
            }
        }

        MaintenanceAction::CleanupOrphanedSubGenres { dry_run } => {
            println!("Finding orphaned sub-genres...");
            let summary = to_result(cleanup_orphaned_sub_genres(dry_run).await)?;

            println!("\n=== Orphaned Sub-Genres Summary ===");
            println!("Sub-genres found: {}", summary.sub_genres_found);

            if summary.sub_genres_found > 0 {
                println!("\nOrphaned sub-genres:");
                for name in &summary.sub_genre_names {
                    println!("  - {}", name);
                }

                if dry_run {
                    println!(
                        "\n[DRY RUN] No sub-genres were deleted. Run without --dry-run to delete."
                    );
                } else {
                    println!("\nSub-genres deleted: {}", summary.sub_genres_deleted);
                    if summary.sub_genres_deleted < summary.sub_genres_found {
                        println!(
                            "Warning: {} sub-genres failed to delete",
                            summary.sub_genres_found - summary.sub_genres_deleted
                        );
                    }
                }
            } else {
                println!("No orphaned sub-genres found.");
            }
        }

        MaintenanceAction::CleanupAll { dry_run } => {
            println!("Running comprehensive orphaned records cleanup...\n");

            // Cleanup tags
            println!("=== Cleaning up orphaned tags ===");
            let tags_summary = to_result(cleanup_orphaned_tags(dry_run).await)?;
            println!("Tags found: {}", tags_summary.tags_found);
            if !dry_run && tags_summary.tags_deleted > 0 {
                println!("Tags deleted: {}", tags_summary.tags_deleted);
            }

            // Cleanup genres
            println!("\n=== Cleaning up orphaned genres ===");
            let genres_summary = to_result(cleanup_orphaned_genres(dry_run).await)?;
            println!("Genres found: {}", genres_summary.genres_found);
            if !dry_run && genres_summary.genres_deleted > 0 {
                println!("Genres deleted: {}", genres_summary.genres_deleted);
            }

            // Cleanup sub-genres
            println!("\n=== Cleaning up orphaned sub-genres ===");
            let sub_genres_summary = to_result(cleanup_orphaned_sub_genres(dry_run).await)?;
            println!("Sub-genres found: {}", sub_genres_summary.sub_genres_found);
            if !dry_run && sub_genres_summary.sub_genres_deleted > 0 {
                println!(
                    "Sub-genres deleted: {}",
                    sub_genres_summary.sub_genres_deleted
                );
            }

            // Overall summary
            println!("\n=== Overall Summary ===");
            let total_found = tags_summary.tags_found
                + genres_summary.genres_found
                + sub_genres_summary.sub_genres_found;
            println!("Total orphaned records found: {}", total_found);

            if !dry_run {
                let total_deleted = tags_summary.tags_deleted
                    + genres_summary.genres_deleted
                    + sub_genres_summary.sub_genres_deleted;
                println!("Total records deleted: {}", total_deleted);
            } else {
                println!("\n[DRY RUN] No records were deleted. Run without --dry-run to delete.");
            }
        }
    }

    Ok(())
}
