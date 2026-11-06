//! background-job introspection handlers.

use crate::admin_dispatch::helpers::{bad_request, internal, opt_str, require_str, to_value};
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

pub(in crate::admin_dispatch) async fn dashboard(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let query: crate::jobs::dashboard::DashboardQuery = match serde_json::from_value(args) {
        Ok(query) => query,
        Err(error) => return bad_request(error.to_string()),
    };
    if let Err(error) = query.validate() {
        return bad_request(error);
    }
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => return internal(error.to_string()),
    };
    match crate::jobs::dashboard::dashboard(&pool, &query).await {
        Ok(data) => GrimoireResponse::success("job dashboard refreshed", data),
        Err(error) => internal(format!("could not refresh jobs: {error}")),
    }
}

pub(in crate::admin_dispatch) async fn retry(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "job_id") {
        Ok(id) => id,
        Err(error) => return error,
    };
    if args.get("confirm").and_then(JsonValue::as_bool) != Some(true) {
        return bad_request(
            "confirm must be true; retrying can repeat side effects and child jobs",
        );
    }
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => return internal(error.to_string()),
    };
    match crate::jobs::dashboard::retry(&pool, &id).await {
        Ok(true) => {
            GrimoireResponse::success("failed job requeued", serde_json::json!({"job_id": id}))
        }
        Ok(false) => bad_request("job not found, not failed, or its session is cancelled/paused"),
        Err(error) => internal(format!("could not retry job: {error}")),
    }
}

pub(in crate::admin_dispatch) async fn close_idle_session(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "session_id") {
        Ok(id) => id,
        Err(error) => return error,
    };
    if args.get("confirm").and_then(JsonValue::as_bool) != Some(true) {
        return bad_request(
            "confirm must be true; closing preserves history but does not stop orchestration",
        );
    }
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => return internal(error.to_string()),
    };
    match crate::jobs::dashboard::close_idle_session(&pool, &id).await {
        Ok(true) => GrimoireResponse::success(
            "idle session closed; history preserved",
            serde_json::json!({"session_id": id}),
        ),
        Ok(false) => bad_request("session not found, already closed, or has pending/running jobs"),
        Err(error) => internal(format!("could not close idle session: {error}")),
    }
}

pub(in crate::admin_dispatch) async fn close_idle_sessions(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if args.get("confirm").and_then(JsonValue::as_bool) != Some(true) {
        return bad_request(
            "confirm must be true; closing preserves history but does not stop orchestration",
        );
    }
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => return internal(error.to_string()),
    };
    match crate::jobs::dashboard::close_idle_sessions(&pool, None).await {
        Ok(count) => GrimoireResponse::success(
            "idle sessions closed; history preserved",
            serde_json::json!({"closed_sessions": count}),
        ),
        Err(error) => internal(format!("could not close idle sessions: {error}")),
    }
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
                    e.to_string(),
                )],
            )
        }
    };

    let cancelled_job_ids = match crate::jobs::cancel_session_jobs(&pool, &session_id).await {
        Ok(rs) => rs,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to cancel session jobs",
                vec![crate::ErrorDetail::new(
                    "database_error",
                    "failed to cancel session jobs",
                    e.to_string(),
                )],
            )
        }
    };
    GrimoireResponse::success(
        format!(
            "requested cancellation for {} jobs",
            cancelled_job_ids.len()
        ),
        serde_json::json!({
            "session_id": session_id,
            "cancelled_jobs": cancelled_job_ids.len(),
            "cancelled_job_ids": cancelled_job_ids,
        }),
    )
}
