use super::{job_events, Job, JobError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ReferenceAuditParams {
    pub repair: bool,
}

pub(super) async fn process(job: &Job) -> Result<Option<Value>, JobError> {
    let params: ReferenceAuditParams = job.parameters()?;
    let pool = crate::database::connect().await?;
    let report =
        crate::storage_migration::audit_references_online(params.repair, |checked, total| {
            let pool = pool.clone();
            async move {
                let progress = json!({ "checked": checked, "total": total }).to_string();
                let updated = sqlx::query!(
                    "UPDATE jobz SET result = ? WHERE id = ? AND status = 'Running'",
                    progress,
                    job.id,
                )
                .execute(&pool)
                .await?;
                if updated.rows_affected() == 0 {
                    anyhow::bail!("reference audit cancelled");
                }
                job_events::emit_stage_from_job(
                    job,
                    "audit_blob_references",
                    Some(&format!("checked {checked} of {total} blob references")),
                );
                Ok(())
            }
        })
        .await
        .map_err(|error| JobError::ProcessingFailed {
            reason: format!("reference audit failed: {error:#}"),
        })?;
    finish_report(report)
}

fn finish_report(
    report: crate::storage_migration::ReferenceAudit,
) -> Result<Option<Value>, JobError> {
    let unresolved: Vec<_> = report
        .entries
        .iter()
        .filter_map(|entry| {
            entry
                .error
                .as_ref()
                .map(|error| format!("{}: {error}", entry.hash))
        })
        .collect();
    if !unresolved.is_empty() {
        return Err(JobError::ProcessingFailedFinal {
            reason: format!(
                "{} of {} references unresolved; no source files were deleted\n{}",
                unresolved.len(),
                report.entries.len(),
                unresolved.join("\n")
            ),
            error_type: "blob_references_unresolved".into(),
        });
    }
    Ok(Some(serde_json::to_value(report)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage_migration::{ReferenceAudit, ReferenceAuditEntry};

    #[test]
    fn unresolved_references_fail_the_job_with_actionable_details() {
        let report = ReferenceAudit {
            repair: true,
            entries: vec![ReferenceAuditEntry {
                hash: "expected-hash".into(),
                path: None,
                status: "unresolved",
                error: Some("/media/disk/song.flac: file missing".into()),
            }],
        };
        match finish_report(report) {
            Err(JobError::ProcessingFailedFinal { error_type, reason }) => {
                assert_eq!(error_type, "blob_references_unresolved");
                assert!(reason.contains("1 of 1 references unresolved"));
                assert!(reason.contains("/media/disk/song.flac"));
            }
            other => panic!("expected failed job, got {other:?}"),
        }
    }

    #[test]
    fn successful_job_retains_the_audit_report() {
        let report = ReferenceAudit {
            repair: false,
            entries: vec![ReferenceAuditEntry {
                hash: "expected-hash".into(),
                path: Some("/media/disk/song.flac".into()),
                status: "source_verified",
                error: None,
            }],
        };
        let output = finish_report(report).unwrap().unwrap();
        assert_eq!(output["repair"], false);
        assert_eq!(output["entries"][0]["status"], "source_verified");
    }

    #[test]
    fn job_parameters_require_explicit_repair_mode() {
        assert!(serde_json::from_value::<ReferenceAuditParams>(json!({})).is_err());
        assert!(
            !serde_json::from_value::<ReferenceAuditParams>(json!({ "repair": false }))
                .unwrap()
                .repair
        );
    }
}
