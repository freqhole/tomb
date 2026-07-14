//! CUTOVER(0.2.0): one-shot `migrate-to-haruspex` command. deleted once no
//! deployment still carries pre-haruspex data in grimoire's original auth
//! tables.

use crate::plumbing::utils::CommandOutput;
use grimoire::users::migrate_to_haruspex;

/// run the grimoire auth tables -> haruspex database migration.
///
/// safe to run repeatedly (identities upsert, everything else is
/// `INSERT OR IGNORE`). only reads from grimoire's original auth tables
/// and writes into haruspex's database - the one exception is clearing
/// `tower_sessions` at the end, signing out every currently-logged-in
/// user, since a session established before this cutover shouldn't be
/// trusted against the new auth backend after it.
pub async fn handle_command() -> CommandOutput<serde_json::Value> {
    match migrate_to_haruspex().await {
        Ok(report) => {
            let clean = report.is_clean();
            let message = if clean {
                format!(
                    "migrated {} identity/identities, {} api key(s), {} credential(s), {} device(s), {} knock(s), {} invite(s), {} webauthn challenge(s) into haruspex, flushed {} existing session(s) (0 problems)",
                    report.identities.inserted,
                    report.api_keys.inserted,
                    report.credentials.inserted,
                    report.devices.inserted,
                    report.knocks.inserted,
                    report.invites.inserted,
                    report.challenges.inserted,
                    report.flushed_sessions,
                )
            } else {
                format!(
                    "migration ran but found problems: {} unresolved user reference(s), {} unexpected knock status value(s) - see data for details",
                    report.unresolved_user_refs.len(),
                    report.unexpected_knock_status.len(),
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
