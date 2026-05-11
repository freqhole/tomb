//! job API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, get_job, get_jobs_status, list_jobs, CreateJobRequest, GetJobRequest, JobStatus,
    JobType,
};
use crate::music::fetch::FetchMediaParams;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

/// route metadata for jobs
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
        path: "/api/music/fetch/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetJobRequest",
        response_type: "JobResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "enqueue_mb_album_search",
        path: "/api/music/albums/mb-search/enqueue",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EnqueueMbAlbumSearchRequest",
        response_type: "EnqueueMbAlbumSearchResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "enqueue_lastfm_album_detail",
        path: "/api/music/albums/lastfm/enqueue",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EnqueueLastFmAlbumDetailRequest",
        response_type: "EnqueueLastFmAlbumDetailResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "enqueue_audiodb_album_detail",
        path: "/api/music/albums/audiodb/enqueue",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "EnqueueAudioDbAlbumDetailRequest",
        response_type: "EnqueueAudioDbAlbumDetailResponse",
        auth: RouteAuth::Role(UserRole::Admin),
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

/// get a fetch job by id
///
/// path: POST /api/music/fetch/status
pub async fn get_fetch(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetJobRequest = match serde_json::from_value(body) {
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

    let response = get_job(&req.job_id).await;
    response.map(|job| serde_json::to_value(crate::jobs::JobResponse::from(job)).unwrap())
}

/// enqueue a `MbAlbumSearch` job per album id. admin only.
///
/// path: POST /api/music/albums/mb-search/enqueue
pub async fn enqueue_mb_album_search(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: crate::jobs::EnqueueMbAlbumSearchRequest = match serde_json::from_value(body) {
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

    let mut job_ids: Vec<String> = Vec::with_capacity(req.album_ids.len());
    let mut skipped: Vec<String> = Vec::new();

    for album_id in &req.album_ids {
        let params = crate::jobs::MbAlbumSearchParams {
            album_id: album_id.clone(),
            artist_override: None,
            title_override: None,
            auto_confirm_threshold: req.auto_confirm_threshold,
        };
        let parameters = match serde_json::to_value(&params) {
            Ok(v) => v,
            Err(_) => {
                skipped.push(album_id.clone());
                continue;
            }
        };
        let job_request = CreateJobRequest {
            job_type: JobType::MbAlbumSearch,
            session_id: None,
            parameters,
            max_retries: Some(2),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
        };
        let resp = create_job(job_request).await;
        match resp.data {
            Some(j) => job_ids.push(j.id),
            None => skipped.push(album_id.clone()),
        }
    }

    let body = crate::jobs::EnqueueMbAlbumSearchResponse {
        job_ids,
        skipped_album_ids: skipped,
    };
    GrimoireResponse::success(
        "mb album search enqueued",
        serde_json::to_value(body).unwrap(),
    )
}

/// enqueue a `LastFmAlbumDetail` job per album id. admin only.
///
/// path: POST /api/music/albums/lastfm/enqueue
pub async fn enqueue_lastfm_album_detail(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: crate::jobs::EnqueueLastFmAlbumDetailRequest = match serde_json::from_value(body) {
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

    let mut job_ids: Vec<String> = Vec::with_capacity(req.album_ids.len());
    let mut skipped: Vec<String> = Vec::new();

    for album_id in &req.album_ids {
        // best-effort mbid hint from the album's confirmed musicbrainz match
        let mbid = crate::music::entities::albums::read_album_metadata(album_id)
            .await
            .data
            .and_then(|m| m.musicbrainz)
            .and_then(|mb| mb.release_group_id);

        let params = crate::jobs::LastFmAlbumDetailParams {
            album_id: album_id.clone(),
            mbid,
        };
        let parameters = match serde_json::to_value(&params) {
            Ok(v) => v,
            Err(_) => {
                skipped.push(album_id.clone());
                continue;
            }
        };
        let job_request = CreateJobRequest {
            job_type: JobType::LastFmAlbumDetail,
            session_id: None,
            parameters,
            max_retries: Some(2),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
        };
        let resp = create_job(job_request).await;
        match resp.data {
            Some(j) => job_ids.push(j.id),
            None => skipped.push(album_id.clone()),
        }
    }

    let body = crate::jobs::EnqueueLastFmAlbumDetailResponse {
        job_ids,
        skipped_album_ids: skipped,
    };
    GrimoireResponse::success(
        "lastfm album detail enqueued",
        serde_json::to_value(body).unwrap(),
    )
}

/// enqueue an `AudioDbAlbumDetail` job per album id. admin only.
///
/// path: POST /api/music/albums/audiodb/enqueue
pub async fn enqueue_audiodb_album_detail(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: crate::jobs::EnqueueAudioDbAlbumDetailRequest = match serde_json::from_value(body) {
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

    let mut job_ids: Vec<String> = Vec::with_capacity(req.album_ids.len());
    let mut skipped: Vec<String> = Vec::new();

    for album_id in &req.album_ids {
        // best-effort mbid hints from the album's confirmed musicbrainz match
        let md = crate::music::entities::albums::read_album_metadata(album_id)
            .await
            .data;
        let (mbid, artist_mbid) = match md.and_then(|m| m.musicbrainz) {
            Some(mb) => (mb.release_group_id, None::<String>),
            None => (None, None),
        };

        let params = crate::jobs::AudioDbAlbumDetailParams {
            album_id: album_id.clone(),
            mbid,
            artist_mbid,
        };
        let parameters = match serde_json::to_value(&params) {
            Ok(v) => v,
            Err(_) => {
                skipped.push(album_id.clone());
                continue;
            }
        };
        let job_request = CreateJobRequest {
            job_type: JobType::AudioDbAlbumDetail,
            session_id: None,
            parameters,
            max_retries: Some(2),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
        };
        let resp = create_job(job_request).await;
        match resp.data {
            Some(j) => job_ids.push(j.id),
            None => skipped.push(album_id.clone()),
        }
    }

    let body = crate::jobs::EnqueueAudioDbAlbumDetailResponse {
        job_ids,
        skipped_album_ids: skipped,
    };
    GrimoireResponse::success(
        "audiodb album detail enqueued",
        serde_json::to_value(body).unwrap(),
    )
}
