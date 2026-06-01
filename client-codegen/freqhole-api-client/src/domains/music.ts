// music domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import {
  UpdateAlbumRequestSchema,
  UpdateArtistRequestSchema,
  UpdateSongsRequestSchema,
} from "../codegen/schema.js";
import { ListFavoritesResponseSchema } from "./favorites.types.js";
import type { CallFn } from "./types.js";

// partial schemas for update operations
const UpdateSongsRequestPartialSchema =
  UpdateSongsRequestSchema.partial().required({ song_ids: true });
const UpdateArtistRequestPartialSchema =
  UpdateArtistRequestSchema.partial().required({ artist_id: true });
const UpdateAlbumRequestPartialSchema =
  UpdateAlbumRequestSchema.partial().required({ album_id: true });

export function createMusicMethods(call: CallFn) {
  return {
    // search
    search: (params: s.SearchRequest) => {
      return call(
        "music",
        "search",
        routes.music.search.resp,
        routes.music.search.req,
        routes.music.search.method,
        routes.music.search.path,
        params,
      );
    },

    suggestions: (params: s.SuggestionsRequest) => {
      return call(
        "music",
        "suggestions",
        routes.music.suggestions.resp,
        routes.music.suggestions.req,
        routes.music.suggestions.method,
        routes.music.suggestions.path,
        params,
      );
    },

    // songs
    querySongs: (params: s.QueryParams) => {
      return call(
        "music",
        "query_songs",
        routes.music.query_songs.resp,
        routes.music.query_songs.req,
        routes.music.query_songs.method,
        routes.music.query_songs.path,
        params,
      );
    },

    recentSongs: (params: s.RecentSongsRequest) => {
      return call(
        "music",
        "recent_songs",
        routes.music.recent_songs.resp,
        routes.music.recent_songs.req,
        routes.music.recent_songs.method,
        routes.music.recent_songs.path,
        params,
      );
    },

    updateSongs: (
      params: Partial<s.UpdateSongsRequest> & { song_ids: string[] },
    ) => {
      return call(
        "music",
        "update_songs",
        routes.music.update_songs.resp,
        UpdateSongsRequestPartialSchema,
        routes.music.update_songs.method,
        routes.music.update_songs.path,
        params,
      );
    },

    deleteSong: (params: s.DeleteSongRequest) => {
      return call(
        "music",
        "delete_song",
        routes.music.delete_song.resp,
        routes.music.delete_song.req,
        routes.music.delete_song.method,
        routes.music.delete_song.path,
        params,
      );
    },

    bulkDeleteSongs: (params: s.BulkDeleteSongsRequest) => {
      return call(
        "music",
        "bulk_delete_songs",
        routes.music.bulk_delete_songs.resp,
        routes.music.bulk_delete_songs.req,
        routes.music.bulk_delete_songs.method,
        routes.music.bulk_delete_songs.path,
        params,
      );
    },

    bulkClearSongArtwork: (params: s.BulkClearSongArtworkRequest) => {
      return call(
        "music",
        "bulk_clear_song_artwork",
        routes.music.bulk_clear_song_artwork.resp,
        routes.music.bulk_clear_song_artwork.req,
        routes.music.bulk_clear_song_artwork.method,
        routes.music.bulk_clear_song_artwork.path,
        params,
      );
    },

    // albums
    queryAlbums: (params: s.QueryParams) => {
      return call(
        "music",
        "query_albums",
        routes.music.query_albums.resp,
        routes.music.query_albums.req,
        routes.music.query_albums.method,
        routes.music.query_albums.path,
        params,
      );
    },

    queryAlbumStatusCounts: (params: s.QueryParams) => {
      return call(
        "music",
        "query_album_status_counts",
        routes.music.query_album_status_counts.resp,
        routes.music.query_album_status_counts.req,
        routes.music.query_album_status_counts.method,
        routes.music.query_album_status_counts.path,
        params,
      );
    },

    getAlbum: (params: s.GetAlbumRequest) => {
      return call(
        "music",
        "get_album",
        routes.music.get_album.resp,
        routes.music.get_album.req,
        routes.music.get_album.method,
        routes.music.get_album.path,
        params,
      );
    },

    updateAlbum: (
      params: Partial<s.UpdateAlbumRequest> & { album_id: string },
    ) => {
      return call(
        "music",
        "update_album",
        routes.music.update_album.resp,
        UpdateAlbumRequestPartialSchema,
        routes.music.update_album.method,
        routes.music.update_album.path,
        params,
      );
    },

    deleteAlbum: (params: s.DeleteAlbumRequest) => {
      return call(
        "music",
        "delete_album",
        routes.music.delete_album.resp,
        routes.music.delete_album.req,
        routes.music.delete_album.method,
        routes.music.delete_album.path,
        params,
      );
    },

    getAlbumImages: (params: { id: string }) => {
      return call(
        "music",
        "get_album_images",
        routes.music.get_album_images.resp,
        routes.music.get_album_images.req,
        routes.music.get_album_images.method,
        routes.music.get_album_images.path,
        params,
      );
    },

    // bulk enrichment review (phase 11)
    proposeTaxons: (params: s.ProposeTaxonsRequest) => {
      return call(
        "music",
        "propose_taxons",
        routes.music.propose_taxons.resp,
        routes.music.propose_taxons.req,
        routes.music.propose_taxons.method,
        routes.music.propose_taxons.path,
        params,
      );
    },

    applyTaxonProposals: (params: s.ApplyTaxonProposalsRequest) => {
      return call(
        "music",
        "apply_taxon_proposals",
        routes.music.apply_taxon_proposals.resp,
        routes.music.apply_taxon_proposals.req,
        routes.music.apply_taxon_proposals.method,
        routes.music.apply_taxon_proposals.path,
        params,
      );
    },

    setMbLookupStatus: (params: s.SetMbLookupStatusRequest) => {
      return call(
        "music",
        "set_mb_lookup_status",
        routes.music.set_mb_lookup_status.resp,
        routes.music.set_mb_lookup_status.req,
        routes.music.set_mb_lookup_status.method,
        routes.music.set_mb_lookup_status.path,
        params,
      );
    },

    // external-url proposals (phase 11.x)
    proposeExternalUrls: (params: s.ProposeExternalUrlsRequest) => {
      return call(
        "music",
        "propose_external_urls",
        routes.music.propose_external_urls.resp,
        routes.music.propose_external_urls.req,
        routes.music.propose_external_urls.method,
        routes.music.propose_external_urls.path,
        params,
      );
    },

    applyExternalUrls: (params: s.ApplyExternalUrlsRequest) => {
      return call(
        "music",
        "apply_external_urls",
        routes.music.apply_external_urls.resp,
        routes.music.apply_external_urls.req,
        routes.music.apply_external_urls.method,
        routes.music.apply_external_urls.path,
        params,
      );
    },

    // artist bio review (slice 4a)
    proposeArtistBios: (params: s.ProposeArtistBiosRequest) => {
      return call(
        "music",
        "propose_artist_bios",
        routes.music.propose_artist_bios.resp,
        routes.music.propose_artist_bios.req,
        routes.music.propose_artist_bios.method,
        routes.music.propose_artist_bios.path,
        params,
      );
    },

    applyArtistBio: (params: s.ApplyArtistBioRequest) => {
      return call(
        "music",
        "apply_artist_bio",
        routes.music.apply_artist_bio.resp,
        routes.music.apply_artist_bio.req,
        routes.music.apply_artist_bio.method,
        routes.music.apply_artist_bio.path,
        params,
      );
    },

    // related-artist review (slice 4c)
    proposeRelatedArtists: (params: s.ProposeRelatedArtistsRequest) => {
      return call(
        "music",
        "propose_related_artists",
        routes.music.propose_related_artists.resp,
        routes.music.propose_related_artists.req,
        routes.music.propose_related_artists.method,
        routes.music.propose_related_artists.path,
        params,
      );
    },

    applyRelatedArtists: (params: s.ApplyRelatedArtistsRequest) => {
      return call(
        "music",
        "apply_related_artists",
        routes.music.apply_related_artists.resp,
        routes.music.apply_related_artists.req,
        routes.music.apply_related_artists.method,
        routes.music.apply_related_artists.path,
        params,
      );
    },

    // artists
    queryArtists: (params: s.QueryParams) => {
      return call(
        "music",
        "query_artists",
        routes.music.query_artists.resp,
        routes.music.query_artists.req,
        routes.music.query_artists.method,
        routes.music.query_artists.path,
        params,
      );
    },

    getArtist: (params: s.GetArtistRequest) => {
      return call(
        "music",
        "get_artist",
        routes.music.get_artist.resp,
        routes.music.get_artist.req,
        routes.music.get_artist.method,
        routes.music.get_artist.path,
        params,
      );
    },

    createArtist: (params: s.CreateArtistRequest) => {
      return call(
        "music",
        "create_artist",
        routes.music.create_artist.resp,
        routes.music.create_artist.req,
        routes.music.create_artist.method,
        routes.music.create_artist.path,
        params,
      );
    },

    updateArtist: (
      params: Partial<s.UpdateArtistRequest> & { artist_id: string },
    ) => {
      return call(
        "music",
        "update_artist",
        routes.music.update_artist.resp,
        UpdateArtistRequestPartialSchema,
        routes.music.update_artist.method,
        routes.music.update_artist.path,
        params,
      );
    },

    deleteArtist: (params: s.DeleteArtistRequest) => {
      return call(
        "music",
        "delete_artist",
        routes.music.delete_artist.resp,
        routes.music.delete_artist.req,
        routes.music.delete_artist.method,
        routes.music.delete_artist.path,
        params,
      );
    },

    getArtistImages: (params: { id: string }) => {
      return call(
        "music",
        "get_artist_images",
        routes.music.get_artist_images.resp,
        routes.music.get_artist_images.req,
        routes.music.get_artist_images.method,
        routes.music.get_artist_images.path,
        params,
      );
    },

    // genres are now exposed via the unified taxonomy api
    // (queryTaxons / getTaxon with kind_slug='genre'). dedicated genre
    // routes were removed during the taxonomy refactor.

    // playlists
    listPlaylists: (params: s.QueryParams) => {
      return call(
        "music",
        "list_playlists",
        routes.music.list_playlists.resp,
        routes.music.list_playlists.req,
        routes.music.list_playlists.method,
        routes.music.list_playlists.path,
        params,
      );
    },

    getPlaylistById: (params: s.GetPlaylistRequest) => {
      return call(
        "music",
        "get_playlist_by_id",
        routes.music.get_playlist_by_id.resp,
        routes.music.get_playlist_by_id.req,
        routes.music.get_playlist_by_id.method,
        routes.music.get_playlist_by_id.path,
        params,
      );
    },

    getPlaylistEtag: (params: s.GetPlaylistRequest) => {
      const path = routes.music.get_playlist_etag.path.replace(
        "{id}",
        params.id,
      );
      return call(
        "music",
        "get_playlist_etag",
        routes.music.get_playlist_etag.resp,
        routes.music.get_playlist_etag.req,
        routes.music.get_playlist_etag.method,
        path,
        params,
      );
    },

    getPlaylistImages: (params: { id: string }) => {
      return call(
        "music",
        "get_playlist_images",
        routes.music.get_playlist_images.resp,
        routes.music.get_playlist_images.req,
        routes.music.get_playlist_images.method,
        routes.music.get_playlist_images.path,
        params,
      );
    },

    createPlaylist: (params: s.CreatePlaylistRequest) => {
      return call(
        "music",
        "create_playlist",
        routes.music.create_playlist.resp,
        routes.music.create_playlist.req,
        routes.music.create_playlist.method,
        routes.music.create_playlist.path,
        params,
      );
    },

    updatePlaylist: (params: s.UpdatePlaylistRequest) => {
      return call(
        "music",
        "update_playlist",
        routes.music.update_playlist.resp,
        routes.music.update_playlist.req,
        routes.music.update_playlist.method,
        routes.music.update_playlist.path,
        params,
      );
    },

    deletePlaylist: (params: s.DeletePlaylistRequest) => {
      return call(
        "music",
        "delete_playlist",
        routes.music.delete_playlist.resp,
        routes.music.delete_playlist.req,
        routes.music.delete_playlist.method,
        routes.music.delete_playlist.path,
        params,
      );
    },

    queryPlaylistSongs: (params: s.QueryPlaylistSongsRequest) => {
      return call(
        "music",
        "query_playlist_songs",
        routes.music.query_playlist_songs.resp,
        routes.music.query_playlist_songs.req,
        routes.music.query_playlist_songs.method,
        routes.music.query_playlist_songs.path,
        params,
      );
    },

    addSongsToPlaylist: (params: s.AddSongsToPlaylistRequest) => {
      return call(
        "music",
        "add_songs_to_playlist",
        routes.music.add_songs_to_playlist.resp,
        routes.music.add_songs_to_playlist.req,
        routes.music.add_songs_to_playlist.method,
        routes.music.add_songs_to_playlist.path,
        params,
      );
    },

    removeSongsFromPlaylist: (params: s.RemoveSongsFromPlaylistRequest) => {
      return call(
        "music",
        "remove_songs_from_playlist",
        routes.music.remove_songs_from_playlist.resp,
        routes.music.remove_songs_from_playlist.req,
        routes.music.remove_songs_from_playlist.method,
        routes.music.remove_songs_from_playlist.path,
        params,
      );
    },

    reorderPlaylistSongs: (params: s.ReorderPlaylistSongsRequest) => {
      return call(
        "music",
        "reorder_playlist_songs",
        routes.music.reorder_playlist_songs.resp,
        routes.music.reorder_playlist_songs.req,
        routes.music.reorder_playlist_songs.method,
        routes.music.reorder_playlist_songs.path,
        params,
      );
    },

    // tags
    listTags: () => {
      return call(
        "music",
        "list_tags",
        routes.music.list_tags.resp,
        routes.music.list_tags.req,
        routes.music.list_tags.method,
        routes.music.list_tags.path,
      );
    },

    getTag: (params: s.GetTagRequest) => {
      return call(
        "music",
        "get_tag",
        routes.music.get_tag.resp,
        routes.music.get_tag.req,
        routes.music.get_tag.method,
        routes.music.get_tag.path,
        params,
      );
    },

    queryTags: (params: s.QueryTagsRequest) => {
      return call(
        "music",
        "query_tags",
        routes.music.query_tags.resp,
        routes.music.query_tags.req,
        routes.music.query_tags.method,
        routes.music.query_tags.path,
        params,
      );
    },

    deleteTag: (params: s.DeleteTagRequest) => {
      return call(
        "music",
        "delete_tag",
        routes.music.delete_tag.resp,
        routes.music.delete_tag.req,
        routes.music.delete_tag.method,
        routes.music.delete_tag.path,
        params,
      );
    },

    getAlbumsTags: (params: s.GetAlbumsTagsRequest) => {
      return call(
        "music",
        "get_albums_tags",
        routes.music.get_albums_tags.resp,
        routes.music.get_albums_tags.req,
        routes.music.get_albums_tags.method,
        routes.music.get_albums_tags.path,
        params,
      );
    },

    addAlbumsTags: (params: s.AddAlbumsTagsRequest) => {
      return call(
        "music",
        "add_albums_tags",
        routes.music.add_albums_tags.resp,
        routes.music.add_albums_tags.req,
        routes.music.add_albums_tags.method,
        routes.music.add_albums_tags.path,
        params,
      );
    },

    removeAlbumsTags: (params: s.RemoveAlbumsTagsRequest) => {
      return call(
        "music",
        "remove_albums_tags",
        routes.music.remove_albums_tags.resp,
        routes.music.remove_albums_tags.req,
        routes.music.remove_albums_tags.method,
        routes.music.remove_albums_tags.path,
        params,
      );
    },

    replaceAlbumsTags: (params: s.ReplaceAlbumsTagsRequest) => {
      return call(
        "music",
        "replace_albums_tags",
        routes.music.replace_albums_tags.resp,
        routes.music.replace_albums_tags.req,
        routes.music.replace_albums_tags.method,
        routes.music.replace_albums_tags.path,
        params,
      );
    },

    // ratings
    setRating: (params: s.SetRatingRequest) => {
      return call(
        "music",
        "set_rating",
        routes.music.set_rating.resp,
        routes.music.set_rating.req,
        routes.music.set_rating.method,
        routes.music.set_rating.path,
        params,
      );
    },

    removeRating: (params: s.RemoveRatingRequest) => {
      return call(
        "music",
        "remove_rating",
        routes.music.remove_rating.resp,
        routes.music.remove_rating.req,
        routes.music.remove_rating.method,
        routes.music.remove_rating.path,
        params,
      );
    },

    getRatingStats: (params: s.GetRatingStatsRequest) => {
      return call(
        "music",
        "get_rating_stats",
        routes.music.get_rating_stats.resp,
        routes.music.get_rating_stats.req,
        routes.music.get_rating_stats.method,
        routes.music.get_rating_stats.path,
        params,
      );
    },

    // favorites
    listFavorites: (params: s.ListFavoritesRequest) => {
      return call(
        "music",
        "list_favorites",
        ListFavoritesResponseSchema, // use hand-rolled schema for discriminated union
        routes.music.list_favorites.req,
        routes.music.list_favorites.method,
        routes.music.list_favorites.path,
        params,
      );
    },

    setFavorite: (params: s.SetFavoriteRequest) => {
      return call(
        "music",
        "set_favorite",
        routes.music.set_favorite.resp,
        routes.music.set_favorite.req,
        routes.music.set_favorite.method,
        routes.music.set_favorite.path,
        params,
      );
    },

    // analytics
    recordPlay: (params: s.RecordPlayRequest) => {
      return call(
        "music",
        "record_play",
        routes.music.record_play.resp,
        routes.music.record_play.req,
        routes.music.record_play.method,
        routes.music.record_play.path,
        params,
      );
    },

    activityFeed: (params: s.FeedRequest) => {
      return call(
        "music",
        "activity_feed",
        routes.music.activity_feed.resp,
        routes.music.activity_feed.req,
        routes.music.activity_feed.method,
        routes.music.activity_feed.path,
        params,
      );
    },

    listeningHistory: (params: s.ListeningHistoryRequest) => {
      return call(
        "music",
        "listening_history",
        routes.music.listening_history.resp,
        routes.music.listening_history.req,
        routes.music.listening_history.method,
        routes.music.listening_history.path,
        params,
      );
    },

    songAnalytics: (params: s.SongAnalyticsRequest) => {
      return call(
        "music",
        "song_analytics",
        routes.music.song_analytics.resp,
        routes.music.song_analytics.req,
        routes.music.song_analytics.method,
        routes.music.song_analytics.path,
        params,
      );
    },

    topSongs: (params: s.TopSongsRequest) => {
      return call(
        "music",
        "top_songs",
        routes.music.top_songs.resp,
        routes.music.top_songs.req,
        routes.music.top_songs.method,
        routes.music.top_songs.path,
        params,
      );
    },

    topAlbums: (params: s.TopAlbumsRequest) => {
      return call(
        "music",
        "top_albums",
        routes.music.top_albums.resp,
        routes.music.top_albums.req,
        routes.music.top_albums.method,
        routes.music.top_albums.path,
        params,
      );
    },

    topArtists: (params: s.TopArtistsRequest) => {
      return call(
        "music",
        "top_artists",
        routes.music.top_artists.resp,
        routes.music.top_artists.req,
        routes.music.top_artists.method,
        routes.music.top_artists.path,
        params,
      );
    },

    // listen sessions
    createListenSession: (params: s.CreateListenSessionRequest) => {
      return call(
        "music",
        "create_listen_session",
        routes.music.create_listen_session.resp,
        routes.music.create_listen_session.req,
        routes.music.create_listen_session.method,
        routes.music.create_listen_session.path,
        params,
      );
    },

    getListenSession: (id: string) => {
      const path = routes.music.get_listen_session.path.replace("{id}", id);
      return call(
        "music",
        "get_listen_session",
        routes.music.get_listen_session.resp,
        routes.music.get_listen_session.req,
        routes.music.get_listen_session.method,
        path,
      );
    },

    deleteListenSession: (id: string) => {
      return call(
        "music",
        "delete_listen_session",
        routes.music.delete_listen_session.resp,
        routes.music.delete_listen_session.req,
        routes.music.delete_listen_session.method,
        routes.music.delete_listen_session.path,
        { id },
      );
    },

    deleteFeedEvent: (id: string) => {
      return call(
        "music",
        "delete_feed_event",
        routes.music.delete_feed_event.resp,
        routes.music.delete_feed_event.req,
        routes.music.delete_feed_event.method,
        routes.music.delete_feed_event.path,
        { id },
      );
    },

    recordPlaylistPlay: (id: string) => {
      return call(
        "music",
        "record_playlist_play",
        routes.music.record_playlist_play.resp,
        routes.music.record_playlist_play.req,
        routes.music.record_playlist_play.method,
        routes.music.record_playlist_play.path,
        { id },
      );
    },

    updateListenSessionProgress: (
      id: string,
      params: s.UpdateListenSessionProgressRequest,
    ) => {
      const path = routes.music.update_listen_session_progress.path.replace(
        "{id}",
        id,
      );
      return call(
        "music",
        "update_listen_session_progress",
        routes.music.update_listen_session_progress.resp,
        routes.music.update_listen_session_progress.req,
        routes.music.update_listen_session_progress.method,
        path,
        params,
      );
    },

    updateListenSessionStatus: (id: string, status: string) => {
      const path = routes.music.update_listen_session_status.path
        .replace("{id}", id)
        .replace("{status}", status);
      return call(
        "music",
        "update_listen_session_status",
        routes.music.update_listen_session_status.resp,
        routes.music.update_listen_session_status.req,
        routes.music.update_listen_session_status.method,
        path,
      );
    },

    updateListenSessionSongs: (
      id: string,
      params: s.UpdateListenSessionSongsRequest,
    ) => {
      const path = routes.music.update_listen_session_songs.path.replace(
        "{id}",
        id,
      );
      return call(
        "music",
        "update_listen_session_songs",
        routes.music.update_listen_session_songs.resp,
        routes.music.update_listen_session_songs.req,
        routes.music.update_listen_session_songs.method,
        path,
        params,
      );
    },

    listListenSessions: (params: s.ListListenSessionsRequest) => {
      return call(
        "music",
        "list_listen_sessions",
        routes.music.list_listen_sessions.resp,
        routes.music.list_listen_sessions.req,
        routes.music.list_listen_sessions.method,
        routes.music.list_listen_sessions.path,
        params,
      );
    },

    // jobs
    getJobStatus: (params: s.GetJobsStatusRequest) => {
      return call(
        "music",
        "get_job_status",
        routes.music.get_job_status.resp,
        routes.music.get_job_status.req,
        routes.music.get_job_status.method,
        routes.music.get_job_status.path,
        params,
      );
    },

    listJobs: (params: s.ListJobsRequest) => {
      return call(
        "music",
        "list_jobs",
        routes.music.list_jobs.resp,
        routes.music.list_jobs.req,
        routes.music.list_jobs.method,
        routes.music.list_jobs.path,
        params,
      );
    },

    // blobs
    blobMetadata: (params: { id: string }) => {
      return call(
        "music",
        "blob_metadata",
        routes.music.blob_metadata.resp,
        routes.music.blob_metadata.req,
        routes.music.blob_metadata.method,
        routes.music.blob_metadata.path,
        params,
      );
    },

    // images
    deleteImage: (params: s.DeleteImageRequest) => {
      return call(
        "music",
        "delete_image",
        routes.music.delete_image.resp,
        routes.music.delete_image.req,
        routes.music.delete_image.method,
        routes.music.delete_image.path,
        params,
      );
    },

    setPrimaryImage: (params: s.SetPrimaryImageRequest) => {
      return call(
        "music",
        "set_primary_image",
        routes.music.set_primary_image.resp,
        routes.music.set_primary_image.req,
        routes.music.set_primary_image.method,
        routes.music.set_primary_image.path,
        params,
      );
    },

    // musicbrainz
    getMusicbrainzRelease: (params: s.GetReleaseRequest) => {
      return call(
        "music",
        "get_musicbrainz_release",
        routes.music.get_musicbrainz_release.resp,
        routes.music.get_musicbrainz_release.req,
        routes.music.get_musicbrainz_release.method,
        routes.music.get_musicbrainz_release.path,
        params,
      );
    },

    searchMusicbrainzReleases: (params: s.SearchReleasesRequest) => {
      return call(
        "music",
        "search_musicbrainz_releases",
        routes.music.search_musicbrainz_releases.resp,
        routes.music.search_musicbrainz_releases.req,
        routes.music.search_musicbrainz_releases.method,
        routes.music.search_musicbrainz_releases.path,
        params,
      );
    },

    // fetch/import
    createFetchJob: (params: s.FetchMediaParams) => {
      return call(
        "music",
        "create_fetch_job",
        routes.music.create_fetch_job.resp,
        routes.music.create_fetch_job.req,
        routes.music.create_fetch_job.method,
        routes.music.create_fetch_job.path,
        params,
      );
    },

    getFetchJob: (params: s.GetJobRequest) => {
      return call(
        "music",
        "get_fetch_job",
        routes.music.get_fetch_job.resp,
        routes.music.get_fetch_job.req,
        routes.music.get_fetch_job.method,
        routes.music.get_fetch_job.path,
        params,
      );
    },

    // musicbrainz album-search bulk enqueue (admin only). spawns one
    // `MbAlbumSearch` job per album id, returns the job ids so the caller
    // can poll status.
    enqueueMbAlbumSearch: (params: s.EnqueueMbAlbumSearchRequest) => {
      return call(
        "music",
        "enqueue_mb_album_search",
        routes.music.enqueue_mb_album_search.resp,
        routes.music.enqueue_mb_album_search.req,
        routes.music.enqueue_mb_album_search.method,
        routes.music.enqueue_mb_album_search.path,
        params,
      );
    },

    // confirm a musicbrainz candidate as the canonical match for an album
    // (admin only). updates `mb_lookup_status` to `Confirmed` and stamps
    // the chosen release/release-group ids into `metadata.musicbrainz`.
    confirmMbMatch: (params: s.ConfirmMbMatchRequest) => {
      return call(
        "music",
        "confirm_mb_match",
        routes.music.confirm_mb_match.resp,
        routes.music.confirm_mb_match.req,
        routes.music.confirm_mb_match.method,
        routes.music.confirm_mb_match.path,
        params,
      );
    },

    // reject all candidates for an album (admin only). flips
    // `mb_lookup_status` to `Rejected` and clears stored candidates so
    // the next lookup starts fresh.
    rejectMbMatch: (params: s.RejectMbMatchRequest) => {
      return call(
        "music",
        "reject_mb_match",
        routes.music.reject_mb_match.resp,
        routes.music.reject_mb_match.req,
        routes.music.reject_mb_match.method,
        routes.music.reject_mb_match.path,
        params,
      );
    },

    // bulk auto-confirm musicbrainz matches (admin only). confirms the
    // top candidate per album where it clears both a confidence floor
    // and a gap-to-#2 floor. returns per-album confirmed/skipped/errors.
    autoConfirmMbMatches: (params: s.AutoConfirmMbMatchesRequest) => {
      return call(
        "music",
        "auto_confirm_mb_matches",
        routes.music.auto_confirm_mb_matches.resp,
        routes.music.auto_confirm_mb_matches.req,
        routes.music.auto_confirm_mb_matches.method,
        routes.music.auto_confirm_mb_matches.path,
        params,
      );
    },

    // last.fm album-detail bulk enqueue (admin only). spawns one
    // `LastFmAlbumDetail` job per album id, fetching album.getInfo and
    // artist.getInfo and storing the raw response under
    // `metadata.lastfm` for review.
    enqueueLastFmAlbumDetail: (params: s.EnqueueLastFmAlbumDetailRequest) => {
      return call(
        "music",
        "enqueue_lastfm_album_detail",
        routes.music.enqueue_lastfm_album_detail.resp,
        routes.music.enqueue_lastfm_album_detail.req,
        routes.music.enqueue_lastfm_album_detail.method,
        routes.music.enqueue_lastfm_album_detail.path,
        params,
      );
    },

    // theaudiodb album-detail bulk enqueue (admin only). spawns one
    // `AudioDbAlbumDetail` job per album id, fetching the album record
    // (by mbid or text-search) and the artist record (by mbid), and
    // storing the captured snapshot under `metadata.audiodb` for review.
    enqueueAudioDbAlbumDetail: (params: s.EnqueueAudioDbAlbumDetailRequest) => {
      return call(
        "music",
        "enqueue_audiodb_album_detail",
        routes.music.enqueue_audiodb_album_detail.resp,
        routes.music.enqueue_audiodb_album_detail.req,
        routes.music.enqueue_audiodb_album_detail.method,
        routes.music.enqueue_audiodb_album_detail.path,
        params,
      );
    },

    // special routes - these exist for route coverage but have alternate implementations
    // for actual blob streaming, use client.fetchBlob(id) instead
    streamBlob: (params: { id: string }) => {
      return call(
        "music",
        "stream_blob",
        routes.music.stream_blob.resp,
        routes.music.stream_blob.req,
        routes.music.stream_blob.method,
        routes.music.stream_blob.path,
        params,
      );
    },

    // for blob thumbnails - returns binary image data
    getBlobThumbnail: (params: { id: string; size: string }) => {
      return call(
        "music",
        "get_blob_thumbnail",
        routes.music.get_blob_thumbnail.resp,
        routes.music.get_blob_thumbnail.req,
        routes.music.get_blob_thumbnail.method,
        routes.music.get_blob_thumbnail.path,
        params,
      );
    },

    // for image uploads, use utils.uploadImage() which handles FormData properly
    uploadImage: () => {
      return call(
        "music",
        "upload_image",
        routes.music.upload_image.resp,
        routes.music.upload_image.req,
        routes.music.upload_image.method,
        routes.music.upload_image.path,
        undefined,
      );
    },

    // for music uploads, use utils.uploadMusic() which handles FormData properly
    uploadMusic: () => {
      return call(
        "music",
        "upload_music",
        routes.music.upload_music.resp,
        routes.music.upload_music.req,
        routes.music.upload_music.method,
        routes.music.upload_music.path,
        undefined,
      );
    },

    // ----------------------------------------------------------------------
    // taxonomy (cross-kind labels: genre, label, mood, era, region, ...)
    // ----------------------------------------------------------------------

    listTaxonKinds: () => {
      return call(
        "music",
        "list_taxon_kinds",
        routes.music.list_taxon_kinds.resp,
        routes.music.list_taxon_kinds.req,
        routes.music.list_taxon_kinds.method,
        routes.music.list_taxon_kinds.path,
        undefined,
      );
    },

    createTaxonKind: (params: s.CreateTaxonKindRequest) => {
      return call(
        "music",
        "create_taxon_kind",
        routes.music.create_taxon_kind.resp,
        routes.music.create_taxon_kind.req,
        routes.music.create_taxon_kind.method,
        routes.music.create_taxon_kind.path,
        params,
      );
    },

    listTaxonsByKind: (params: s.ListTaxonsByKindRequest) => {
      return call(
        "music",
        "list_taxons_by_kind",
        routes.music.list_taxons_by_kind.resp,
        routes.music.list_taxons_by_kind.req,
        routes.music.list_taxons_by_kind.method,
        routes.music.list_taxons_by_kind.path,
        params,
      );
    },

    queryTaxons: (params: s.QueryTaxonsRequest) => {
      return call(
        "music",
        "query_taxons",
        routes.music.query_taxons.resp,
        routes.music.query_taxons.req,
        routes.music.query_taxons.method,
        routes.music.query_taxons.path,
        params,
      );
    },

    getTaxon: (params: s.GetTaxonRequest) => {
      return call(
        "music",
        "get_taxon",
        routes.music.get_taxon.resp,
        routes.music.get_taxon.req,
        routes.music.get_taxon.method,
        routes.music.get_taxon.path,
        params,
      );
    },

    createTaxon: (params: s.CreateTaxonRequest) => {
      return call(
        "music",
        "create_taxon",
        routes.music.create_taxon.resp,
        routes.music.create_taxon.req,
        routes.music.create_taxon.method,
        routes.music.create_taxon.path,
        params,
      );
    },

    deleteTaxon: (params: s.DeleteTaxonRequest) => {
      return call(
        "music",
        "delete_taxon",
        routes.music.delete_taxon.resp,
        routes.music.delete_taxon.req,
        routes.music.delete_taxon.method,
        routes.music.delete_taxon.path,
        params,
      );
    },

    addTaxonParent: (params: s.AddTaxonParentRequest) => {
      return call(
        "music",
        "add_taxon_parent",
        routes.music.add_taxon_parent.resp,
        routes.music.add_taxon_parent.req,
        routes.music.add_taxon_parent.method,
        routes.music.add_taxon_parent.path,
        params,
      );
    },

    listTaxonParentsForKind: (params: s.ListTaxonParentsForKindRequest) => {
      return call(
        "music",
        "list_taxon_parents_for_kind",
        routes.music.list_taxon_parents_for_kind.resp,
        routes.music.list_taxon_parents_for_kind.req,
        routes.music.list_taxon_parents_for_kind.method,
        routes.music.list_taxon_parents_for_kind.path,
        params,
      );
    },

    removeTaxonParent: (params: s.RemoveTaxonParentRequest) => {
      return call(
        "music",
        "remove_taxon_parent",
        routes.music.remove_taxon_parent.resp,
        routes.music.remove_taxon_parent.req,
        routes.music.remove_taxon_parent.method,
        routes.music.remove_taxon_parent.path,
        params,
      );
    },

    getTaxonAncestors: (params: s.GetTaxonRequest) => {
      return call(
        "music",
        "get_taxon_ancestors",
        routes.music.get_taxon_ancestors.resp,
        routes.music.get_taxon_ancestors.req,
        routes.music.get_taxon_ancestors.method,
        routes.music.get_taxon_ancestors.path,
        params,
      );
    },

    getTaxonDescendants: (params: s.GetTaxonRequest) => {
      return call(
        "music",
        "get_taxon_descendants",
        routes.music.get_taxon_descendants.resp,
        routes.music.get_taxon_descendants.req,
        routes.music.get_taxon_descendants.method,
        routes.music.get_taxon_descendants.path,
        params,
      );
    },

    getAlbumTaxonLinks: (params: s.GetAlbumTaxonLinksRequest) => {
      return call(
        "music",
        "get_album_taxon_links",
        routes.music.get_album_taxon_links.resp,
        routes.music.get_album_taxon_links.req,
        routes.music.get_album_taxon_links.method,
        routes.music.get_album_taxon_links.path,
        params,
      );
    },

    addAlbumTaxon: (params: s.AddAlbumTaxonRequest) => {
      return call(
        "music",
        "add_album_taxon",
        routes.music.add_album_taxon.resp,
        routes.music.add_album_taxon.req,
        routes.music.add_album_taxon.method,
        routes.music.add_album_taxon.path,
        params,
      );
    },

    removeAlbumTaxon: (params: s.RemoveAlbumTaxonRequest) => {
      return call(
        "music",
        "remove_album_taxon",
        routes.music.remove_album_taxon.resp,
        routes.music.remove_album_taxon.req,
        routes.music.remove_album_taxon.method,
        routes.music.remove_album_taxon.path,
        params,
      );
    },

    setAlbumTaxons: (params: s.SetAlbumTaxonsRequest) => {
      return call(
        "music",
        "set_album_taxons",
        routes.music.set_album_taxons.resp,
        routes.music.set_album_taxons.req,
        routes.music.set_album_taxons.method,
        routes.music.set_album_taxons.path,
        params,
      );
    },

    set_taxon_color: (params: s.SetTaxonColorRequest) => {
      return call(
        "music",
        "set_taxon_color",
        routes.music.set_taxon_color.resp,
        routes.music.set_taxon_color.req,
        routes.music.set_taxon_color.method,
        routes.music.set_taxon_color.path,
        params,
      );
    },

    set_taxon_kind_color: (params: s.SetTaxonKindColorRequest) => {
      return call(
        "music",
        "set_taxon_kind_color",
        routes.music.set_taxon_kind_color.resp,
        routes.music.set_taxon_kind_color.req,
        routes.music.set_taxon_kind_color.method,
        routes.music.set_taxon_kind_color.path,
        params,
      );
    },

    setScalarAttribute: (params: s.SetScalarAttributeRequest) => {
      return call(
        "music",
        "set_scalar_attribute",
        routes.music.set_scalar_attribute.resp,
        routes.music.set_scalar_attribute.req,
        routes.music.set_scalar_attribute.method,
        routes.music.set_scalar_attribute.path,
        params,
      );
    },

    queryAlbumsByScalarRange: (params: s.QueryScalarRangeRequest) => {
      return call(
        "music",
        "query_albums_by_scalar_range",
        routes.music.query_albums_by_scalar_range.resp,
        routes.music.query_albums_by_scalar_range.req,
        routes.music.query_albums_by_scalar_range.method,
        routes.music.query_albums_by_scalar_range.path,
        params,
      );
    },

    // bulk-enrichment review (phase 14.4e). spawns one
    // `AlbumEnrichmentPipeline` job per album_id with shared session_id
    // so the caller can poll progress / cancel as a group.
    enqueueBulkEnrichment: (params: s.BulkEnrichmentRequest) => {
      return call(
        "music",
        "enqueue_bulk_enrichment",
        routes.music.enqueue_bulk_enrichment.resp,
        routes.music.enqueue_bulk_enrichment.req,
        routes.music.enqueue_bulk_enrichment.method,
        routes.music.enqueue_bulk_enrichment.path,
        params,
      );
    },

    // cancel all pending/running jobs in a bulk-enrichment session
    // (phase 14.4e). already-completed jobs are left untouched.
    cancelBulkEnrichment: (params: s.CancelBulkEnrichmentRequest) => {
      return call(
        "music",
        "cancel_bulk_enrichment",
        routes.music.cancel_bulk_enrichment.resp,
        routes.music.cancel_bulk_enrichment.req,
        routes.music.cancel_bulk_enrichment.method,
        routes.music.cancel_bulk_enrichment.path,
        params,
      );
    },

    // fetch per-source enrichment status for a batch of album ids
    // (phase 14.4e). used by the review modal to render status badges +
    // last-error / retry-count.
    getEnrichmentProgress: (params: s.GetEnrichmentProgressRequest) => {
      return call(
        "music",
        "get_enrichment_progress",
        routes.music.get_enrichment_progress.resp,
        routes.music.get_enrichment_progress.req,
        routes.music.get_enrichment_progress.method,
        routes.music.get_enrichment_progress.path,
        params,
      );
    },

    // re-enqueue a single source for a single album with optional
    // override query (phase 14.5). supports per-album manual retry from
    // the review modal's per-source tab.
    requeryEnrichment: (params: s.RequeryEnrichmentRequest) => {
      return call(
        "music",
        "requery_enrichment",
        routes.music.requery_enrichment.resp,
        routes.music.requery_enrichment.req,
        routes.music.requery_enrichment.method,
        routes.music.requery_enrichment.path,
        params,
      );
    },

    // download a remote image url and link it to an album or artist
    // (phase 14.6). dedups by sha256.
    ingestRemoteImage: (params: s.IngestRemoteImageRequest) => {
      return call(
        "music",
        "ingest_remote_image",
        routes.music.ingest_remote_image.resp,
        routes.music.ingest_remote_image.req,
        routes.music.ingest_remote_image.method,
        routes.music.ingest_remote_image.path,
        params,
      );
    },

    // surface remote image candidates for an album from stored
    // metadata snapshots (audiodb thumbs + musicbrainz coverart).
    // read-only — does not make any external http calls.
    albumImageCandidates: (params: s.AlbumImageCandidatesRequest) => {
      return call(
        "music",
        "image_candidates_for_album",
        routes.music.image_candidates_for_album.resp,
        routes.music.image_candidates_for_album.req,
        routes.music.image_candidates_for_album.method,
        routes.music.image_candidates_for_album.path,
        params,
      );
    },

    // surface remote image candidates for an artist from stored
    // metadata snapshots (audiodb artist_thumb / artist_fanart).
    // accepts artist_id directly OR album_id (resolved server-side).
    artistImageCandidates: (params: s.ArtistImageCandidatesRequest) => {
      return call(
        "music",
        "image_candidates_for_artist",
        routes.music.image_candidates_for_artist.resp,
        routes.music.image_candidates_for_artist.req,
        routes.music.image_candidates_for_artist.method,
        routes.music.image_candidates_for_artist.path,
        params,
      );
    },

    // update an artist's enrichment metadata blob (phase 14.10).
    // never touches `name`. honours skip-if-complete unless `force=true`.
    updateArtistMetadata: (params: s.UpdateArtistMetadataRequest) => {
      return call(
        "music",
        "update_artist_metadata",
        routes.music.update_artist_metadata.resp,
        routes.music.update_artist_metadata.req,
        routes.music.update_artist_metadata.method,
        routes.music.update_artist_metadata.path,
        params,
      );
    },

    // related-artists (phase 13h). cross-source index of artist
    // recommendations harvested from lastfm / audiodb / mb enrichment.
    listRelatedArtists: (params: s.ListRelatedArtistsRequest) => {
      return call(
        "music",
        "list_related_artists",
        routes.music.list_related_artists.resp,
        routes.music.list_related_artists.req,
        routes.music.list_related_artists.method,
        routes.music.list_related_artists.path,
        params,
      );
    },

    // batched lookup: fetch related-artist lists for many source artists in
    // one round trip. avoids fanning out N calls when rendering large graphs.
    listRelatedArtistsBatch: (params: s.ListRelatedArtistsBatchRequest) => {
      return call(
        "music",
        "list_related_artists_batch",
        routes.music.list_related_artists_batch.resp,
        routes.music.list_related_artists_batch.req,
        routes.music.list_related_artists_batch.method,
        routes.music.list_related_artists_batch.path,
        params,
      );
    },

    // admin-only manual override for a related artist's bandcamp links.
    setRelatedArtistBandcamp: (params: s.SetRelatedArtistBandcampRequest) => {
      return call(
        "music",
        "set_related_artist_bandcamp",
        routes.music.set_related_artist_bandcamp.resp,
        routes.music.set_related_artist_bandcamp.req,
        routes.music.set_related_artist_bandcamp.method,
        routes.music.set_related_artist_bandcamp.path,
        params,
      );
    },

    // cross-remote walk routes (phase 11). all POST. used by the graph
    // viz's lazy walk-expansion to fetch membership / taxons / merged
    // entities in a single round trip per (remote, hub) pair.

    // list albums belonging to a (kind, value_norm) taxon. supports
    // optional limit + offset for paging large clusters.
    albumsByValue: (params: s.AlbumsByValueRequest) => {
      return call(
        "music",
        "albums_by_value",
        routes.music.albums_by_value.resp,
        routes.music.albums_by_value.req,
        routes.music.albums_by_value.method,
        routes.music.albums_by_value.path,
        params,
      );
    },

    // batched lookup: fetch taxons for many entities (album OR artist)
    // in one round trip. avoids N+1 when walk-expanding a cluster.
    entityTaxonsBatch: (params: s.EntityTaxonsBatchRequest) => {
      return call(
        "music",
        "entity_taxons_batch",
        routes.music.entity_taxons_batch.resp,
        routes.music.entity_taxons_batch.req,
        routes.music.entity_taxons_batch.method,
        routes.music.entity_taxons_batch.path,
        params,
      );
    },

    // confirm which entities on this remote match a list of merged
    // keys (lowercased "artist::title" / "artist"). used for
    // per-remote chip rendering in popovers and for cross-remote
    // dedup validation.
    findByMergedKey: (params: s.FindByMergedKeyRequest) => {
      return call(
        "music",
        "find_by_merged_key",
        routes.music.find_by_merged_key.resp,
        routes.music.find_by_merged_key.req,
        routes.music.find_by_merged_key.method,
        routes.music.find_by_merged_key.path,
        params,
      );
    },

    // phase 22: synthesized first-order hubs. these are server-side
    // computed clusters that don't correspond to a stored taxon —
    // currently stubs (era_bins returns []), but the routes are
    // wired so the client can render hub nodes + degrade gracefully.

    // greedy decade-aware year binning for the "era" hub. server
    // returns empty bins until the heuristic ships; clients should
    // treat zero bins as "feature not yet available".
    eraBins: (params: s.EraBinsRequest) => {
      return call(
        "music",
        "era_bins",
        routes.music.era_bins.resp,
        routes.music.era_bins.req,
        routes.music.era_bins.method,
        routes.music.era_bins.path,
        params,
      );
    },

    // top-N most recently added albums, ordered by album_created_at
    // desc. enriched with artist + images + favorites so the graph
    // can render the hub's child albums without follow-up fetches.
    recentlyAddedAlbums: (params: s.RecentlyAddedAlbumsRequest) => {
      return call(
        "music",
        "recently_added_albums",
        routes.music.recently_added_albums.resp,
        routes.music.recently_added_albums.req,
        routes.music.recently_added_albums.method,
        routes.music.recently_added_albums.path,
        params,
      );
    },

    // fan-out one era bin to its member albums (release_date year
    // inside [min_year, max_year]). enriched album shape mirrors
    // recentlyAddedAlbums/albumsByValue so a single adapter handles
    // all walk-pulled albums.
    eraAlbums: (params: s.EraAlbumsRequest) => {
      return call(
        "music",
        "era_albums",
        routes.music.era_albums.resp,
        routes.music.era_albums.req,
        routes.music.era_albums.method,
        routes.music.era_albums.path,
        params,
      );
    },

    // fan-out the synthesized "unassigned" hub to its member albums.
    // when kind_slug is null/empty, returns albums with no taxon
    // assignments of any kind (fully untagged); otherwise restricts
    // the missing-check to the given kind only. paged (default 100,
    // max 500).
    unassignedAlbums: (params: s.UnassignedAlbumsRequest) => {
      return call(
        "music",
        "unassigned_albums",
        routes.music.unassigned_albums.resp,
        routes.music.unassigned_albums.req,
        routes.music.unassigned_albums.method,
        routes.music.unassigned_albums.path,
        params,
      );
    },
  };
}

export type MusicMethods = ReturnType<typeof createMusicMethods>;
