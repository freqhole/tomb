//! Music maintenance commands (custom - no offal routes)

use crate::plumbing::utils::CommandOutput;
use grimoire::maintenance::{
    cleanup_orphaned_media_blobs_older_than, hard_delete_old_records,
    run_full_maintenance_with_options, HardDeleteOptions,
};
use grimoire::media_blobz::find_media_blob_references;

pub async fn handle_check_blob_references(blob_id: String) -> CommandOutput<serde_json::Value> {
    let refs = match find_media_blob_references(&blob_id).await {
        Ok(r) => r,
        Err(e) => {
            return CommandOutput::failure(
                "failed to check blob references",
                vec![grimoire::error::ErrorDetail::from(&e)],
                (),
            );
        }
    };

    CommandOutput::success(
        format!("media blob {} reference summary", blob_id),
        vec![refs],
    )
}

pub async fn handle_cleanup_orphaned_blobs(
    min_age_days: i64,
    _dry_run: bool,
) -> CommandOutput<serde_json::Value> {
    let response = cleanup_orphaned_media_blobs_older_than(min_age_days as f64).await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(summary) = response.data else {
        return CommandOutput::failure("no summary data returned", vec![], ());
    };

    CommandOutput::success("orphaned blob cleanup completed", vec![summary])
}

pub async fn handle_hard_delete_old_records(
    retention_days: i64,
    keep_blob_data: bool,
    _dry_run: bool,
) -> CommandOutput<serde_json::Value> {
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
        return CommandOutput::failure("no summary data returned", vec![], ());
    };

    CommandOutput::success("hard deletion completed", vec![summary])
}

pub async fn handle_run_maintenance(
    retention_days: i64,
    _dry_run: bool,
) -> CommandOutput<serde_json::Value> {
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
        return CommandOutput::failure("no result data returned", vec![], ());
    };

    CommandOutput::success("full maintenance completed", vec![result])
}
