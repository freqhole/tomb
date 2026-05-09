//! genre handlers — list/get/create/delete and album-genre linkage.
//!
//! mirrors the dir_tags / library handler conventions: thin
//! decoders that delegate to grimoire repository functions and
//! re-wrap as `GrimoireResponse<JsonValue>` via `to_value`.

use crate::admin_dispatch::helpers::{require_str, to_value};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::entities::genres::list_genres().await)
}

pub(in crate::admin_dispatch) async fn list_with_stats() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::entities::genres::list_genres_with_stats().await)
}

pub(in crate::admin_dispatch) async fn stats() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::entities::genres::get_genre_stats().await)
}

pub(in crate::admin_dispatch) async fn get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::genres::get_genre(&id).await)
}

pub(in crate::admin_dispatch) async fn create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let req = crate::music::entities::genres::CreateGenreRequest { name };
    to_value(crate::music::entities::genres::create_genre(req).await)
}

pub(in crate::admin_dispatch) async fn delete(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::genres::delete_genre(&id, Some(caller.user_id.clone())).await,
    )
}

pub(in crate::admin_dispatch) async fn add_to_album(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let genre_id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::genres::add_genre_to_album(&album_id, &genre_id).await,
    )
}

pub(in crate::admin_dispatch) async fn remove_from_album(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let genre_id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::genres::remove_genre_from_album(&album_id, &genre_id).await,
    )
}

pub(in crate::admin_dispatch) async fn album_genres(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::genres::get_album_genre_ids(&album_id).await)
}

pub(in crate::admin_dispatch) async fn songs(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let genre_id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as u32);
    let offset = args.get("offset").and_then(|v| v.as_u64()).map(|n| n as u32);
    to_value(
        crate::music::crud::list_songs_by_genre(&genre_id, limit.or(Some(200)), offset.or(Some(0)))
            .await,
    )
}
