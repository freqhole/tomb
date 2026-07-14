//! CUTOVER(0.2.0): one-shot `backfill-instance-grants` command. deleted,
//! along with acl_bridge's tier-1 field-check fast path, once every
//! deployment has run this and real instance-scope grants exist for every
//! user.

use crate::plumbing::utils::CommandOutput;
use grimoire::users::backfill_instance_grants;

/// backfill real haruspex `RoleGrant` rows on the instance resource from
/// grimoire's own `user_accountz.role` column.
///
/// safe to run repeatedly: writing a grant upserts on (subject, resource),
/// so a rerun just refreshes every user's grant to their current role.
pub async fn handle_command() -> CommandOutput<serde_json::Value> {
    match backfill_instance_grants().await {
        Ok(report) => {
            let message = format!(
                "backfilled {} instance-scope grant(s) from {} live grimoire user(s)",
                report.granted, report.examined,
            );
            let data = serde_json::to_value(&report).unwrap_or(serde_json::Value::Null);
            CommandOutput::success(message, data)
        }
        Err(e) => CommandOutput::failure(format!("backfill failed: {}", e), vec![], ()),
    }
}
