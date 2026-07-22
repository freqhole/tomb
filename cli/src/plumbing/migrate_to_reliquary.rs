//! CUTOVER(0.2.0): one-shot `migrate-to-reliquary` command. deleted once the
//! storage seam cutover finishes and this migration is no longer needed.

use crate::plumbing::utils::CommandOutput;
use grimoire::blobz::migrate_to_reliquary;

/// run the media_blobz + blob_data -> reliquary blobz migration.
///
/// safe to run repeatedly (idempotent via `INSERT OR IGNORE`), and never
/// modifies or deletes anything in grimoire's existing tables - only reads
/// from them and writes into reliquary's database. refuses to run at all
/// (via the hard gate inside `migrate_to_reliquary`) unless every live
/// media blob already has a blake3 hash.
pub async fn handle_command() -> CommandOutput<serde_json::Value> {
    match migrate_to_reliquary().await {
        Ok(report) => {
            let clean = report.is_clean();
            let message = if clean {
                format!(
                    "migrated {} of {} live blob(s) into reliquary ({} already migrated, 0 problems)",
                    report.inserted, report.total_live_blobs, report.already_migrated
                )
            } else {
                format!(
                    "migration ran but found problems: {} unresolved parent(s), {} blob(s) with no content, {} unmigrated blob_data row(s) - see data for details",
                    report.unresolved_parents.len(),
                    report.missing_content.len(),
                    report.unmigrated_blob_data
                )
            };
            let data = serde_json::to_value(&report).unwrap_or(serde_json::Value::Null);
            if clean {
                CommandOutput::success(message, data)
            } else {
                CommandOutput::failure(message, vec![], data)
            }
        }
        Err(e) => CommandOutput::failure(format!("migration failed: {}", e), vec![], ()),
    }
}
