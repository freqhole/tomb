//! library / scan handlers (validate_path, scan, scan_status, image_upload,
//! list/remove directories, rescan_all).

use crate::admin_dispatch::helpers::{opt_bool, opt_str, require_str, to_value};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

pub(in crate::admin_dispatch) async fn validate_path(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let raw_path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let path = expand_tilde(raw_path.trim());
    let p = std::path::Path::new(&path);
    let (exists, is_dir, is_readable) = match std::fs::metadata(p) {
        Ok(m) => {
            let dir = m.is_dir();
            // crude readable probe: if dir, try read_dir; else open file
            let readable = if dir {
                std::fs::read_dir(p).is_ok()
            } else {
                std::fs::File::open(p).is_ok()
            };
            (true, dir, readable)
        }
        Err(_) => (false, false, false),
    };
    GrimoireResponse::success(
        "path validated",
        json!({
            "path": path,
            "exists": exists,
            "is_dir": is_dir,
            "is_readable": is_readable,
        }),
    )
}

pub(in crate::admin_dispatch) async fn scan(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let raw_path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let path = expand_tilde(raw_path.trim());
    let scan_path = std::path::Path::new(&path);
    if !scan_path.exists() {
        return GrimoireResponse::failure(
            format!("scan path does not exist: {path}"),
            vec![crate::ErrorDetail::new(
                "path_not_found",
                "scan path not found",
                format!("path does not exist: {path}"),
            )],
        );
    }
    if !scan_path.is_dir() {
        return GrimoireResponse::failure(
            format!("scan path is not a directory: {path}"),
            vec![crate::ErrorDetail::new(
                "invalid_scan_path",
                "invalid scan path",
                format!("path is not a directory: {path}"),
            )],
        );
    }
    let recursive = opt_bool(&args, "recursive").unwrap_or(true);

    // optional tag list to apply to the directory
    let tags: Vec<String> = match args.get("tags") {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Some(serde_json::Value::String(csv)) => csv
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    };

    // session id can be supplied; otherwise create a fresh job session so
    // the scan inherits a real session row (foreign-key requirement).
    let session_id = match opt_str(&args, "session_id") {
        Some(s) => s,
        None => {
            let req = crate::jobs::CreateJobSessionRequest {
                job_type: crate::jobs::JobType::ProcessFile,
                batch_size: None,
                created_by: Some("admin-dispatch-scan".to_string()),
            };
            let sess = crate::jobs::create_job_session(req).await;
            match sess.data {
                Some(s) => s.id,
                None => {
                    return GrimoireResponse::failure("failed to create scan session", sess.errors);
                }
            }
        }
    };

    if !tags.is_empty() {
        let _ = crate::jobs::add_directory_tags(
            &path,
            tags.clone(),
            Some("admin-dispatch-scan".to_string()),
        )
        .await;
    }

    let resp = crate::music::scan_directory(&path, &session_id, recursive, None, None, false).await;

    let count = resp.data.unwrap_or(0);
    if count > 0 {
        let _ = crate::jobs::record_scanned_directory(&path, count as i64, None).await;
        // emit an immediate progress event so rathole's header badge
        // appears as soon as jobs are enqueued (before first file
        // finishes processing).
        crate::events::emit(crate::events::GrimoireEvent::JobProgress {
            session_id: session_id.clone(),
            directory: path.clone(),
            songs_added: 0,
            jobs_pending: count as u32,
            jobs_total: count as u32,
        });
    }

    if resp.success {
        GrimoireResponse::success(
            format!("created {} import jobs", count),
            json!({
                "session_id": session_id,
                "files_discovered": count,
                "jobs_created": count,
                "success": true,
                "message": format!("created {} import jobs", count),
            }),
        )
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

pub(in crate::admin_dispatch) async fn scan_status(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let session_id = match require_str(&args, "session_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(crate::jobs::get_session_job_counts(&session_id).await)
}

pub(in crate::admin_dispatch) async fn image_upload(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    // delegate to existing upload handler. body shape mirrors UploadImageRequest:
    // { filename?, mime?, data: base64, associate_with?, wait_for_completion? }
    crate::offal::upload::upload_image(caller, args).await
}

/// list every directory ever scanned, with the tags applied via
/// directory tag rules. shape mirrors the legacy `list_scanned_directories`
/// tauri command so the UI can use one shape for both targets.
pub(in crate::admin_dispatch) async fn list_directories() -> GrimoireResponse<JsonValue> {
    let list = crate::jobs::list_scanned_directories().await;
    let dirs = match list.data {
        Some(d) => d,
        None => return GrimoireResponse::failure("failed to list directories", list.errors),
    };
    let mut out = Vec::with_capacity(dirs.len());
    for d in dirs {
        let tags_resp = crate::jobs::list_directory_tags(&d.path).await;
        let tags: Vec<String> = tags_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| r.tag_name)
            .collect();
        out.push(json!({
            "id": d.id,
            "path": d.path,
            "file_count": d.file_count,
            "last_scanned_at": d.last_scanned_at,
            "tags": tags,
        }));
    }
    GrimoireResponse::success(
        format!("found {} directories", out.len()),
        JsonValue::Array(out),
    )
}

/// stop tracking a previously-scanned directory.
pub(in crate::admin_dispatch) async fn remove_directory(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = crate::jobs::remove_scanned_directory(&path).await;
    if resp.success {
        GrimoireResponse::success("directory removed", JsonValue::Null)
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

/// kick off a `RescanDirectories` background job. mirrors the legacy
/// `rescan_directories` tauri command shape (`{ success, jobs_created,
/// message }`); `jobs_created` is always 1 here (the rescan job itself)
/// since the per-directory work happens inside the job.
pub(in crate::admin_dispatch) async fn rescan_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let req = crate::jobs::CreateJobRequest {
        job_type: crate::jobs::JobType::RescanDirectories,
        session_id: None,
        parameters: json!({}),
        max_retries: Some(0),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority: None,
    };
    let resp = crate::jobs::create_job(req).await;
    if resp.success {
        GrimoireResponse::success(
            "rescan started",
            json!({
                "success": true,
                "jobs_created": 1,
                "message": "rescan job created",
            }),
        )
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

/// kick off a `FetchMedia` background job for an external url.
/// shape mirrors `rescan_all`'s `{ success, jobs_created, message }`
/// so the result-panel renderer can show the same style row.
pub(in crate::admin_dispatch) async fn fetch(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let url = match require_str(&args, "url") {
        Ok(v) => v,
        Err(r) => return r,
    };
    if url.is_empty() {
        return GrimoireResponse::failure(
            "url required",
            vec![crate::ErrorDetail::new(
                "bad_request",
                "url required",
                "/fetch <url> requires a non-empty url",
            )],
        );
    }
    let params = crate::music::fetch::FetchMediaParams {
        url: url.clone(),
        user_id: Some(caller.user_id.clone()),
    };
    let parameters = match serde_json::to_value(&params) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to serialize fetch params",
                vec![crate::ErrorDetail::new(
                    "serialization_error",
                    "failed to serialize parameters",
                    &e.to_string(),
                )],
            );
        }
    };
    // create a job session so the runner emits JobProgress /
    // JobSessionComplete events for this fetch (the rathole top-bar
    // badge subscribes to them).
    let session_id = {
        let req = crate::jobs::CreateJobSessionRequest {
            job_type: crate::jobs::JobType::FetchMedia,
            batch_size: Some(1),
            created_by: Some(caller.user_id.clone()),
        };
        let sess = crate::jobs::create_job_session(req).await;
        match sess.data {
            Some(s) => Some(s.id),
            None => {
                return GrimoireResponse::failure("failed to create fetch session", sess.errors);
            }
        }
    };
    // seed the session.progress total = 1 so the runner's
    // `session_total` lookup picks it up after the row is deleted.
    if let Some(sid) = &session_id {
        let _ =
            crate::jobs::update_session_progress(sid, crate::jobs::JobProgress::new(0, 1), None)
                .await;
        // emit an immediate JobProgress so the rathole top-bar badge
        // appears the instant /fetch runs. without this, no event
        // fires until the (potentially minutes-long) FetchMedia row
        // completes, leaving the user with no visual feedback that
        // anything is happening. directory = url so subscribers
        // classify it as a fetch.
        crate::events::emit(crate::events::GrimoireEvent::JobProgress {
            session_id: sid.clone(),
            directory: url.clone(),
            songs_added: 0,
            jobs_pending: 1,
            jobs_total: 1,
        });
    }
    let req = crate::jobs::CreateJobRequest {
        job_type: crate::jobs::JobType::FetchMedia,
        session_id: session_id.clone(),
        parameters,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority: None,
    };
    let resp = crate::jobs::create_job(req).await;
    if resp.success {
        GrimoireResponse::success(
            format!("queued fetch for {url}"),
            json!({
                "success": true,
                "jobs_created": 1,
                "session_id": session_id,
                "url": url,
                "message": format!("queued fetch for {url}"),
            }),
        )
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}
