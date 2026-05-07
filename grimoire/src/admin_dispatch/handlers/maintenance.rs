//! maintenance handlers (cleanup, backfill, server image, spume update).

use crate::admin_dispatch::helpers::{
    bad_request, internal, opt_bool, resolve_config_path, to_value,
};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn cleanup_orphaned_tags(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    to_value(crate::maintenance::cleanup_orphaned_tags(dry_run).await)
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_genres(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    to_value(crate::maintenance::cleanup_orphaned_genres(dry_run).await)
}

pub(in crate::admin_dispatch) async fn cleanup_all(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let tags = crate::maintenance::cleanup_orphaned_tags(dry_run).await;
    if !tags.success {
        return to_value(tags);
    }
    let genres = crate::maintenance::cleanup_orphaned_genres(dry_run).await;
    if !genres.success {
        return to_value(genres);
    }
    let tags_data = tags
        .data
        .unwrap_or(crate::maintenance::OrphanedTagsSummary {
            tags_found: 0,
            tags_deleted: 0,
            tag_names: vec![],
        });
    let genres_data = genres
        .data
        .unwrap_or(crate::maintenance::OrphanedGenresSummary {
            genres_found: 0,
            genres_deleted: 0,
            genre_names: vec![],
        });
    let total_found = tags_data.tags_found + genres_data.genres_found;
    let total_deleted = tags_data.tags_deleted + genres_data.genres_deleted;
    let payload = json!({
        "tags": tags_data,
        "genres": genres_data,
        "total_found": total_found,
        "total_deleted": total_deleted,
        "dry_run": dry_run,
    });
    let msg = if dry_run {
        format!("found {} orphaned records (dry run)", total_found)
    } else {
        format!(
            "deleted {} of {} orphaned records",
            total_deleted, total_found
        )
    };
    GrimoireResponse::success(&msg, payload)
}

pub(in crate::admin_dispatch) async fn backfill_thumbnails_count() -> GrimoireResponse<JsonValue> {
    to_value(crate::blob_data::count_blobs_needing_thumbnails().await)
}

pub(in crate::admin_dispatch) async fn backfill_thumbnails(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    if dry_run {
        let count_resp = crate::blob_data::count_blobs_needing_thumbnails().await;
        if !count_resp.success {
            return to_value(count_resp);
        }
        let total = count_resp.data.unwrap_or(0);
        let to_process = limit.map(|l| l.min(total)).unwrap_or(total);
        let payload = json!({
            "dry_run": true,
            "blobs_needing_thumbnails": total,
            "will_process": to_process,
            "limit": limit,
        });
        return GrimoireResponse::success(
            &format!(
                "would process {} blobs (of {} needing thumbnails)",
                to_process, total
            ),
            payload,
        );
    }
    to_value(crate::blob_data::backfill_thumbnails(limit, Some(caller.user_id.clone())).await)
}

pub(in crate::admin_dispatch) async fn update_server_image() -> GrimoireResponse<JsonValue> {
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return bad_request(format!("config not found: {e}")),
    };
    match crate::config::ensure_server_image_blob(&path).await {
        Ok(blob_id) => GrimoireResponse::success(
            &format!("server image blob created: {blob_id}"),
            json!({
                "blob_id": blob_id,
                "config_path": path.display().to_string(),
            }),
        ),
        Err(e) => internal(format!("failed to update server image: {e}")),
    }
}

pub(in crate::admin_dispatch) async fn update_spume() -> GrimoireResponse<JsonValue> {
    if !crate::setup::has_embedded_spume() {
        return bad_request("this build does not include embedded spume web client");
    }
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return bad_request(format!("config not found: {e}")),
    };
    let cfg = match crate::config::GrimoireConfig::load(&path) {
        Ok(c) => c,
        Err(e) => return internal(format!("failed to load config: {e}")),
    };
    let server = match &cfg.server {
        Some(s) => s,
        None => return bad_request("config has no [server] section"),
    };
    if !server.static_files.enabled {
        return bad_request("server.static_files.enabled = false");
    }
    let spume_dir = match &server.static_files.directory {
        Some(d) => d.clone(),
        None => return bad_request("server.static_files.directory not set"),
    };
    if !spume_dir.exists() {
        return bad_request(format!("directory {} does not exist", spume_dir.display()));
    }
    match crate::setup::update_spume_to(&spume_dir) {
        Ok(result) => GrimoireResponse::success(
            "spume assets updated",
            json!({
                "directory": spume_dir.display().to_string(),
                "result": format!("{:?}", result),
            }),
        ),
        Err(e) => internal(format!("update_spume failed: {e:?}")),
    }
}
