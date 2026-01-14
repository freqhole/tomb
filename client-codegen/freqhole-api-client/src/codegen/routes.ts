// generated route config
import * as s from './schema';
import { z } from 'zod';

export const routes = {
  auth: {
    redeem_invite: { method: 'POST', path: '/api/auth/invite', req: s.RedeemInviteRequestSchema, resp: z.any() },
    api_key_status: { method: 'GET', path: '/api/auth/api-key/status', req: null, resp: s.ApiKeyStatusResponseSchema },
    regenerate_api_key: { method: 'POST', path: '/api/auth/api-key/regenerate', req: null, resp: s.ApiKeyRegenerateResponseSchema },
    logout: { method: 'POST', path: '/api/auth/logout', req: null, resp: z.any() },
    whoami: { method: 'GET', path: '/api/auth/whoami', req: null, resp: s.WhoAmIResponseSchema },
  },
  music: {
    get_playlist_by_id: { method: 'GET', path: '/api/music/playlists/:id', req: null, resp: s.PlaylistSchema },
    create_playlist: { method: 'POST', path: '/api/music/playlists', req: s.CreatePlaylistRequestSchema, resp: s.PlaylistSchema },
    list_playlists: { method: 'POST', path: '/api/music/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistQueryResultSchema.array() },
    create_artist: { method: 'POST', path: '/api/music/artists', req: s.CreateArtistRequestSchema, resp: s.ArtistSchema },
  },
};
