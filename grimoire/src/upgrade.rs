//! one-call orchestration of a config upgrade plus the one-shot data
//! migrations that must follow it.
//!
//! upgrading a config file can change database paths and other values the
//! migrations read, so ordering matters: the config file is upgraded on
//! disk first, the in-memory config is reloaded from the upgraded file,
//! and only then do the migrations run - guaranteeing they see the fresh
//! config rather than whatever was loaded before the upgrade. callers
//! (desktop app, embedded server, CLI) invoke `upgrade_config_and_migrate`
//! instead of hand-rolling that sequence.
//!
//! a config upgrade failure aborts everything (nothing else is safe to
//! run against a half-upgraded file). migration failures are non-fatal:
//! each one's success, failure, or skip is captured in the returned
//! outcome so callers can log or display it without the whole operation
//! erroring out.

// CUTOVER(0.2.0): the migrate-to-haruspex/migrate-to-reliquary hook here is deleted once the storage + auth seam cutovers finish and the one-shot migrations are no longer needed.

use std::path::Path;

use serde::Serialize;

use crate::config::{ConfigError, ConfigUpgradeResult};

/// the combined result of one `upgrade_config_and_migrate` run: the config
/// upgrade result plus the outcome of each follow-on migration.
#[derive(Debug, Clone, Serialize)]
pub struct UpgradeAndMigrateOutcome {
    pub config: ConfigUpgradeResult,
    pub haruspex: MigrationOutcome,
    pub reliquary: MigrationOutcome,
}

/// how one migration went: it ran (with a one-line summary and its full
/// report as json), it failed (with the error message), or it was skipped
/// entirely (with the reason).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MigrationOutcome {
    Ran {
        summary: String,
        report: serde_json::Value,
    },
    Failed {
        error: String,
    },
    Skipped {
        reason: String,
    },
}

impl MigrationOutcome {
    /// one-line rendering for logs and human-readable summaries.
    fn describe(&self) -> String {
        match self {
            MigrationOutcome::Ran { summary, .. } => summary.clone(),
            MigrationOutcome::Failed { error } => format!("failed: {}", error),
            MigrationOutcome::Skipped { reason } => format!("skipped: {}", reason),
        }
    }
}

/// one-line summary of a haruspex auth migration report.
fn summarize_haruspex_report(report: &crate::users::MigrationReport) -> String {
    let tables = [
        &report.identities,
        &report.api_keys,
        &report.credentials,
        &report.devices,
        &report.knocks,
        &report.invites,
        &report.challenges,
    ];
    let examined: i64 = tables.iter().map(|t| t.examined).sum();
    let inserted: i64 = tables.iter().map(|t| t.inserted).sum();
    let already_existed: i64 = tables.iter().map(|t| t.already_existed).sum();
    let skipped: i64 = tables.iter().map(|t| t.skipped).sum();

    let mut summary = format!(
        "migrated {} of {} auth row(s) into haruspex ({} already existed, {} skipped, {} session(s) flushed)",
        inserted, examined, already_existed, skipped, report.flushed_sessions
    );
    if !report.is_clean() {
        summary.push_str(&format!(
            ", problems: {} unresolved user ref(s), {} unexpected knock status value(s)",
            report.unresolved_user_refs.len(),
            report.unexpected_knock_status.len()
        ));
    }
    summary
}

/// one-line summary of a reliquary blob migration report.
fn summarize_reliquary_report(report: &crate::blobz::MigrationReport) -> String {
    let mut summary = format!(
        "migrated {} of {} live blob(s) into reliquary ({} already migrated)",
        report.inserted, report.total_live_blobs, report.already_migrated
    );
    if !report.is_clean() {
        summary.push_str(&format!(
            ", problems: {} unresolved parent(s), {} blob(s) with no content, {} unmigrated blob_data row(s)",
            report.unresolved_parents.len(),
            report.missing_content.len(),
            report.unmigrated_blob_data
        ));
    }
    summary
}

/// wrap a migration report into a `Ran` outcome with its summary and
/// serialized report.
fn ran_outcome<R: Serialize>(report: &R, summary: String) -> MigrationOutcome {
    MigrationOutcome::Ran {
        summary,
        report: serde_json::to_value(report).unwrap_or(serde_json::Value::Null),
    }
}

