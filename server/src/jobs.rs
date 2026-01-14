//! job status and management handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::jobs::{get_job, list_jobs, GetJobRequest, Job, JobStatus, ListJobsRequest};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// get job status by id
pub async fn get_job_status(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetJobRequest>,
) -> Result<Json<Job>, ApiError> {
    let response = get_job(&req.job_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_job_status",
        path: "/api/jobs/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetJobRequest",
        response_type: "Job",
    }
}

/// list jobs with optional filters
pub async fn list_jobs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<ListJobsRequest>,
) -> Result<Json<Vec<Job>>, ApiError> {
    // parse status filter if provided
    let status_filter = if let Some(status_str) = req.status {
        match status_str.as_str() {
            "Pending" => Some(JobStatus::Pending),
            "Running" => Some(JobStatus::Running),
            "Completed" => Some(JobStatus::Completed),
            "Failed" => Some(JobStatus::Failed),
            "Cancelled" => Some(JobStatus::Cancelled),
            _ => None,
        }
    } else {
        None
    };

    let response = list_jobs(
        req.session_id.as_deref(),
        status_filter,
        req.limit,
        req.offset,
    )
    .await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "list_jobs",
        path: "/api/jobs/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListJobsRequest",
        response_type: "Vec<Job>",
    }
}
