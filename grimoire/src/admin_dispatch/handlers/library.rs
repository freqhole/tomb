//! library / scan handlers (validate_path, scan, scan_status, image_upload,
//! list/remove directories, rescan_all).

use crate::admin_dispatch::helpers::{decode, opt_bool, opt_str, require_str, to_value};
use crate::external_storage::{
    availability,
    sources::{self, SourceSelection},
    sync_priority,
};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn list_sources() -> GrimoireResponse<JsonValue> {
    let result = async {
        let pool = crate::database::connect().await?;
        let targets = sync_priority::list_targets(&pool).await?;
        Ok(sources::list_sources(&pool)
            .await?
            .into_iter()
            .filter(|source| !sync_priority::is_sync_source(&targets, source))
            .collect::<Vec<_>>())
    }
    .await;
    source_response("library sources listed", result)
}

pub(in crate::admin_dispatch) async fn source_availability(
    refresh: bool,
) -> GrimoireResponse<JsonValue> {
    let result = async {
        let pool = crate::database::connect().await?;
        if refresh {
            availability::refresh_availability(&pool).await
        } else {
            availability::list_availability(&pool).await
        }
    }
    .await;
    source_response("source availability listed", result)
}

pub(in crate::admin_dispatch) async fn register_source(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let request: crate::admin_dispatch::types::library::LibraryRegisterSourceRequest =
        match decode(args) {
            Ok(selection) => selection,
            Err(error) => return error,
        };
    let selection = SourceSelection {
        device_path: request.device_path,
        mount_path: request.mount_path,
        relative_path: request.relative_path,
        domain: request.domain,
    };
    let result = async {
        let pool = crate::database::connect().await?;
        let source = sources::register_source_with_renditions(
            &pool,
            &selection,
            request.generate_renditions,
        )
        .await?;
        Ok(source)
    }
    .await;
    source_response(
        "library source registered; scan now or wait for the source monitor",
        result,
    )
}

pub(in crate::admin_dispatch) async fn manage_sources(
    command: &str,
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    use crate::external_storage::management;
    let result: crate::GrimoireResult<JsonValue> = async {
        let pool = crate::database::connect().await?;
        Ok(match command {
            "library_source_summaries" => {
                serde_json::to_value(management::summaries(&pool).await?)?
            }
            "library_active_scans" => serde_json::to_value(management::active_scans(&pool).await?)?,
            "library_rendition_settings" => serde_json::to_value(management::rendition_settings())?,
            "library_remove_source" => {
                let request: crate::admin_dispatch::types::library::LibrarySourceByIdRequest =
                    serde_json::from_value(args)?;
                management::remove_source(&pool, &request.id).await?;
                json!(true)
            }
            _ => unreachable!("source management command is dispatched explicitly"),
        })
    }
    .await;
    source_response("library source operation complete", result)
}

pub(in crate::admin_dispatch) async fn browse_volume(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let selection: SourceSelection = match decode(args) {
        Ok(selection) => selection,
        Err(error) => return error,
    };
    source_response(
        "volume folders listed",
        sources::browse_folders(&selection).await,
    )
}

fn source_response<T: serde::Serialize>(
    message: &str,
    result: crate::GrimoireResult<T>,
) -> GrimoireResponse<JsonValue> {
    match result {
        Ok(value) => to_value(GrimoireResponse::success(message, value)),
        Err(error) => {
            tracing::warn!("library source operation failed: {error}");
            GrimoireResponse::failure(
                "library source operation failed",
                vec![crate::ErrorDetail::from(&error)],
            )
        }
    }
}