/// upgrade the config file at `config_path`, reload the in-memory config
/// from it, then run the one-shot data migrations.
///
/// the config upgrade is the only fatal step: if it errors, nothing else
/// runs and the error propagates. the in-memory reload must succeed before
/// any migration runs (migrations read database paths from the loaded
/// config); if the reload fails, both migrations are skipped and the
/// reload error is recorded as the skip reason. each migration's own
/// failure is captured in the outcome, never propagated - a migration
/// error does not undo or taint the config upgrade.
pub async fn upgrade_config_and_migrate(
    config_path: &Path,
) -> Result<UpgradeAndMigrateOutcome, ConfigError> {
    let config = crate::config::upgrade_config(config_path)?;

    // reload the in-memory config from the freshly upgraded file so the
    // migrations below read current values, not whatever was loaded before
    // the upgrade rewrote the file.
    if let Err(e) = crate::config::init_config(Some(config_path.to_path_buf())) {
        let reason = format!("config reload after upgrade failed: {}", e);
        return Ok(UpgradeAndMigrateOutcome {
            config,
            haruspex: MigrationOutcome::Skipped {
                reason: reason.clone(),
            },
            reliquary: MigrationOutcome::Skipped { reason },
        });
    }

    let haruspex = match crate::users::migrate_to_haruspex().await {
        Ok(report) => {
            let summary = summarize_haruspex_report(&report);
            ran_outcome(&report, summary)
        }
        Err(e) => MigrationOutcome::Failed {
            error: e.to_string(),
        },
    };

    let reliquary = match crate::blobz::migrate_to_reliquary().await {
        Ok(report) => {
            let summary = summarize_reliquary_report(&report);
            ran_outcome(&report, summary)
        }
        Err(e) => MigrationOutcome::Failed {
            error: e.to_string(),
        },
    };

    Ok(UpgradeAndMigrateOutcome {
        config,
        haruspex,
        reliquary,
    })
}

/// short multi-line human summary of an upgrade-and-migrate outcome, ready
/// to log or display verbatim.
pub fn describe_outcome(outcome: &UpgradeAndMigrateOutcome) -> String {
    format!(
        "config upgraded: {} -> {} (backup: {})\nharuspex migration: {}\nreliquary migration: {}",
        outcome.config.old_version,
        outcome.config.new_version,
        outcome.config.backup_path.display(),
        outcome.haruspex.describe(),
        outcome.reliquary.describe()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_migration_outcome_serializes_with_status_tags() {
        let ran = MigrationOutcome::Ran {
            summary: "ok".to_string(),
            report: serde_json::json!({ "inserted": 1 }),
        };
        let v = serde_json::to_value(&ran).expect("serialize ran");
        assert_eq!(v["status"], "ran");
        assert_eq!(v["summary"], "ok");
        assert_eq!(v["report"]["inserted"], 1);

        let failed = MigrationOutcome::Failed {
            error: "boom".to_string(),
        };
        let v = serde_json::to_value(&failed).expect("serialize failed");
        assert_eq!(v["status"], "failed");
        assert_eq!(v["error"], "boom");

        let skipped = MigrationOutcome::Skipped {
            reason: "no config".to_string(),
        };
        let v = serde_json::to_value(&skipped).expect("serialize skipped");
        assert_eq!(v["status"], "skipped");
        assert_eq!(v["reason"], "no config");
    }

    #[test]
    fn test_describe_outcome_covers_all_lines() {
        let outcome = UpgradeAndMigrateOutcome {
            config: ConfigUpgradeResult {
                backup_path: PathBuf::from("/tmp/freqhole-config.toml.bak.x"),
                old_version: "0.1.0".to_string(),
                new_version: "0.2.0".to_string(),
            },
            haruspex: MigrationOutcome::Skipped {
                reason: "reload failed".to_string(),
            },
            reliquary: MigrationOutcome::Failed {
                error: "gate error".to_string(),
            },
        };
        let text = describe_outcome(&outcome);
        assert!(text.contains("0.1.0 -> 0.2.0"));
        assert!(text.contains("/tmp/freqhole-config.toml.bak.x"));
        assert!(text.contains("haruspex migration: skipped: reload failed"));
        assert!(text.contains("reliquary migration: failed: gate error"));
    }

    #[tokio::test]
    async fn test_nonexistent_config_path_returns_err() {
        let result =
            upgrade_config_and_migrate(Path::new("/nonexistent/dir/freqhole-config.toml")).await;
        assert!(result.is_err(), "step 1 failure must propagate as Err");
    }
}
