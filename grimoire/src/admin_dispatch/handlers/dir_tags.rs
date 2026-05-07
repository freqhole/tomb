//! directory-tag rule handlers (list/add/remove/clear/strip).

use crate::admin_dispatch::helpers::{parse_tag_list, require_str, to_value};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list_rules() -> GrimoireResponse<JsonValue> {
    to_value(crate::jobs::list_directory_tag_rules().await)
}

pub(in crate::admin_dispatch) async fn list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::jobs::list_directory_tags(&path).await)
}

pub(in crate::admin_dispatch) async fn add(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let tags = match parse_tag_list(&args) {
        Ok(t) => t,
        Err(r) => return r,
    };
    to_value(crate::jobs::add_directory_tags(&path, tags, Some(caller.user_id.clone())).await)
}

pub(in crate::admin_dispatch) async fn remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let tags = match parse_tag_list(&args) {
        Ok(t) => t,
        Err(r) => return r,
    };
    to_value(crate::jobs::remove_directory_tags(&path, tags).await)
}

pub(in crate::admin_dispatch) async fn clear(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::jobs::clear_directory_tags(&path).await)
}

pub(in crate::admin_dispatch) async fn strip(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let tags = match parse_tag_list(&args) {
        Ok(t) => t,
        Err(r) => return r,
    };
    to_value(crate::jobs::strip_tags_from_directory(&path, tags).await)
}
