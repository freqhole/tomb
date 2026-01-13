// generated route config
import * as s from './schema';
import { z } from 'zod';

export const routes = {
  auth: {
    redeem_invite: { method: 'POST', path: '/auth/invite', req: s.RedeemInviteRequestSchema, resp: z.any() },
    api_key_status: { method: 'GET', path: '/auth/api-key/status', req: null, resp: s.ApiKeyStatusResponseSchema },
    regenerate_api_key: { method: 'POST', path: '/auth/api-key/regenerate', req: null, resp: s.ApiKeyRegenerateResponseSchema },
    logout: { method: 'POST', path: '/auth/logout', req: null, resp: z.any() },
    whoami: { method: 'GET', path: '/auth/whoami', req: null, resp: s.WhoAmIResponseSchema },
  },
  music: {
    list_playlists: { method: 'POST', path: '/api/playlists/list', req: s.QueryParamsSchema, resp: s.PlaylistQueryResultSchema.array() },
  },
};
