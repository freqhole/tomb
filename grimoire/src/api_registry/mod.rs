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
    use crate::users::{
        RegisterStartRequest, SetFavoriteRequest, SetRatingRequest, StartLoginRequest,
    };

    // music types
    use crate::media_blobz::MediaBlob;
    use crate::music::crud::{
        AlbumQueryResult, AlbumsQueryResult, ArtistQueryResult, ArtistsQueryResult,
        DeleteAlbumRequest, DeleteAlbumResponse, DeleteArtistRequest, DeleteArtistResponse,
        DeleteSongRequest, DeleteSongResponse, GenreQueryResult, GenresQueryResult,
        GetAlbumRequest, GetArtistRequest, GetGenreRequest, GetRatingStatsRequest,
        ListFavoritesRequest, ListFavoritesResponse, PlaylistQueryResult, QueryParams, RatingStats,
        RecentSongsRequest, RemoveRatingRequest, RemoveRatingResponse, SetFavoriteResponse,
        SetRatingResponse, SongQueryResult, SongUpdateError, SongsQueryResult, UpdateSongsRequest,
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

        gen.add_schema::<ArtistQueryResult>("ArtistQueryResult");
        registered.insert("ArtistQueryResult".to_string());

        gen.add_schema::<ArtistsQueryResult>("ArtistsQueryResult");
        registered.insert("ArtistsQueryResult".to_string());

        gen.add_schema::<GetArtistRequest>("GetArtistRequest");
        registered.insert("GetArtistRequest".to_string());

        gen.add_schema::<DeleteArtistRequest>("DeleteArtistRequest");
        registered.insert("DeleteArtistRequest".to_string());

        gen.add_schema::<DeleteArtistResponse>("DeleteArtistResponse");
        registered.insert("DeleteArtistResponse".to_string());

        gen.add_schema::<AlbumQueryResult>("AlbumQueryResult");
        registered.insert("AlbumQueryResult".to_string());

        gen.add_schema::<AlbumsQueryResult>("AlbumsQueryResult");
        registered.insert("AlbumsQueryResult".to_string());

        gen.add_schema::<GetAlbumRequest>("GetAlbumRequest");
        registered.insert("GetAlbumRequest".to_string());

        gen.add_schema::<DeleteAlbumRequest>("DeleteAlbumRequest");
        registered.insert("DeleteAlbumRequest".to_string());

        gen.add_schema::<DeleteAlbumResponse>("DeleteAlbumResponse");
        registered.insert("DeleteAlbumResponse".to_string());

        // favorites types
        gen.add_schema::<ListFavoritesRequest>("ListFavoritesRequest");
        registered.insert("ListFavoritesRequest".to_string());

        gen.add_schema::<ListFavoritesResponse>("ListFavoritesResponse");
        registered.insert("ListFavoritesResponse".to_string());

        gen.add_schema::<SetFavoriteResponse>("SetFavoriteResponse");
        registered.insert("SetFavoriteResponse".to_string());

        // ratings types
        gen.add_schema::<GetRatingStatsRequest>("GetRatingStatsRequest");
        registered.insert("GetRatingStatsRequest".to_string());

        gen.add_schema::<RemoveRatingRequest>("RemoveRatingRequest");
        registered.insert("RemoveRatingRequest".to_string());

        gen.add_schema::<RemoveRatingResponse>("RemoveRatingResponse");
        registered.insert("RemoveRatingResponse".to_string());

        gen.add_schema::<SetRatingResponse>("SetRatingResponse");
        registered.insert("SetRatingResponse".to_string());

        gen.add_schema::<RatingStats>("RatingStats");
        registered.insert("RatingStats".to_string());

        // genres types
        gen.add_schema::<GenreQueryResult>("GenreQueryResult");
        registered.insert("GenreQueryResult".to_string());

        gen.add_schema::<GenresQueryResult>("GenresQueryResult");
        registered.insert("GenresQueryResult".to_string());

        gen.add_schema::<GetGenreRequest>("GetGenreRequest");
        registered.insert("GetGenreRequest".to_string());

        // user interaction types
        gen.add_schema::<SetFavoriteRequest>("SetFavoriteRequest");
        registered.insert("SetFavoriteRequest".to_string());

        gen.add_schema::<SetRatingRequest>("SetRatingRequest");
        registered.insert("SetRatingRequest".to_string());
    }
}
