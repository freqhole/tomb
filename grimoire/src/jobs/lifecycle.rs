use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

use sqlx::SqlitePool;

use super::{Job, JobError};
use crate::error::GrimoireResult;

pub(super) fn try_runner_lock(database: &Path) -> std::io::Result<Option<File>> {
    let path = database.with_extension("job-runner.lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

pub(super) async fn recover_interrupted(pool: &SqlitePool) -> GrimoireResult<u64> {
    // called only while holding the database's exclusive runner lock.
    let result = sqlx::query!(
        "UPDATE jobz SET
           status = CASE WHEN EXISTS (SELECT 1 FROM job_sessionz s
                             WHERE s.id=jobz.session_id AND s.status='Cancelled')
                         THEN 'Cancelled'
                         WHEN job_type IN ('ProcessDirectory','ProcessFile')
                         AND retry_count + 1 < max_retries
                         AND NOT EXISTS (SELECT 1 FROM job_sessionz s
                             WHERE s.id=jobz.session_id AND s.status='Cancelled')
                         THEN 'Pending' ELSE 'Failed' END,
           retry_count = retry_count + 1,
           error_message = 'job interrupted when its previous runner stopped',
           result = '[{\"error_type\":\"job_interrupted\",\"title\":\"job interrupted\",\"detail\":\"the previous runner stopped before this job finished\"}]',
           scheduled_at = unixepoch(), started_at = NULL,
           completed_at = CASE WHEN job_type IN ('ProcessDirectory','ProcessFile')
                         AND retry_count + 1 < max_retries
                         AND NOT EXISTS (SELECT 1 FROM job_sessionz s
                             WHERE s.id=jobz.session_id AND s.status='Cancelled')
                         THEN NULL ELSE unixepoch() END
         WHERE status='Running'",
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub(super) async fn ensure_active(pool: &SqlitePool, job_id: &str) -> Result<(), JobError> {
    let cancelled = sqlx::query_scalar!(
        r#"SELECT (j.status='Cancelled' OR COALESCE(s.status='Cancelled',0)) AS "cancelled!: bool"
         FROM jobz j LEFT JOIN job_sessionz s ON s.id=j.session_id WHERE j.id=?"#,
        job_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| JobError::JobNotFound {
        id: job_id.to_owned(),
    })?;
    if cancelled {
        return Err(JobError::Cancelled);
    }
    Ok(())
}

pub(crate) async fn cancel_session(
    pool: &SqlitePool,
    session: &str,
) -> GrimoireResult<Vec<String>> {
    let mut transaction = pool.begin().await?;
    sqlx::query!(
        "UPDATE job_sessionz SET status='Cancelled',updated_at=unixepoch() WHERE id=? RETURNING id",
        session
    )
    .fetch_one(&mut *transaction)
    .await?;
    let jobs = sqlx::query_as!(
        Job,
        r#"UPDATE jobz SET
           status=CASE WHEN status='Pending' THEN 'Cancelled' ELSE status END,
           completed_at=CASE WHEN status='Pending' THEN unixepoch() ELSE completed_at END
         WHERE session_id=? AND status IN ('Pending','Running')
         RETURNING id AS "id!", session_id, job_type AS "job_type!", status AS "status!",
                   parameters AS "parameters!", result, retry_count AS "retry_count!: i32",
                   max_retries AS "max_retries!: i32", scheduled_at AS "scheduled_at!",
                   started_at, completed_at, error_message, created_by"#,
        session
    )
    .fetch_all(&mut *transaction)
    .await?;
    transaction.commit().await?;
    for job in &jobs {
        if job.status == "Cancelled" {
            emit_cancelled(job, super::job_events::JobStatusWire::Pending);
        }
    }
    Ok(jobs.into_iter().map(|job| job.id).collect())
}

pub(super) fn emit_cancelled(job: &Job, from: super::job_events::JobStatusWire) {
    match job.job_type() {
        Ok(topic) => super::job_events::emit(super::job_events::JobEvent::StatusChanged {
            session_id: job.session_id.clone().unwrap_or_default(),
            job_id: job.id.clone(),
            from: Some(from),
            to: super::job_events::JobStatusWire::Cancelled,
            topic,
            entity_ref: super::job_events::entity_ref_for_job(job),
            created_by: job.created_by.clone(),
        }),
        Err(error) => tracing::error!(job_id=%job.id, %error, "could not emit cancelled job event"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclusive_lock_is_released_when_owner_exits() {
        let path = std::env::temp_dir().join(format!("job-lock-{}.db", uuid::Uuid::new_v4()));
        let first = try_runner_lock(&path).unwrap().unwrap();
        assert!(try_runner_lock(&path).unwrap().is_none());
        drop(first);
        assert!(try_runner_lock(&path).unwrap().is_some());
        std::fs::remove_file(path.with_extension("job-runner.lock")).unwrap();
    }

    #[tokio::test]
    async fn recovery_retries_only_replayable_imports_with_a_bounded_budget() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        for (id, kind, status, retries) in [
            ("directory", "ProcessDirectory", "Running", 0),
            ("exhausted", "ProcessFile", "Running", 2),
            ("transcode", "TranscodeVideo", "Running", 0),
            ("movefiles", "ReorganizeLibraryFiles", "Running", 0),
            ("pending", "ProcessFile", "Pending", 0),
            ("cancelled", "ProcessDirectory", "Cancelled", 0),
        ] {
            sqlx::query!(
                "INSERT INTO jobz(id,job_type,status,retry_count) VALUES(?,?,?,?)",
                id,
                kind,
                status,
                retries
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        assert_eq!(recover_interrupted(&pool).await.unwrap(), 4);
        let states =
            sqlx::query!(r#"SELECT id AS "id!", status AS "status!" FROM jobz ORDER BY id"#)
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .map(|row| (row.id, row.status))
                .collect::<Vec<_>>();
        assert_eq!(
            states,
            [
                ("cancelled".into(), "Cancelled".into()),
                ("directory".into(), "Pending".into()),
                ("exhausted".into(), "Failed".into()),
                ("movefiles".into(), "Failed".into()),
                ("pending".into(), "Pending".into()),
                ("transcode".into(), "Failed".into()),
            ]
        );
        assert_eq!(recover_interrupted(&pool).await.unwrap(), 0);
        assert!(ensure_active(&pool, "cancelled").await.is_err());
        assert!(ensure_active(&pool, "directory").await.is_ok());
    }
}