pub(in crate::admin_dispatch) async fn scan_source(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let _guard = sources::lock_source_operations().await;
    let request: crate::admin_dispatch::types::library::LibrarySourceByIdRequest =
        match decode(args) {
            Ok(request) => request,
            Err(error) => return error,
        };
    let result = async {
        let pool = crate::database::connect().await?;
        let source = sources::get_source(&pool, &request.id).await?;
        if sync_priority::is_sync_source(&sync_priority::list_targets(&pool).await?, &source) {
            return Err(crate::GrimoireError::Validation {
                field: "id".into(),
                message: "source is reserved for removable storage sync".into(),
            });
        }
        Ok(source)
    }
    .await;
    match result {
        Ok(source) => {
            scan_inner(
                json!({
                    "path": source.last_known_path, "domain": source.domain, "recursive": true,
                }),
                caller,
            )
            .await
        }
        Err(error) => source_response::<()>("source loaded", Err(error)),
    }
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

pub(in crate::admin_dispatch) async fn list_removable_volumes() -> GrimoireResponse<JsonValue> {
    let result: std::io::Result<_> = async {
        let volumes = crate::external_storage::inventory::list_removable_volumes().await?;
        let pool = crate::database::connect()
            .await
            .map_err(std::io::Error::other)?;
        let targets = sync_priority::list_targets(&pool)
            .await
            .map_err(std::io::Error::other)?;
        Ok(volumes
            .into_iter()
            .filter(|volume| !sync_priority::is_sync_volume(&targets, volume))
            .collect::<Vec<_>>())
    }
    .await;
    match result {
        Ok(volumes) => to_value(GrimoireResponse::success(
            "removable volumes listed",
            volumes,
        )),
        Err(error) => {
            tracing::warn!("removable volume inventory failed: {error}");
            let error_type = if error.kind() == std::io::ErrorKind::Unsupported {
                "storage_inventory_unsupported"
            } else {
                "storage_inventory_failed"
            };
            GrimoireResponse::failure(
                "could not list removable volumes",
                vec![crate::ErrorDetail::new(
                    error_type,
                    "removable volume inventory failed",
                    error.to_string(),
                )],
            )
        }
    }
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

pub(in crate::admin_dispatch) async fn scan(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let _guard = sources::lock_source_operations().await;
    scan_inner(args, caller).await
}

async fn scan_inner(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

    // which media pipeline to scan for - defaults to music so existing
    // callers that don't pass `domain` yet keep today's behavior. `"both"`
    // is a distinct explicit choice (`None` here, not `MediaDomain::Music`)
    // that scans for both in one pass below.
    let domain: Option<crate::MediaDomain> = match opt_str(&args, "domain").as_deref() {
        Some("both") => None,
        Some(s) => match s.parse() {
            Ok(d) => Some(d),
            Err(e) => {
                return GrimoireResponse::failure(
                    format!("invalid domain: {e}"),
                    vec![crate::ErrorDetail::new(
                        "invalid_domain",
                        "invalid domain",
                        e,
                    )],
                )
            }
        },
        None => Some(crate::MediaDomain::Music),
    };

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
                created_by: Some(caller.user_id.clone()),
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
        let _ = crate::jobs::add_directory_tags(&path, tags.clone(), Some(caller.user_id.clone()))
            .await;
    }

    let resp = match domain {
        Some(crate::MediaDomain::Music) => {
            crate::music::scan_directory(&path, &session_id, recursive, None, None, false).await
        }
        Some(crate::MediaDomain::Video) => {
            crate::video::scan_directory(&path, &session_id, recursive, None, None, false).await
        }
        None => {
            // "both": one pass per domain, same session - merge the two
            // outcomes into one response rather than exposing the fact
            // that this ran as two scanner calls under the hood.
            let music_resp =
                crate::music::scan_directory(&path, &session_id, recursive, None, None, false)
                    .await;
            let video_resp =
                crate::video::scan_directory(&path, &session_id, recursive, None, None, false)
                    .await;
            match (music_resp.data, video_resp.data) {
                (Some(m), Some(v)) => {
                    let merged = crate::music::scanner::DirectoryScanOutcome {
                        file_count: m.file_count + v.file_count,
                        files_queued: m.files_queued + v.files_queued,
                        files_skipped: m.files_skipped + v.files_skipped,
                        jobs_created: m.jobs_created + v.jobs_created,
                    };
                    GrimoireResponse::success(
                        format!(
                            "scanned directory: {} file(s) found, {} queued for import, {} unchanged or intentionally deleted, {} job(s) created",
                            merged.file_count, merged.files_queued, merged.files_skipped, merged.jobs_created
                        ),
                        merged,
                    )
                }
                _ => GrimoireResponse::failure(
                    format!(
                        "both-domain scan partially failed: music={}, video={}",
                        music_resp.message, video_resp.message
                    ),
                    music_resp
                        .errors
                        .into_iter()
                        .chain(video_resp.errors)
                        .collect(),
                ),
            }
        }
    };

    let outcome = resp.data.unwrap_or_default();
    if outcome.file_count > 0 {
        let _ = crate::jobs::record_scanned_directory(&path, outcome.file_count as i64, None).await;
    }
    if outcome.jobs_created > 0 {
        // emit an immediate progress event so rathole's header badge
        // appears as soon as jobs are enqueued (before first file
        // finishes processing). only emit when jobs actually exist -
        // otherwise the badge would show pending work that will never
        // complete (every file already imported and unchanged).
        crate::jobs::job_events::emit(crate::jobs::job_events::JobEvent::Progress {
            session_id: session_id.clone(),
            complete: 0,
            total: outcome.jobs_created as i64,
            topic: crate::jobs::JobType::ScanDirectory,
            entity_ref: None,
            created_by: Some(caller.user_id.clone()),
            details: Some(serde_json::json!({
                "directory": path.clone(),
                "songs_added": 0,
                "jobs_pending": outcome.jobs_created as u32,
                "jobs_total": outcome.jobs_created as u32,
            })),
        });
    }

    if resp.success {
        let message = if outcome.jobs_created == 0 && outcome.files_skipped > 0 {
            format!(
                "nothing new to import: {} file(s) unchanged or intentionally deleted",
                outcome.files_skipped
            )
        } else {
            format!("created {} import job(s)", outcome.jobs_created)
        };
        to_value(GrimoireResponse::success(
            message.clone(),
            crate::admin_dispatch::types::library::LibraryScanResponse {
                session_id,
                files_discovered: outcome.file_count as u64,
                jobs_created: outcome.jobs_created as u64,
                success: true,
                message,
            },
        ))
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

/// edit / relocate a previously-scanned directory. used when the user moves
/// their music library on disk; relocates matched blobs (filename+size cheap
/// matching) instead of re-hashing every file. see
/// `crate::music::scanner::move_scanned_directory` for matching tiers + behavior.
///
/// args: { old_path: string, new_path: string, dry_run?: bool,
///         soft_delete_unmatched?: bool, refresh_blobs_store?: bool }
pub(in crate::admin_dispatch) async fn move_directory(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let old_path = match require_str(&args, "old_path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let new_path = match require_str(&args, "new_path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let mut opts = crate::music::scanner::MoveScanDirectoryOptions::default();
    if let Some(v) = opt_bool(&args, "dry_run") {
        opts.dry_run = v;
    }
    if let Some(v) = opt_bool(&args, "soft_delete_unmatched") {
        opts.soft_delete_unmatched = v;
    }
    if let Some(v) = opt_bool(&args, "refresh_blobs_store") {
        opts.refresh_blobs_store = v;
    }
    opts.updated_by = Some(caller.user_id.clone());

    let resp = crate::music::scanner::move_scanned_directory(&old_path, &new_path, opts).await;
    to_value(resp)
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

/// one-shot library repair: purge `scanned_directories` rows whose path no
/// longer exists on disk, then undelete any soft-deleted blobs (cascading to
/// songs) whose `local_path` exists. use when a library got incorrectly
/// soft-deleted by a prior rescan / move-dir iteration.
pub(in crate::admin_dispatch) async fn repair_orphans() -> GrimoireResponse<JsonValue> {
    crate::jobs::repair_library_orphans().await
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
        domain: crate::media_domain::MediaDomain::Music,
    };
    let parameters = match serde_json::to_value(&params) {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to serialize fetch params",
                vec![crate::ErrorDetail::new(
                    "serialization_error",
                    "failed to serialize parameters",
                    e.to_string(),
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
        // emit an immediate Progress so the rathole top-bar badge
        // appears the instant /fetch runs. without this, no event
        // fires until the (potentially minutes-long) FetchMedia row
        // completes, leaving the user with no visual feedback that
        // anything is happening. directory = url so subscribers
        // classify it as a fetch.
        crate::jobs::job_events::emit(crate::jobs::job_events::JobEvent::Progress {
            session_id: sid.clone(),
            complete: 0,
            total: 1,
            topic: crate::jobs::JobType::FetchMedia,
            entity_ref: None,
            created_by: Some(caller.user_id.clone()),
            details: Some(serde_json::json!({
                "directory": url.clone(),
                "songs_added": 0,
                "jobs_pending": 1,
                "jobs_total": 1,
            })),
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

#[cfg(test)]
mod removable_inventory_tests {
    use crate::{admin_dispatch, offal::Caller, users::UserRole};
    use serde_json::json;

    #[tokio::test]
    async fn removable_volume_inventory_requires_admin() {
        let caller = Caller::new("test", "member", UserRole::Member);
        for command in [
            "library_list_removable_volumes",
            "library_list_sources",
            "library_source_availability",
            "library_refresh_source_availability",
            "library_register_source",
            "library_browse_volume",
            "library_scan_source",
        ] {
            let response = admin_dispatch::handle(command, json!({}), &caller).await;
            assert!(!response.success);
            assert!(response.data.is_none());
            assert_eq!(response.errors[0].error_type, "forbidden");
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    #[tokio::test]
    async fn unsupported_inventory_has_a_structured_error() {
        let caller = Caller::new("test", "admin", UserRole::Admin);
        let response =
            admin_dispatch::handle("library_list_removable_volumes", json!({}), &caller).await;
        assert!(!response.success);
        assert!(response.data.is_none());
        assert_eq!(
            response.errors[0].error_type,
            "storage_inventory_unsupported"
        );
    }
}
