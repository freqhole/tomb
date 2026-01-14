// generated route config
import * as s from './schema';
import { z } from 'zod';

export const routes = {
  music: {
    set_rating: { method: 'POST', path: '/api/ratings/set', req: s.SetRatingRequestSchema, resp: s.SetRatingResponseSchema },
    get_rating_stats: { method: 'POST', path: '/api/ratings/stats', req: s.GetRatingStatsRequestSchema, resp: s.RatingStatsSchema },
    remove_rating: { method: 'POST', path: '/api/ratings/remove', req: s.RemoveRatingRequestSchema, resp: s.RemoveRatingResponseSchema },
    query_genres: { method: 'POST', path: '/api/genres/query', req: s.QueryParamsSchema, resp: s.GenresQueryResultSchema },
    get_genre: { method: 'GET', path: '/api/genres/{id}', req: s.GetGenreRequestSchema, resp: s.GenreSchema },
    recent_songs: { method: 'POST', path: '/api/songs/recent', req: s.RecentSongsRequestSchema, resp: s.SongsQueryResultSchema },
    query_songs: { method: 'POST', path: '/api/songs/query', req: s.QueryParamsSchema, resp: s.SongsQueryResultSchema },
    delete_song: { method: 'DELETE', path: '/api/songs/{id}', req: s.DeleteSongRequestSchema, resp: s.DeleteSongResponseSchema },
    update_songs: { method: 'POST', path: '/api/songs/update', req: s.UpdateSongsRequestSchema, resp: s.UpdateSongsResultSchema },
    query_albums: { method: 'POST', path: '/api/albums/query', req: s.QueryParamsSchema, resp: s.AlbumsQueryResultSchema },
    get_album: { method: 'GET', path: '/api/albums/{id}', req: s.GetAlbumRequestSchema, resp: s.AlbumSchema },
    delete_album: { method: 'DELETE', path: '/api/albums/{id}', req: s.DeleteAlbumRequestSchema, resp: s.DeleteAlbumResponseSchema },
    create_fetch_job: { method: 'POST', path: '/api/music/fetch', req: s.FetchMediaParamsSchema, resp: s.JobSchema },
    get_fetch_job: { method: 'GET', path: '/api/music/fetch/{id}', req: null, resp: s.JobSchema },
    list_playlists: { method: 'POST', path: '/api/music/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistQueryResultSchema.array() },
    create_playlist: { method: 'POST', path: '/api/music/playlists', req: s.CreatePlaylistRequestSchema, resp: s.PlaylistSchema },
    get_playlist_by_id: { method: 'GET', path: '/api/music/playlists/{id}', req: null, resp: s.PlaylistSchema },
    delete_artist: { method: 'DELETE', path: '/api/artists/{id}', req: s.DeleteArtistRequestSchema, resp: s.DeleteArtistResponseSchema },
    query_artists: { method: 'POST', path: '/api/artists/query', req: s.QueryParamsSchema, resp: s.ArtistsQueryResultSchema },
    get_artist: { method: 'GET', path: '/api/artists/{id}', req: s.GetArtistRequestSchema, resp: s.ArtistSchema },
    create_artist: { method: 'POST', path: '/api/music/artists', req: s.CreateArtistRequestSchema, resp: s.ArtistSchema },
    set_favorite: { method: 'POST', path: '/api/favorites/set', req: s.SetFavoriteRequestSchema, resp: s.SetFavoriteResponseSchema },
    list_favorites: { method: 'POST', path: '/api/favorites/list', req: s.ListFavoritesRequestSchema, resp: s.ListFavoritesResponseSchema },
  },
  auth: {
    login_finish: { method: 'POST', path: '/api/auth/webauthn/login/finish', req: z.any(), resp: z.any() },
    register_start: { method: 'POST', path: '/api/auth/webauthn/register/start', req: s.RegisterStartRequestSchema, resp: z.any() },
    register_finish: { method: 'POST', path: '/api/auth/webauthn/register/finish', req: z.any(), resp: z.any() },
    login_start: { method: 'POST', path: '/api/auth/webauthn/login/start', req: s.StartLoginRequestSchema, resp: z.any() },
    logout: { method: 'POST', path: '/api/auth/logout', req: null, resp: z.any() },
    api_key_status: { method: 'GET', path: '/api/auth/api-key/status', req: null, resp: s.ApiKeyStatusResponseSchema },
    whoami: { method: 'GET', path: '/api/auth/whoami', req: null, resp: s.WhoAmIResponseSchema },
    redeem_invite: { method: 'POST', path: '/api/auth/invite', req: s.RedeemInviteRequestSchema, resp: z.any() },
    regenerate_api_key: { method: 'POST', path: '/api/auth/api-key/regenerate', req: null, resp: s.ApiKeyRegenerateResponseSchema },
  },
};
