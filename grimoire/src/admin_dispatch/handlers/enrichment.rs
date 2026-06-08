//! bulk enrichment admin handlers.
//!
//! exposes five RPC commands for browsing tags, resolving filtered album
//! sets, and launching bulk enrichment sessions (with or without
//! auto-confirm).

use crate::admin_dispatch::helpers::to_value;
use crate::database;
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, create_job_session, AutoApplyAlbumEnrichmentParams, CreateJobRequest,
    CreateJobSessionRequest, EnrichmentSource, JobType,
};
use crate::music::entities::albums::{self as albums_repo, TagFilterMode};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn parse_mode(v: Option<&JsonValue>) -> TagFilterMode {
    match v.and_then(|v| v.as_str()) {
        Some("all") => TagFilterMode::All,
        _ => TagFilterMode::Any,
    }
}

fn parse_tag_ids(v: Option<&JsonValue>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_tag_names(v: Option<&JsonValue>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// case-insensitive name→id lookup against `tagz` (excluding deleted).
/// returns the resolved ids in `data` and pushes one `ErrorDetail` per
/// name that didn't match, but does NOT mark the response as failed —
/// callers decide whether unknown names are fatal.
async fn resolve_tag_names_to_ids(names: &[String]) -> (Vec<String>, Vec<ErrorDetail>) {
    if names.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return (Vec::new(), vec![ErrorDetail::from(e)]),
    };
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, name FROM tagz WHERE deleted_at IS NULL AND LOWER(name) IN (",
    );
    let mut sep = qb.separated(", ");
    for n in names {
        sep.push_bind(n.to_lowercase());
    }
    sep.push_unseparated(")");
    let rows: Vec<(String, String)> = match qb
        .build_query_as::<(String, String)>()
        .fetch_all(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => return (Vec::new(), vec![ErrorDetail::from(e)]),
    };
    let mut ids: Vec<String> = Vec::with_capacity(rows.len());
    let mut matched: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (id, name) in rows {
        ids.push(id);
        matched.insert(name.to_lowercase());
    }
    let mut errors: Vec<ErrorDetail> = Vec::new();
    for n in names {
        if !matched.contains(&n.to_lowercase()) {
            errors.push(ErrorDetail::new(
                "unknown_tag",
                "unknown tag name",
                format!("no tag matches '{}'", n),
            ));
        }
    }
    (ids, errors)
}

/// merge explicit `tag_ids` with the ids resolved from `tag_names`,
/// de-duplicating. used by every bulk handler.
async fn merge_tag_inputs(args: &JsonValue) -> (Vec<String>, Vec<ErrorDetail>) {
    let mut ids = parse_tag_ids(args.get("tag_ids"));
    let names = parse_tag_names(args.get("tag_names"));
    let (resolved, errors) = resolve_tag_names_to_ids(&names).await;
    for id in resolved {
        if !ids.iter().any(|existing| existing == &id) {
            ids.push(id);
        }
    }
    (ids, errors)
}

// ---------------------------------------------------------------------------
// music_enrichment_tags
// ---------------------------------------------------------------------------

/// list every non-deleted tag that has at least one non-deleted album,
/// with a per-tag album count. sorted by count desc, name asc.
pub(in crate::admin_dispatch) async fn tags() -> GrimoireResponse<JsonValue> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return GrimoireResponse::failure("database error", vec![ErrorDetail::from(e)]),
    };

    let rows = match sqlx::query!(
        r#"
        SELECT
            t.id   AS "id!",
            t.name AS "name!",
            COUNT(DISTINCT a.id) AS "album_count!"
        FROM tagz t
        JOIN album_tagz at ON at.tag_id = t.id
        JOIN albumz a ON a.id = at.album_id
        WHERE t.deleted_at IS NULL
          AND a.deleted_at IS NULL
        GROUP BY t.id, t.name
        HAVING COUNT(DISTINCT a.id) >= 1
        ORDER BY COUNT(DISTINCT a.id) DESC, t.name ASC
        "#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("query failed", vec![ErrorDetail::from(e)]),
    };

    let tags: Vec<JsonValue> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.name,
                "album_count": r.album_count,
            })
        })
        .collect();

    GrimoireResponse::success("ok", json!({ "tags": tags }))
}

