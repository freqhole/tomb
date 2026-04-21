// generated freqhole-admin/1 ALPN command map
//
// do not edit by hand: regenerate with `cd client-codegen && make all`.
import * as s from './schema';
import { z } from 'zod';

export type AdminAuthType = 'admin';

export type AdminAuth = { type: AdminAuthType };

export const adminCommands = {
  knocks_accept: { req: s.KnocksAcceptRequestSchema, resp: s.KnockRequestSchema, auth: { type: 'admin' } as const },
  knocks_delete: { req: s.KnocksDeleteRequestSchema, resp: z.unknown().optional(), auth: { type: 'admin' } as const },
  knocks_list: { req: z.void().optional(), resp: s.KnockRequestSchema.array(), auth: { type: 'admin' } as const },
  knocks_list_all: { req: z.void().optional(), resp: s.KnockRequestSchema.array(), auth: { type: 'admin' } as const },
  knocks_reject: { req: s.KnocksRejectRequestSchema, resp: s.KnockRequestSchema, auth: { type: 'admin' } as const },
  knocks_reject_all: { req: z.void().optional(), resp: s.KnocksRejectAllResponseSchema, auth: { type: 'admin' } as const },
} as const;

export type AdminCommandName = keyof typeof adminCommands;
