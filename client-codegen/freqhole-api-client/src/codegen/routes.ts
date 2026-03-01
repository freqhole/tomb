// generated route config
import * as s from './schema';
import { z } from 'zod';

// role hierarchy - lower number = higher privilege
export const roleHierarchy = {
  root: 0,
  admin: 10,
  member: 20,
  viewer: 30,
} as const;

export type UserRoleName = keyof typeof roleHierarchy;
export type RouteAuthType = 'public' | 'authenticated' | 'role' | 'owner' | 'owner_or';
export type RouteAuth =
  | { type: 'public' }
  | { type: 'authenticated' }
  | { type: 'role'; role: UserRoleName }
  | { type: 'owner' }
  | { type: 'owner_or'; role: UserRoleName };

export const routes = {
  music: {
    top_albums: { method: 'POST', path: '/api/analytics/top-albums', req: s.TopAlbumsRequestSchema, resp: s.TopAlbumSchema.array(), auth: { type: 'authenticated' } as const },
    create_listen_session: { method: 'POST', path: '/api/analytics/sessions', req: s.CreateListenSessionRequestSchema, resp: s.ListenSessionSchema, auth: { type: 'role', role: 'member' } as const },
    song_analytics: { method: 'POST', path: '/api/analytics/song-stats', req: s.SongAnalyticsRequestSchema, resp: s.PlayAnalyticsSchema, auth: { type: 'authenticated' } as const },
    top_artists: { method: 'POST', path: '/api/analytics/top-artists', req: s.TopArtistsRequestSchema, resp: s.TopArtistSchema.array(), auth: { type: 'authenticated' } as const },
    activity_feed: { method: 'POST', path: '/api/analytics/feed', req: s.FeedRequestSchema, resp: s.FeedResponseSchema, auth: { type: 'authenticated' } as const },
    delete_listen_session: { method: 'DELETE', path: '/api/analytics/sessions/{id}', req: null, resp: s.EmptyResponseSchema, auth: { type: 'owner' } as const },
    update_listen_session_progress: { method: 'PUT', path: '/api/analytics/sessions/{id}/progress', req: s.UpdateListenSessionProgressRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner' } as const },
    list_listen_sessions: { method: 'POST', path: '/api/analytics/sessions/list', req: s.ListListenSessionsRequestSchema, resp: s.ListListenSessionsResponseSchema, auth: { type: 'authenticated' } as const },
    update_listen_session_songs: { method: 'PUT', path: '/api/analytics/sessions/{id}/songs', req: s.UpdateListenSessionSongsRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner' } as const },
    listening_history: { method: 'POST', path: '/api/analytics/listening-history', req: s.ListeningHistoryRequestSchema, resp: s.ListeningHistoryResponseSchema, auth: { type: 'authenticated' } as const },
    update_listen_session_status: { method: 'PUT', path: '/api/analytics/sessions/{id}/status/{status}', req: null, resp: s.EmptyResponseSchema, auth: { type: 'owner' } as const },
    get_listen_session: { method: 'GET', path: '/api/analytics/sessions/{id}', req: null, resp: s.ListenSessionSchema, auth: { type: 'authenticated' } as const },
    record_play: { method: 'POST', path: '/api/analytics/play', req: s.RecordPlayRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'member' } as const },
    top_songs: { method: 'POST', path: '/api/analytics/top-songs', req: s.TopSongsRequestSchema, resp: s.TopSongSchema.array(), auth: { type: 'authenticated' } as const },
    get_job_status: { method: 'POST', path: '/api/jobs/status', req: s.GetJobsStatusRequestSchema, resp: s.GetJobsStatusResponseSchema, auth: { type: 'authenticated' } as const },
    list_jobs: { method: 'POST', path: '/api/jobs/list', req: s.ListJobsRequestSchema, resp: s.JobResponseSchema.array(), auth: { type: 'authenticated' } as const },
    get_fetch_job: { method: 'GET', path: '/api/music/fetch/{id}', req: s.GetJobRequestSchema, resp: s.JobResponseSchema, auth: { type: 'authenticated' } as const },
    create_fetch_job: { method: 'POST', path: '/api/music/fetch', req: s.FetchMediaParamsSchema, resp: s.JobResponseSchema, auth: { type: 'role', role: 'member' } as const },
    delete_image: { method: 'POST', path: '/api/music/images/delete', req: s.DeleteImageRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    upload_image: { method: 'POST', path: '/api/upload/image', req: null, resp: s.ImageUploadResponseSchema, auth: { type: 'role', role: 'member' } as const },
    set_primary_image: { method: 'POST', path: '/api/music/images/set-primary', req: s.SetPrimaryImageRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    query_albums: { method: 'POST', path: '/api/albums/query', req: s.QueryParamsSchema, resp: s.AlbumsQueryResultSchema, auth: { type: 'authenticated' } as const },
    update_album: { method: 'POST', path: '/api/albums/update', req: s.UpdateAlbumRequestSchema, resp: s.AlbumSchema, auth: { type: 'role', role: 'admin' } as const },
    get_album_images: { method: 'GET', path: '/api/albums/{id}/images', req: null, resp: z.string().array(), auth: { type: 'authenticated' } as const },
    get_album: { method: 'GET', path: '/api/albums/{id}', req: s.GetAlbumRequestSchema, resp: s.AlbumSchema, auth: { type: 'authenticated' } as const },
    delete_album: { method: 'DELETE', path: '/api/albums/{id}', req: s.DeleteAlbumRequestSchema, resp: s.DeleteAlbumResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    get_musicbrainz_release: { method: 'POST', path: '/api/musicbrainz/release', req: s.GetReleaseRequestSchema, resp: s.MbReleaseDetailSchema, auth: { type: 'role', role: 'admin' } as const },
    search_musicbrainz_releases: { method: 'POST', path: '/api/musicbrainz/search/releases', req: s.SearchReleasesRequestSchema, resp: s.MbSearchReleasesResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    upload_music: { method: 'POST', path: '/api/upload/music', req: null, resp: s.MusicUploadResponseSchema, auth: { type: 'role', role: 'member' } as const },
    set_favorite: { method: 'POST', path: '/api/favorites/set', req: s.SetFavoriteRequestSchema, resp: s.SetFavoriteResponseSchema, auth: { type: 'role', role: 'member' } as const },
    list_favorites: { method: 'POST', path: '/api/favorites/list', req: s.ListFavoritesRequestSchema, resp: s.ListFavoritesResponseSchema, auth: { type: 'role', role: 'member' } as const },
    get_genre: { method: 'GET', path: '/api/genres/{id}', req: s.GetGenreRequestSchema, resp: s.GenreSchema, auth: { type: 'authenticated' } as const },
    query_genres: { method: 'POST', path: '/api/genres/query', req: s.QueryParamsSchema, resp: s.GenresQueryResultSchema, auth: { type: 'authenticated' } as const },
    query_songs: { method: 'POST', path: '/api/songs/query', req: s.QueryParamsSchema, resp: s.SongsQueryResultSchema, auth: { type: 'authenticated' } as const },
    update_songs: { method: 'POST', path: '/api/songs/update', req: s.UpdateSongsRequestSchema, resp: s.UpdateSongsResultSchema, auth: { type: 'role', role: 'admin' } as const },
    recent_songs: { method: 'POST', path: '/api/songs/recent', req: s.RecentSongsRequestSchema, resp: s.SongsQueryResultSchema, auth: { type: 'authenticated' } as const },
    delete_song: { method: 'DELETE', path: '/api/songs/{id}', req: s.DeleteSongRequestSchema, resp: s.DeleteSongResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    stream_blob: { method: 'GET', path: '/api/blobs/{id}', req: null, resp: null, auth: { type: 'authenticated' } as const },
    blob_metadata: { method: 'GET', path: '/api/blobs/{id}/metadata', req: null, resp: s.BlobMetadataResponseSchema, auth: { type: 'authenticated' } as const },
    create_playlist: { method: 'POST', path: '/api/music/playlists', req: s.CreatePlaylistRequestSchema, resp: s.PlaylistSchema, auth: { type: 'role', role: 'member' } as const },
    query_playlist_songs: { method: 'POST', path: '/api/playlists/songs', req: s.QueryPlaylistSongsRequestSchema, resp: s.PlaylistSongsQueryResultSchema, auth: { type: 'authenticated' } as const },
    delete_playlist: { method: 'POST', path: '/api/playlists/delete', req: s.DeletePlaylistRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner_or', role: 'admin' } as const },
    get_playlist_by_id: { method: 'GET', path: '/api/music/playlists/{id}', req: s.GetPlaylistRequestSchema, resp: s.PlaylistSchema, auth: { type: 'authenticated' } as const },
    get_playlist_images: { method: 'GET', path: '/api/playlists/{id}/images', req: null, resp: z.string().array(), auth: { type: 'authenticated' } as const },
    reorder_playlist_songs: { method: 'POST', path: '/api/playlists/reorder', req: s.ReorderPlaylistSongsRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner_or', role: 'admin' } as const },
    remove_songs_from_playlist: { method: 'POST', path: '/api/playlists/remove-songs', req: s.RemoveSongsFromPlaylistRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner_or', role: 'admin' } as const },
    list_playlists: { method: 'POST', path: '/api/music/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistsQueryResultSchema, auth: { type: 'authenticated' } as const },
    update_playlist: { method: 'POST', path: '/api/playlists/update', req: s.UpdatePlaylistRequestSchema, resp: s.PlaylistSchema, auth: { type: 'owner_or', role: 'admin' } as const },
    add_songs_to_playlist: { method: 'POST', path: '/api/playlists/add-songs', req: s.AddSongsToPlaylistRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'owner_or', role: 'admin' } as const },
    get_playlist_etag: { method: 'HEAD', path: '/api/music/playlists/{id}/etag', req: s.GetPlaylistRequestSchema, resp: null, auth: { type: 'authenticated' } as const },
    set_rating: { method: 'POST', path: '/api/ratings/set', req: s.SetRatingRequestSchema, resp: s.SetRatingResponseSchema, auth: { type: 'role', role: 'member' } as const },
    remove_rating: { method: 'POST', path: '/api/ratings/remove', req: s.RemoveRatingRequestSchema, resp: s.RemoveRatingResponseSchema, auth: { type: 'role', role: 'member' } as const },
    get_rating_stats: { method: 'POST', path: '/api/ratings/stats', req: s.GetRatingStatsRequestSchema, resp: s.RatingStatsSchema, auth: { type: 'authenticated' } as const },
    query_artists: { method: 'POST', path: '/api/artists/query', req: s.QueryParamsSchema, resp: s.ArtistsQueryResultSchema, auth: { type: 'authenticated' } as const },
    delete_artist: { method: 'DELETE', path: '/api/artists/{id}', req: s.DeleteArtistRequestSchema, resp: s.DeleteArtistResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    update_artist: { method: 'POST', path: '/api/artists/update', req: s.UpdateArtistRequestSchema, resp: s.ArtistSchema, auth: { type: 'role', role: 'admin' } as const },
    create_artist: { method: 'POST', path: '/api/music/artists', req: s.CreateArtistRequestSchema, resp: s.ArtistSchema, auth: { type: 'role', role: 'admin' } as const },
    get_artist: { method: 'GET', path: '/api/artists/{id}', req: s.GetArtistRequestSchema, resp: s.ArtistSchema, auth: { type: 'authenticated' } as const },
    get_artist_images: { method: 'GET', path: '/api/artists/{id}/images', req: null, resp: z.string().array(), auth: { type: 'authenticated' } as const },
    suggestions: { method: 'POST', path: '/api/music/suggestions', req: s.SuggestionsRequestSchema, resp: s.SuggestionsResponseSchema, auth: { type: 'authenticated' } as const },
    search: { method: 'POST', path: '/api/music/search', req: s.SearchRequestSchema, resp: s.SearchResponseSchema, auth: { type: 'authenticated' } as const },
    list_tags: { method: 'GET', path: '/api/tags/list', req: null, resp: s.TagSchema.array(), auth: { type: 'authenticated' } as const },
    add_albums_tags: { method: 'POST', path: '/api/tags/albums/add', req: s.AddAlbumsTagsRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    get_tag: { method: 'POST', path: '/api/tags/get', req: s.GetTagRequestSchema, resp: s.TagSchema, auth: { type: 'authenticated' } as const },
    query_tags: { method: 'POST', path: '/api/tags/query', req: s.QueryTagsRequestSchema, resp: s.TagSchema.array(), auth: { type: 'authenticated' } as const },
    remove_albums_tags: { method: 'POST', path: '/api/tags/albums/remove', req: s.RemoveAlbumsTagsRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    replace_albums_tags: { method: 'POST', path: '/api/tags/albums/replace', req: s.ReplaceAlbumsTagsRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    delete_tag: { method: 'POST', path: '/api/tags/delete', req: s.DeleteTagRequestSchema, resp: s.EmptyResponseSchema, auth: { type: 'role', role: 'admin' } as const },
    get_albums_tags: { method: 'POST', path: '/api/tags/albums/get', req: s.GetAlbumsTagsRequestSchema, resp: s.TagSchema.array(), auth: { type: 'authenticated' } as const },
  },
  auth: {
    api_key_status: { method: 'GET', path: '/api/auth/api-key/status', req: null, resp: s.ApiKeyStatusResponseSchema, auth: { type: 'authenticated' } as const },
    whoami: { method: 'GET', path: '/api/auth/whoami', req: null, resp: s.WhoAmIResponseSchema, auth: { type: 'authenticated' } as const },
    logout: { method: 'POST', path: '/api/auth/logout', req: null, resp: z.any(), auth: { type: 'authenticated' } as const },
    redeem_invite: { method: 'POST', path: '/api/auth/invite', req: s.RedeemInviteRequestSchema, resp: z.any(), auth: { type: 'public' } as const },
    regenerate_api_key: { method: 'POST', path: '/api/auth/api-key/regenerate', req: null, resp: s.ApiKeyRegenerateResponseSchema, auth: { type: 'authenticated' } as const },
    login_finish: { method: 'POST', path: '/api/auth/webauthn/login/finish', req: z.any(), resp: z.any(), auth: { type: 'public' } as const },
    login_start: { method: 'POST', path: '/api/auth/webauthn/login/start', req: s.StartLoginRequestSchema, resp: z.any(), auth: { type: 'public' } as const },
    register_start: { method: 'POST', path: '/api/auth/webauthn/register/start', req: s.RegisterStartRequestSchema, resp: z.any(), auth: { type: 'public' } as const },
    register_finish: { method: 'POST', path: '/api/auth/webauthn/register/finish', req: z.any(), resp: z.any(), auth: { type: 'public' } as const },
  },
  app: {
    server_info: { method: 'GET', path: '/api/hello', req: null, resp: s.ServerInfoResponseSchema, auth: { type: 'public' } as const },
    health_check: { method: 'GET', path: '/health', req: null, resp: s.HealthResponseSchema, auth: { type: 'public' } as const },
  },
} as const;