// ---------------------------------------------------------------------------
// music_enrichment_resolve
// ---------------------------------------------------------------------------

/// resolve album ids matching the given tag filter. returns the album_ids
/// list, count, and the echo'd filter params.
pub(in crate::admin_dispatch) async fn resolve(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let (tag_ids, name_errors) = merge_tag_inputs(&args).await;
    let mode = parse_mode(args.get("mode"));
    let mode_str = if mode == TagFilterMode::All {
        "all"
    } else {
        "any"
    };

    let resp = albums_repo::resolve_album_ids_by_tags(&tag_ids, mode).await;
    if !resp.success {
        return GrimoireResponse::failure(&resp.message, resp.errors);
    }
    let album_ids = resp.data.unwrap_or_default();
    let count = album_ids.len();

    let unknown_names: Vec<String> = name_errors.iter().map(|e| e.detail.clone()).collect();
    GrimoireResponse::success(
        "resolved",
        json!({
            "album_ids": album_ids,
            "count": count,
            "tag_ids": tag_ids,
            "mode": mode_str,
            "unknown_tag_names": unknown_names,
        }),
    )
}

// ---------------------------------------------------------------------------
// music_enrichment_bulk_start
// ---------------------------------------------------------------------------

/// resolve albums by tag filter then kick off an enrichment pipeline
/// session for every matched album.
pub(in crate::admin_dispatch) async fn bulk_start(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let (tag_ids, _name_errors) = merge_tag_inputs(&args).await;
    let mode = parse_mode(args.get("mode"));
    let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let priority = args
        .get("priority")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let sources: Vec<EnrichmentSource> = args
        .get("sources")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let resp = albums_repo::resolve_album_ids_by_tags(&tag_ids, mode).await;
    if !resp.success {
        return GrimoireResponse::failure(&resp.message, resp.errors);
    }
    let album_ids = resp.data.unwrap_or_default();
    if album_ids.is_empty() {
        return GrimoireResponse::success(
            "no albums matched",
            json!({ "session_id": null, "count": 0, "skipped": 0, "message": "no albums matched" }),
        );
    }

    let count = album_ids.len();
    let body = json!({
        "album_ids": album_ids,
        "sources": sources,
        "force": force,
        "priority": priority,
    });

    let inner = crate::offal::music::jobs::enqueue_bulk_enrichment(caller, body).await;
    if !inner.success {
        return GrimoireResponse::failure(&inner.message, inner.errors);
    }
    // merge count into the response
    let mut data = inner.data.unwrap_or(json!({}));
    if let Some(obj) = data.as_object_mut() {
        obj.insert("count".to_string(), json!(count));
    }
    GrimoireResponse::success(inner.message, data)
}

// ---------------------------------------------------------------------------
// music_enrichment_bulk_auto_confirm
// ---------------------------------------------------------------------------

