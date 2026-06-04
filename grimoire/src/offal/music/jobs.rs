//! job API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, get_job, get_jobs_status, list_jobs, AlbumEnrichmentPipelineParams,
    AudioDbAlbumDetailParams, BulkEnrichmentRequest, BulkEnrichmentResponse,
    CancelBulkEnrichmentRequest, CancelBulkEnrichmentResponse, CreateJobRequest,
    CreateJobSessionRequest, EnrichmentSource, GetEnrichmentProgressRequest,
    GetEnrichmentProgressResponse, GetJobRequest, JobStatus, JobType, LastFmAlbumDetailParams,
    MbAlbumDetailParams, MbAlbumSearchParams, RequeryEnrichmentRequest, RequeryEnrichmentResponse,
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
    RouteInfo {
        name: "enqueue_bulk_enrichment",
        path: "/api/music/albums/enrichment/bulk",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BulkEnrichmentRequest",
        response_type: "BulkEnrichmentResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "cancel_bulk_enrichment",
        path: "/api/music/albums/enrichment/cancel",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CancelBulkEnrichmentRequest",
        response_type: "CancelBulkEnrichmentResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_enrichment_progress",
        path: "/api/music/albums/enrichment/progress",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetEnrichmentProgressRequest",
        response_type: "GetEnrichmentProgressResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "requery_enrichment",
        path: "/api/music/albums/enrichment/requery",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RequeryEnrichmentRequest",
        response_type: "RequeryEnrichmentResponse",
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
        priority: None,
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

    // pre-load each album's metadata so we can detect already-confirmed
    // matches and ALSO enqueue a detail-fetch alongside the search. without
    // this, re-running enrich on previously-confirmed albums never
    // re-fetches the detail (so newly-added detail-side fields like
    // artist url-rels never land).
    let pool = match crate::database::connect().await {
        Ok(p) => Some(p),
        Err(e) => {
            tracing::warn!("enqueue_mb_album_search: db connect failed: {}", e);
            None
        }
    };

    for album_id in &req.album_ids {
        // best-effort: if the album already has a confirmed mbid, fire
        // a detail job directly so the user's "enrich" click actually
        // re-pulls fresh data even when no new search candidates exist.
        if let Some(p) = pool.as_ref() {
            let raw_outer: Option<Option<String>> = sqlx::query_scalar!(
                r#"SELECT metadata FROM albumz WHERE id = ? AND deleted_at IS NULL"#,
                album_id
            )
            .fetch_optional(p)
            .await
            .ok()
            .flatten();
            let raw: Option<String> = raw_outer.flatten();
            if let Some(raw) = raw {
                if let Ok(meta) = crate::music::entities::albums::metadata::parse(Some(&raw)) {
                    if let Some(mb) = meta.musicbrainz.as_ref() {
                        if let Some(rg_id) = mb.release_group_id.as_deref() {
                            let detail_params = crate::jobs::MbAlbumDetailParams {
                                album_id: album_id.clone(),
                                release_group_id: rg_id.to_string(),
                                release_id: mb.release_id.clone(),
                            };
                            if let Ok(parameters) = serde_json::to_value(&detail_params) {
                                let detail_req = CreateJobRequest {
                                    job_type: JobType::MbAlbumDetail,
                                    session_id: None,
                                    parameters,
                                    max_retries: Some(2),
                                    scheduled_at: None,
                                    created_by: Some(caller.user_id.clone()),
                                    priority: None,
                                };
                                let resp = create_job(detail_req).await;
                                if let Some(j) = resp.data {
                                    job_ids.push(j.id);
                                }
                            }
                        }
                    }
                }
            }
        }

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
            priority: None,
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
            artist_override: None,
            title_override: None,
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
            priority: None,
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
            artist_override: None,
            title_override: None,
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
            priority: None,
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

/// enqueue an `AlbumEnrichmentPipeline` orchestrator job per album. each
/// orchestrator then enqueues per-source detail jobs respecting freshness
/// + `force`. all spawned pipeline jobs share one `job_session_id` so the
/// modal queue can show grouped progress and `cancel_bulk_enrichment` can
/// flip every pending child to `Cancelled` in one call.
///
/// path: POST /api/music/albums/enrichment/bulk
pub async fn enqueue_bulk_enrichment(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: BulkEnrichmentRequest = match serde_json::from_value(body) {
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

    if req.album_ids.is_empty() {
        return GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                "album_ids required",
            )],
        );
    }

    let sources: Vec<EnrichmentSource> = if req.sources.is_empty() {
        vec![
            EnrichmentSource::Mb,
            EnrichmentSource::Lastfm,
            EnrichmentSource::Audiodb,
        ]
    } else {
        req.sources.clone()
    };

    // create a session so the runner emits grouped progress events and
    // cancel can be done by session.
    let sess_resp = crate::jobs::create_job_session(CreateJobSessionRequest {
        job_type: JobType::AlbumEnrichmentPipeline,
        batch_size: Some(req.album_ids.len()),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    let session = match sess_resp.data {
        Some(s) => s,
        None => return GrimoireResponse::failure("failed to create session", sess_resp.errors),
    };

    let mut job_ids: Vec<String> = Vec::with_capacity(req.album_ids.len());
    let mut skipped: Vec<String> = Vec::new();

    for album_id in &req.album_ids {
        let params = AlbumEnrichmentPipelineParams {
            album_id: album_id.clone(),
            sources: sources.clone(),
            force: req.force,
        };
        let parameters = match serde_json::to_value(&params) {
            Ok(v) => v,
            Err(_) => {
                skipped.push(album_id.clone());
                continue;
            }
        };
        let job_request = CreateJobRequest {
            job_type: JobType::AlbumEnrichmentPipeline,
            session_id: Some(session.id.clone()),
            parameters,
            max_retries: Some(0),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
            priority: req.priority,
        };
        let resp = create_job(job_request).await;
        match resp.data {
            Some(j) => job_ids.push(j.id),
            None => skipped.push(album_id.clone()),
        }
    }

    let body = BulkEnrichmentResponse {
        job_session_id: session.id,
        job_ids,
        skipped_album_ids: skipped,
    };
    GrimoireResponse::success(
        "bulk enrichment enqueued",
        serde_json::to_value(body).unwrap(),
    )
}

/// cancel every pending/running job in the given enrichment session.
/// completed jobs are left alone. returns the ids that flipped to
/// `Cancelled`.
///
/// path: POST /api/music/albums/enrichment/cancel
pub async fn cancel_bulk_enrichment(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: CancelBulkEnrichmentRequest = match serde_json::from_value(body) {
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

    let pool = match crate::database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "database unavailable",
                vec![ErrorDetail::new(
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
        req.job_session_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to cancel session jobs",
                vec![ErrorDetail::new(
                    "database_error",
                    "failed to cancel session jobs",
                    &e.to_string(),
                )],
            )
        }
    };

    let cancelled_job_ids: Vec<String> = rows.into_iter().map(|r| r.id).collect();
    let body = CancelBulkEnrichmentResponse {
        job_session_id: req.job_session_id,
        cancelled_job_ids,
    };
    GrimoireResponse::success(
        "bulk enrichment cancelled",
        serde_json::to_value(body).unwrap(),
    )
}

/// poll per-album per-source status badges for the modal queue ui.
/// returns the most-recent job row per (album_id, source) by inspecting
/// the job parameters json (`$.album_id`).
///
/// path: POST /api/music/albums/enrichment/progress
pub async fn get_enrichment_progress(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: GetEnrichmentProgressRequest = match serde_json::from_value(body) {
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

    let pool = match crate::database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "database unavailable",
                vec![ErrorDetail::new(
                    "database_error",
                    "database unavailable",
                    &e.to_string(),
                )],
            )
        }
    };

    // job_type -> source-tag
    let source_for = |jt: &str| -> Option<&'static str> {
        match jt {
            "MbAlbumSearch" | "MbAlbumDetail" => Some("mb"),
            "LastFmAlbumDetail" => Some("lastfm"),
            "AudioDbAlbumDetail" => Some("audiodb"),
            _ => None,
        }
    };

    let mut albums = Vec::with_capacity(req.album_ids.len());
    for album_id in &req.album_ids {
        // newest-first per (album_id, source). sqlite's json_extract on
        // `parameters->>$.album_id` works because parameters is stored as
        // a json text. we sort desc by created_at and take the first per
        // source via a per-row pass in rust.
        let rows = sqlx::query!(
            r#"
            SELECT id as "id!", job_type as "job_type!", status as "status!",
                   COALESCE(completed_at, started_at, scheduled_at) as "last_attempt_at",
                   error_message, retry_count as "retry_count!: i32"
            FROM jobz
            WHERE job_type IN ('MbAlbumSearch','MbAlbumDetail','LastFmAlbumDetail','AudioDbAlbumDetail')
              AND json_extract(parameters, '$.album_id') = ?
            ORDER BY scheduled_at DESC
            "#,
            album_id
        )
        .fetch_all(&pool)
        .await;

        let rows = match rows {
            Ok(rs) => rs,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to read enrichment progress",
                    vec![ErrorDetail::new(
                        "database_error",
                        "failed to read enrichment progress",
                        &e.to_string(),
                    )],
                )
            }
        };

        let mut by_source: std::collections::HashMap<&str, crate::jobs::EnrichmentSourceStatus> =
            std::collections::HashMap::new();
        for row in rows {
            let Some(src) = source_for(row.job_type.as_str()) else {
                continue;
            };
            // first-seen wins (rows are sorted DESC by created_at).
            by_source
                .entry(src)
                .or_insert(crate::jobs::EnrichmentSourceStatus {
                    source: src.to_string(),
                    status: row.status,
                    last_attempt_at: Some(row.last_attempt_at),
                    last_error: row.error_message,
                    retry_count: row.retry_count,
                });
        }

        let mut sources = Vec::new();
        for src in ["mb", "lastfm", "audiodb"] {
            sources.push(by_source.remove(src).unwrap_or_else(|| {
                crate::jobs::EnrichmentSourceStatus {
                    source: src.to_string(),
                    status: "none".to_string(),
                    last_attempt_at: None,
                    last_error: None,
                    retry_count: 0,
                }
            }));
        }

        albums.push(crate::jobs::AlbumEnrichmentProgress {
            album_id: album_id.clone(),
            sources,
        });
    }

    let body = GetEnrichmentProgressResponse { albums };
    GrimoireResponse::success("enrichment progress", serde_json::to_value(body).unwrap())
}

