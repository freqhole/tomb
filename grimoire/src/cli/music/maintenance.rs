//! Music maintenance commands

use super::MusicAction;
use crate::blob_data::OrphanedBlobSummary;
use crate::cli::output::CommandOutput;
use crate::error::GrimoireResult;
use crate::maintenance::{
    cleanup_orphaned_media_blobs_older_than, hard_delete_old_records,
    run_full_maintenance_with_options, HardDeleteOptions, HardDeleteSummary, MaintenanceResult,
};
use crate::media_blobz::{find_media_blob_references, MediaBlobReferences};

pub async fn handle_check_blob_references(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<MediaBlobReferences>>> {
    if let MusicAction::CheckBlobReferences { blob_id } = action {
        let refs = find_media_blob_references(&blob_id).await?;

        let message = format!("Media blob {} reference summary", blob_id);
        Ok(CommandOutput::new(message, vec![refs]))
    } else {
        unreachable!("handle_check_blob_references called with wrong action variant")
    }
}

pub async fn handle_cleanup_orphaned_blobs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<OrphanedBlobSummary>>> {
    if let MusicAction::CleanupOrphanedBlobs {
        min_age_days,
        dry_run: _,
    } = action
    {
        let summary = cleanup_orphaned_media_blobs_older_than(min_age_days as f64).await?;

        let message = "Orphaned blob cleanup completed";
        Ok(CommandOutput::new(message, vec![summary]))
    } else {
        unreachable!("handle_cleanup_orphaned_blobs called with wrong action variant")
    }
}

pub async fn handle_hard_delete_old_records(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<HardDeleteSummary>>> {
    if let MusicAction::HardDeleteOldRecords {
        retention_days,
        keep_blob_data,
        dry_run: _,
    } = action
    {
        let options = HardDeleteOptions {
            retention_days: retention_days as u32,
            delete_blob_data: !keep_blob_data,
            dry_run: false,
        };

        let summary = hard_delete_old_records(options).await?;

        let message = "Hard deletion completed";
        Ok(CommandOutput::new(message, vec![summary]))
    } else {
        unreachable!("handle_hard_delete_old_records called with wrong action variant")
    }
}

pub async fn handle_run_maintenance(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<Vec<MaintenanceResult>>> {
    if let MusicAction::RunMaintenance {
        retention_days,
        dry_run: _,
    } = action
    {
        let options = HardDeleteOptions {
            retention_days: retention_days as u32,
            delete_blob_data: true,
            dry_run: false,
        };

        let result = run_full_maintenance_with_options(options).await?;

        let message = "Full maintenance completed";
        Ok(CommandOutput::new(message, vec![result]))
    } else {
        unreachable!("handle_run_maintenance called with wrong action variant")
    }
}
