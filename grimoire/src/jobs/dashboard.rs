use super::{job_events, Job};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub const PAGE_SIZE: i64 = 20;

#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DashboardQuery {
    pub view: String,
    pub query: String,
    pub session_id: Option<String>,
    pub page: u32,
    pub job_id: Option<String>,
    pub job_type: Option<String>,
}

impl DashboardQuery {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !matches!(
            self.view.as_str(),
            "" | "overview"
                | "Running"
                | "Pending"
                | "Failed"
                | "Completed"
                | "Cancelled"
                | "sessions"
                | "all"
        ) {
            return Err("unknown jobs view");
        }
        if self.query.len() > 256 {
            return Err("job search is limited to 256 bytes");
        }
        if self.job_type.as_ref().is_some_and(|kind| kind.len() > 128) {
            return Err("job type filter is limited to 128 bytes");
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct Group {
    job_type: String,
    status: String,
    count: i64,
}

#[derive(Clone, Serialize)]
struct Session {
    id: String,
    job_type: String,
    status: String,
    progress: Option<String>,
    pending: i64,
    running: i64,
    completed: i64,
    failed: i64,
    cancelled: i64,
    updated_at: i64,
    created_at: i64,
    started_at: Option<i64>,
    ended_at: Option<i64>,
    can_close: bool,
    closed: bool,
    #[serde(skip)]
    listed: bool,
}

pub async fn dashboard(pool: &SqlitePool, args: &DashboardQuery) -> Result<Value, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let groups = sqlx::query_as!(
        Group,
        r#"SELECT job_type AS "job_type!",status AS "status!",COUNT(*) AS "count!: i64" FROM jobz
           GROUP BY job_type,status ORDER BY (status='Running') DESC,COUNT(*) DESC,job_type,status"#,
    )
    .fetch_all(&mut *tx)
    .await?;
    let count = |status: &str| {
        groups
            .iter()
            .filter(|g| g.status == status)
            .map(|g| g.count)
            .sum::<i64>()
    };
    let overview = matches!(args.view.as_str(), "" | "overview");
    let status = if overview {
        Some("Running")
    } else if matches!(args.view.as_str(), "all" | "sessions") {
        None
    } else {
        Some(args.view.as_str())
    };
    let total = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!: i64" FROM jobz WHERE (? IS NULL OR status=?)
         AND (? IS NULL OR session_id=?) AND (? IS NULL OR job_type=?)
         AND instr(lower(id || ' ' || job_type || ' ' ||
         COALESCE(session_id,'') || ' ' || COALESCE(error_message,'')),lower(?))>0"#,
        status,
        status,
        args.session_id,
        args.session_id,
        args.job_type,
        args.job_type,
        args.query
    )
    .fetch_one(&mut *tx)
    .await?;
    let limit = if overview { 8 } else { PAGE_SIZE };
    let page = args
        .page
        .min((total.saturating_sub(1).max(0) / limit) as u32);
    let offset = i64::from(page) * limit;
    let jobs = sqlx::query_as!(
        Job,
        r#"SELECT id AS "id!",session_id,job_type AS "job_type!",status AS "status!",parameters AS "parameters!",result,
         retry_count AS "retry_count!: i32",max_retries AS "max_retries!: i32",
         scheduled_at AS "scheduled_at!",started_at,completed_at,error_message,created_by
         FROM jobz WHERE (? IS NULL OR status=?) AND (? IS NULL OR session_id=?)
         AND (? IS NULL OR job_type=?)
         AND instr(lower(id || ' ' || job_type || ' ' || COALESCE(session_id,'') || ' ' ||
         COALESCE(error_message,'')),lower(?))>0
         ORDER BY (status='Running') DESC, scheduled_at DESC,id LIMIT ? OFFSET ?"#,
        status,
        status,
        args.session_id,
        args.session_id,
        args.job_type,
        args.job_type,
        args.query,
        limit,
        offset
    )
    .fetch_all(&mut *tx)
    .await?;
    let active_jobs = sqlx::query_as!(
        Job,
        r#"SELECT id AS "id!",session_id,job_type AS "job_type!",status AS "status!",parameters AS "parameters!",result,
         retry_count AS "retry_count!: i32",max_retries AS "max_retries!: i32",
         scheduled_at AS "scheduled_at!",started_at,completed_at,error_message,created_by
         FROM jobz WHERE status='Running' ORDER BY started_at,id LIMIT 8"#,
    )
    .fetch_all(&mut *tx)
    .await?;
    let session_total = sqlx::query_scalar!(
        r#"WITH ids AS (SELECT id FROM job_sessionz UNION SELECT session_id FROM jobz WHERE session_id IS NOT NULL),
        sessions AS (
          SELECT ids.id,COALESCE(s.job_type,MIN(j.job_type),'unknown') AS job_type
          FROM ids LEFT JOIN job_sessionz s ON s.id=ids.id LEFT JOIN jobz j ON j.session_id=ids.id
          GROUP BY ids.id)
        SELECT COUNT(*) AS "count!: i64" FROM sessions
        WHERE instr(lower(id || ' ' || job_type),lower(?))>0"#,
        args.query
    )
        .fetch_one(&mut *tx)
        .await?;
    let session_global_total =
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!: i64" FROM
            (SELECT id FROM job_sessionz UNION SELECT session_id FROM jobz WHERE session_id IS NOT NULL)"#
        )
            .fetch_one(&mut *tx)
            .await?;
    let session_page = args
        .page
        .min((session_total.saturating_sub(1).max(0) / PAGE_SIZE) as u32);
    let session_limit = if overview { 5 } else { PAGE_SIZE };
    let session_offset = if overview {
        0
    } else {
        i64::from(session_page) * PAGE_SIZE
    };
    let mut sessions = sqlx::query_as!(
        Session,
        r#"WITH ids AS (SELECT id FROM job_sessionz UNION SELECT session_id FROM jobz WHERE session_id IS NOT NULL),
        sessions AS (
        SELECT ids.id, COALESCE(s.job_type, MIN(j.job_type),'unknown') AS job_type,
        CASE WHEN s.status IN ('Cancelled','Paused') THEN s.status
             WHEN SUM(j.status='Running')>0 THEN 'Running'
             WHEN SUM(j.status='Pending')>0 THEN 'Pending'
             WHEN SUM(j.status='Failed')>0 THEN 'Failed'
             WHEN s.status='Active' THEN 'Idle'
             WHEN s.status='Failed' THEN s.status ELSE 'Completed' END AS status,
        s.progress,
        COALESCE(SUM(j.status='Pending'),0) AS pending,
        COALESCE(SUM(j.status='Running'),0) AS running,
        COALESCE(SUM(j.status='Completed'),0) AS completed,
        COALESCE(SUM(j.status='Failed'),0) AS failed,
        COALESCE(SUM(j.status='Cancelled'),0) AS cancelled,
        MAX(COALESCE(MAX(COALESCE(j.completed_at,j.started_at,j.scheduled_at)),0),
            COALESCE(s.updated_at,0)) AS updated_at,
        COALESCE(s.created_at,MIN(j.scheduled_at),0) AS created_at,
        MIN(j.started_at) AS started_at,
        CASE WHEN SUM(j.status='Running')>0 THEN NULL ELSE MAX(j.completed_at) END AS ended_at,
        COALESCE(s.status IN ('Active','Failed') AND COALESCE(SUM(j.status IN ('Pending','Running')),0)=0,0) AS can_close,
        COALESCE(s.status IN ('Completed','Cancelled'),0) AS closed
        FROM ids LEFT JOIN job_sessionz s ON s.id=ids.id LEFT JOIN jobz j ON j.session_id=ids.id
        GROUP BY ids.id),
        paged AS (SELECT * FROM sessions WHERE instr(lower(id || ' ' || job_type),lower(?))>0
        AND (NOT ? OR NOT closed OR running>0 OR pending>0)
        ORDER BY (status IN ('Running','Pending')) DESC,updated_at DESC,id LIMIT ? OFFSET ?),
        selected AS (SELECT *,1 AS listed FROM paged UNION ALL SELECT *,0 AS listed FROM sessions WHERE id=?
                     AND id NOT IN (SELECT id FROM paged))
        SELECT id AS "id!",job_type AS "job_type!",status AS "status!: String",progress,
          pending AS "pending!: i64",running AS "running!: i64",completed AS "completed!: i64",
          failed AS "failed!: i64",cancelled AS "cancelled!: i64",updated_at AS "updated_at!: i64",
          created_at AS "created_at!: i64",started_at AS "started_at?: i64",
          ended_at AS "ended_at?: i64",can_close AS "can_close!: bool",
          closed AS "closed!: bool",
          listed AS "listed!: bool"
        FROM selected ORDER BY (status IN ('Running','Pending')) DESC,updated_at DESC,id"#,
        args.query, overview, session_limit, session_offset, args.session_id
    )
        .fetch_all(&mut *tx)
        .await?;
    let detail = if let Some(id) = &args.job_id {
        sqlx::query_as!(
            Job,
            r#"SELECT id AS "id!",session_id,job_type AS "job_type!",status AS "status!",parameters AS "parameters!",result,
            retry_count AS "retry_count!: i32",max_retries AS "max_retries!: i32",
            scheduled_at AS "scheduled_at!",started_at,completed_at,error_message,created_by FROM jobz WHERE id=?"#,
            id
        )
        .fetch_optional(&mut *tx)
        .await?
    } else {
        None
    };
    let running = sqlx::query!("SELECT id AS \"id!\",session_id FROM jobz WHERE status='Running'")
        .fetch_all(&mut *tx)
        .await?;
    for session in &mut sessions {
        for job in running
            .iter()
            .filter(|job| job.session_id.as_deref() == Some(&session.id))
        {
            if let Some(at) = job_events::last_stage_activity(&job.id) {
                session.updated_at = session.updated_at.max(at);
            }
        }
    }
    let selected_session = sessions
        .iter()
        .find(|s| Some(&s.id) == args.session_id.as_ref())
        .cloned();
    // the off-page selected session is for detail only, not an extra list row.
    sessions.retain(|s| s.listed);
    tx.commit().await?;
    let summarize = |job: &Job| {
        let progress: Option<Value> = job
            .result
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());
        let (stage, message) = job_events::current_stage(&job.id);
        let lifecycle_at = job
            .completed_at
            .or(job.started_at)
            .unwrap_or(job.scheduled_at);
        let stage_at = job_events::last_stage_activity(&job.id);
        json!({
            "id": job.id, "session_id": job.session_id, "job_type": job.job_type, "status": job.status,
            "started_at": job.started_at, "completed_at": job.completed_at, "scheduled_at": job.scheduled_at,
            "retry_count": job.retry_count, "max_retries": job.max_retries,
            "error_message": job.error_message, "stage": stage,
            "message": message.or_else(|| progress.as_ref().and_then(|p| p.get("message")).and_then(Value::as_str).map(str::to_owned)),
            "skipped": progress.as_ref().and_then(|p| p.get("skipped")).and_then(Value::as_bool).unwrap_or(false),
            "checked": progress.as_ref().and_then(|p| p.get("checked")).and_then(Value::as_u64),
            "total": progress.as_ref().and_then(|p| p.get("total")).and_then(Value::as_u64),
            "last_activity_at": stage_at.unwrap_or(lifecycle_at).max(lifecycle_at),
            "activity_source": if stage_at.is_some() { "progress event" } else { "lifecycle timestamp" },
        })
    };
    let rows: Vec<_> = jobs.iter().map(summarize).collect();
    let active_rows: Vec<_> = active_jobs.iter().map(summarize).collect();
    let stats = json!({
        "pending": count("Pending"), "running": count("Running"), "completed": count("Completed"),
        "failed": count("Failed"), "cancelled": count("Cancelled"), "sessions": session_global_total,
    });
    Ok(json!({
        "stats": stats, "groups": groups, "jobs": rows, "active_jobs": active_rows, "sessions": sessions,
        "total": if args.view=="sessions" { session_total } else { total },
        "page": if args.view=="sessions" { session_page } else { page },
        "page_size": if args.view=="sessions" { PAGE_SIZE } else { limit },
        "detail_summary": detail.as_ref().map(summarize), "detail": detail,
        "selected_session": selected_session,
    }))
}

