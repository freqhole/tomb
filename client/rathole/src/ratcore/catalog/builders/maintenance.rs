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
