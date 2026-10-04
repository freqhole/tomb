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
    pub blake3_backfill: MigrationOutcome,
    pub contentless_blob_cleanup: MigrationOutcome,
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

/// report shape for the blake3 backfill migration step - deliberately
/// simpler than haruspex/reliquary's own report types since there's only
/// two numbers worth keeping: how many blobs got hashed this run, and how
/// many (if any) are left (only possible if a round made zero progress -
/// e.g. every remaining blob fails to hash - see
/// `run_blake3_backfill_rounds`'s own doc comment; there's no round-count
/// cap, this keeps going until the backlog is actually cleared).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Blake3BackfillReport {
    pub processed: i64,
    pub remaining: i64,
}

fn summarize_blake3_backfill_report(report: &Blake3BackfillReport) -> String {
    if report.remaining > 0 {
        format!(
            "hashed {} blob(s), {} stuck (couldn't be hashed - run `blobz backfill-blake3` after investigating, e.g. missing files on disk)",
            report.processed, report.remaining
        )
    } else {
        format!("hashed {} blob(s), all caught up", report.processed)
    }
}

/// one-line summary of the contentless-blob cleanup report.
fn summarize_contentless_cleanup_report(
    report: &crate::blob_data::ContentlessBlobSummary,
) -> String {
    if report.blobs_found == 0 {
        "no contentless blobs found".to_string()
    } else {
        format!(
            "deleted {} of {} contentless blob(s) (no local_path, no blob_data, unhashable)",
            report.blobs_deleted, report.blobs_found
        )
    }
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

/// last version shipped before media import stopped computing sha256 at
/// all - anyone upgrading FROM this version or older may have existing
/// `media_blobz` rows with no
/// blake3 yet (it was previously only computed best-effort/non-fatally on
/// a few paths). gets a one-shot automatic backfill - same self-
/// terminating gate shape as the other two constants above.
const LAST_VERSION_NEEDING_BLAKE3_BACKFILL: &str = "0.3.12";

/// per-round batch size / concurrency for the automatic backfill - same
/// defaults already established by the manual admin/CLI backfill command
/// (`admin_dispatch::handlers::blobz::backfill_blake3`,
/// `cli blobz backfill-blake3`), not new numbers invented for this path.
/// no cap on the number of rounds - this runs until the backlog is
/// genuinely cleared (or a round makes zero progress, see
/// `run_blake3_backfill_rounds`), not until some arbitrary round count.
const BLAKE3_BACKFILL_BATCH_SIZE: i64 = 100;
const BLAKE3_BACKFILL_CONCURRENCY: usize = 16;

/// pure looping/termination logic for the blake3 backfill migration,
/// extracted specifically so it's unit-testable without a real database -
/// `round` does one batch's worth of real work (or a test double returning
/// canned results). no round-count cap - keeps going until a round
/// reports nothing remaining, or a round makes zero progress (the backlog
/// is genuinely stuck, e.g. every remaining blob fails to hash - looping
/// forever against that would never finish, so zero-progress is where
/// this stops, not an arbitrary count). a round error aborts immediately
/// and is reported as the whole migration's failure, same as every other
/// migration in this file.
async fn run_blake3_backfill_rounds<F, Fut>(mut round: F) -> Result<Blake3BackfillReport, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = crate::error::GrimoireResult<(i64, i64)>>,
{
    let mut total_processed: i64 = 0;
    let mut round_num: u32 = 0;
    let remaining: i64;
    loop {
        round_num += 1;
        let (processed, left) = round().await.map_err(|e| e.to_string())?;
        total_processed += processed;
        crate::progress::report(format!(
            "blake3 backfill round {round_num}: hashed {processed} (total {total_processed}), {left} remaining"
        ));
        if processed == 0 || left == 0 {
            remaining = left;
            break;
        }
    }
    Ok(Blake3BackfillReport {
        processed: total_processed,
        remaining,
    })
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
    crate::progress::report(format!(
        "config upgraded: {} -> {}",
        config.old_version, config.new_version
    ));

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
            radio_encode_args: MigrationOutcome::Skipped {
                reason: reason.clone(),
            },
            blake3_backfill: MigrationOutcome::Skipped {
                reason: reason.clone(),
            },
            contentless_blob_cleanup: MigrationOutcome::Skipped { reason },
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
        crate::progress::report("running haruspex auth migration...".to_string());
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
        crate::progress::report("running reliquary blob migration...".to_string());
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
        crate::progress::report("checking for stale radio encode_args defaults...".to_string());
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

    let blake3_backfill = if !crate::updates::is_newer(
        &config.old_version,
        LAST_VERSION_NEEDING_BLAKE3_BACKFILL,
    ) {
        crate::progress::report("starting blake3 backfill...".to_string());
        match run_blake3_backfill_rounds(|| {
            crate::blobz::backfill_blake3_hashes(
                BLAKE3_BACKFILL_BATCH_SIZE,
                BLAKE3_BACKFILL_CONCURRENCY,
            )
        })
        .await
        {
            Ok(report) => {
                let summary = summarize_blake3_backfill_report(&report);
                let changed = report.processed > 0;
                ran_outcome(&report, summary, changed)
            }
            Err(error) => MigrationOutcome::Failed { error },
        }
    } else {
        MigrationOutcome::Skipped {
            reason: format!(
                "old config version {} is newer than {} - blake3 was already being computed for every new import",
                config.old_version, LAST_VERSION_NEEDING_BLAKE3_BACKFILL
            ),
        }
    };

    // same gate as blake3_backfill above: runs right after it regardless of
    // how much of the backlog that backfill cleared, since rows that are
    // still stuck afterward (no local_path, no blob_data row) can never be
    // hashed no matter how many more backfill rounds run - see
    // `find_contentless_media_blobs`'s doc comment.
    let contentless_blob_cleanup = if !crate::updates::is_newer(
        &config.old_version,
        LAST_VERSION_NEEDING_BLAKE3_BACKFILL,
    ) {
        crate::progress::report("cleaning up contentless blobs...".to_string());
        let response = crate::blob_data::cleanup_contentless_media_blobs(false).await;
        if response.success {
            let summary = response.data.unwrap_or_default();
            let changed = summary.blobs_deleted > 0;
            let text = summarize_contentless_cleanup_report(&summary);
            ran_outcome(&summary, text, changed)
        } else {
            MigrationOutcome::Failed {
                error: response.message,
            }
        }
    } else {
        MigrationOutcome::Skipped {
            reason: format!(
                "old config version {} is newer than {} - every blob since has been hashed at creation time, so a contentless+unhashable row can't exist",
                config.old_version, LAST_VERSION_NEEDING_BLAKE3_BACKFILL
            ),
        }
    };

    Ok(UpgradeAndMigrateOutcome {
        config,
        haruspex,
        reliquary,
        radio_encode_args,
        blake3_backfill,
        contentless_blob_cleanup,
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
        ("blake3 backfill", &outcome.blake3_backfill),
        (
            "contentless blob cleanup",
            &outcome.contentless_blob_cleanup,
        ),
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
    use std::cell::RefCell;
    use std::path::PathBuf;

    #[tokio::test]
    async fn test_blake3_backfill_rounds_stops_immediately_when_nothing_needed() {
        let calls = RefCell::new(0);
        let report = run_blake3_backfill_rounds(|| {
            *calls.borrow_mut() += 1;
            async { Ok((0, 0)) }
        })
        .await
        .expect("rounds succeed");
        assert_eq!(report.processed, 0);
        assert_eq!(report.remaining, 0);
        assert_eq!(
            *calls.borrow(),
            1,
            "a round reporting 0/0 must not be retried"
        );
    }

    #[tokio::test]
    async fn test_blake3_backfill_rounds_finishes_clean_after_a_few_rounds() {
        // simulates 250 blobs needing backfill, 100 per round (3 rounds:
        // 100, 100, 50).
        let remaining_after = RefCell::new(vec![150i64, 50, 0]);
        let calls = RefCell::new(0);
        let report = run_blake3_backfill_rounds(|| {
            *calls.borrow_mut() += 1;
            let left = remaining_after.borrow_mut().remove(0);
            let processed = if left == 150 {
                100
            } else if left == 50 {
                100
            } else {
                50
            };
            async move { Ok((processed, left)) }
        })
        .await
        .expect("rounds succeed");
        assert_eq!(report.processed, 250);
        assert_eq!(report.remaining, 0);
        assert_eq!(
            *calls.borrow(),
            3,
            "must stop the round after remaining hits 0"
        );
    }

    #[tokio::test]
    async fn test_blake3_backfill_rounds_has_no_round_cap_on_a_huge_backlog() {
        // 5000 blobs, 100 per round = 50 rounds to finish - well past what
        // used to be a 50-round safety cap. there's no cap anymore: this
        // must keep going until remaining actually hits 0, not give up
        // partway through a large-but-finite backlog.
        let calls = RefCell::new(0);
        let report = run_blake3_backfill_rounds(|| {
            let mut c = calls.borrow_mut();
            *c += 1;
            let done_so_far = *c * 100;
            let left = (5_000 - done_so_far).max(0);
            async move { Ok((100, left)) }
        })
        .await
        .expect("rounds succeed");
        assert_eq!(report.processed, 5_000);
        assert_eq!(report.remaining, 0);
        assert_eq!(
            *calls.borrow(),
            50,
            "must run as many rounds as it takes, no artificial cap"
        );
    }

    #[tokio::test]
    async fn test_blake3_backfill_rounds_stops_when_a_round_makes_zero_progress() {
        // every remaining blob fails to hash (e.g. missing files on disk) -
        // further rounds would never make progress, so this must stop
        // after the first zero-progress round rather than spin forever,
        // and must still report the true remaining count.
        let calls = RefCell::new(0);
        let report = run_blake3_backfill_rounds(|| {
            *calls.borrow_mut() += 1;
            async { Ok((0, 10_000)) }
        })
        .await
        .expect("rounds succeed");
        assert_eq!(report.processed, 0);
        assert_eq!(report.remaining, 10_000);
        assert_eq!(
            *calls.borrow(),
            1,
            "a zero-progress round must stop the loop, not spin forever"
        );
    }

    #[tokio::test]
    async fn test_blake3_backfill_rounds_aborts_immediately_on_error() {
        let calls = RefCell::new(0);
        let result = run_blake3_backfill_rounds(|| {
            *calls.borrow_mut() += 1;
            async {
                Err(crate::error::GrimoireError::ProcessingFailed {
                    message: "db gone".to_string(),
                })
            }
        })
        .await;
        assert_eq!(result, Err("processing failed: db gone".to_string()));
        assert_eq!(*calls.borrow(), 1, "a failed round must not be retried");
    }

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
            blake3_backfill: MigrationOutcome::Skipped {
                reason: "not under test".to_string(),
            },
            contentless_blob_cleanup: MigrationOutcome::Skipped {
                reason: "not under test".to_string(),
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
            blake3_backfill: MigrationOutcome::Skipped {
                reason: "not under test".to_string(),
            },
            contentless_blob_cleanup: MigrationOutcome::Skipped {
                reason: "not under test".to_string(),
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
