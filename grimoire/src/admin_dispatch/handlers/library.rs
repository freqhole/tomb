//! library / scan handlers (validate_path, scan, scan_status, image_upload,
//! list/remove directories, rescan_all).

use crate::admin_dispatch::helpers::{opt_bool, opt_str, require_str, to_value};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn validate_path(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
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
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let recursive = opt_bool(&args, "recursive").unwrap_or(true);

    // optional tag list to apply to the directory
    let tags: Vec<String> = args
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

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
