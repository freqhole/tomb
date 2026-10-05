//! maintenance command builders.

use crate::ratcore::app::{AdminCommand, CommandKind};
use crate::ratcore::catalog::widgets::{dry_run_arg, limit_arg};

pub(in crate::ratcore::catalog) fn cleanup_orphaned_tags() -> AdminCommand {
    AdminCommand {
        name: "maintenance_cleanup_orphaned_tags".to_string(),
        request_type: "MaintenanceDryRunRequest".to_string(),
        response_type: "OrphanedTagsSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![dry_run_arg()],
    }
}

pub(in crate::ratcore::catalog) fn cleanup_orphaned_genres() -> AdminCommand {
    AdminCommand {
        name: "maintenance_cleanup_orphaned_genres".to_string(),
        request_type: "MaintenanceDryRunRequest".to_string(),
        response_type: "OrphanedGenresSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![dry_run_arg()],
    }
}

pub(in crate::ratcore::catalog) fn cleanup_all() -> AdminCommand {
    AdminCommand {
        name: "maintenance_cleanup_all".to_string(),
        request_type: "MaintenanceDryRunRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![dry_run_arg()],
    }
}

pub(in crate::ratcore::catalog) fn backfill_thumbnails() -> AdminCommand {
    AdminCommand {
        name: "maintenance_backfill_thumbnails".to_string(),
        request_type: "MaintenanceBackfillThumbnailsRequest".to_string(),
        response_type: "BackfillResult".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            limit_arg(0, "max blobs to process (blank = all)"),
            dry_run_arg(),
        ],
    }
}

