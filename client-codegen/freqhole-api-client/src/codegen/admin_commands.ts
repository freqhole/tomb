// generated freqhole-admin/1 ALPN command map
//
// do not edit by hand: regenerate with `cd client-codegen && make all`.
import * as s from './schema';
import { z } from 'zod';

export type AdminAuthType = 'admin';

export type AdminAuth = { type: AdminAuthType };

export const adminCommands = {
  invites_generate: { req: s.AdminInvitesGenerateRequestSchema, resp: s.AdminInvitesGenerateResponseSchema, auth: { type: 'admin' } as const },
  invites_list: { req: s.AdminInvitesListRequestSchema, resp: s.AdminInviteInfoSchema.array(), auth: { type: 'admin' } as const },
  invites_revoke: { req: s.AdminInvitesRevokeRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  invites_revoke_all: { req: z.void().optional(), resp: s.AdminInvitesRevokeAllResponseSchema, auth: { type: 'admin' } as const },
  invites_update_role: { req: s.AdminInvitesUpdateRoleRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  knocks_accept: { req: s.KnocksAcceptRequestSchema, resp: s.KnockRequestSchema, auth: { type: 'admin' } as const },
  knocks_delete: { req: s.KnocksDeleteRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  knocks_list: { req: z.void().optional(), resp: s.KnockRequestSchema.array(), auth: { type: 'admin' } as const },
  knocks_list_all: { req: z.void().optional(), resp: s.KnockRequestSchema.array(), auth: { type: 'admin' } as const },
  knocks_reject: { req: s.KnocksRejectRequestSchema, resp: s.KnockRequestSchema, auth: { type: 'admin' } as const },
  knocks_reject_all: { req: z.void().optional(), resp: s.KnocksRejectAllResponseSchema, auth: { type: 'admin' } as const },
  peers_allow: { req: s.AdminPeersAllowRequestSchema, resp: s.AdminPeersAllowResponseSchema, auth: { type: 'admin' } as const },
  peers_list_all: { req: z.void().optional(), resp: s.AdminPeerSummarySchema.array(), auth: { type: 'admin' } as const },
  peers_list_for_user: { req: s.AdminPeersListForUserRequestSchema, resp: s.AdminPeerNodeSummarySchema.array(), auth: { type: 'admin' } as const },
  peers_remove: { req: s.AdminPeersRemoveRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_bumpers_add: { req: s.RadioBumpersAddRequestSchema, resp: s.RadioBumperSchema, auth: { type: 'admin' } as const },
  radio_bumpers_list: { req: s.RadioBumpersListRequestSchema, resp: s.RadioBumperSchema.array(), auth: { type: 'admin' } as const },
  radio_bumpers_remove: { req: s.RadioBumpersRemoveRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_bumpers_set_frequency: { req: s.RadioBumpersSetFrequencyRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_config_get: { req: z.void().optional(), resp: s.RadioConfigPayloadSchema, auth: { type: 'admin' } as const },
  radio_config_set: { req: s.RadioConfigPayloadSchema, resp: s.RadioConfigPayloadSchema, auth: { type: 'admin' } as const },
  radio_filters_add: { req: s.RadioFiltersAddRequestSchema, resp: s.StationFilterSchema, auth: { type: 'admin' } as const },
  radio_filters_list: { req: s.RadioStationByStationIdRequestSchema, resp: s.StationFilterSchema.array(), auth: { type: 'admin' } as const },
  radio_filters_remove: { req: s.RadioFiltersRemoveRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_seed_suggest: { req: s.RadioSeedSuggestRequestSchema, resp: s.RadioSeedSuggestionSchema.array(), auth: { type: 'admin' } as const },
  radio_songs_add: { req: s.RadioSongsAddRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_songs_list: { req: s.RadioStationByStationIdRequestSchema, resp: s.StationSongSchema.array(), auth: { type: 'admin' } as const },
  radio_songs_remove: { req: s.RadioSongsRemoveRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_stations_create: { req: s.CreateStationRequestSchema, resp: s.RadioStationSchema, auth: { type: 'admin' } as const },
  radio_stations_delete: { req: s.RadioStationsByIdRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  radio_stations_get: { req: s.RadioStationsByIdRequestSchema, resp: s.RadioStationSchema, auth: { type: 'admin' } as const },
  radio_stations_list: { req: z.void().optional(), resp: s.RadioStationSchema.array(), auth: { type: 'admin' } as const },
  radio_stations_update: { req: s.UpdateStationRequestSchema, resp: s.RadioStationSchema, auth: { type: 'admin' } as const },
  radio_supervisor_restart: { req: s.RadioSupervisorStationRequestSchema, resp: s.RadioSupervisorStatusResponseSchema, auth: { type: 'admin' } as const },
  radio_supervisor_start: { req: s.RadioSupervisorStationRequestSchema, resp: s.RadioSupervisorStatusResponseSchema, auth: { type: 'admin' } as const },
  radio_supervisor_status: { req: z.void().optional(), resp: s.RadioSupervisorStatusResponseSchema, auth: { type: 'admin' } as const },
  radio_supervisor_stop: { req: s.RadioSupervisorStationRequestSchema, resp: s.RadioSupervisorStatusResponseSchema, auth: { type: 'admin' } as const },
  users_delete: { req: s.AdminUsersDeleteRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  users_generate_account_link: { req: s.AdminUsersGenerateAccountLinkRequestSchema, resp: s.AdminAccountLinkResponseSchema, auth: { type: 'admin' } as const },
  users_get: { req: s.AdminUsersGetRequestSchema, resp: s.AdminUserSummarySchema, auth: { type: 'admin' } as const },
  users_list: { req: s.AdminUsersListRequestSchema, resp: s.AdminUserSummarySchema.array(), auth: { type: 'admin' } as const },
  users_update_role: { req: s.AdminUsersUpdateRoleRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
} as const;

export type AdminCommandName = keyof typeof adminCommands;
