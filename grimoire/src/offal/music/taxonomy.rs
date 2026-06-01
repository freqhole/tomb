//! taxonomy API handlers
//!
//! exposes the cross-kind taxonomy (genre / mood / instrument / era / key /
//! location / label / scalar attrs) over the offal dispatch system.
//! reads are open to authenticated users; writes require admin.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::entities::taxonomy::{
    add_album_taxon as r_add_album_taxon, add_taxon_parent as r_add_taxon_parent,
    create_taxon as r_create_taxon, create_taxon_kind as r_create_taxon_kind,
    get_album_taxon_links as r_get_album_taxon_links, get_taxon as r_get_taxon,
    get_taxon_ancestors as r_get_taxon_ancestors, get_taxon_descendants as r_get_taxon_descendants,
    list_taxon_kinds as r_list_taxon_kinds,
    list_taxon_parents_for_kind as r_list_taxon_parents_for_kind,
    list_taxons_by_kind as r_list_taxons_by_kind,
    query_albums_by_scalar_range as r_query_albums_by_scalar_range, query_taxons as r_query_taxons,
    remove_album_taxon as r_remove_album_taxon, remove_taxon_parent as r_remove_taxon_parent,
    set_album_taxons as r_set_album_taxons, set_scalar_attribute as r_set_scalar_attribute,
    set_taxon_color as r_set_taxon_color, AddAlbumTaxonRequest, AddTaxonParentRequest,
    CreateTaxonKindRequest, CreateTaxonRequest, GetAlbumTaxonLinksRequest, GetTaxonRequest,
    ListTaxonParentsForKindRequest, ListTaxonsByKindRequest, QueryScalarRangeRequest,
    QueryTaxonsRequest, RemoveAlbumTaxonRequest, RemoveTaxonParentRequest, SetAlbumTaxonsRequest,
    SetScalarAttributeRequest, SetTaxonColorRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for taxonomy
pub const ROUTES: &[RouteInfo] = &[
    // ---- kinds ----
    RouteInfo {
        name: "list_taxon_kinds",
        path: "/api/taxonomy/kinds/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<TaxonKind>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "create_taxon_kind",
        path: "/api/taxonomy/kinds/create",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateTaxonKindRequest",
        response_type: "TaxonKind",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    // ---- taxons ----
    RouteInfo {
        name: "list_taxons_by_kind",
        path: "/api/taxonomy/taxons/list-by-kind",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListTaxonsByKindRequest",
        response_type: "Vec<Taxon>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "query_taxons",
        path: "/api/taxonomy/taxons/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryTaxonsRequest",
        response_type: "TaxonsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_taxon",
        path: "/api/taxonomy/taxons/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetTaxonRequest",
        response_type: "Taxon",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "create_taxon",
        path: "/api/taxonomy/taxons/create",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateTaxonRequest",
        response_type: "Taxon",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "set_taxon_color",
        path: "/api/taxonomy/taxons/set-color",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetTaxonColorRequest",
        response_type: "Taxon",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    // ---- parents (DAG edges) ----
    RouteInfo {
        name: "add_taxon_parent",
        path: "/api/taxonomy/parents/add",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddTaxonParentRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_taxon_parent",
        path: "/api/taxonomy/parents/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveTaxonParentRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "list_taxon_parents_for_kind",
        path: "/api/taxonomy/parents/list-by-kind",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListTaxonParentsForKindRequest",
        response_type: "Vec<TaxonParentEdge>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_taxon_ancestors",
        path: "/api/taxonomy/taxons/ancestors",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetTaxonRequest",
        response_type: "Vec<TaxonRef>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_taxon_descendants",
        path: "/api/taxonomy/taxons/descendants",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetTaxonRequest",
        response_type: "Vec<TaxonRef>",
        auth: RouteAuth::Authenticated,
    },
    // ---- album_taxonz junction ----
    RouteInfo {
        name: "get_album_taxon_links",
        path: "/api/taxonomy/album-links/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumTaxonLinksRequest",
        response_type: "Vec<AlbumTaxonLink>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_album_taxon",
        path: "/api/taxonomy/album-links/add",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddAlbumTaxonRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_album_taxon",
        path: "/api/taxonomy/album-links/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveAlbumTaxonRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "set_album_taxons",
        path: "/api/taxonomy/album-links/set",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetAlbumTaxonsRequest",
        response_type: "Vec<AlbumTaxonLink>",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    // ---- scalar attributes ----
    RouteInfo {
        name: "set_scalar_attribute",
        path: "/api/taxonomy/scalars/set",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetScalarAttributeRequest",
        response_type: "ScalarAttribute",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "query_albums_by_scalar_range",
        path: "/api/taxonomy/scalars/query-range",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryScalarRangeRequest",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
];

// ---- request shapes that don't have first-class models ----

// (none currently — all request shapes live in `taxonomy::models`)

// ---- helpers ----

fn bad_req(e: impl std::fmt::Display) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "bad request",
        vec![ErrorDetail::new(
            "bad_request",
            "bad request",
            &e.to_string(),
        )],
    )
}

fn to_json<T: serde::Serialize>(resp: GrimoireResponse<T>) -> GrimoireResponse<JsonValue> {
    resp.map(|data| serde_json::to_value(data).unwrap())
}

// ---- handlers ----

pub async fn list_kinds(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    to_json(r_list_taxon_kinds().await)
}

pub async fn create_kind(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateTaxonKindRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_create_taxon_kind(req).await)
}

pub async fn list_taxons_by_kind(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListTaxonsByKindRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_list_taxons_by_kind(&req.kind_slug).await)
}

pub async fn query_taxons(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: QueryTaxonsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_query_taxons(req).await)
}

pub async fn get_taxon(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_get_taxon(req).await)
}

pub async fn create_taxon(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_create_taxon(req).await)
}

pub async fn add_parent(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AddTaxonParentRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_add_taxon_parent(req).await)
}

pub async fn remove_parent(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemoveTaxonParentRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_remove_taxon_parent(req).await)
}

pub async fn ancestors(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_get_taxon_ancestors(&req.id).await)
}

pub async fn descendants(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_get_taxon_descendants(&req.id).await)
}

pub async fn get_album_links(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumTaxonLinksRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_get_album_taxon_links(&req.album_id).await)
}

pub async fn add_album_link(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AddAlbumTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_add_album_taxon(req).await)
}

pub async fn remove_album_link(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemoveAlbumTaxonRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_remove_album_taxon(req).await)
}

pub async fn set_album_links(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SetAlbumTaxonsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_set_album_taxons(req).await)
}

pub async fn set_scalar(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SetScalarAttributeRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_set_scalar_attribute(req).await)
}

pub async fn query_scalar_range(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: QueryScalarRangeRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_query_albums_by_scalar_range(req).await)
}

pub async fn set_color(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SetTaxonColorRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_set_taxon_color(req).await)
}

pub async fn list_parents_for_kind(
    _caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: ListTaxonParentsForKindRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => return bad_req(e),
    };
    to_json(r_list_taxon_parents_for_kind(req).await)
}
