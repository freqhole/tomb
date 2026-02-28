//! job status and management handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::jobs::{
    get_jobs_status, list_jobs, GetJobsStatusRequest, GetJobsStatusResponse, JobResponse,
    JobStatus, ListJobsRequest,
};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// get job status by id(s) - accepts one or more job IDs
pub async fn get_job_status(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<GetJobsStatusRequest>,
) -> Result<Json<GetJobsStatusResponse>, ApiError> {
    let response = get_jobs_status(&req.job_ids).await;

    response
        .data
        .map(|jobs| GetJobsStatusResponse { jobs })
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_job_status",
        path: "/api/jobs/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetJobsStatusRequest",
        response_type: "GetJobsStatusResponse",
        auth: RouteAuth::Authenticated,
    }
}

/// list jobs with optional filters
pub async fn list_jobs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<ListJobsRequest>,
) -> Result<Json<Vec<JobResponse>>, ApiError> {
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
        .map(|jobs| jobs.into_iter().map(JobResponse::from).collect())
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
        response_type: "Vec<JobResponse>",
        auth: RouteAuth::Authenticated,
    }
}