pub async fn close_idle_session(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    Ok(close_idle_sessions(pool, Some(id)).await? == 1)
}

pub async fn close_idle_sessions(pool: &SqlitePool, id: Option<&str>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        "UPDATE job_sessionz SET status='Completed'
         WHERE (? IS NULL OR id=?) AND status IN ('Active','Failed') AND NOT EXISTS
         (SELECT 1 FROM jobz WHERE session_id=job_sessionz.id AND status IN ('Pending','Running'))",
        id,
        id
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub async fn retry(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let updated = sqlx::query!(
        "UPDATE jobz SET status='Pending',retry_count=0,started_at=NULL,completed_at=NULL,
         error_message=NULL,result=NULL,scheduled_at=unixepoch()
         WHERE id=? AND status='Failed'
         AND NOT EXISTS (SELECT 1 FROM job_sessionz WHERE id=jobz.session_id AND status IN ('Cancelled','Paused'))",
        id
    ).execute(&mut *tx).await?;
    if updated.rows_affected() > 0 {
        sqlx::query!(
            "UPDATE job_sessionz SET status='Active',updated_at=unixepoch()
             WHERE id=(SELECT session_id FROM jobz WHERE id=?)",
            id
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(updated.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::run_schema_migrations(&pool).await.unwrap();
        for (id, status) in [
            ("active", "Active"),
            ("cancelled", "Cancelled"),
            ("paused", "Paused"),
            ("empty", "Completed"),
        ] {
            sqlx::query!("INSERT INTO job_sessionz(id,job_type,status,progress) VALUES (?,'ScanDirectory',?,?)",
                id,status,r#"{"current":10,"total":10}"#).execute(&pool).await.unwrap();
        }
        for i in 0..45 {
            let id = format!("pending-{i:02}");
            sqlx::query!("INSERT INTO jobz(id,session_id,job_type,status,parameters) VALUES (?,'active','ProcessFile','Pending','{}')",
                id).execute(&pool).await.unwrap();
        }
        for (id, status, session) in [
            ("running", "Running", "active"),
            ("failure", "Failed", "active"),
            ("cancelled-failure", "Failed", "cancelled"),
            ("paused-failure", "Failed", "paused"),
            ("done", "Completed", "active"),
        ] {
            sqlx::query!("INSERT INTO jobz(id,session_id,job_type,status,parameters,result,error_message,started_at)
                VALUES (?,?,'RegenerateVideoPosters',?,'{}',?, 'disk offline',unixepoch()-10)",
                id,session,status,r#"{"checked":2,"total":10}"#)
                .execute(&pool).await.unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn bulk_close_clears_all_pages_but_preserves_live_work_and_failure_history() {
        let pool = fixture().await;
        for i in 0..12 {
            let id = format!("idle-{i}");
            sqlx::query!(
                "INSERT INTO job_sessionz(id,job_type,status) VALUES (?,'ScanDirectory','Failed')",
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query!("INSERT INTO jobz(session_id,job_type,status,error_message) VALUES (?,'ProcessDirectory','Failed','old failure')", id)
                .execute(&pool).await.unwrap();
        }
        assert_eq!(close_idle_sessions(&pool, None).await.unwrap(), 12);
        assert_eq!(close_idle_sessions(&pool, None).await.unwrap(), 0);
        let overview = dashboard(&pool, &DashboardQuery::default()).await.unwrap();
        assert_eq!(overview["sessions"].as_array().unwrap().len(), 2);
        assert!(overview["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["id"] == "active" || s["id"] == "paused"));
        assert_eq!(overview["stats"]["pending"], 45);
        assert_eq!(overview["stats"]["running"], 1);
        assert_eq!(
            sqlx::query_scalar!(
                r#"SELECT COUNT(*) AS "count!: i64" FROM jobz WHERE error_message='old failure'"#
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            12
        );
    }

    #[tokio::test]
    async fn overview_is_bounded_and_reports_all_queue_totals() {
        let pool = fixture().await;
        let result = dashboard(&pool, &DashboardQuery::default()).await.unwrap();
        assert_eq!(result["stats"]["pending"], 45);
        assert_eq!(result["stats"]["running"], 1);
        assert_eq!(result["jobs"].as_array().unwrap().len(), 1);
        assert!(result["sessions"].as_array().unwrap().len() <= 5);
        assert!(result["jobs"][0].get("parameters").is_none());
        assert_eq!(result["jobs"][0]["checked"], 2);
        assert_eq!(result["jobs"][0]["total"], 10);
        assert_eq!(result["detail"], Value::Null);
    }

    #[tokio::test]
    async fn large_queues_keep_overview_bounded_and_details_available_off_page() {
        let pool = fixture().await;
        for i in 0..12 {
            let id = format!("extra-running-{i:02}");
            sqlx::query!("INSERT INTO jobz(id,job_type,status,parameters) VALUES (?,'RegenerateVideoPosters','Running','{}')",
                id).execute(&pool).await.unwrap();
        }
        for i in 0..25 {
            let id = format!("extra-session-{i:02}");
            sqlx::query!("INSERT INTO job_sessionz(id,job_type,status,progress) VALUES (?,'RegenerateVideoPosters','Active','{}')",
                id).execute(&pool).await.unwrap();
        }
        let args = DashboardQuery {
            job_id: Some("failure".into()),
            ..Default::default()
        };
        let result = dashboard(&pool, &args).await.unwrap();
        assert_eq!(result["stats"]["running"], 13);
        assert_eq!(result["jobs"].as_array().unwrap().len(), 8);
        assert_eq!(result["active_jobs"].as_array().unwrap().len(), 8);
        assert_eq!(result["sessions"].as_array().unwrap().len(), 5);
        assert_eq!(result["groups"][0]["status"], "Running");
        assert_eq!(result["detail_summary"]["id"], "failure");
        let args = DashboardQuery {
            view: "sessions".into(),
            page: 1,
            ..Default::default()
        };
        let result = dashboard(&pool, &args).await.unwrap();
        assert_eq!(result["total"], 29);
        assert_eq!(result["sessions"].as_array().unwrap().len(), 9);
        let (first, second) = tokio::join!(retry(&pool, "failure"), retry(&pool, "failure"));
        assert_ne!(first.unwrap(), second.unwrap());
    }

    #[tokio::test]
    async fn paging_search_filters_and_details_do_not_truncate_the_population() {
        let pool = fixture().await;
        let mut args = DashboardQuery {
            view: "Pending".into(),
            ..Default::default()
        };
        let first = dashboard(&pool, &args).await.unwrap();
        assert_eq!(first["total"], 45);
        assert_eq!(first["jobs"].as_array().unwrap().len(), 20);
        args.page = 2;
        let last = dashboard(&pool, &args).await.unwrap();
        assert_eq!(last["jobs"].as_array().unwrap().len(), 5);
        assert!(!first["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|j| j["id"] == last["jobs"][0]["id"]));
        args.view = "Failed".into();
        args.query = "disk offline".into();
        args.session_id = Some("active".into());
        args.job_id = Some("failure".into());
        let failure = dashboard(&pool, &args).await.unwrap();
        assert_eq!(failure["total"], 1);
        assert_eq!(failure["page"], 0);
        assert_eq!(failure["jobs"][0]["id"], "failure");
        assert_eq!(failure["detail"]["parameters"], "{}");
        assert_eq!(failure["detail"]["error_message"], "disk offline");
        assert_eq!(failure["active_jobs"][0]["id"], "running");
        args.query = "%_".into();
        assert_eq!(dashboard(&pool, &args).await.unwrap()["total"], 0);
    }

    #[tokio::test]
    async fn sessions_include_pruned_empty_sessions_and_page_consistently() {
        let pool = fixture().await;
        let args = DashboardQuery {
            view: "sessions".into(),
            query: "empty".into(),
            ..Default::default()
        };
        let result = dashboard(&pool, &args).await.unwrap();
        assert_eq!(result["total"], 1);
        assert_eq!(result["sessions"][0]["id"], "empty");
        assert_eq!(result["sessions"][0]["completed"], 0);
        assert_eq!(result["sessions"][0]["status"], "Completed");
    }

    #[tokio::test]
    async fn job_type_filters_are_exact_and_compose_with_status_and_search() {
        let pool = fixture().await;
        let mut args = DashboardQuery {
            view: "Failed".into(),
            job_type: Some("RegenerateVideoPosters".into()),
            query: "disk offline".into(),
            ..Default::default()
        };
        assert_eq!(dashboard(&pool, &args).await.unwrap()["total"], 3);
        args.job_type = Some("Video".into());
        assert_eq!(dashboard(&pool, &args).await.unwrap()["total"], 0);
    }

    #[tokio::test]
    async fn idle_sessions_can_be_closed_without_deleting_history_or_touching_live_work() {
        let pool = fixture().await;
        sqlx::query!(
            "INSERT INTO job_sessionz(id,job_type,status) VALUES ('idle','ProcessFile','Active')"
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO jobz(id,session_id,job_type,status,parameters,started_at,completed_at)
            VALUES ('idle-job','idle','ProcessFile','Completed','{}',100,130)"
        )
        .execute(&pool)
        .await
        .unwrap();
        let args = DashboardQuery {
            view: "all".into(),
            session_id: Some("idle".into()),
            query: "not-matching-session".into(),
            ..Default::default()
        };
        let result = dashboard(&pool, &args).await.unwrap();
        assert_eq!(result["selected_session"]["status"], "Idle");
        assert_eq!(result["selected_session"]["can_close"], true);
        assert_eq!(result["selected_session"]["started_at"], 100);
        assert_eq!(result["selected_session"]["ended_at"], 130);
        assert_eq!(result["sessions"].as_array().unwrap().len(), 0);
        assert!(close_idle_session(&pool, "idle").await.unwrap());
        assert!(!close_idle_session(&pool, "idle").await.unwrap());
        for id in ["active", "paused", "cancelled", "missing"] {
            assert!(!close_idle_session(&pool, id).await.unwrap());
        }
        assert_eq!(
            sqlx::query_scalar!("SELECT COUNT(*) AS \"count!: i64\" FROM jobz WHERE id='idle-job'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            dashboard(&pool, &args).await.unwrap()["selected_session"]["status"],
            "Completed"
        );
        sqlx::query!("UPDATE job_sessionz SET status='Active' WHERE id='idle'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query!("UPDATE jobz SET status='Pending' WHERE id='idle-job'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!close_idle_session(&pool, "idle").await.unwrap());
        sqlx::query!("UPDATE jobz SET status='Failed' WHERE id='idle-job'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(close_idle_session(&pool, "idle").await.unwrap());
        assert_eq!(
            dashboard(&pool, &args).await.unwrap()["selected_session"]["status"],
            "Failed"
        );
        assert_eq!(
            dashboard(&pool, &args).await.unwrap()["selected_session"]["closed"],
            true
        );
        let overview = dashboard(&pool, &DashboardQuery::default()).await.unwrap();
        assert!(!overview["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == "idle"));
        let history = dashboard(
            &pool,
            &DashboardQuery {
                view: "sessions".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(history["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == "idle"));
        sqlx::query!("UPDATE job_sessionz SET status='Failed' WHERE id='idle'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(close_idle_session(&pool, "idle").await.unwrap());
    }

    #[tokio::test]
    async fn latest_stage_activity_is_visible_without_being_a_persistent_heartbeat() {
        let pool = fixture().await;
        let job = sqlx::query_as!(Job, r#"SELECT id AS "id!",session_id,job_type AS "job_type!",
            status AS "status!",parameters AS "parameters!",result,retry_count AS "retry_count!: i32",
            max_retries AS "max_retries!: i32",scheduled_at AS "scheduled_at!",started_at,
            completed_at,error_message,created_by FROM jobz WHERE id='running'"#)
            .fetch_one(&pool).await.unwrap();
        job_events::emit_stage_from_job_with_details(
            &job,
            "dashboard_test_activity",
            Some("working"),
            None,
        );
        let args = DashboardQuery {
            job_id: Some("running".into()),
            session_id: Some("active".into()),
            ..Default::default()
        };
        let result = dashboard(&pool, &args).await.unwrap();
        assert_eq!(
            result["detail_summary"]["activity_source"],
            "progress event"
        );
        assert!(
            result["detail_summary"]["last_activity_at"]
                .as_i64()
                .unwrap()
                >= job.started_at.unwrap()
        );
        assert!(
            result["selected_session"]["updated_at"].as_i64().unwrap()
                >= result["detail_summary"]["last_activity_at"]
                    .as_i64()
                    .unwrap()
        );
    }

    #[tokio::test]
    async fn retry_is_atomic_and_cannot_resurrect_running_or_cancelled_work() {
        let pool = fixture().await;
        assert!(retry(&pool, "failure").await.unwrap());
        assert!(!retry(&pool, "failure").await.unwrap());
        for id in [
            "missing",
            "running",
            "done",
            "cancelled-failure",
            "paused-failure",
        ] {
            assert!(!retry(&pool, id).await.unwrap(), "{id}");
        }
        let job = sqlx::query_as!(Job,
            r#"SELECT id AS "id!",session_id,job_type AS "job_type!",status AS "status!",parameters AS "parameters!",result,
            retry_count AS "retry_count!: i32",max_retries AS "max_retries!: i32",
            scheduled_at AS "scheduled_at!",started_at,completed_at,error_message,created_by FROM jobz WHERE id='failure'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(job.status, "Pending");
        assert_eq!(job.retry_count, 0);
        assert!(job.result.is_none() && job.error_message.is_none() && job.started_at.is_none());
    }

    #[test]
    fn request_validation_rejects_unknown_statuses_and_unbounded_search() {
        assert!(DashboardQuery {
            view: "bogus".into(),
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(DashboardQuery {
            query: "x".repeat(257),
            ..Default::default()
        }
        .validate()
        .is_err());
    }
}
