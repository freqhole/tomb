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
        "music", "search",
        routes.music.search.resp,
        routes.music.search.req,
        routes.music.search.method,
        routes.music.search.path,
        params,
      );
    },

    suggestions: (params: s.SuggestionsRequest) => {
      return call(
        "music", "suggestions",
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
        "music", "query_songs",
        routes.music.query_songs.resp,
        routes.music.query_songs.req,
        routes.music.query_songs.method,
        routes.music.query_songs.path,
        params,
      );
    },

    recentSongs: (params: s.RecentSongsRequest) => {
      return call(
        "music", "recent_songs",
        routes.music.recent_songs.resp,
        routes.music.recent_songs.req,
        routes.music.recent_songs.method,
        routes.music.recent_songs.path,
        params,
      );
    },

    updateSongs: (params: Partial<s.UpdateSongsRequest> & { song_ids: string[] }) => {
      return call(
        "music", "update_songs",
        routes.music.update_songs.resp,
        UpdateSongsRequestPartialSchema,
        routes.music.update_songs.method,
        routes.music.update_songs.path,
        params,
      );
    },

    deleteSong: (params: s.DeleteSongRequest) => {
      return call(
        "music", "delete_song",
        routes.music.delete_song.resp,
        routes.music.delete_song.req,
        routes.music.delete_song.method,
        routes.music.delete_song.path,
        params,
      );
    },

    // albums
    queryAlbums: (params: s.QueryParams) => {
      return call(
        "music", "query_albums",
        routes.music.query_albums.resp,
        routes.music.query_albums.req,
        routes.music.query_albums.method,
        routes.music.query_albums.path,
        params,
      );
    },

    getAlbum: (params: s.GetAlbumRequest) => {
      return call(
        "music", "get_album",
        routes.music.get_album.resp,
        routes.music.get_album.req,
        routes.music.get_album.method,
        routes.music.get_album.path,
        params,
      );
    },

    updateAlbum: (params: Partial<s.UpdateAlbumRequest> & { album_id: string }) => {
      return call(
        "music", "update_album",
        routes.music.update_album.resp,
        UpdateAlbumRequestPartialSchema,
        routes.music.update_album.method,
        routes.music.update_album.path,
        params,
      );
    },

    deleteAlbum: (params: s.DeleteAlbumRequest) => {
      return call(
        "music", "delete_album",
        routes.music.delete_album.resp,
        routes.music.delete_album.req,
        routes.music.delete_album.method,
        routes.music.delete_album.path,
        params,
      );
    },

    getAlbumImages: (params: { id: string }) => {
      return call(
        "music", "get_album_images",
        routes.music.get_album_images.resp,
        routes.music.get_album_images.req,
        routes.music.get_album_images.method,
        routes.music.get_album_images.path,
        params,
      );
    },

    // artists
    queryArtists: (params: s.QueryParams) => {
      return call(
        "music", "query_artists",
        routes.music.query_artists.resp,
        routes.music.query_artists.req,
        routes.music.query_artists.method,
        routes.music.query_artists.path,
        params,
      );
    },

    getArtist: (params: s.GetArtistRequest) => {
      return call(
        "music", "get_artist",
        routes.music.get_artist.resp,
        routes.music.get_artist.req,
        routes.music.get_artist.method,
        routes.music.get_artist.path,
        params,
      );
    },

    createArtist: (params: s.CreateArtistRequest) => {
      return call(
        "music", "create_artist",
        routes.music.create_artist.resp,
        routes.music.create_artist.req,
        routes.music.create_artist.method,
        routes.music.create_artist.path,
        params,
      );
    },

    updateArtist: (params: Partial<s.UpdateArtistRequest> & { artist_id: string }) => {
      return call(
        "music", "update_artist",
        routes.music.update_artist.resp,
        UpdateArtistRequestPartialSchema,
        routes.music.update_artist.method,
        routes.music.update_artist.path,
        params,
      );
    },

    deleteArtist: (params: s.DeleteArtistRequest) => {
      return call(
        "music", "delete_artist",
        routes.music.delete_artist.resp,
        routes.music.delete_artist.req,
        routes.music.delete_artist.method,
        routes.music.delete_artist.path,
        params,
      );
    },

    getArtistImages: (params: { id: string }) => {
      return call(
        "music", "get_artist_images",
        routes.music.get_artist_images.resp,
        routes.music.get_artist_images.req,
        routes.music.get_artist_images.method,
        routes.music.get_artist_images.path,
        params,
      );
    },

    // genres
    queryGenres: (params: s.QueryParams) => {
      return call(
        "music", "query_genres",
        routes.music.query_genres.resp,
        routes.music.query_genres.req,
        routes.music.query_genres.method,
        routes.music.query_genres.path,
        params,
      );
    },

    getGenre: (params: s.GetGenreRequest) => {
      return call(
        "music", "get_genre",
        routes.music.get_genre.resp,
        routes.music.get_genre.req,
        routes.music.get_genre.method,
        routes.music.get_genre.path,
        params,
      );
    },

    // playlists
    listPlaylists: (params: s.QueryParams) => {
      return call(
        "music", "list_playlists",
        routes.music.list_playlists.resp,
        routes.music.list_playlists.req,
        routes.music.list_playlists.method,
        routes.music.list_playlists.path,
        params,
      );
    },

    getPlaylistById: (params: s.GetPlaylistRequest) => {
      return call(
        "music", "get_playlist_by_id",
        routes.music.get_playlist_by_id.resp,
        routes.music.get_playlist_by_id.req,
        routes.music.get_playlist_by_id.method,
        routes.music.get_playlist_by_id.path,
        params,
      );
    },

    getPlaylistEtag: (params: s.GetPlaylistRequest) => {
      const path = routes.music.get_playlist_etag.path.replace("{id}", params.id);
      return call(
        "music", "get_playlist_etag",
        routes.music.get_playlist_etag.resp,
        routes.music.get_playlist_etag.req,
        routes.music.get_playlist_etag.method,
        path,
        params,
      );
    },

    getPlaylistImages: (params: { id: string }) => {
      return call(
        "music", "get_playlist_images",
        routes.music.get_playlist_images.resp,
        routes.music.get_playlist_images.req,
        routes.music.get_playlist_images.method,
        routes.music.get_playlist_images.path,
        params,
      );
    },

    createPlaylist: (params: s.CreatePlaylistRequest) => {
      return call(
        "music", "create_playlist",
        routes.music.create_playlist.resp,
        routes.music.create_playlist.req,
        routes.music.create_playlist.method,
        routes.music.create_playlist.path,
        params,
      );
    },

    updatePlaylist: (params: s.UpdatePlaylistRequest) => {
      return call(
        "music", "update_playlist",
        routes.music.update_playlist.resp,
        routes.music.update_playlist.req,
        routes.music.update_playlist.method,
        routes.music.update_playlist.path,
        params,
      );
    },

    deletePlaylist: (params: s.DeletePlaylistRequest) => {
      return call(
        "music", "delete_playlist",
        routes.music.delete_playlist.resp,
        routes.music.delete_playlist.req,
        routes.music.delete_playlist.method,
        routes.music.delete_playlist.path,
        params,
      );
    },

    queryPlaylistSongs: (params: s.QueryPlaylistSongsRequest) => {
      return call(
        "music", "query_playlist_songs",
        routes.music.query_playlist_songs.resp,
        routes.music.query_playlist_songs.req,
        routes.music.query_playlist_songs.method,
        routes.music.query_playlist_songs.path,
        params,
      );
    },

    addSongsToPlaylist: (params: s.AddSongsToPlaylistRequest) => {
      return call(
        "music", "add_songs_to_playlist",
        routes.music.add_songs_to_playlist.resp,
        routes.music.add_songs_to_playlist.req,
        routes.music.add_songs_to_playlist.method,
        routes.music.add_songs_to_playlist.path,
        params,
      );
    },

    removeSongsFromPlaylist: (params: s.RemoveSongsFromPlaylistRequest) => {
      return call(
        "music", "remove_songs_from_playlist",
        routes.music.remove_songs_from_playlist.resp,
        routes.music.remove_songs_from_playlist.req,
        routes.music.remove_songs_from_playlist.method,
        routes.music.remove_songs_from_playlist.path,
        params,
      );
    },

    reorderPlaylistSongs: (params: s.ReorderPlaylistSongsRequest) => {
      return call(
        "music", "reorder_playlist_songs",
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
        "music", "list_tags",
        routes.music.list_tags.resp,
        routes.music.list_tags.req,
        routes.music.list_tags.method,
        routes.music.list_tags.path,
      );
    },

    getTag: (params: s.GetTagRequest) => {
      return call(
        "music", "get_tag",
        routes.music.get_tag.resp,
        routes.music.get_tag.req,
        routes.music.get_tag.method,
        routes.music.get_tag.path,
        params,
      );
    },

    queryTags: (params: s.QueryTagsRequest) => {
      return call(
        "music", "query_tags",
        routes.music.query_tags.resp,
        routes.music.query_tags.req,
        routes.music.query_tags.method,
        routes.music.query_tags.path,
        params,
      );
    },

    deleteTag: (params: s.DeleteTagRequest) => {
      return call(
        "music", "delete_tag",
        routes.music.delete_tag.resp,
        routes.music.delete_tag.req,
        routes.music.delete_tag.method,
        routes.music.delete_tag.path,
        params,
      );
    },

    getAlbumsTags: (params: s.GetAlbumsTagsRequest) => {
      return call(
        "music", "get_albums_tags",
        routes.music.get_albums_tags.resp,
        routes.music.get_albums_tags.req,
        routes.music.get_albums_tags.method,
        routes.music.get_albums_tags.path,
        params,
      );
    },

    addAlbumsTags: (params: s.AddAlbumsTagsRequest) => {
      return call(
        "music", "add_albums_tags",
        routes.music.add_albums_tags.resp,
        routes.music.add_albums_tags.req,
        routes.music.add_albums_tags.method,
        routes.music.add_albums_tags.path,
        params,
      );
    },

    removeAlbumsTags: (params: s.RemoveAlbumsTagsRequest) => {
      return call(
        "music", "remove_albums_tags",
        routes.music.remove_albums_tags.resp,
        routes.music.remove_albums_tags.req,
        routes.music.remove_albums_tags.method,
        routes.music.remove_albums_tags.path,
        params,
      );
    },

    replaceAlbumsTags: (params: s.ReplaceAlbumsTagsRequest) => {
      return call(
        "music", "replace_albums_tags",
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
        "music", "set_rating",
        routes.music.set_rating.resp,
        routes.music.set_rating.req,
        routes.music.set_rating.method,
        routes.music.set_rating.path,
        params,
      );
    },

    removeRating: (params: s.RemoveRatingRequest) => {
      return call(
        "music", "remove_rating",
        routes.music.remove_rating.resp,
        routes.music.remove_rating.req,
        routes.music.remove_rating.method,
        routes.music.remove_rating.path,
        params,
      );
    },

    getRatingStats: (params: s.GetRatingStatsRequest) => {
      return call(
        "music", "get_rating_stats",
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
        "music", "list_favorites",
        ListFavoritesResponseSchema,  // use hand-rolled schema for discriminated union
        routes.music.list_favorites.req,
        routes.music.list_favorites.method,
        routes.music.list_favorites.path,
        params,
      );
    },

    setFavorite: (params: s.SetFavoriteRequest) => {
      return call(
        "music", "set_favorite",
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
        "music", "record_play",
        routes.music.record_play.resp,
        routes.music.record_play.req,
        routes.music.record_play.method,
        routes.music.record_play.path,
        params,
      );
    },

    activityFeed: (params: s.FeedRequest) => {
      return call(
        "music", "activity_feed",
        routes.music.activity_feed.resp,
        routes.music.activity_feed.req,
        routes.music.activity_feed.method,
        routes.music.activity_feed.path,
        params,
      );
    },

    listeningHistory: (params: s.ListeningHistoryRequest) => {
      return call(
        "music", "listening_history",
        routes.music.listening_history.resp,
        routes.music.listening_history.req,
        routes.music.listening_history.method,
        routes.music.listening_history.path,
        params,
      );
    },

    songAnalytics: (params: s.SongAnalyticsRequest) => {
      return call(
        "music", "song_analytics",
        routes.music.song_analytics.resp,
        routes.music.song_analytics.req,
        routes.music.song_analytics.method,
        routes.music.song_analytics.path,
        params,
      );
    },

    topSongs: (params: s.TopSongsRequest) => {
      return call(
        "music", "top_songs",
        routes.music.top_songs.resp,
        routes.music.top_songs.req,
        routes.music.top_songs.method,
        routes.music.top_songs.path,
        params,
      );
    },

    topAlbums: (params: s.TopAlbumsRequest) => {
      return call(
        "music", "top_albums",
        routes.music.top_albums.resp,
        routes.music.top_albums.req,
        routes.music.top_albums.method,
        routes.music.top_albums.path,
        params,
      );
    },

    topArtists: (params: s.TopArtistsRequest) => {
      return call(
        "music", "top_artists",
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
        "music", "create_listen_session",
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
        "music", "get_listen_session",
        routes.music.get_listen_session.resp,
        routes.music.get_listen_session.req,
        routes.music.get_listen_session.method,
        path,
      );
    },

    deleteListenSession: (id: string) => {
      const path = routes.music.delete_listen_session.path.replace("{id}", id);
      return call(
        "music", "delete_listen_session",
        routes.music.delete_listen_session.resp,
        routes.music.delete_listen_session.req,
        routes.music.delete_listen_session.method,
        path,
      );
    },

    updateListenSessionProgress: (id: string, params: s.UpdateListenSessionProgressRequest) => {
      const path = routes.music.update_listen_session_progress.path.replace("{id}", id);
      return call(
        "music", "update_listen_session_progress",
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
        "music", "update_listen_session_status",
        routes.music.update_listen_session_status.resp,
        routes.music.update_listen_session_status.req,
        routes.music.update_listen_session_status.method,
        path,
      );
    },

    updateListenSessionSongs: (id: string, params: s.UpdateListenSessionSongsRequest) => {
      const path = routes.music.update_listen_session_songs.path.replace("{id}", id);
      return call(
        "music", "update_listen_session_songs",
        routes.music.update_listen_session_songs.resp,
        routes.music.update_listen_session_songs.req,
        routes.music.update_listen_session_songs.method,
        path,
        params,
      );
    },

    listListenSessions: (params: s.ListListenSessionsRequest) => {
      return call(
        "music", "list_listen_sessions",
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
        "music", "get_job_status",
        routes.music.get_job_status.resp,
        routes.music.get_job_status.req,
        routes.music.get_job_status.method,
        routes.music.get_job_status.path,
        params,
      );
    },

    listJobs: (params: s.ListJobsRequest) => {
      return call(
        "music", "list_jobs",
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
        "music", "blob_metadata",
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
        "music", "delete_image",
        routes.music.delete_image.resp,
        routes.music.delete_image.req,
        routes.music.delete_image.method,
        routes.music.delete_image.path,
        params,
      );
    },

    setPrimaryImage: (params: s.SetPrimaryImageRequest) => {
      return call(
        "music", "set_primary_image",
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
        "music", "get_musicbrainz_release",
        routes.music.get_musicbrainz_release.resp,
        routes.music.get_musicbrainz_release.req,
        routes.music.get_musicbrainz_release.method,
        routes.music.get_musicbrainz_release.path,
        params,
      );
    },

    searchMusicbrainzReleases: (params: s.SearchReleasesRequest) => {
      return call(
        "music", "search_musicbrainz_releases",
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
        "music", "create_fetch_job",
        routes.music.create_fetch_job.resp,
        routes.music.create_fetch_job.req,
        routes.music.create_fetch_job.method,
        routes.music.create_fetch_job.path,
        params,
      );
    },

    getFetchJob: (params: s.GetJobRequest) => {
      return call(
        "music", "get_fetch_job",
        routes.music.get_fetch_job.resp,
        routes.music.get_fetch_job.req,
        routes.music.get_fetch_job.method,
        routes.music.get_fetch_job.path,
        params,
      );
    },

    // special routes - these exist for route coverage but have alternate implementations
    // for actual blob streaming, use client.fetchBlob(id) instead
    streamBlob: (params: { id: string }) => {
      return call(
        "music", "stream_blob",
        routes.music.stream_blob.resp,
        routes.music.stream_blob.req,
        routes.music.stream_blob.method,
        routes.music.stream_blob.path,
        params,
      );
    },

    // for image uploads, use utils.uploadImage() which handles FormData properly
    uploadImage: () => {
      return call(
        "music", "upload_image",
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
        "music", "upload_music",
        routes.music.upload_music.resp,
        routes.music.upload_music.req,
        routes.music.upload_music.method,
        routes.music.upload_music.path,
        undefined,
      );
    },
  };
}

export type MusicMethods = ReturnType<typeof createMusicMethods>;
