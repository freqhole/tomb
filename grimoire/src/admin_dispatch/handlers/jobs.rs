//! background-job introspection handlers.

use crate::admin_dispatch::helpers::{opt_str, require_str, to_value};
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let session_id = opt_str(&args, "session_id");
    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
    let offset = args
        .get("offset")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    to_value(crate::jobs::list_jobs(session_id.as_deref(), None, limit, offset).await)
}

pub(in crate::admin_dispatch) async fn stats() -> GrimoireResponse<JsonValue> {
    to_value(crate::jobs::get_queue_stats().await)
}

pub(in crate::admin_dispatch) async fn cancel_session(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let session_id = match require_str(&args, "session_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let pool = match crate::database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![crate::ErrorDetail::new(
                    "database_error",
                    "database unavailable",
                    &e.to_string(),
                )],
            )
        }
    };

    let rows = match sqlx::query!(
        r#"
        UPDATE jobz
        SET status = 'Cancelled', completed_at = unixepoch()
        WHERE session_id = ? AND status IN ('Pending', 'Running')
        RETURNING id as "id!"
        "#,
        session_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to cancel session jobs",
                vec![crate::ErrorDetail::new(
                    "database_error",
                    "failed to cancel session jobs",
                    &e.to_string(),
                )],
            )
        }
    };

    let cancelled_job_ids: Vec<String> = rows.into_iter().map(|r| r.id).collect();
    GrimoireResponse::success(
        format!("cancelled {} jobs", cancelled_job_ids.len()),
        serde_json::json!({
            "session_id": session_id,
            "cancelled_jobs": cancelled_job_ids.len(),
            "cancelled_job_ids": cancelled_job_ids,
        }),
    )
}
