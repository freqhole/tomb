//! api registry - route metadata for codegen and server routing
//!
//! this module defines the route registration types used by both
//! the server (to register routes) and the codegen tool (to generate
//! typescript clients).

use crate::users::UserRole;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    GET,
    POST,
    PATCH,
    HEAD,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PATCH => "PATCH",
            Method::HEAD => "HEAD",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    App,
    Auth,
    Music,
    Admin,
}

impl Domain {
    pub fn as_str(&self) -> &'static str {
        match self {
            Domain::App => "app",
            Domain::Auth => "auth",
            Domain::Music => "music",
            Domain::Admin => "admin",
        }
    }
}

/// route authorization requirements
///
/// defines what level of access is required for a route:
/// - Public: no authentication required
/// - Authenticated: any authenticated user (Viewer or higher)
/// - Role(role): user must have at least the specified role
/// - Owner: only the resource owner can access
/// - OwnerOr(role): owner OR user with at least the specified role
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "role", rename_all = "snake_case")]
pub enum RouteAuth {
    /// no authentication required (health checks, login, etc.)
    Public,
    /// any authenticated user (equivalent to Role(Viewer))
    Authenticated,
    /// user must have at least the specified role
    Role(UserRole),
    /// only the resource owner can access (no admin override)
    Owner,
    /// owner OR user with at least the specified role (e.g., owner or admin)
    OwnerOr(UserRole),
}

impl RouteAuth {
    /// convert to TypeScript-friendly type string for codegen
    pub fn type_str(&self) -> &'static str {
        match self {
            RouteAuth::Public => "public",
            RouteAuth::Authenticated => "authenticated",
            RouteAuth::Role(_) => "role",
            RouteAuth::Owner => "owner",
            RouteAuth::OwnerOr(_) => "owner_or",
        }
    }

    /// get the role name if this auth variant has one (for codegen)
    pub fn role_str(&self) -> Option<&'static str> {
        match self {
            RouteAuth::Role(role) | RouteAuth::OwnerOr(role) => Some(role.as_str()),
            _ => None,
        }
    }
}

