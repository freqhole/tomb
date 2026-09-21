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
    pub radio_encode_args: MigrationOutcome,
}

/// how one migration went: it ran (with a one-line summary, its full
/// report as json, and whether it actually changed anything - these
/// migrations re-scan and re-check every row on every run, so a clean
/// rerun where everything already existed is the common case, not an
/// error), it failed (with the error message), or it was skipped
/// entirely (with the reason).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MigrationOutcome {
    Ran {
        summary: String,
        report: serde_json::Value,
        /// true when this run actually inserted/cleared/flushed something,
        /// or surfaced a problem worth a human's attention - false for the
        /// common "re-verified everything already migrated cleanly" case.
        changed: bool,
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

    /// true when this outcome is worth surfacing to a human - a failure,
    /// or a run that actually changed/flagged something. false for a
    /// no-op rerun or a skip, which `describe_outcome` omits entirely.
    fn is_noteworthy(&self) -> bool {
        match self {
            MigrationOutcome::Ran { changed, .. } => *changed,
            MigrationOutcome::Failed { .. } => true,
            MigrationOutcome::Skipped { .. } => false,
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

/// wrap a migration report into a `Ran` outcome with its summary,
/// serialized report, and whether it actually changed anything.
fn ran_outcome<R: Serialize>(report: &R, summary: String, changed: bool) -> MigrationOutcome {
    MigrationOutcome::Ran {
        summary,
        report: serde_json::to_value(report).unwrap_or(serde_json::Value::Null),
        changed,
    }
}

/// one-line summary of the stale radio `encode_args` migration report.
fn summarize_radio_encode_args_report(
    report: &crate::radio::stations::StaleEncodeArgsMigrationReport,
) -> String {
    format!(
        "examined {} station(s) with a per-station encode_args override, cleared {} known-stale one(s) back to inherit: {:?}",
        report.examined,
        report.cleared_station_ids.len(),
        report.cleared_station_ids
    )
}

/// last version whose grimoire db could still have rows that never made
/// it into haruspex/reliquary - anyone upgrading from newer than this has
/// already been through a run that migrated everything there was to
/// migrate (both are safe to rerun regardless - see their own doc
/// comments - but a full-table rescan is real cost on a large library, so
/// skip it once it can't possibly find anything new). same
/// self-terminating gate shape as `LAST_VERSION_WITH_STALE_RADIO_DEFAULTS_RISK`.
const LAST_VERSION_NEEDING_HARUSPEX_RELIQUARY_MIGRATION: &str = "0.3.1";

/// last version whose shipped `[radio]` encode_args/video_encode_args/
/// video_codec defaults could end up frozen as a literal override -
/// either in the toml (fixed structurally: the template no longer
/// declares these keys, so `upgrade_config`'s merge already drops them
/// for every upgrade going forward) or per-station in the db (not
/// touched by the config merge at all, so it needs this explicit,
/// version-gated one-shot pass). anyone upgrading FROM this version or
/// older gets the one-shot db clear exactly once - their `[server]
/// .version` is bumped to the current binary version as part of this
/// same upgrade, so the gate naturally never re-fires for them again,
/// no matter how many further releases ship.
const LAST_VERSION_WITH_STALE_RADIO_DEFAULTS_RISK: &str = "0.3.6";

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
            reliquary: MigrationOutcome::Skipped {
                reason: reason.clone(),
            },
            radio_encode_args: MigrationOutcome::Skipped { reason },
        });
    }

    let needs_haruspex_reliquary_pass = !crate::updates::is_newer(
        &config.old_version,
        LAST_VERSION_NEEDING_HARUSPEX_RELIQUARY_MIGRATION,
    );
    let skip_reason = || MigrationOutcome::Skipped {
        reason: format!(
            "old config version {} is newer than {} - already fully migrated by an earlier upgrade",
            config.old_version, LAST_VERSION_NEEDING_HARUSPEX_RELIQUARY_MIGRATION
        ),
    };

    let haruspex = if !needs_haruspex_reliquary_pass {
        skip_reason()
    } else {
        match crate::users::migrate_to_haruspex().await {
            Ok(report) => {
                let summary = summarize_haruspex_report(&report);
                let tables = [
                    report.identities.inserted,
                    report.api_keys.inserted,
                    report.credentials.inserted,
                    report.devices.inserted,
                    report.knocks.inserted,
                    report.invites.inserted,
                    report.challenges.inserted,
                ];
                let changed = tables.iter().sum::<i64>() > 0
                    || report.flushed_sessions > 0
                    || !report.is_clean();
                ran_outcome(&report, summary, changed)
            }
            Err(e) => MigrationOutcome::Failed {
                error: e.to_string(),
            },
        }
    };

    let reliquary = if !needs_haruspex_reliquary_pass {
        skip_reason()
    } else {
        match crate::blobz::migrate_to_reliquary().await {
            Ok(report) => {
                let summary = summarize_reliquary_report(&report);
                let changed = report.inserted > 0 || !report.is_clean();
                ran_outcome(&report, summary, changed)
            }
            Err(e) => MigrationOutcome::Failed {
                error: e.to_string(),
            },
        }
    };

    let radio_encode_args = if !crate::updates::is_newer(
        &config.old_version,
        LAST_VERSION_WITH_STALE_RADIO_DEFAULTS_RISK,
    ) {
        match crate::radio::stations::clear_stale_default_encode_args().await {
            Ok(report) => {
                let summary = summarize_radio_encode_args_report(&report);
                let changed = !report.cleared_station_ids.is_empty();
                ran_outcome(&report, summary, changed)
            }
            Err(e) => MigrationOutcome::Failed {
                error: e.to_string(),
            },
        }
    } else {
        MigrationOutcome::Skipped {
            reason: format!(
                "old config version {} is newer than {} - stale radio defaults can't be present",
                config.old_version, LAST_VERSION_WITH_STALE_RADIO_DEFAULTS_RISK
            ),
        }
    };

    Ok(UpgradeAndMigrateOutcome {
        config,
        haruspex,
        reliquary,
        radio_encode_args,
    })
}

