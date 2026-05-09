//! album-tag handlers — list/get/create/delete and album-tag linkage.
//!
//! distinct from `dir_tags` (which manages directory-tag rules used
//! by the scanner). these manage the `tagz` + `album_tagz` tables
//! directly, like the existing `tags::*` library RPCs.

use crate::admin_dispatch::helpers::{require_str, to_value};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::entities::tags::list_tags().await)
}

pub(in crate::admin_dispatch) async fn query(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let search = args
        .get("search")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    to_value(crate::music::entities::tags::query_tags(&search).await)
}

pub(in crate::admin_dispatch) async fn get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "tag_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::tags::get_tag(&id).await)
}

pub(in crate::admin_dispatch) async fn create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let req = crate::music::entities::tags::CreateTagRequest { name };
    to_value(crate::music::entities::tags::create_tag(req).await)
}

pub(in crate::admin_dispatch) async fn delete(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "tag_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::tags::delete_tag(&id, Some(caller.user_id.clone())).await)
}

pub(in crate::admin_dispatch) async fn album_tags(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::tags::get_albums_tags(vec![album_id]).await)
}

pub(in crate::admin_dispatch) async fn add_to_album(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    // accept either a tag_id (existing) or a tag_name (find-or-create
    // semantics). bare-keyword tag names are the more common slash
    // path so allow both.
    let tag_ids: Vec<String> = args
        .get("tag_id")
        .and_then(|v| v.as_str())
        .map(|s| vec![s.to_string()])
        .unwrap_or_default();
    let tag_names: Vec<String> = args
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|s| vec![s.to_string()])
        .unwrap_or_default();
    if tag_ids.is_empty() && tag_names.is_empty() {
        return crate::response::GrimoireResponse::failure(
            "tag_id or tag_name required",
            vec![crate::ErrorDetail::new(
                "bad_request",
                "missing tag",
                "provide either tag_id or tag_name",
            )],
        );
    }
    let req = crate::music::entities::tags::AddAlbumsTagsRequest {
        album_ids: vec![album_id],
        tag_ids,
        tag_names,
    };
    to_value(crate::music::entities::tags::add_albums_tags(req).await)
}

pub(in crate::admin_dispatch) async fn remove_from_album(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let tag_id = match require_str(&args, "tag_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::tags::remove_albums_tags(vec![album_id], vec![tag_id]).await,
    )
}
