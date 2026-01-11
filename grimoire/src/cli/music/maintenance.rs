//! Music maintenance commands

use super::MusicAction;
use crate::cli::utils::CommandOutput;
use crate::maintenance::{
    cleanup_orphaned_media_blobs_older_than, hard_delete_old_records,
    run_full_maintenance_with_options, HardDeleteOptions,
};
use crate::media_blobz::find_media_blob_references;

pub async fn handle_check_blob_references(action: MusicAction) -> CommandOutput<()> {
    let MusicAction::CheckBlobReferences { blob_id } = action;

    let refs = match find_media_blob_references(&blob_id).await {
        Ok(r) => r,
        Err(e) => {
            return CommandOutput::failure(
                "Failed to check blob references",
                vec![crate::error::ErrorDetail::from(&e)],
                (),
            );
        }
    };

    let message = format!("Media blob {} reference summary", blob_id);
    CommandOutput::success(message, vec![refs]).map_data(|_| ())
}

pub async fn handle_cleanup_orphaned_blobs(action: MusicAction) -> CommandOutput<()> {
    let MusicAction::CleanupOrphanedBlobs {
        min_age_days,
        dry_run: _,
    } = action;

    let response = cleanup_orphaned_media_blobs_older_than(min_age_days as f64).await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(summary) = response.data else {
        return CommandOutput::failure("No summary data returned", vec![], ());
    };

    let message = "Orphaned blob cleanup completed";
    CommandOutput::success(message, vec![summary]).map_data(|_| ())
}

pub async fn handle_hard_delete_old_records(action: MusicAction) -> CommandOutput<()> {
    let MusicAction::HardDeleteOldRecords {
        retention_days,
        keep_blob_data,
        dry_run: _,
    } = action;

    let options = HardDeleteOptions {
        retention_days: retention_days as u32,
        delete_blob_data: !keep_blob_data,
        dry_run: false,
    };

    let response = hard_delete_old_records(options).await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(summary) = response.data else {
        return CommandOutput::failure("No summary data returned", vec![], ());
    };

    let message = "Hard deletion completed";
    CommandOutput::success(message, vec![summary]).map_data(|_| ())
}

pub async fn handle_run_maintenance(action: MusicAction) -> CommandOutput<()> {
    let MusicAction::RunMaintenance {
        retention_days,
        dry_run: _,
    } = action;

    let options = HardDeleteOptions {
        retention_days: retention_days as u32,
        delete_blob_data: true,
        dry_run: false,
    };

    let response = run_full_maintenance_with_options(options).await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(result) = response.data else {
        return CommandOutput::failure("No result data returned", vec![], ());
    };

    let message = "Full maintenance completed";
    CommandOutput::success(message, vec![result]).map_data(|_| ())
}