/// short multi-line human summary of an upgrade-and-migrate outcome, ready
/// to log or display verbatim. only lines for a failed migration or one
/// that actually changed/flagged something are included - a clean no-op
/// rerun (the common case; see `MigrationOutcome::is_noteworthy`) is left
/// out entirely rather than padding the summary with "nothing happened".
pub fn describe_outcome(outcome: &UpgradeAndMigrateOutcome) -> String {
    let mut lines = vec![format!(
        "config upgraded: {} -> {} (backup: {})",
        outcome.config.old_version,
        outcome.config.new_version,
        outcome.config.backup_path.display()
    )];
    for (name, migration) in [
        ("haruspex", &outcome.haruspex),
        ("reliquary", &outcome.reliquary),
        ("radio encode_args", &outcome.radio_encode_args),
    ] {
        if migration.is_noteworthy() {
            lines.push(format!("{} migration: {}", name, migration.describe()));
        }
    }
    lines.join("\n")
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
            changed: true,
        };
        let v = serde_json::to_value(&ran).expect("serialize ran");
        assert_eq!(v["status"], "ran");
        assert_eq!(v["summary"], "ok");
        assert_eq!(v["report"]["inserted"], 1);
        assert_eq!(v["changed"], true);

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
    fn test_describe_outcome_omits_skips_and_no_op_runs() {
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
            radio_encode_args: MigrationOutcome::Ran {
                summary: "examined 3 station(s), cleared 0".to_string(),
                report: serde_json::json!({}),
                changed: false,
            },
        };
        let text = describe_outcome(&outcome);
        assert!(text.contains("0.1.0 -> 0.2.0"));
        assert!(text.contains("/tmp/freqhole-config.toml.bak.x"));
        // a skip is never noteworthy - omitted entirely.
        assert!(!text.contains("haruspex"));
        // a failure is always noteworthy, regardless of the gate above.
        assert!(text.contains("reliquary migration: failed: gate error"));
        // a clean no-op run is not noteworthy - omitted entirely.
        assert!(!text.contains("radio encode_args"));
    }

    #[test]
    fn test_describe_outcome_includes_a_changed_run() {
        let outcome = UpgradeAndMigrateOutcome {
            config: ConfigUpgradeResult {
                backup_path: PathBuf::from("/tmp/freqhole-config.toml.bak.x"),
                old_version: "0.3.6".to_string(),
                new_version: "0.3.7".to_string(),
            },
            haruspex: MigrationOutcome::Ran {
                summary: "nothing new".to_string(),
                report: serde_json::json!({}),
                changed: false,
            },
            reliquary: MigrationOutcome::Ran {
                summary: "nothing new".to_string(),
                report: serde_json::json!({}),
                changed: false,
            },
            radio_encode_args: MigrationOutcome::Ran {
                summary: "cleared 1 stale station override".to_string(),
                report: serde_json::json!({}),
                changed: true,
            },
        };
        let text = describe_outcome(&outcome);
        assert!(!text.contains("haruspex"));
        assert!(!text.contains("reliquary"));
        assert!(text.contains("radio encode_args migration: cleared 1 stale station override"));
    }

    #[tokio::test]
    async fn test_nonexistent_config_path_returns_err() {
        let result =
            upgrade_config_and_migrate(Path::new("/nonexistent/dir/freqhole-config.toml")).await;
        assert!(result.is_err(), "step 1 failure must propagate as Err");
    }
}
