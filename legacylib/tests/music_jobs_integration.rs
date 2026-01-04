//! Integration tests for the music job system
//!
//! These tests verify that the music job database tables and functions
//! are working correctly with real database operations.

use legacylib::music::jobs::*;
use legacylib::test_helpers::*;
use serde_json::json;
use sqlx::PgPool;
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

#[sqlx::test]
async fn test_music_scan_session_crud(pool: PgPool) {
    // Create a test scan session
    let session_id = Uuid::new_v4();
    let base_path = "/test/music/library";
    let user_id = create_test_user(&pool, "test@example.com", "testuser").await;

    // Insert scan session
    let session = sqlx::query_as!(
        MusicScanSession,
        r#"
        INSERT INTO music_scan_sessions (
            id, base_path, session_name, status, total_files,
            initiated_by_user_id, configuration
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
            id, base_path, session_name,
            status as "status: _",
            total_files, processed_files, last_processed_path,
            songs_added, songs_updated, songs_skipped, errors_encountered,
            started_at, completed_at, estimated_completion, error_message,
            client_id, initiated_by_user_id, configuration,
            created_at, updated_at
        "#,
        session_id,
        base_path,
        Some("Test Music Scan"),
        ScanSessionStatus::Running.as_str(),
        Some(100i32),
        user_id,
        json!({"scan_depth": 3, "file_types": ["mp3", "flac"]})
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to create scan session");

    assert_eq!(session.id, session_id);
    assert_eq!(session.base_path, base_path);
    assert_eq!(session.status, ScanSessionStatus::Running);
    assert_eq!(session.total_files, Some(100));
    assert_eq!(session.processed_files, 0);

    // Update session progress
    let updated = sqlx::query!(
        "SELECT update_scan_session_progress($1, $2, $3, $4, $5, $6, $7) as success",
        session_id,
        25i32,
        Some("/test/music/library/album1/song1.mp3"),
        20i32, // songs_added_delta
        3i32,  // songs_updated_delta
        2i32,  // songs_skipped_delta
        0i32   // errors_delta
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to update session progress");

    assert!(updated.success.unwrap_or(false));

    // Verify progress was updated
    let updated_session = sqlx::query_as!(
        MusicScanSession,
        r#"
        SELECT
            id, base_path, session_name,
            status as "status: _",
            total_files, processed_files, last_processed_path,
            songs_added, songs_updated, songs_skipped, errors_encountered,
            started_at, completed_at, estimated_completion, error_message,
            client_id, initiated_by_user_id, configuration,
            created_at, updated_at
        FROM music_scan_sessions
        WHERE id = $1
        "#,
        session_id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch updated session");

    assert_eq!(updated_session.processed_files, 25);
    assert_eq!(updated_session.songs_added, 20);
    assert_eq!(updated_session.songs_updated, 3);
    assert_eq!(updated_session.songs_skipped, 2);
    assert_eq!(
        updated_session.last_processed_path,
        Some("/test/music/library/album1/song1.mp3".to_string())
    );

    // Complete the session
    let completed = sqlx::query!(
        "SELECT complete_scan_session($1, $2, $3) as success",
        session_id,
        "completed",
        None::<String>
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to complete session");

    assert!(completed.success.unwrap_or(false));

    // Verify session is completed
    let final_session = sqlx::query!(
        r#"SELECT status as "status: String" FROM music_scan_sessions WHERE id = $1"#,
        session_id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch completed session");

    assert_eq!(final_session.status, "completed");
}

#[sqlx::test]
async fn test_music_jobs_crud(pool: PgPool) {
    // Create a test scan session first
    let session_id = Uuid::new_v4();
    let user_id = create_test_user(&pool, "jobtest@example.com", "jobuser").await;

    sqlx::query!(
        "INSERT INTO music_scan_sessions (id, base_path, initiated_by_user_id) VALUES ($1, $2, $3)",
        session_id,
        "/test/jobs",
        user_id
    )
    .execute(&pool)
    .await
    .expect("Failed to create test scan session");

    // Create test media blob
    let blob_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO media_blobs (id, file_name, content_type, file_size, content_hash, data)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        blob_id,
        "test.mp3",
        "audio/mpeg",
        1024i32,
        "test_hash",
        &b"test_audio_data"[..]
    )
    .execute(&pool)
    .await
    .expect("Failed to create test media blob");

    // Create a music job
    let job_id = Uuid::new_v4();
    let file_path = "/test/jobs/song.mp3";

    let job = sqlx::query_as!(
        MusicJob,
        r#"
        INSERT INTO music_jobs (
            id, job_type, scan_session_id, file_path, media_blob_id,
            status, priority, parameters, max_retries
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
            id,
            job_type as "job_type: _",
            scan_session_id, file_path, media_blob_id, song_id,
            status as "status: _",
            priority as "priority: _",
            worker_id, parameters, result,
            scheduled_at, started_at, completed_at,
            retry_count, max_retries, error_message, error_details,
            progress_percentage, progress_message,
            created_at, updated_at
        "#,
        job_id,
        MusicJobType::ExtractMetadata.as_str(),
        session_id,
        file_path,
        blob_id,
        JobStatus::Pending.as_str(),
        JobPriority::Normal.as_str(),
        json!({"extract_thumbnails": true}),
        3i32
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to create music job");

    assert_eq!(job.id, job_id);
    assert_eq!(job.job_type, MusicJobType::ExtractMetadata);
    assert_eq!(job.status, JobStatus::Pending);
    assert_eq!(job.file_path, file_path);
    assert_eq!(job.media_blob_id, Some(blob_id));

    // Test job claiming function
    let claimed_jobs = sqlx::query!(
        r#"
        SELECT * FROM claim_music_jobs($1, $2, $3)
        "#,
        "test_worker_1",
        1i32,
        Some(MusicJobType::ExtractMetadata.as_str())
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to claim jobs");

    assert_eq!(claimed_jobs.len(), 1);
    assert_eq!(claimed_jobs[0].id, job_id);

    // Verify job status was updated to in_progress
    let updated_job = sqlx::query!(
        r#"SELECT status as "status: String", worker_id FROM music_jobs WHERE id = $1"#,
        job_id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch updated job");

    assert_eq!(updated_job.status, "in_progress");
    assert_eq!(updated_job.worker_id, Some("test_worker_1".to_string()));

    // Complete the job
    sqlx::query!(
        r#"
        UPDATE music_jobs
        SET status = $1, completed_at = NOW(),
            result = $2, progress_percentage = $3
        WHERE id = $4
        "#,
        JobStatus::Completed.as_str(),
        json!({"metadata_extracted": true, "duration_seconds": 180}),
        100.0,
        job_id
    )
    .execute(&pool)
    .await
    .expect("Failed to complete job");

    // Verify job completion
    let completed_job = sqlx::query!(
        r#"SELECT status as "status: String", progress_percentage FROM music_jobs WHERE id = $1"#,
        job_id
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch completed job");

    assert_eq!(completed_job.status, "completed");
    assert_eq!(completed_job.progress_percentage, Some(100.0));
}

#[sqlx::test]
async fn test_job_deduplication(pool: PgPool) {
    // Create a test scan session
    let session_id = Uuid::new_v4();
    let user_id = create_test_user(&pool, "dedup@example.com", "dedupuser").await;

    sqlx::query!(
        "INSERT INTO music_scan_sessions (id, base_path, initiated_by_user_id) VALUES ($1, $2, $3)",
        session_id,
        "/test/dedup",
        user_id
    )
    .execute(&pool)
    .await
    .expect("Failed to create test scan session");

    let file_path = "/test/dedup/duplicate.mp3";
    let job_type = MusicJobType::ExtractMetadata.as_str();

    // Create first job
    let job1_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO music_jobs (id, job_type, scan_session_id, file_path, status)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        job1_id,
        job_type,
        session_id,
        file_path,
        JobStatus::Pending.as_str()
    )
    .execute(&pool)
    .await
    .expect("Failed to create first job");

    // Try to create duplicate job - should fail due to unique constraint
    let job2_id = Uuid::new_v4();
    let result = sqlx::query!(
        r#"
        INSERT INTO music_jobs (id, job_type, scan_session_id, file_path, status)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        job2_id,
        job_type,
        session_id,
        file_path,
        JobStatus::Pending.as_str()
    )
    .execute(&pool)
    .await;

    assert!(result.is_err(), "Duplicate job should have been rejected");

    // Complete the first job, then we should be able to create another
    sqlx::query!(
        "UPDATE music_jobs SET status = $1 WHERE id = $2",
        JobStatus::Completed.as_str(),
        job1_id
    )
    .execute(&pool)
    .await
    .expect("Failed to complete first job");

    // Now creating another job with same file_path and job_type should work
    let job3_id = Uuid::new_v4();
    let result = sqlx::query!(
        r#"
        INSERT INTO music_jobs (id, job_type, scan_session_id, file_path, status)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        job3_id,
        job_type,
        session_id,
        file_path,
        JobStatus::Pending.as_str()
    )
    .execute(&pool)
    .await;

    assert!(
        result.is_ok(),
        "Should be able to create job after previous completed"
    );
}

#[sqlx::test]
async fn test_scan_session_stats_function(pool: PgPool) {
    // Create test data
    let session_id = Uuid::new_v4();
    let user_id = create_test_user(&pool, "stats@example.com", "statsuser").await;

    // Create scan session
    sqlx::query!(
        r#"
        INSERT INTO music_scan_sessions (
            id, base_path, initiated_by_user_id, total_files, processed_files,
            songs_added, songs_updated, songs_skipped
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        session_id,
        "/test/stats",
        user_id,
        100i32,
        75i32,
        60i32,
        10i32,
        5i32
    )
    .execute(&pool)
    .await
    .expect("Failed to create test scan session");

    // Create some jobs
    for i in 0..5 {
        let job_id = Uuid::new_v4();
        let status = match i {
            0..=2 => JobStatus::Completed.as_str(),
            3 => JobStatus::Pending.as_str(),
            _ => JobStatus::Failed.as_str(),
        };

        sqlx::query!(
            r#"
            INSERT INTO music_jobs (id, job_type, scan_session_id, file_path, status)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            job_id,
            MusicJobType::ExtractMetadata.as_str(),
            session_id,
            format!("/test/stats/file{}.mp3", i),
            status
        )
        .execute(&pool)
        .await
        .expect("Failed to create test job");
    }

    // Get stats using the function
    let stats = sqlx::query!("SELECT * FROM get_scan_session_stats($1)", session_id)
        .fetch_one(&pool)
        .await
        .expect("Failed to get scan session stats");

    assert_eq!(stats.session_id, Some(session_id));
    assert_eq!(stats.processed_files, Some(75));
    assert_eq!(stats.total_files, Some(100));
    assert_eq!(stats.songs_added, Some(60));
    assert_eq!(stats.songs_updated, Some(10));
    assert_eq!(stats.songs_skipped, Some(5));
    assert_eq!(stats.jobs_completed, Some(3));
    assert_eq!(stats.jobs_pending, Some(1));
    assert_eq!(stats.jobs_failed, Some(1));

    // Progress should be 75%
    assert_eq!(stats.progress_percentage, Some(75.0));
}

#[sqlx::test]
async fn test_music_job_health_function(pool: PgPool) {
    // Create some test data
    let session_id = Uuid::new_v4();
    let user_id = create_test_user(&pool, "health@example.com", "healthuser").await;

    sqlx::query!(
        "INSERT INTO music_scan_sessions (id, base_path, initiated_by_user_id, status) VALUES ($1, $2, $3, $4)",
        session_id,
        "/test/health",
        user_id,
        ScanSessionStatus::Running.as_str()
    )
    .execute(&pool)
    .await
    .expect("Failed to create test scan session");

    // Create jobs with different statuses
    let job_statuses = vec![
        JobStatus::Completed,
        JobStatus::Completed,
        JobStatus::Completed,
        JobStatus::Pending,
        JobStatus::Failed,
    ];

    for (i, status) in job_statuses.iter().enumerate() {
        let job_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO music_jobs (
                id, job_type, scan_session_id, file_path, status,
                started_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            job_id,
            MusicJobType::ExtractMetadata.as_str(),
            session_id,
            format!("/test/health/file{}.mp3", i),
            status.as_str(),
            Some(OffsetDateTime::now_utc() - Duration::from_secs(60)),
            if status.is_completed() {
                Some(OffsetDateTime::now_utc())
            } else {
                None
            }
        )
        .execute(&pool)
        .await
        .expect("Failed to create test job");
    }

    // Get health stats
    let health = sqlx::query!("SELECT * FROM get_music_job_health()")
        .fetch_one(&pool)
        .await
        .expect("Failed to get job health stats");

    assert_eq!(health.total_jobs, Some(5));
    assert_eq!(health.completed_jobs, Some(3));
    assert_eq!(health.pending_jobs, Some(1));
    assert_eq!(health.failed_jobs, Some(1));
    assert_eq!(health.active_sessions, Some(1));
    assert!(health.avg_processing_time_minutes.unwrap_or(0.0) > 0.0);
}

#[sqlx::test]
async fn test_retry_failed_jobs_function(pool: PgPool) {
    // Create test scan session
    let session_id = Uuid::new_v4();
    let user_id = create_test_user(&pool, "retry@example.com", "retryuser").await;

    sqlx::query!(
        "INSERT INTO music_scan_sessions (id, base_path, initiated_by_user_id) VALUES ($1, $2, $3)",
        session_id,
        "/test/retry",
        user_id
    )
    .execute(&pool)
    .await
    .expect("Failed to create test scan session");

    // Create failed jobs
    for i in 0..3 {
        let job_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO music_jobs (
                id, job_type, scan_session_id, file_path, status,
                retry_count, max_retries
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            job_id,
            MusicJobType::ExtractMetadata.as_str(),
            session_id,
            format!("/test/retry/file{}.mp3", i),
            JobStatus::Failed.as_str(),
            i as i32, // Different retry counts
            3i32
        )
        .execute(&pool)
        .await
        .expect("Failed to create failed job");
    }

    // Retry failed jobs
    let retried_count = sqlx::query!(
        "SELECT retry_failed_music_jobs($1, $2, $3) as count",
        Some(MusicJobType::ExtractMetadata.as_str()),
        3i32,
        Some(session_id)
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to retry jobs");

    // Should retry 3 jobs (all have retry_count < max_retries)
    assert_eq!(retried_count.count, Some(3));

    // Verify jobs were updated to pending
    let pending_count = sqlx::query!(
        r#"SELECT COUNT(*) as count FROM music_jobs WHERE scan_session_id = $1 AND status = $2"#,
        session_id,
        JobStatus::Pending.as_str()
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to count pending jobs");

    assert_eq!(pending_count.count, Some(3));
}