impl Default for RouteAuth {
    /// default to Authenticated (any logged-in user)
    /// this is a safe default - routes should explicitly set Public if needed
    fn default() -> Self {
        RouteAuth::Authenticated
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
    /// authorization requirements for this route
    pub auth: RouteAuth,
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

    // health types
    use crate::health::{EmptyResponse, HealthResponse, ServerInfoResponse};

    // music types
    use crate::media_blobz::{BlobMetadataResponse, MediaBlob};
    use crate::music::crud::{
        AlbumQueryResult, AlbumsQueryResult, ArtistQueryResult, ArtistsQueryResult,
        BulkClearSongArtworkRequest, BulkClearSongArtworkResponse, BulkDeleteSongsRequest,
        BulkDeleteSongsResponse, DeleteAlbumRequest, DeleteAlbumResponse, DeleteArtistRequest,
        DeleteArtistResponse, DeleteSongRequest, DeleteSongResponse, FavoriteAlbumResult,
        FavoriteArtistResult, FavoriteItem, FavoritePlaylistResult, FavoriteSongResult,
        GenreQueryResult, GenresQueryResult, GetAlbumRequest, GetArtistRequest, GetGenreRequest,
        GetRatingStatsRequest, ListFavoritesRequest, ListFavoritesResponse, PlaylistQueryResult,
        PlaylistSongResult, PlaylistSongsQueryResult, PlaylistsQueryResult, QueryParams,
        QueryPlaylistSongsRequest, RatingStats, RecentSongsRequest, RemoveRatingRequest,
        RemoveRatingResponse, SetFavoriteResponse, SetRatingResponse, SongQueryResult,
        SongUpdateError, SongsQueryResult, UpdateSongsRequest, UpdateSongsResult,
    };

    // upload types
    use crate::music::entities::albums::{Album, GenreRef, UpdateAlbumRequest};
    use crate::music::entities::artists::{Artist, CreateArtistRequest, UpdateArtistRequest};
    use crate::music::entities::genres::Genre;
    use crate::music::entities::playlists::{
        AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest,
        GetPlaylistRequest, Playlist, RemovePlaylistThumbnailRequest,
        RemoveSongsFromPlaylistRequest, ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
    };
    use crate::music::entities::songs::Song;
    use crate::music::entities::tags::{
        AddAlbumsTagsRequest, CreateTagRequest, DeleteTagRequest, GetAlbumsTagsRequest,
        GetTagRequest, QueryTagsRequest, RemoveAlbumsTagsRequest, ReplaceAlbumsTagsRequest, Tag,
    };
    use crate::music::fetch::{FetchMediaParams, FetchMediaResult};
    use crate::upload::{
        AssociationHint, AssociationInfo, DeleteImageRequest, ImageUploadResponse,
        MusicImportResponse, MusicMetadataHints, MusicUploadResponse, SetPrimaryImageRequest,
    };

    // analytics types
    use crate::music::analytics::{
        CreateListenSessionRequest, DeleteFeedEventRequest, DeleteListenSessionRequest, FeedItem,
        FeedItemType, FeedRequest, FeedResponse, GetListenSessionRequest,
        ListListenSessionsRequest, ListListenSessionsResponse, ListenSession, ListenSessionStatus,
        ListenSessionType, ListeningHistoryItem, ListeningHistoryRequest, ListeningHistoryResponse,
        OverviewStats, PlayAnalytics, RecordPlayRequest, SessionSong, SessionSummary,
        SongAnalyticsRequest, TopAlbum, TopAlbumsRequest, TopArtist, TopArtistsRequest, TopSong,
        TopSongsRequest, UpdateListenSessionProgressRequest, UpdateListenSessionSongsRequest,
        UpdateListenSessionStatusRequest, UserStats,
    };

    // musicbrainz types
    use crate::music::musicbrainz::{
        GetCoverArtRequest, GetRecordingRequest, GetReleaseRequest, MbArtistCreditEntry,
        MbCoverArtImage, MbCoverArtThumbnails, MbMediumDetail, MbReleaseDetail, MbReleaseListItem,
        MbSearchReleasesResponse, MbTrackDetail, SearchRecordingsRequest, SearchReleasesRequest,
    };

    // jobs types
    use crate::jobs::{
        CreateJobRequest, GetJobRequest, GetJobsStatusRequest, GetJobsStatusResponse, JobResponse,
        ListJobsRequest,
    };

    // error types
    use crate::error::ErrorDetail;

    // search types
    use crate::search::{
        AlbumSearchResult, ArtistSearchResult, FilterSet, GenreSearchResult, PlaylistSearchResult,
        QueryContext, SearchField, SearchRequest, SearchResponse, SongSearchResult, Suggestion,
        SuggestionType, SuggestionsRequest, SuggestionsResponse,
    };

    // knock types
    use crate::federation::knock::{
        CreateKnockRequest, KnockRequest, KnockStatus, KnockStatusResponse, ProcessKnockRequest,
    };

    // knock request types from offal (separate from federation types)
    use crate::offal::admin::knocks::{
        AcceptKnockRequest, DeleteKnockRequest, GetKnockRequest, RejectKnockRequest,
    };

    // admin dispatch (freqhole-admin/1 ALPN) typed envelopes
    use crate::admin_dispatch::types::invites::{
        AdminGeneratedInvite, AdminInviteInfo, AdminInvitesGenerateRequest,
        AdminInvitesGenerateResponse, AdminInvitesListRequest, AdminInvitesRevokeAllResponse,
        AdminInvitesRevokeRequest, AdminInvitesUpdateRoleRequest,
    };
    use crate::admin_dispatch::types::knocks::{
        KnocksAcceptRequest, KnocksDeleteRequest, KnocksRejectAllResponse, KnocksRejectRequest,
    };
    use crate::admin_dispatch::types::peers::{
        AdminPeerNodeSummary, AdminPeerSummary, AdminPeersAllowRequest, AdminPeersAllowResponse,
        AdminPeersListForUserRequest, AdminPeersRemoveRequest,
    };
    use crate::admin_dispatch::types::radio::{
        RadioBumper, RadioBumpersAddRequest, RadioBumpersListRequest, RadioBumpersRemoveRequest,
        RadioBumpersSetFrequencyRequest, RadioConfigPayload, RadioFiltersAddRequest,
        RadioFiltersRemoveRequest, RadioSeedSuggestRequest, RadioSeedSuggestion,
        RadioSongsAddRequest, RadioSongsRemoveRequest, RadioStationByStationIdRequest,
        RadioStationSupervisorStatus, RadioStationsByIdRequest, RadioSupervisorStationRequest,
        RadioSupervisorStatusResponse,
    };
    use crate::admin_dispatch::types::users::{
        AdminAccountLinkResponse, AdminUserSummary, AdminUsersDeleteRequest,
        AdminUsersGenerateAccountLinkRequest, AdminUsersGetRequest, AdminUsersListRequest,
        AdminUsersUpdateRoleRequest,
    };

    // blob metadata request types
    use crate::offal::media_blobz::{
        GetBlobMetadataByBlake3Request, GetBlobMetadataRequest, HasBlobsRequest, HasBlobsResponse,
    };

    // upload request types
    use crate::offal::upload::UploadMusicByBlake3Request;

    // sync types
    use crate::offal::sync::{
        SyncAlbumRequest, SyncAlbumResponse, SyncImageRef, SyncPlaylistRequest,
        SyncPlaylistResponse, SyncSongByBlake3Request, SyncSongByBlake3Response,
    };

    // radio public types
    use crate::offal::public::radio::{
        PublicNowPlaying, PublicStation, RadioInfoResponse, RadioStationsResponse,
    };

    // radio admin types
    use crate::radio::stations::models::{
        CreateStationRequest, RadioStation, StationFilter, StationSong, UpdateStationRequest,
    };

    pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
        // auth types
        gen.add_schema::<WhoAmIResponse>("WhoAmIResponse");
        registered.insert("WhoAmIResponse".to_string());

        // error types (used across API responses and job failures)
        gen.add_schema::<ErrorDetail>("ErrorDetail");
        registered.insert("ErrorDetail".to_string());

        // health types
        gen.add_schema::<HealthResponse>("HealthResponse");
        registered.insert("HealthResponse".to_string());

        gen.add_schema::<EmptyResponse>("EmptyResponse");
        registered.insert("EmptyResponse".to_string());

        gen.add_schema::<ServerInfoResponse>("ServerInfoResponse");
        registered.insert("ServerInfoResponse".to_string());

        // radio discovery types
        gen.add_schema::<PublicNowPlaying>("PublicNowPlaying");
        registered.insert("PublicNowPlaying".to_string());
        gen.add_schema::<PublicStation>("PublicStation");
        registered.insert("PublicStation".to_string());
        gen.add_schema::<RadioInfoResponse>("RadioInfoResponse");
        registered.insert("RadioInfoResponse".to_string());
        gen.add_schema::<RadioStationsResponse>("RadioStationsResponse");
        registered.insert("RadioStationsResponse".to_string());

        gen.add_schema::<ApiKeyStatusResponse>("ApiKeyStatusResponse");
        registered.insert("ApiKeyStatusResponse".to_string());

        // blob types
        gen.add_schema::<BlobMetadataResponse>("BlobMetadataResponse");
        registered.insert("BlobMetadataResponse".to_string());

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

        gen.add_schema::<GetPlaylistRequest>("GetPlaylistRequest");
        registered.insert("GetPlaylistRequest".to_string());

        gen.add_schema::<PlaylistSongResult>("PlaylistSongResult");
        registered.insert("PlaylistSongResult".to_string());

        gen.add_schema::<PlaylistSongsQueryResult>("PlaylistSongsQueryResult");
        registered.insert("PlaylistSongsQueryResult".to_string());

        gen.add_schema::<PlaylistsQueryResult>("PlaylistsQueryResult");
        registered.insert("PlaylistsQueryResult".to_string());

        gen.add_schema::<QueryPlaylistSongsRequest>("QueryPlaylistSongsRequest");
        registered.insert("QueryPlaylistSongsRequest".to_string());

        gen.add_schema::<UpdatePlaylistRequest>("UpdatePlaylistRequest");
        registered.insert("UpdatePlaylistRequest".to_string());

        gen.add_schema::<AddSongsToPlaylistRequest>("AddSongsToPlaylistRequest");
        registered.insert("AddSongsToPlaylistRequest".to_string());

        gen.add_schema::<DeletePlaylistRequest>("DeletePlaylistRequest");
        registered.insert("DeletePlaylistRequest".to_string());

        gen.add_schema::<RemoveSongsFromPlaylistRequest>("RemoveSongsFromPlaylistRequest");
        registered.insert("RemoveSongsFromPlaylistRequest".to_string());

        gen.add_schema::<ReorderPlaylistSongsRequest>("ReorderPlaylistSongsRequest");
        registered.insert("ReorderPlaylistSongsRequest".to_string());

        gen.add_schema::<RemovePlaylistThumbnailRequest>("RemovePlaylistThumbnailRequest");
        registered.insert("RemovePlaylistThumbnailRequest".to_string());

        gen.add_schema::<Artist>("Artist");
        registered.insert("Artist".to_string());

        gen.add_schema::<CreateArtistRequest>("CreateArtistRequest");
        registered.insert("CreateArtistRequest".to_string());

        gen.add_schema::<UpdateArtistRequest>("UpdateArtistRequest");
        registered.insert("UpdateArtistRequest".to_string());

        gen.add_schema::<UpdateAlbumRequest>("UpdateAlbumRequest");
        registered.insert("UpdateAlbumRequest".to_string());

        gen.add_schema::<JobResponse>("JobResponse");
        registered.insert("JobResponse".to_string());

        gen.add_schema::<CreateJobRequest>("CreateJobRequest");
        registered.insert("CreateJobRequest".to_string());

        gen.add_schema::<GetJobRequest>("GetJobRequest");
        registered.insert("GetJobRequest".to_string());

        gen.add_schema::<GetJobsStatusRequest>("GetJobsStatusRequest");
        registered.insert("GetJobsStatusRequest".to_string());

        gen.add_schema::<GetJobsStatusResponse>("GetJobsStatusResponse");
        registered.insert("GetJobsStatusResponse".to_string());

        gen.add_schema::<ListJobsRequest>("ListJobsRequest");
        registered.insert("ListJobsRequest".to_string());

        // analytics types
        gen.add_schema::<RecordPlayRequest>("RecordPlayRequest");
        registered.insert("RecordPlayRequest".to_string());

        gen.add_schema::<ListeningHistoryRequest>("ListeningHistoryRequest");
        registered.insert("ListeningHistoryRequest".to_string());

        gen.add_schema::<ListeningHistoryResponse>("ListeningHistoryResponse");
        registered.insert("ListeningHistoryResponse".to_string());

        gen.add_schema::<ListeningHistoryItem>("ListeningHistoryItem");
        registered.insert("ListeningHistoryItem".to_string());

        gen.add_schema::<SongAnalyticsRequest>("SongAnalyticsRequest");
        registered.insert("SongAnalyticsRequest".to_string());

        gen.add_schema::<PlayAnalytics>("PlayAnalytics");
        registered.insert("PlayAnalytics".to_string());

        gen.add_schema::<TopSongsRequest>("TopSongsRequest");
        registered.insert("TopSongsRequest".to_string());

        gen.add_schema::<TopSong>("TopSong");
        registered.insert("TopSong".to_string());

        gen.add_schema::<TopAlbumsRequest>("TopAlbumsRequest");
        registered.insert("TopAlbumsRequest".to_string());

        gen.add_schema::<TopAlbum>("TopAlbum");
        registered.insert("TopAlbum".to_string());

        gen.add_schema::<TopArtistsRequest>("TopArtistsRequest");
        registered.insert("TopArtistsRequest".to_string());

        gen.add_schema::<TopArtist>("TopArtist");
        registered.insert("TopArtist".to_string());

        gen.add_schema::<FeedRequest>("FeedRequest");
        registered.insert("FeedRequest".to_string());

        gen.add_schema::<FeedResponse>("FeedResponse");
        registered.insert("FeedResponse".to_string());

        gen.add_schema::<FeedItem>("FeedItem");
        registered.insert("FeedItem".to_string());

        gen.add_schema::<FeedItemType>("FeedItemType");
        registered.insert("FeedItemType".to_string());

        gen.add_schema::<SessionSummary>("SessionSummary");
        registered.insert("SessionSummary".to_string());

        gen.add_schema::<SessionSong>("SessionSong");
        registered.insert("SessionSong".to_string());

        gen.add_schema::<OverviewStats>("OverviewStats");
        registered.insert("OverviewStats".to_string());

        gen.add_schema::<UserStats>("UserStats");
        registered.insert("UserStats".to_string());

        // listen session types
        gen.add_schema::<ListenSession>("ListenSession");
        registered.insert("ListenSession".to_string());

        gen.add_schema::<ListenSessionType>("ListenSessionType");
        registered.insert("ListenSessionType".to_string());

        gen.add_schema::<ListenSessionStatus>("ListenSessionStatus");
        registered.insert("ListenSessionStatus".to_string());

        gen.add_schema::<CreateListenSessionRequest>("CreateListenSessionRequest");
        registered.insert("CreateListenSessionRequest".to_string());

        gen.add_schema::<UpdateListenSessionProgressRequest>("UpdateListenSessionProgressRequest");
        registered.insert("UpdateListenSessionProgressRequest".to_string());

        gen.add_schema::<UpdateListenSessionSongsRequest>("UpdateListenSessionSongsRequest");
        registered.insert("UpdateListenSessionSongsRequest".to_string());

        gen.add_schema::<ListListenSessionsRequest>("ListListenSessionsRequest");
        registered.insert("ListListenSessionsRequest".to_string());

        gen.add_schema::<ListListenSessionsResponse>("ListListenSessionsResponse");
        registered.insert("ListListenSessionsResponse".to_string());

        // musicbrainz types
        gen.add_schema::<SearchReleasesRequest>("SearchReleasesRequest");
        registered.insert("SearchReleasesRequest".to_string());

        gen.add_schema::<GetReleaseRequest>("GetReleaseRequest");
        registered.insert("GetReleaseRequest".to_string());

        gen.add_schema::<SearchRecordingsRequest>("SearchRecordingsRequest");
        registered.insert("SearchRecordingsRequest".to_string());

        gen.add_schema::<GetRecordingRequest>("GetRecordingRequest");
        registered.insert("GetRecordingRequest".to_string());

        gen.add_schema::<GetCoverArtRequest>("GetCoverArtRequest");
        registered.insert("GetCoverArtRequest".to_string());

        gen.add_schema::<MbSearchReleasesResponse>("MbSearchReleasesResponse");
        registered.insert("MbSearchReleasesResponse".to_string());

        gen.add_schema::<MbReleaseListItem>("MbReleaseListItem");
        registered.insert("MbReleaseListItem".to_string());

        gen.add_schema::<MbArtistCreditEntry>("MbArtistCreditEntry");
        registered.insert("MbArtistCreditEntry".to_string());

        gen.add_schema::<MbReleaseDetail>("MbReleaseDetail");
        registered.insert("MbReleaseDetail".to_string());

        gen.add_schema::<MbMediumDetail>("MbMediumDetail");
        registered.insert("MbMediumDetail".to_string());

        gen.add_schema::<MbTrackDetail>("MbTrackDetail");
        registered.insert("MbTrackDetail".to_string());

        gen.add_schema::<MbCoverArtImage>("MbCoverArtImage");
        registered.insert("MbCoverArtImage".to_string());

        gen.add_schema::<MbCoverArtThumbnails>("MbCoverArtThumbnails");
        registered.insert("MbCoverArtThumbnails".to_string());

        // tag types
        gen.add_schema::<Tag>("Tag");
        registered.insert("Tag".to_string());

        gen.add_schema::<CreateTagRequest>("CreateTagRequest");
        registered.insert("CreateTagRequest".to_string());

        gen.add_schema::<QueryTagsRequest>("QueryTagsRequest");
        registered.insert("QueryTagsRequest".to_string());

        gen.add_schema::<GetTagRequest>("GetTagRequest");
        registered.insert("GetTagRequest".to_string());

        gen.add_schema::<DeleteTagRequest>("DeleteTagRequest");
        registered.insert("DeleteTagRequest".to_string());

        gen.add_schema::<GetAlbumsTagsRequest>("GetAlbumsTagsRequest");
        registered.insert("GetAlbumsTagsRequest".to_string());

        gen.add_schema::<AddAlbumsTagsRequest>("AddAlbumsTagsRequest");
        registered.insert("AddAlbumsTagsRequest".to_string());

        gen.add_schema::<RemoveAlbumsTagsRequest>("RemoveAlbumsTagsRequest");
        registered.insert("RemoveAlbumsTagsRequest".to_string());

        gen.add_schema::<ReplaceAlbumsTagsRequest>("ReplaceAlbumsTagsRequest");
        registered.insert("ReplaceAlbumsTagsRequest".to_string());

        gen.add_schema::<FetchMediaParams>("FetchMediaParams");
        registered.insert("FetchMediaParams".to_string());

        gen.add_schema::<FetchMediaResult>("FetchMediaResult");
        registered.insert("FetchMediaResult".to_string());

        // jobs types
        gen.add_schema::<CreateJobRequest>("CreateJobRequest");
        registered.insert("CreateJobRequest".to_string());

        // song types
        gen.add_schema::<Song>("Song");
        registered.insert("Song".to_string());

        gen.add_schema::<Album>("Album");
        registered.insert("Album".to_string());

        gen.add_schema::<GenreRef>("GenreRef");
        registered.insert("GenreRef".to_string());

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

        gen.add_schema::<BulkDeleteSongsRequest>("BulkDeleteSongsRequest");
        registered.insert("BulkDeleteSongsRequest".to_string());

        gen.add_schema::<BulkDeleteSongsResponse>("BulkDeleteSongsResponse");
        registered.insert("BulkDeleteSongsResponse".to_string());

        gen.add_schema::<BulkClearSongArtworkRequest>("BulkClearSongArtworkRequest");
        registered.insert("BulkClearSongArtworkRequest".to_string());

        gen.add_schema::<BulkClearSongArtworkResponse>("BulkClearSongArtworkResponse");
        registered.insert("BulkClearSongArtworkResponse".to_string());

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

        gen.add_schema::<FavoriteItem>("FavoriteItem");
        registered.insert("FavoriteItem".to_string());

        gen.add_schema::<FavoriteSongResult>("FavoriteSongResult");
        registered.insert("FavoriteSongResult".to_string());

        gen.add_schema::<FavoriteAlbumResult>("FavoriteAlbumResult");
        registered.insert("FavoriteAlbumResult".to_string());

        gen.add_schema::<FavoriteArtistResult>("FavoriteArtistResult");
        registered.insert("FavoriteArtistResult".to_string());

        gen.add_schema::<FavoritePlaylistResult>("FavoritePlaylistResult");
        registered.insert("FavoritePlaylistResult".to_string());

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

        // upload types
        gen.add_schema::<ImageUploadResponse>("ImageUploadResponse");
        registered.insert("ImageUploadResponse".to_string());

        gen.add_schema::<MusicUploadResponse>("MusicUploadResponse");
        registered.insert("MusicUploadResponse".to_string());

        gen.add_schema::<MusicImportResponse>("MusicImportResponse");
        registered.insert("MusicImportResponse".to_string());

        gen.add_schema::<DeleteImageRequest>("DeleteImageRequest");
        registered.insert("DeleteImageRequest".to_string());

        gen.add_schema::<SetPrimaryImageRequest>("SetPrimaryImageRequest");
        registered.insert("SetPrimaryImageRequest".to_string());

        gen.add_schema::<AssociationHint>("AssociationHint");
        registered.insert("AssociationHint".to_string());

        gen.add_schema::<AssociationInfo>("AssociationInfo");
        registered.insert("AssociationInfo".to_string());

        gen.add_schema::<MusicMetadataHints>("MusicMetadataHints");
        registered.insert("MusicMetadataHints".to_string());

        // user interaction types
        gen.add_schema::<SetFavoriteRequest>("SetFavoriteRequest");
        registered.insert("SetFavoriteRequest".to_string());

        gen.add_schema::<SetRatingRequest>("SetRatingRequest");
        registered.insert("SetRatingRequest".to_string());

        // search types
        gen.add_schema::<SearchRequest>("SearchRequest");
        registered.insert("SearchRequest".to_string());

        gen.add_schema::<SearchResponse>("SearchResponse");
        registered.insert("SearchResponse".to_string());

        gen.add_schema::<SuggestionsRequest>("SuggestionsRequest");
        registered.insert("SuggestionsRequest".to_string());

        gen.add_schema::<SuggestionsResponse>("SuggestionsResponse");
        registered.insert("SuggestionsResponse".to_string());

        gen.add_schema::<Suggestion>("Suggestion");
        registered.insert("Suggestion".to_string());

        gen.add_schema::<SearchField>("SearchField");
        registered.insert("SearchField".to_string());

        gen.add_schema::<SuggestionType>("SuggestionType");
        registered.insert("SuggestionType".to_string());

        gen.add_schema::<FilterSet>("FilterSet");
        registered.insert("FilterSet".to_string());

        gen.add_schema::<QueryContext>("QueryContext");
        registered.insert("QueryContext".to_string());

        gen.add_schema::<SongSearchResult>("SongSearchResult");
        registered.insert("SongSearchResult".to_string());

        gen.add_schema::<ArtistSearchResult>("ArtistSearchResult");
        registered.insert("ArtistSearchResult".to_string());

        gen.add_schema::<AlbumSearchResult>("AlbumSearchResult");
        registered.insert("AlbumSearchResult".to_string());

        gen.add_schema::<GenreSearchResult>("GenreSearchResult");
        registered.insert("GenreSearchResult".to_string());

        gen.add_schema::<PlaylistSearchResult>("PlaylistSearchResult");
        registered.insert("PlaylistSearchResult".to_string());

        // knock types
        gen.add_schema::<KnockRequest>("KnockRequest");
        registered.insert("KnockRequest".to_string());

        gen.add_schema::<KnockStatus>("KnockStatus");
        registered.insert("KnockStatus".to_string());

        gen.add_schema::<KnockStatusResponse>("KnockStatusResponse");
        registered.insert("KnockStatusResponse".to_string());

        gen.add_schema::<CreateKnockRequest>("CreateKnockRequest");
        registered.insert("CreateKnockRequest".to_string());

        gen.add_schema::<ProcessKnockRequest>("ProcessKnockRequest");
        registered.insert("ProcessKnockRequest".to_string());

        // knock admin request types
        gen.add_schema::<GetKnockRequest>("GetKnockRequest");
        registered.insert("GetKnockRequest".to_string());

        gen.add_schema::<AcceptKnockRequest>("AcceptKnockRequest");
        registered.insert("AcceptKnockRequest".to_string());

        gen.add_schema::<RejectKnockRequest>("RejectKnockRequest");
        registered.insert("RejectKnockRequest".to_string());

        gen.add_schema::<DeleteKnockRequest>("DeleteKnockRequest");
        registered.insert("DeleteKnockRequest".to_string());

        // admin dispatch (freqhole-admin/1 ALPN) typed envelopes
        gen.add_schema::<KnocksAcceptRequest>("KnocksAcceptRequest");
        registered.insert("KnocksAcceptRequest".to_string());

        gen.add_schema::<KnocksRejectRequest>("KnocksRejectRequest");
        registered.insert("KnocksRejectRequest".to_string());

        gen.add_schema::<KnocksDeleteRequest>("KnocksDeleteRequest");
        registered.insert("KnocksDeleteRequest".to_string());

        gen.add_schema::<KnocksRejectAllResponse>("KnocksRejectAllResponse");
        registered.insert("KnocksRejectAllResponse".to_string());

        // admin dispatch: users
        gen.add_schema::<AdminUserSummary>("AdminUserSummary");
        registered.insert("AdminUserSummary".to_string());
        gen.add_schema::<AdminUsersListRequest>("AdminUsersListRequest");
        registered.insert("AdminUsersListRequest".to_string());
        gen.add_schema::<AdminUsersGetRequest>("AdminUsersGetRequest");
        registered.insert("AdminUsersGetRequest".to_string());
        gen.add_schema::<AdminUsersUpdateRoleRequest>("AdminUsersUpdateRoleRequest");
        registered.insert("AdminUsersUpdateRoleRequest".to_string());
        gen.add_schema::<AdminUsersDeleteRequest>("AdminUsersDeleteRequest");
        registered.insert("AdminUsersDeleteRequest".to_string());
        gen.add_schema::<AdminUsersGenerateAccountLinkRequest>(
            "AdminUsersGenerateAccountLinkRequest",
        );
        registered.insert("AdminUsersGenerateAccountLinkRequest".to_string());
        gen.add_schema::<AdminAccountLinkResponse>("AdminAccountLinkResponse");
        registered.insert("AdminAccountLinkResponse".to_string());

        // admin dispatch: invites
        gen.add_schema::<AdminInviteInfo>("AdminInviteInfo");
        registered.insert("AdminInviteInfo".to_string());
        gen.add_schema::<AdminInvitesListRequest>("AdminInvitesListRequest");
        registered.insert("AdminInvitesListRequest".to_string());
        gen.add_schema::<AdminInvitesGenerateRequest>("AdminInvitesGenerateRequest");
        registered.insert("AdminInvitesGenerateRequest".to_string());
        gen.add_schema::<AdminGeneratedInvite>("AdminGeneratedInvite");
        registered.insert("AdminGeneratedInvite".to_string());
        gen.add_schema::<AdminInvitesGenerateResponse>("AdminInvitesGenerateResponse");
        registered.insert("AdminInvitesGenerateResponse".to_string());
        gen.add_schema::<AdminInvitesRevokeRequest>("AdminInvitesRevokeRequest");
        registered.insert("AdminInvitesRevokeRequest".to_string());
        gen.add_schema::<AdminInvitesRevokeAllResponse>("AdminInvitesRevokeAllResponse");
        registered.insert("AdminInvitesRevokeAllResponse".to_string());
        gen.add_schema::<AdminInvitesUpdateRoleRequest>("AdminInvitesUpdateRoleRequest");
        registered.insert("AdminInvitesUpdateRoleRequest".to_string());

        // admin dispatch: peers
        gen.add_schema::<AdminPeerSummary>("AdminPeerSummary");
        registered.insert("AdminPeerSummary".to_string());
        gen.add_schema::<AdminPeerNodeSummary>("AdminPeerNodeSummary");
        registered.insert("AdminPeerNodeSummary".to_string());
        gen.add_schema::<AdminPeersListForUserRequest>("AdminPeersListForUserRequest");
        registered.insert("AdminPeersListForUserRequest".to_string());
        gen.add_schema::<AdminPeersRemoveRequest>("AdminPeersRemoveRequest");
        registered.insert("AdminPeersRemoveRequest".to_string());
        gen.add_schema::<AdminPeersAllowRequest>("AdminPeersAllowRequest");
        registered.insert("AdminPeersAllowRequest".to_string());
        gen.add_schema::<AdminPeersAllowResponse>("AdminPeersAllowResponse");
        registered.insert("AdminPeersAllowResponse".to_string());

        // radio admin types
        gen.add_schema::<RadioStation>("RadioStation");
        registered.insert("RadioStation".to_string());
        gen.add_schema::<CreateStationRequest>("CreateStationRequest");
        registered.insert("CreateStationRequest".to_string());
        gen.add_schema::<UpdateStationRequest>("UpdateStationRequest");
        registered.insert("UpdateStationRequest".to_string());
        gen.add_schema::<RadioStationsByIdRequest>("RadioStationsByIdRequest");
        registered.insert("RadioStationsByIdRequest".to_string());
        gen.add_schema::<RadioStationByStationIdRequest>("RadioStationByStationIdRequest");
        registered.insert("RadioStationByStationIdRequest".to_string());
        gen.add_schema::<RadioFiltersAddRequest>("RadioFiltersAddRequest");
        registered.insert("RadioFiltersAddRequest".to_string());
        gen.add_schema::<RadioFiltersRemoveRequest>("RadioFiltersRemoveRequest");
        registered.insert("RadioFiltersRemoveRequest".to_string());
        gen.add_schema::<RadioSongsAddRequest>("RadioSongsAddRequest");
        registered.insert("RadioSongsAddRequest".to_string());
        gen.add_schema::<RadioSongsRemoveRequest>("RadioSongsRemoveRequest");
        registered.insert("RadioSongsRemoveRequest".to_string());
        gen.add_schema::<RadioSeedSuggestRequest>("RadioSeedSuggestRequest");
        registered.insert("RadioSeedSuggestRequest".to_string());
        gen.add_schema::<RadioSeedSuggestion>("RadioSeedSuggestion");
        registered.insert("RadioSeedSuggestion".to_string());
        gen.add_schema::<RadioConfigPayload>("RadioConfigPayload");
        registered.insert("RadioConfigPayload".to_string());
        gen.add_schema::<RadioStationSupervisorStatus>("RadioStationSupervisorStatus");
        registered.insert("RadioStationSupervisorStatus".to_string());
        gen.add_schema::<RadioSupervisorStatusResponse>("RadioSupervisorStatusResponse");
        registered.insert("RadioSupervisorStatusResponse".to_string());
        gen.add_schema::<RadioSupervisorStationRequest>("RadioSupervisorStationRequest");
        registered.insert("RadioSupervisorStationRequest".to_string());
        gen.add_schema::<RadioBumper>("RadioBumper");
        registered.insert("RadioBumper".to_string());
        gen.add_schema::<RadioBumpersListRequest>("RadioBumpersListRequest");
        registered.insert("RadioBumpersListRequest".to_string());
        gen.add_schema::<RadioBumpersAddRequest>("RadioBumpersAddRequest");
        registered.insert("RadioBumpersAddRequest".to_string());
        gen.add_schema::<RadioBumpersRemoveRequest>("RadioBumpersRemoveRequest");
        registered.insert("RadioBumpersRemoveRequest".to_string());
        gen.add_schema::<RadioBumpersSetFrequencyRequest>("RadioBumpersSetFrequencyRequest");
        registered.insert("RadioBumpersSetFrequencyRequest".to_string());
        gen.add_schema::<StationFilter>("StationFilter");
        registered.insert("StationFilter".to_string());
        gen.add_schema::<StationSong>("StationSong");
        registered.insert("StationSong".to_string());

        // listen session request types
        gen.add_schema::<GetListenSessionRequest>("GetListenSessionRequest");
        registered.insert("GetListenSessionRequest".to_string());

        gen.add_schema::<DeleteListenSessionRequest>("DeleteListenSessionRequest");
        registered.insert("DeleteListenSessionRequest".to_string());

        gen.add_schema::<DeleteFeedEventRequest>("DeleteFeedEventRequest");
        registered.insert("DeleteFeedEventRequest".to_string());

        gen.add_schema::<UpdateListenSessionStatusRequest>("UpdateListenSessionStatusRequest");
        registered.insert("UpdateListenSessionStatusRequest".to_string());

        // blob metadata request type
        gen.add_schema::<GetBlobMetadataRequest>("GetBlobMetadataRequest");
        registered.insert("GetBlobMetadataRequest".to_string());

        gen.add_schema::<GetBlobMetadataByBlake3Request>("GetBlobMetadataByBlake3Request");
        registered.insert("GetBlobMetadataByBlake3Request".to_string());

        gen.add_schema::<HasBlobsRequest>("HasBlobsRequest");
        registered.insert("HasBlobsRequest".to_string());
        gen.add_schema::<HasBlobsResponse>("HasBlobsResponse");
        registered.insert("HasBlobsResponse".to_string());

        // upload request types
        gen.add_schema::<UploadMusicByBlake3Request>("UploadMusicByBlake3Request");
        registered.insert("UploadMusicByBlake3Request".to_string());

        // sync types
        gen.add_schema::<SyncSongByBlake3Request>("SyncSongByBlake3Request");
        registered.insert("SyncSongByBlake3Request".to_string());
        gen.add_schema::<SyncSongByBlake3Response>("SyncSongByBlake3Response");
        registered.insert("SyncSongByBlake3Response".to_string());
        gen.add_schema::<SyncPlaylistRequest>("SyncPlaylistRequest");
        registered.insert("SyncPlaylistRequest".to_string());
        gen.add_schema::<SyncPlaylistResponse>("SyncPlaylistResponse");
        registered.insert("SyncPlaylistResponse".to_string());
        gen.add_schema::<SyncImageRef>("SyncImageRef");
        registered.insert("SyncImageRef".to_string());
        gen.add_schema::<SyncAlbumRequest>("SyncAlbumRequest");
        registered.insert("SyncAlbumRequest".to_string());
        gen.add_schema::<SyncAlbumResponse>("SyncAlbumResponse");
        registered.insert("SyncAlbumResponse".to_string());
    }
}