pub(in crate::ratcore::catalog) fn backfill_blake3() -> AdminCommand {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    AdminCommand {
        name: "maintenance_backfill_blake3".to_string(),
        request_type: "MaintenanceBackfillBlake3Request".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "batch_size".to_string(),
            kind: ArgKind::Number {
                placeholder: "(blank = 100) blobs to hash per batch".to_string(),
                signed: false,
                min: Some(1),
                max: None,
            },
            required: false,
            help: Some("how many rows to process in one pass. covers both audio (file-backed) and db-stored blobs (images, thumbnails, waveforms).".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn cleanup_orphaned_blobs() -> AdminCommand {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    AdminCommand {
        name: "maintenance_cleanup_orphaned_blobs".to_string(),
        request_type: "MaintenanceCleanupOrphanedBlobsRequest".to_string(),
        response_type: "OrphanedBlobsSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "min_age_days".to_string(),
            kind: ArgKind::Number {
                placeholder: "(blank = 30) min days since soft-delete".to_string(),
                signed: false,
                min: Some(0),
                max: None,
            },
            required: false,
            help: Some("only purge blobs soft-deleted more than this many days ago".to_string()),
        }],
    }
}

fn hard_delete_args() -> Vec<crate::ratcore::app::ArgSpec> {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    vec![
        ArgSpec {
            name: "retention_days".to_string(),
            kind: ArgKind::Number {
                placeholder: "(blank = 30) min days since soft-delete".to_string(),
                signed: false,
                min: Some(0),
                max: None,
            },
            required: false,
            help: None,
        },
        ArgSpec {
            name: "delete_blob_data".to_string(),
            kind: ArgKind::Bool { default: true },
            required: true,
            help: Some("also drop the underlying blob_data rows".to_string()),
        },
        dry_run_arg(),
    ]
}

pub(in crate::ratcore::catalog) fn hard_delete_old_records() -> AdminCommand {
    AdminCommand {
        name: "maintenance_hard_delete_old_records".to_string(),
        request_type: "MaintenanceHardDeleteRequest".to_string(),
        response_type: "HardDeleteSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: hard_delete_args(),
    }
}

fn hard_delete_video_args() -> Vec<crate::ratcore::app::ArgSpec> {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    vec![
        ArgSpec {
            name: "retention_days".to_string(),
            kind: ArgKind::Number {
                placeholder: "(blank = 30) min days since soft-delete".to_string(),
                signed: false,
                min: Some(0),
                max: None,
            },
            required: false,
            help: Some(
                "row-level purge only; any media blobs/files this orphans are reclaimed separately by cleanup-orphaned-blobs/run-full"
                    .to_string(),
            ),
        },
        dry_run_arg(),
    ]
}

pub(in crate::ratcore::catalog) fn hard_delete_old_videos() -> AdminCommand {
    AdminCommand {
        name: "maintenance_hard_delete_old_videos".to_string(),
        request_type: "MaintenanceHardDeleteVideoRequest".to_string(),
        response_type: "HardDeleteVideoSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: hard_delete_video_args(),
    }
}

pub(in crate::ratcore::catalog) fn run_full() -> AdminCommand {
    AdminCommand {
        name: "maintenance_run_full".to_string(),
        request_type: "MaintenanceHardDeleteRequest".to_string(),
        response_type: "MaintenanceSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: hard_delete_args(),
    }
}

fn repair_library_args() -> Vec<crate::ratcore::app::ArgSpec> {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    vec![
        dry_run_arg(),
        ArgSpec {
            name: "scan_directory".to_string(),
            kind: ArgKind::Text {
                placeholder: "(blank = whole library) tracked directory path".to_string(),
            },
            required: false,
            help: Some(
                "restrict to one tracked directory's subtree instead of the whole library"
                    .to_string(),
            ),
        },
    ]
}

/// the three directory-phase sub-job toggles, shared by the full
/// `repair_library` command and the `repair_library_thumbnails` preset -
/// `remove_overapplied` is destructive (deletes existing album-image
/// associations) and defaults off, unlike the two backfill toggles.
fn repair_directory_action_args() -> Vec<crate::ratcore::app::ArgSpec> {
    use crate::ratcore::app::{ArgKind, ArgSpec};
    vec![
        ArgSpec {
            name: "backfill_embedded_art".to_string(),
            kind: ArgKind::Bool { default: true },
            required: false,
            help: Some(
                "apply a song's own embedded file art (id3/vorbis cover) to a missing album thumbnail"
                    .to_string(),
            ),
        },
        ArgSpec {
            name: "backfill_directory_art".to_string(),
            kind: ArgKind::Bool { default: true },
            required: false,
            help: Some(
                "apply a directory-level image (folder.jpg etc) to a missing album thumbnail"
                    .to_string(),
            ),
        },
        ArgSpec {
            name: "remove_overapplied".to_string(),
            kind: ArgKind::Bool { default: false },
            required: false,
            help: Some(
                "destructive: remove directory-sourced thumbnails identified as over-applied across unrelated albums"
                    .to_string(),
            ),
        },
    ]
}

/// toggle for `repair_library`'s video-poster-thumbnail sub-job - its own
/// arg (not folded into `repair_directory_action_args`) since it's
/// unrelated to the song/album directory-grouping heuristic those cover.
fn video_thumbnail_action_arg() -> crate::ratcore::app::ArgSpec {
    use crate::ratcore::app::ArgSpec;
    ArgSpec {
        name: "backfill_video_thumbnails".to_string(),
        kind: crate::ratcore::app::ArgKind::Bool { default: true },
        required: false,
        help: Some("extract a poster frame (ffmpeg) for any video missing a thumbnail".to_string()),
    }
}

/// full repair: song+video waveform backfill, video thumbnail backfill,
/// and directory-grouped song/album thumbnail backfill/cleanup. see
/// `maintenance_repair_library_waveforms`/`maintenance_repair_library_thumbnails`/
/// `maintenance_repair_library_video_thumbnails` to run just one group.
pub(in crate::ratcore::catalog) fn repair_library() -> AdminCommand {
    let mut args = repair_library_args();
    args.extend(repair_directory_action_args());
    args.push(video_thumbnail_action_arg());
    AdminCommand {
        name: "maintenance_repair_library".to_string(),
        request_type: "MaintenanceRepairLibraryRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args,
    }
}

/// waveform-only variant - backfills missing song waveforms.
pub(in crate::ratcore::catalog) fn repair_library_waveforms() -> AdminCommand {
    AdminCommand {
        name: "maintenance_repair_library_waveforms".to_string(),
        request_type: "MaintenanceRepairLibraryRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: repair_library_args(),
    }
}

/// directory-image-only variant - backfills missing album thumbnails and
/// (optionally) cleans up images over-applied across unrelated albums.
pub(in crate::ratcore::catalog) fn repair_library_thumbnails() -> AdminCommand {
    let mut args = repair_library_args();
    args.extend(repair_directory_action_args());
    AdminCommand {
        name: "maintenance_repair_library_thumbnails".to_string(),
        request_type: "MaintenanceRepairLibraryRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args,
    }
}

/// video-thumbnail-only variant - backfills a missing poster/thumbnail
/// (ffmpeg frame grab) for any video that doesn't have one yet.
pub(in crate::ratcore::catalog) fn repair_library_video_thumbnails() -> AdminCommand {
    AdminCommand {
        name: "maintenance_repair_library_video_thumbnails".to_string(),
        request_type: "MaintenanceRepairLibraryRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: repair_library_args(),
    }
}
