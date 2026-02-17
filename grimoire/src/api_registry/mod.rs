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
    HEAD,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PUT => "PUT",
            Method::DELETE => "DELETE",
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

    // health types
    use crate::health::{EmptyResponse, HealthResponse, ServerInfoResponse};

    // music types
    use crate::media_blobz::{BlobMetadataResponse, MediaBlob};
    use crate::music::crud::{
        AlbumQueryResult, AlbumsQueryResult, ArtistQueryResult, ArtistsQueryResult,
        DeleteAlbumRequest, DeleteAlbumResponse, DeleteArtistRequest, DeleteArtistResponse,
        DeleteSongRequest, DeleteSongResponse, FavoriteAlbumResult, FavoriteArtistResult,
        FavoriteItem, FavoritePlaylistResult, FavoriteSongResult, GenreQueryResult,
        GenresQueryResult, GetAlbumRequest, GetArtistRequest, GetGenreRequest,
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
        MusicMetadataHints, MusicUploadResponse, SetPrimaryImageRequest,
    };

    // analytics types
    use crate::music::analytics::{
        CreateListenSessionRequest, FeedItem, FeedItemType, FeedRequest, FeedResponse,
        ListListenSessionsRequest, ListListenSessionsResponse, ListenSession, ListenSessionStatus,
        ListenSessionType, ListeningHistoryItem, ListeningHistoryRequest, ListeningHistoryResponse,
        OverviewStats, PlayAnalytics, RecordPlayRequest, SessionSong, SessionSummary,
        SongAnalyticsRequest, TopAlbum, TopAlbumsRequest, TopArtist, TopArtistsRequest, TopSong,
        TopSongsRequest, UpdateListenSessionProgressRequest, UserStats,
    };

    // musicbrainz types
    use crate::music::musicbrainz::{
        GetCoverArtRequest, GetRecordingRequest, GetReleaseRequest, MbArtistCreditEntry,
        MbCoverArtImage, MbCoverArtThumbnails, MbMediumDetail, MbReleaseDetail, MbReleaseListItem,
        MbSearchReleasesResponse, MbTrackDetail, SearchRecordingsRequest, SearchReleasesRequest,
    };

    // jobs types
    use crate::jobs::{CreateJobRequest, GetJobRequest, Job, ListJobsRequest};

    // search types
    use crate::search::{
        AlbumSearchResult, ArtistSearchResult, FilterSet, GenreSearchResult, PlaylistSearchResult,
        QueryContext, SearchField, SearchRequest, SearchResponse, SongSearchResult, Suggestion,
        SuggestionType, SuggestionsRequest, SuggestionsResponse,
    };

    pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
        // auth types
        gen.add_schema::<WhoAmIResponse>("WhoAmIResponse");
        registered.insert("WhoAmIResponse".to_string());

        // health types
        gen.add_schema::<HealthResponse>("HealthResponse");
        registered.insert("HealthResponse".to_string());

        gen.add_schema::<EmptyResponse>("EmptyResponse");
        registered.insert("EmptyResponse".to_string());

        gen.add_schema::<ServerInfoResponse>("ServerInfoResponse");
        registered.insert("ServerInfoResponse".to_string());

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

        gen.add_schema::<Job>("Job");
        registered.insert("Job".to_string());

        gen.add_schema::<CreateJobRequest>("CreateJobRequest");
        registered.insert("CreateJobRequest".to_string());

        gen.add_schema::<GetJobRequest>("GetJobRequest");
        registered.insert("GetJobRequest".to_string());

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

        gen.add_schema::<Job>("Job");
        registered.insert("Job".to_string());

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
    }
}
