use super::{job_events, Job, JobError};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Params {
    dry_run: bool,
    scan_directory: Option<String>,
}

pub(super) async fn process(job: &Job) -> Result<Option<Value>, JobError> {
    let pool = crate::database::connect().await?;
    process_with_pool(job, &pool).await
}

async fn process_with_pool(job: &Job, pool: &sqlx::SqlitePool) -> Result<Option<Value>, JobError> {
    let params: Params = job.parameters()?;
    let pattern = crate::maintenance::repair_library_images::scan_directory_pattern(
        params.scan_directory.as_deref(),
    );
    let video_ids = sqlx::query_scalar!(
        r#"SELECT v.id AS "id!" FROM videoz v JOIN media_blobz mb ON mb.id=v.media_blob_id
         WHERE v.deleted_at IS NULL AND v.poster_blob_id IS NOT NULL
         AND mb.local_path IS NOT NULL AND (?1 IS NULL OR mb.local_path LIKE ?1 ESCAPE '\')
         ORDER BY v.id"#,
        pattern
    )
    .fetch_all(pool)
    .await?;
    let total = video_ids.len();
    let mut totals = crate::maintenance::RepairLibraryImagesResult::default();
    for checked in 0..=total {
        let progress = json!({
            "checked": checked, "total": total, "dry_run": params.dry_run,
            "videos_posters_regenerated": totals.videos_posters_regenerated,
            "errors": totals.errors,
        });
        let progress_json = progress.to_string();
        let updated = sqlx::query!(
            "UPDATE jobz SET result=? WHERE id=? AND status='Running'
             AND NOT EXISTS (SELECT 1 FROM job_sessionz WHERE id=jobz.session_id AND status='Cancelled')",
            progress_json, job.id
        )
        .execute(pool)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(JobError::Cancelled);
        }

        job_events::emit_stage_from_job_with_details(
            job,
            if checked == total {
                "regenerate_video_posters_complete"
            } else {
                "regenerate_video_posters"
            },
            Some(&format!("processed {checked} of {total} video posters")),
            Some(progress.clone()),
        );
        if checked == total {
            if !totals.errors.is_empty() {
                return Err(JobError::ProcessingFailedFinal {
                    reason: totals
                        .errors
                        .iter()
                        .map(|e| e.detail.clone())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    error_type: "video_poster_regeneration_failed".into(),
                });
            }
            return Ok(Some(progress));
        }
        let response = crate::maintenance::regenerate_video_poster(
            &video_ids[checked],
            params.dry_run,
            job.created_by.clone().map(|id| (id, String::new())),
        )
        .await;
        if !response.success {
            return Err(JobError::ProcessingFailedFinal {
                reason: format!(
                    "{}: {}",
                    response.message,
                    response
                        .errors
                        .iter()
                        .map(|e| e.detail.clone())
                        .collect::<Vec<_>>()
                        .join("; ")
                ),
                error_type: "video_poster_regeneration_failed".into(),
            });
        }
        let outcome = response
            .data
            .ok_or_else(|| JobError::ProcessingFailedFinal {
                reason: "video poster regeneration returned no batch result".into(),
                error_type: "missing_batch_result".into(),
            })?;
        totals.merge(outcome.result);
    }
    unreachable!("the final progress iteration returns");
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture(status: &str, session_status: &str) -> (sqlx::SqlitePool, Job) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        sqlx::query!("INSERT INTO job_sessionz(id,job_type,status,progress) VALUES ('posters','RegenerateVideoPosters',?,'{}')",
            session_status).execute(&pool).await.unwrap();
        sqlx::query!("INSERT INTO jobz(id,session_id,job_type,status,parameters) VALUES ('poster-job','posters','RegenerateVideoPosters',?,?)",
            status,r#"{"dry_run":false}"#).execute(&pool).await.unwrap();
        let job = sqlx::query_as!(Job,
            r#"SELECT id AS "id!",session_id,job_type AS "job_type!",status AS "status!",parameters AS "parameters!",result,
            retry_count AS "retry_count!: i32",max_retries AS "max_retries!: i32",
            scheduled_at AS "scheduled_at!",started_at,completed_at,error_message,created_by FROM jobz WHERE id='poster-job'"#)
            .fetch_one(&pool).await.unwrap();
        (pool, job)
    }

    #[tokio::test]
    async fn empty_library_completes_with_persisted_zero_progress() {
        let (pool, job) = fixture("Running", "Active").await;
        let progress = process_with_pool(&job, &pool).await.unwrap().unwrap();
        assert_eq!(progress["checked"], 0);
        assert_eq!(progress["total"], 0);
        assert_eq!(progress["videos_posters_regenerated"], 0);
        let stored = sqlx::query_scalar!("SELECT result FROM jobz WHERE id=?", job.id)
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), progress);
        assert_eq!(
            job_events::current_stage(&job.id).0.as_deref(),
            Some("regenerate_video_posters_complete")
        );
    }

    #[tokio::test]
    async fn cancelled_job_or_session_cannot_update_progress_or_resume() {
        for (status, session_status) in [("Cancelled", "Active"), ("Running", "Cancelled")] {
            let (pool, job) = fixture(status, session_status).await;
            assert!(matches!(
                process_with_pool(&job, &pool).await,
                Err(JobError::Cancelled)
            ));
            let result = sqlx::query_scalar!("SELECT result FROM jobz WHERE id=?", job.id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(result.is_none());
        }
    }
}
