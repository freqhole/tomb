//! Maintenance operations CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::blob_data::{backfill_thumbnails, count_blobs_needing_thumbnails};
use grimoire::config::{ensure_server_image_blob, find_config, GrimoireConfig};
use grimoire::error::GrimoireError;
use grimoire::maintenance::{
    cleanup_contentless_media_blobs, cleanup_orphaned_albums, cleanup_orphaned_artists,
    cleanup_orphaned_genres, cleanup_orphaned_tags, cleanup_orphaned_taxons,
    cleanup_orphaned_video_series, default_music_source_dir, default_video_source_dir,
    reorganize_library_sync, repair_library_images_sync, RepairLibraryImagesOptions,
};
use serde::Serialize;
use std::path::PathBuf;

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
    /// Cleanup orphaned artists (zero album or song references)
    CleanupOrphanedArtists {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Cleanup orphaned albums (zero song references)
    CleanupOrphanedAlbums {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Cleanup orphaned video series (zero video references)
    CleanupOrphanedVideoSeries {
        /// Show what would be deleted without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
    /// Cleanup orphaned taxons (every kind except genre - zero references)
    CleanupOrphanedTaxons {
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
    /// Cleanup media_blobz rows with no retrievable content anywhere (no
    /// local_path, no blob_data row, so no blake3 either - genuinely
    /// unhashable, permanently stuck in `blobz backfill-blake3`)
    CleanupContentlessBlobs {
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
    /// Update server image blob for P2P transport
    /// reads server.image_path, creates a media blob, and stores the blob_id in config
    UpdateServerImage {
        /// Path to config file (uses --config if not specified)
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
    },
    /// Update embedded spume web client files on disk
    /// only updates if static_files.enabled=true, directory is set, and directory exists
    UpdateSpume {
        /// Path to config file (uses --config if not specified)
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
    },
    /// Backfill missing song+video waveforms, video thumbnails, and album
    /// thumbnails, and clean up directory-sourced images over-applied
    /// across unrelated albums. runs all sub-jobs except the destructive
    /// removal, which is off by default; see
    /// `RepairLibraryWaveforms`/`RepairLibraryThumbnails`/
    /// `RepairLibraryVideoThumbnails` to run just one group.
    RepairLibrary {
        /// Show what would change without writing anything
        #[arg(long)]
        dry_run: bool,
        /// Restrict to one tracked directory's subtree instead of the whole library
        #[arg(long)]
        scan_dir: Option<String>,
        /// Skip applying a song's embedded file art (id3/vorbis cover) as an album thumbnail
        #[arg(long)]
        no_embedded_art: bool,
        /// Skip applying directory-level images (folder.jpg etc) as an album thumbnail
        #[arg(long)]
        no_directory_art: bool,
        /// Destructive: also remove directory-sourced thumbnails identified as over-applied
        #[arg(long)]
        remove_overapplied: bool,
    },
    /// Backfill missing song and video waveforms only (no thumbnail changes)
    RepairLibraryWaveforms {
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        scan_dir: Option<String>,
    },
    /// Backfill missing album thumbnails (and optionally clean up
    /// over-applied directory images) only - no waveform or video thumbnail changes
    RepairLibraryThumbnails {
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        scan_dir: Option<String>,
        /// Skip applying a song's embedded file art (id3/vorbis cover) as an album thumbnail
        #[arg(long)]
        no_embedded_art: bool,
        /// Skip applying directory-level images (folder.jpg etc) as an album thumbnail
        #[arg(long)]
        no_directory_art: bool,
        /// Destructive: also remove directory-sourced thumbnails identified as over-applied
        #[arg(long)]
        remove_overapplied: bool,
    },
    /// Backfill a missing poster/thumbnail (ffmpeg frame grab) for any
    /// video that doesn't have one yet - no other changes
    RepairLibraryVideoThumbnails {
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        scan_dir: Option<String>,
    },
    /// Move fetched music/video files into a user-chosen library
    /// directory (with naming + folder layout), optionally embedding
    /// id3/vorbis tags and cover art into the moved song files along the
    /// way. defaults to both domains and the configured fetch output
    /// dirs; pass `--domain music` or `--domain video` to restrict to one.
    ReorganizeLibrary {
        /// destination root directory to move files into
        #[arg(long)]
        target_dir: String,
        /// which domain(s) to reorganize: "music", "video", or "both" (default)
        #[arg(long, default_value = "both")]
        domain: String,
        /// source directory to scan for fetched music (defaults to the
        /// configured fetch_music output dir)
        #[arg(long)]
        source_music_dir: Option<String>,
        /// source directory to scan for fetched video (defaults to the
        /// configured fetch_video output dir)
        #[arg(long)]
        source_video_dir: Option<String>,
        /// show what would move without actually moving/writing anything
        #[arg(long)]
        dry_run: bool,
        /// skip embedding id3/vorbis tags and cover art into moved song files
        #[arg(long)]
        no_embed_tags: bool,
    },
}

/// Handle maintenance commands
pub async fn handle_command(
    action: MaintenanceAction,
    global_config: Option<std::path::PathBuf>,
) -> CommandOutput<serde_json::Value> {
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

        MaintenanceAction::CleanupOrphanedArtists { dry_run } => {
            let response = cleanup_orphaned_artists(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::CleanupOrphanedAlbums { dry_run } => {
            let response = cleanup_orphaned_albums(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::CleanupOrphanedVideoSeries { dry_run } => {
            let response = cleanup_orphaned_video_series(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::CleanupOrphanedTaxons { dry_run } => {
            let response = cleanup_orphaned_taxons(dry_run).await;

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

        MaintenanceAction::CleanupContentlessBlobs { dry_run } => {
            let response = cleanup_contentless_media_blobs(dry_run).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };

            CommandOutput::success(response.message, summary)
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

        MaintenanceAction::UpdateServerImage { config } => {
            let path = match find_config(config.or(global_config)) {
                Ok(p) => p,
                Err(e) => {
                    return CommandOutput::failure(
                        "failed to find config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            match ensure_server_image_blob(&path).await {
                Ok(blob_id) => {
                    let message = format!("server image blob created: {}", blob_id);
                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "blob_id": blob_id,
                            "config_path": path.display().to_string()
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "failed to update server image blob",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }

        MaintenanceAction::UpdateSpume { config } => {
            // check for embedded assets first
            if !grimoire::setup::has_embedded_spume() {
                return CommandOutput::failure(
                    "no embedded spume assets",
                    vec![GrimoireError::ProcessingFailed {
                        message: "this build does not include embedded spume web client"
                            .to_string(),
                    }
                    .into()],
                    (),
                );
            }

            // find config to get static_files settings
            let path = match find_config(config.or(global_config)) {
                Ok(p) => p,
                Err(e) => {
                    return CommandOutput::failure(
                        "failed to find config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            // load config to check static_files settings
            let cfg = match GrimoireConfig::load(&path) {
                Ok(c) => c,
                Err(e) => {
                    return CommandOutput::failure(
                        "failed to load config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            // only update if enabled=true AND directory is set AND directory exists
            let server = match &cfg.server {
                Some(s) => s,
                None => {
                    return CommandOutput::failure(
                        "server config not found",
                        vec![GrimoireError::ProcessingFailed {
                            message: "this command requires [server] section in config".to_string(),
                        }
                        .into()],
                        (),
                    );
                }
            };

            if !server.static_files.enabled {
                return CommandOutput::failure(
                    "static_files.enabled is false",
                    vec![GrimoireError::ProcessingFailed {
                        message:
                            "spume update only applies when server.static_files.enabled = true"
                                .to_string(),
                    }
                    .into()],
                    (),
                );
            }

            let spume_dir = match &server.static_files.directory {
                Some(dir) => dir.clone(),
                None => {
                    return CommandOutput::failure(
                        "static_files.directory not set",
                        vec![GrimoireError::ProcessingFailed {
                            message: "spume update only applies when server.static_files.directory is configured (embedded assets are served directly when no directory is set)"
                                .to_string(),
                        }
                        .into()],
                        (),
                    );
                }
            };

            if !spume_dir.exists() {
                return CommandOutput::failure(
                    "static_files.directory does not exist",
                    vec![GrimoireError::ProcessingFailed {
                        message: format!(
                            "directory {} does not exist - run update-spume after initial extraction or create directory manually",
                            spume_dir.display()
                        ),
                    }
                    .into()],
                    (),
                );
            }

            match grimoire::setup::update_spume_to(&spume_dir) {
                Ok(result) => {
                    let message = format!(
                        "spume updated: cleaned {} items, extracted {} files to {}",
                        result.files_cleaned, result.files_extracted, result.destination
                    );
                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "files_cleaned": result.files_cleaned,
                            "files_extracted": result.files_extracted,
                            "destination": result.destination
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "failed to update spume",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }

        MaintenanceAction::RepairLibrary {
            dry_run,
            scan_dir,
            no_embedded_art,
            no_directory_art,
            remove_overapplied,
        } => {
            let options = RepairLibraryImagesOptions {
                backfill_waveforms: true,
                backfill_embedded_art: !no_embedded_art,
                backfill_directory_art: !no_directory_art,
                remove_overapplied,
                backfill_video_thumbnails: true,
            };
            let response = repair_library_images_sync(dry_run, scan_dir, options, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }
            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };
            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::RepairLibraryWaveforms { dry_run, scan_dir } => {
            let options = RepairLibraryImagesOptions {
                backfill_waveforms: true,
                backfill_embedded_art: false,
                backfill_directory_art: false,
                remove_overapplied: false,
                backfill_video_thumbnails: false,
            };
            let response = repair_library_images_sync(dry_run, scan_dir, options, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }
            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };
            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::RepairLibraryThumbnails {
            dry_run,
            scan_dir,
            no_embedded_art,
            no_directory_art,
            remove_overapplied,
        } => {
            let options = RepairLibraryImagesOptions {
                backfill_waveforms: false,
                backfill_embedded_art: !no_embedded_art,
                backfill_directory_art: !no_directory_art,
                remove_overapplied,
                backfill_video_thumbnails: false,
            };
            let response = repair_library_images_sync(dry_run, scan_dir, options, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }
            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };
            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::RepairLibraryVideoThumbnails { dry_run, scan_dir } => {
            let options = RepairLibraryImagesOptions {
                backfill_waveforms: false,
                backfill_embedded_art: false,
                backfill_directory_art: false,
                remove_overapplied: false,
                backfill_video_thumbnails: true,
            };
            let response = repair_library_images_sync(dry_run, scan_dir, options, None).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }
            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };
            CommandOutput::success(response.message, summary)
        }

        MaintenanceAction::ReorganizeLibrary {
            target_dir,
            domain,
            source_music_dir,
            source_video_dir,
            dry_run,
            no_embed_tags,
        } => {
            let include_music = domain != "video";
            let include_video = domain != "music";
            let source_music = source_music_dir.unwrap_or_else(default_music_source_dir);
            let source_video = source_video_dir.unwrap_or_else(default_video_source_dir);
            let response = reorganize_library_sync(
                &target_dir,
                &source_music,
                &source_video,
                include_music,
                include_video,
                dry_run,
                !no_embed_tags,
                None,
            )
            .await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }
            let Some(summary) = response.data else {
                return CommandOutput::failure("No summary data returned", vec![], ());
            };
            CommandOutput::success(response.message, summary)
        }
    }
}
