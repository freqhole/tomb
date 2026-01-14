// generated route config
import * as s from './schema';
import { z } from 'zod';

export const routes = {
  music: {
    create_artist: { method: 'POST', path: '/api/music/artists', req: s.CreateArtistRequestSchema, resp: s.ArtistSchema },
    create_fetch_job: { method: 'POST', path: '/api/music/fetch', req: s.FetchMediaParamsSchema, resp: s.JobSchema },
    get_fetch_job: { method: 'GET', path: '/api/music/fetch/{id}', req: null, resp: s.JobSchema },
    recent_songs: { method: 'POST', path: '/api/songs/recent', req: s.RecentSongsRequestSchema, resp: s.SongsQueryResultSchema },
    query_songs: { method: 'POST', path: '/api/songs/query', req: s.QueryParamsSchema, resp: s.SongsQueryResultSchema },
    delete_song: { method: 'DELETE', path: '/api/songs/{id}', req: s.DeleteSongRequestSchema, resp: s.DeleteSongResponseSchema },
    update_songs: { method: 'POST', path: '/api/songs/update', req: s.UpdateSongsRequestSchema, resp: s.UpdateSongsResultSchema },
    list_playlists: { method: 'POST', path: '/api/music/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistQueryResultSchema.array() },
    create_playlist: { method: 'POST', path: '/api/music/playlists', req: s.CreatePlaylistRequestSchema, resp: s.PlaylistSchema },
    get_playlist_by_id: { method: 'GET', path: '/api/music/playlists/{id}', req: null, resp: s.PlaylistSchema },
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
