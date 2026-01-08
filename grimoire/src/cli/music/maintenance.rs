//! Music maintenance commands

use super::MusicAction;

pub async fn handle_check_blob_references(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::CheckBlobReferences { blob_id } = action {
        // TODO: Move implementation from cli.rs
        println!("Check blob references: blob_id={}", blob_id);
        Ok(())
    } else {
        unreachable!("handle_check_blob_references called with wrong action variant")
    }
}

pub async fn handle_cleanup_orphaned_blobs(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::CleanupOrphanedBlobs {
        min_age_days,
        dry_run,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Cleanup orphaned blobs: min_age_days={}, dry_run={}",
            min_age_days, dry_run
        );
        Ok(())
    } else {
        unreachable!("handle_cleanup_orphaned_blobs called with wrong action variant")
    }
}

pub async fn handle_hard_delete_old_records(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::HardDeleteOldRecords {
        retention_days,
        keep_blob_data,
        dry_run,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Hard delete old records: retention_days={}, keep_blob_data={}, dry_run={}",
            retention_days, keep_blob_data, dry_run
        );
        Ok(())
    } else {
        unreachable!("handle_hard_delete_old_records called with wrong action variant")
    }
}

pub async fn handle_run_maintenance(action: MusicAction) -> anyhow::Result<()> {
    if let MusicAction::RunMaintenance {
        retention_days,
        dry_run,
    } = action
    {
        // TODO: Move implementation from cli.rs
        println!(
            "Run maintenance: retention_days={}, dry_run={}",
            retention_days, dry_run
        );
        Ok(())
    } else {
        unreachable!("handle_run_maintenance called with wrong action variant")
    }
}
