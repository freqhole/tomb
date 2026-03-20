//! job API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, get_job, get_jobs_status, list_jobs, CreateJobRequest, JobStatus, JobType,
};
use crate::music::fetch::FetchMediaParams;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

/// route metadata for jobs
/// matches server inventory routes
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "get_job_status",
        path: "/api/jobs/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetJobsStatusRequest",
        response_type: "GetJobsStatusResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_jobs",
        path: "/api/jobs/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListJobsRequest",
        response_type: "Vec<JobResponse>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "create_fetch_job",
        path: "/api/music/fetch",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FetchMediaParams",
        response_type: "JobResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "get_fetch_job",
        path: "/api/music/fetch/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetJobRequest",
        response_type: "JobResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// get status of multiple jobs
///
/// path: POST /api/jobs/status
#[derive(Deserialize)]
struct JobsStatusRequest {
    job_ids: Vec<String>,
}

pub async fn status(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: JobsStatusRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = get_jobs_status(&req.job_ids).await;
    // wrap in { jobs: ... } to match GetJobsStatusResponse schema
    response.map(|jobs| json!({ "jobs": jobs }))
}

/// list jobs with optional filters
///
/// path: POST /api/jobs/list
#[derive(Deserialize, Default)]
struct ListJobsRequest {
    job_type: Option<String>,
    status: Option<JobStatus>,
    limit: Option<u32>,
    offset: Option<u32>,
}

pub async fn list(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListJobsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(_) => ListJobsRequest::default(), // allow empty body
    };

    let response = list_jobs(req.job_type.as_deref(), req.status, req.limit, req.offset).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// create a fetch job
///
/// path: POST /api/music/fetch
pub async fn create_fetch(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "must be member")],
        );
    }

    let params: FetchMediaParams = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let job_request = CreateJobRequest {
        job_type: JobType::FetchMedia,
        session_id: None,
        parameters: match serde_json::to_value(&params) {
            Ok(v) => v,
            Err(e) => {
                return GrimoireResponse::failure(
                    "bad request",
                    vec![ErrorDetail::new(
                        "serialization_error",
                        "failed to serialize parameters",
                        &e.to_string(),
                    )],
                )
            }
        },
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
    };

    let response = create_job(job_request).await;
    response.map(|job| serde_json::to_value(crate::jobs::JobResponse::from(job)).unwrap())
}

/// get a fetch job by id (path param)
///
/// path: GET /api/music/fetch/{id}
pub async fn get_fetch(
    _caller: &Caller,
    id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let response = get_job(id).await;
    response.map(|job| serde_json::to_value(crate::jobs::JobResponse::from(job)).unwrap())
}