/// resolve albums by tag filter then run bulk auto-confirm for every
/// matched album.
pub(in crate::admin_dispatch) async fn bulk_auto_confirm(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let (tag_ids, _name_errors) = merge_tag_inputs(&args).await;
    let mode = parse_mode(args.get("mode"));
    let min_confidence = args
        .get("min_confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.85);
    let min_gap = args.get("min_gap").and_then(|v| v.as_f64()).unwrap_or(0.10);

    let resp = albums_repo::resolve_album_ids_by_tags(&tag_ids, mode).await;
    if !resp.success {
        return GrimoireResponse::failure(&resp.message, resp.errors);
    }
    let album_ids = resp.data.unwrap_or_default();

    let result =
        albums_repo::auto_confirm_mb_matches(&album_ids, min_confidence, min_gap, &caller.user_id)
            .await;
    to_value(result)
}

// ---------------------------------------------------------------------------
// music_enrichment_bulk_auto
// ---------------------------------------------------------------------------

/// resolve albums by tag filter, then for each matched album enqueue BOTH
/// an `AlbumEnrichmentPipeline` job AND an `AutoApplyAlbumEnrichment` job
/// with `auto_confirm_top_match = true`, all sharing one session.
pub(in crate::admin_dispatch) async fn bulk_auto(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let (tag_ids, _name_errors) = merge_tag_inputs(&args).await;
    let mode = parse_mode(args.get("mode"));
    let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let priority = args
        .get("priority")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let sources: Vec<EnrichmentSource> = args
        .get("sources")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let min_confidence = args
        .get("min_confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.85);
    let min_gap = args.get("min_gap").and_then(|v| v.as_f64()).unwrap_or(0.10);

    let resolved = albums_repo::resolve_album_ids_by_tags(&tag_ids, mode).await;
    if !resolved.success {
        return GrimoireResponse::failure(&resolved.message, resolved.errors);
    }
    let album_ids = resolved.data.unwrap_or_default();
    if album_ids.is_empty() {
        return GrimoireResponse::success(
            "no albums matched",
            json!({ "session_id": null, "count": 0, "message": "no albums matched" }),
        );
    }

    let count = album_ids.len();

    let effective_sources: Vec<EnrichmentSource> = if sources.is_empty() {
        vec![
            EnrichmentSource::Mb,
            EnrichmentSource::Lastfm,
            EnrichmentSource::Audiodb,
        ]
    } else {
        sources
    };

    // create one shared session for all pipeline + auto-apply jobs.
    let sess_resp = create_job_session(CreateJobSessionRequest {
        job_type: JobType::AlbumEnrichmentPipeline,
        batch_size: Some(album_ids.len()),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    let session = match sess_resp.data {
        Some(s) => s,
        None => return GrimoireResponse::failure("failed to create session", sess_resp.errors),
    };

    use crate::jobs::AlbumEnrichmentPipelineParams;

    let mut pipeline_enqueued: usize = 0;
    let mut auto_apply_enqueued: usize = 0;
    let mut skipped: usize = 0;

    for album_id in &album_ids {
        // pipeline job
        let pipeline_params = AlbumEnrichmentPipelineParams {
            album_id: album_id.clone(),
            sources: effective_sources.clone(),
            force,
        };
        let pipeline_params_value = match serde_json::to_value(&pipeline_params) {
            Ok(v) => v,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let pipeline_resp = create_job(CreateJobRequest {
            job_type: JobType::AlbumEnrichmentPipeline,
            session_id: Some(session.id.clone()),
            parameters: pipeline_params_value,
            max_retries: Some(0),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
            priority,
        })
        .await;
        if pipeline_resp.data.is_none() {
            skipped += 1;
            continue;
        }
        pipeline_enqueued += 1;

        // auto-apply job with auto-confirm enabled
        let auto_apply_params = AutoApplyAlbumEnrichmentParams {
            album_id: album_id.clone(),
            user_id: caller.user_id.clone(),
            username: Some(caller.username.clone()),
            attempts: 0,
            auto_confirm_top_match: true,
            min_confidence: Some(min_confidence),
            min_gap: Some(min_gap),
        };
        let auto_apply_params_value = match serde_json::to_value(&auto_apply_params) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let auto_apply_resp = create_job(CreateJobRequest {
            job_type: JobType::AutoApplyAlbumEnrichment,
            session_id: Some(session.id.clone()),
            parameters: auto_apply_params_value,
            max_retries: Some(0),
            scheduled_at: None,
            created_by: Some(caller.user_id.clone()),
            priority,
        })
        .await;
        if auto_apply_resp.data.is_some() {
            auto_apply_enqueued += 1;
        }
    }

    GrimoireResponse::success(
        "bulk auto enrichment enqueued",
        json!({
            "session_id": session.id,
            "count": count,
            "pipeline_jobs_enqueued": pipeline_enqueued,
            "auto_apply_jobs_enqueued": auto_apply_enqueued,
            "skipped": skipped,
        }),
    )
}
