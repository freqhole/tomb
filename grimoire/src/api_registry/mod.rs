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

    // webauthn types
    use crate::users::{RegisterStartRequest, StartLoginRequest};

    // music types
    use crate::media_blobz::MediaBlob;
    use crate::music::crud::{
        DeleteSongRequest, DeleteSongResponse, PlaylistQueryResult, QueryParams,
        RecentSongsRequest, SongQueryResult, SongUpdateError, SongsQueryResult, UpdateSongsRequest,
        UpdateSongsResult,
    };
    use crate::music::entities::albums::Album;
    use crate::music::entities::artists::{Artist, CreateArtistRequest};
    use crate::music::entities::genres::Genre;
    use crate::music::entities::playlists::{CreatePlaylistRequest, Playlist};
    use crate::music::entities::songs::Song;
    use crate::music::fetch::{FetchMediaParams, FetchMediaResult};

    // jobs types
    use crate::jobs::{CreateJobRequest, Job};

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

        // webauthn types
        gen.add_schema::<RegisterStartRequest>("RegisterStartRequest");
        registered.insert("RegisterStartRequest".to_string());

        gen.add_schema::<StartLoginRequest>("StartLoginRequest");
        registered.insert("StartLoginRequest".to_string());

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

        gen.add_schema::<FetchMediaParams>("FetchMediaParams");
        registered.insert("FetchMediaParams".to_string());

        gen.add_schema::<FetchMediaResult>("FetchMediaResult");
        registered.insert("FetchMediaResult".to_string());

        // jobs types
        gen.add_schema::<CreateJobRequest>("CreateJobRequest");
        registered.insert("CreateJobRequest".to_string());

        gen.add_schema::<Job>("Job");
        registered.insert("Job".to_string());

        // song types
        gen.add_schema::<Song>("Song");
        registered.insert("Song".to_string());

        gen.add_schema::<Album>("Album");
        registered.insert("Album".to_string());

        gen.add_schema::<Genre>("Genre");
        registered.insert("Genre".to_string());

        gen.add_schema::<MediaBlob>("MediaBlob");
        registered.insert("MediaBlob".to_string());

        gen.add_schema::<SongQueryResult>("SongQueryResult");
        registered.insert("SongQueryResult".to_string());

        gen.add_schema::<UpdateSongsRequest>("UpdateSongsRequest");
        registered.insert("UpdateSongsRequest".to_string());

        gen.add_schema::<UpdateSongsResult>("UpdateSongsResult");
        registered.insert("UpdateSongsResult".to_string());

        gen.add_schema::<SongUpdateError>("SongUpdateError");
        registered.insert("SongUpdateError".to_string());

        gen.add_schema::<RecentSongsRequest>("RecentSongsRequest");
        registered.insert("RecentSongsRequest".to_string());

        gen.add_schema::<DeleteSongRequest>("DeleteSongRequest");
        registered.insert("DeleteSongRequest".to_string());

        gen.add_schema::<DeleteSongResponse>("DeleteSongResponse");
        registered.insert("DeleteSongResponse".to_string());

        gen.add_schema::<SongsQueryResult>("SongsQueryResult");
        registered.insert("SongsQueryResult".to_string());
    }
}
