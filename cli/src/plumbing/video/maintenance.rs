//! video maintenance commands (custom - no offal routes)
//!
//! mirrors the music domain's maintenance plumbing. blob/file cleanup for
//! whatever this orphans is handled separately by the domain-agnostic
//! `maintenance cleanup-orphaned-blobs`/full-maintenance pass (see
//! `grimoire::maintenance::video_hard_delete` module docs).

use crate::plumbing::utils::CommandOutput;
use grimoire::maintenance::{hard_delete_old_videos, HardDeleteVideoOptions};

pub async fn handle_hard_delete_old_videos(
    retention_days: i64,
    dry_run: bool,
) -> CommandOutput<serde_json::Value> {
    let options = HardDeleteVideoOptions {
        retention_days: retention_days as u32,
        dry_run,
    };

    let response = hard_delete_old_videos(options).await;
    if !response.success {
        return CommandOutput::failure(response.message, response.errors, ());
    }

    let Some(summary) = response.data else {
        return CommandOutput::failure("no summary data returned", vec![], ());
    };

    CommandOutput::success(response.message, summary)
}
