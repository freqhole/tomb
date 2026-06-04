//! genre admin handlers — kept as an admin/slash facade for the
//! rathole `/genre` command surface; under the hood every operation
//! now flows through the unified taxonomy api (`taxonz` table, kind =
//! "genre"). there is no separate genre table anymore.

use crate::admin_dispatch::helpers::{require_str, to_value};
use crate::music::entities::taxonomy::{
    AddAlbumTaxonRequest, GetTaxonRequest, QueryTaxonsRequest, RemoveAlbumTaxonRequest,
};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

const GENRE_KIND: &str = "genre";

pub(in crate::admin_dispatch) async fn list() -> GrimoireResponse<JsonValue> {
    to_value(crate::music::entities::taxonomy::list_taxons_by_kind(GENRE_KIND).await)
}

pub(in crate::admin_dispatch) async fn list_with_stats() -> GrimoireResponse<JsonValue> {
    to_value(
        crate::music::entities::taxonomy::query_taxons(QueryTaxonsRequest {
            kind_slug: Some(GENRE_KIND.to_string()),
            q: None,
            limit: Some(500),
            offset: Some(0),
        })
        .await,
    )
}

pub(in crate::admin_dispatch) async fn stats() -> GrimoireResponse<JsonValue> {
    to_value(
        crate::music::entities::taxonomy::query_taxons(QueryTaxonsRequest {
            kind_slug: Some(GENRE_KIND.to_string()),
            q: None,
            limit: Some(500),
            offset: Some(0),
        })
        .await,
    )
}

pub(in crate::admin_dispatch) async fn get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::taxonomy::get_taxon(GetTaxonRequest { id }).await)
}

pub(in crate::admin_dispatch) async fn create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(crate::music::entities::taxonomy::find_or_create_taxon(GENRE_KIND, &name).await)
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
        crate::music::entities::taxonomy::delete_taxon(&id, Some(caller.user_id.clone())).await,
    )
}

pub(in crate::admin_dispatch) async fn add_to_album(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let taxon_id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::taxonomy::add_album_taxon(AddAlbumTaxonRequest {
            album_id,
            taxon_id,
            origin: "user".to_string(),
            confidence: None,
        })
        .await,
    )
}

pub(in crate::admin_dispatch) async fn remove_from_album(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let taxon_id = match require_str(&args, "genre_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    to_value(
        crate::music::entities::taxonomy::remove_album_taxon(RemoveAlbumTaxonRequest {
            album_id,
            taxon_id,
            origin: None,
        })
        .await,
    )
}

pub(in crate::admin_dispatch) async fn album_genres(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let album_id = match require_str(&args, "album_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let resp = crate::music::entities::taxonomy::get_album_taxon_links(&album_id).await;
    let Some(links) = resp.data else {
        return to_value::<Vec<String>>(GrimoireResponse::failure(&resp.message, resp.errors));
    };
    let ids: Vec<String> = links
        .into_iter()
        .filter(|l| l.kind_slug == GENRE_KIND)
        .map(|l| l.taxon_id)
        .collect();
    to_value(GrimoireResponse::success("album genres retrieved", ids))
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
