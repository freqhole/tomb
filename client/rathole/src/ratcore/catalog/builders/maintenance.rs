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
