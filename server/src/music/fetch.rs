//! Fetch handlers - external media fetching

use axum::{
    extract::{Extension, Path},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::jobs::{create_job, get_job, CreateJobRequest, Job, JobType};
use grimoire::music::fetch::FetchMediaParams;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// Create a fetch job to download media from external URL
pub async fn create_fetch_job(
    Extension(user): Extension<AuthenticatedUser>,
    Json(params): Json<FetchMediaParams>,
) -> Result<Json<Job>, ApiError> {
    // create job request
    let job_request = CreateJobRequest {
        job_type: JobType::FetchMedia,
        session_id: None,
        parameters: serde_json::to_value(&params)
            .map_err(|e| ApiError::BadRequest(format!("failed to serialize parameters: {}", e)))?,
        max_retries: Some(3),
        scheduled_at: None, // immediate
        created_by: Some(user.user_id),
    };

    let response = create_job(job_request).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_fetch_job",
        path: "/api/music/fetch",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FetchMediaParams",
        response_type: "Job",
    }
}

/// Get fetch job status and result
pub async fn get_fetch_job(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(job_id): Path<String>,
) -> Result<Json<Job>, ApiError> {
    let response = get_job(&job_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_fetch_job",
        path: "/api/music/fetch/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetJobRequest",
        response_type: "Job",
    }
}