/// re-run a single source for a single album with optional overrides.
/// returns the enqueued job id. for mb, supplying `mbid` short-circuits
/// the search and dispatches an `MbAlbumDetail` job directly.
///
/// path: POST /api/music/albums/enrichment/requery
pub async fn requery_enrichment(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: RequeryEnrichmentRequest = match serde_json::from_value(body) {
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

    let priority = req.priority.or(Some(10));
    let ov = req.override_query;

    let (job_type, params_value) = match req.source {
        EnrichmentSource::Mb => {
            // when an mbid is provided we can skip search and go straight
            // to the detail fetch.
            if let Some(mbid) = ov.mbid.clone() {
                let p = MbAlbumDetailParams {
                    album_id: req.album_id.clone(),
                    release_group_id: mbid,
                    release_id: None,
                };
                (
                    JobType::MbAlbumDetail,
                    serde_json::to_value(&p).unwrap_or(JsonValue::Null),
                )
            } else {
                let p = MbAlbumSearchParams {
                    album_id: req.album_id.clone(),
                    artist_override: ov.artist.clone(),
                    title_override: ov.title.clone(),
                    auto_confirm_threshold: None,
                };
                (
                    JobType::MbAlbumSearch,
                    serde_json::to_value(&p).unwrap_or(JsonValue::Null),
                )
            }
        }
        EnrichmentSource::Lastfm => {
            let p = LastFmAlbumDetailParams {
                album_id: req.album_id.clone(),
                mbid: ov.mbid.clone(),
                artist_override: ov.artist.clone(),
                title_override: ov.title.clone(),
            };
            (
                JobType::LastFmAlbumDetail,
                serde_json::to_value(&p).unwrap_or(JsonValue::Null),
            )
        }
        EnrichmentSource::Audiodb => {
            let p = AudioDbAlbumDetailParams {
                album_id: req.album_id.clone(),
                mbid: ov.mbid.clone(),
                artist_mbid: None,
                artist_override: ov.artist.clone(),
                title_override: ov.title.clone(),
            };
            (
                JobType::AudioDbAlbumDetail,
                serde_json::to_value(&p).unwrap_or(JsonValue::Null),
            )
        }
    };

    let job_request = CreateJobRequest {
        job_type: job_type.clone(),
        session_id: None,
        parameters: params_value,
        max_retries: Some(2),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority,
    };
    let resp = create_job(job_request).await;
    let job = match resp.data {
        Some(j) => j,
        None => return GrimoireResponse::failure("failed to enqueue requery", resp.errors),
    };

    let body = RequeryEnrichmentResponse {
        job_id: job.id,
        job_type: format!("{:?}", job_type),
    };
    GrimoireResponse::success("requery enqueued", serde_json::to_value(body).unwrap())
}
