//! api registry - route metadata for codegen and server routing
//!
//! this module defines the route registration types used by both
//! the server (to register routes) and the codegen tool (to generate
//! typescript clients).

use inventory;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PUT => "PUT",
            Method::DELETE => "DELETE",
            Method::PATCH => "PATCH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    App,
    Auth,
    Music,
}

impl Domain {
    pub fn as_str(&self) -> &'static str {
        match self {
            Domain::App => "app",
            Domain::Auth => "auth",
            Domain::Music => "music",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RouteInfo {
    pub name: &'static str,
    pub path: &'static str,
    pub method: Method,
    pub domain: Domain,
    pub request_type: &'static str,
    pub response_type: &'static str,
}

inventory::collect!(RouteInfo);

pub fn all_routes() -> Vec<RouteInfo> {
    inventory::iter::<RouteInfo>
        .into_iter()
        .map(|r| r.clone())
        .collect()
}

pub fn all_routes_map(
) -> std::collections::HashMap<&'static str, std::collections::HashMap<&'static str, RouteInfo>> {
    let mut map: std::collections::HashMap<
        &'static str,
        std::collections::HashMap<&'static str, RouteInfo>,
    > = std::collections::HashMap::new();

    for route in inventory::iter::<RouteInfo> {
        let domain_key = route.domain.as_str();
        map.entry(domain_key)
            .or_insert_with(std::collections::HashMap::new)
            .insert(route.name, route.clone());
    }

    map
}

pub mod type_registry {
    //! type registry for zod schema generation
    //!
    //! this module provides a central place to register all types that need
    //! to be available to the typescript client generator.

    use std::collections::HashSet;
    use zod_gen::ZodGenerator;

    // auth types
    use crate::users::{
        ApiKeyRegenerateResponse, ApiKeyStatusResponse, RedeemInviteRequest, WhoAmIResponse,
    };

    // music types
    use crate::music::crud::{PlaylistQueryResult, QueryParams};
    use crate::music::entities::artists::{Artist, CreateArtistRequest};
    use crate::music::entities::playlists::{CreatePlaylistRequest, Playlist};

    pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
        // auth types
        gen.add_schema::<WhoAmIResponse>("WhoAmIResponse");
        registered.insert("WhoAmIResponse".to_string());

        gen.add_schema::<ApiKeyStatusResponse>("ApiKeyStatusResponse");
        registered.insert("ApiKeyStatusResponse".to_string());

        gen.add_schema::<ApiKeyRegenerateResponse>("ApiKeyRegenerateResponse");
        registered.insert("ApiKeyRegenerateResponse".to_string());

        gen.add_schema::<RedeemInviteRequest>("RedeemInviteRequest");
        registered.insert("RedeemInviteRequest".to_string());

        // music types
        gen.add_schema::<QueryParams>("QueryParams");
        registered.insert("QueryParams".to_string());

        gen.add_schema::<Playlist>("Playlist");
        registered.insert("Playlist".to_string());

        gen.add_schema::<PlaylistQueryResult>("PlaylistQueryResult");
        registered.insert("PlaylistQueryResult".to_string());

        gen.add_schema::<CreatePlaylistRequest>("CreatePlaylistRequest");
        registered.insert("CreatePlaylistRequest".to_string());

        gen.add_schema::<Artist>("Artist");
        registered.insert("Artist".to_string());

        gen.add_schema::<CreateArtistRequest>("CreateArtistRequest");
        registered.insert("CreateArtistRequest".to_string());
    }
}
