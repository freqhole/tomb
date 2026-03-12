// admin domain methods for FreqholeClient
// includes knock management endpoints

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import type { CallFn } from "./types.js";

export function createAdminMethods(call: CallFn) {
  return {
    // knock management (admin)
    listKnocks: () => {
      return call(
        "admin", "list_knocks",
        routes.admin.list_knocks.resp,
        routes.admin.list_knocks.req,
        routes.admin.list_knocks.method,
        routes.admin.list_knocks.path,
      );
    },

    listAllKnocks: () => {
      return call(
        "admin", "list_all_knocks",
        routes.admin.list_all_knocks.resp,
        routes.admin.list_all_knocks.req,
        routes.admin.list_all_knocks.method,
        routes.admin.list_all_knocks.path,
      );
    },

    getKnock: (params: { id: string }) => {
      return call(
        "admin", "get_knock",
        routes.admin.get_knock.resp,
        routes.admin.get_knock.req,
        routes.admin.get_knock.method,
        routes.admin.get_knock.path,
        params,
      );
    },

    acceptKnock: (params: { id: string } & s.ProcessKnockRequest) => {
      return call(
        "admin", "accept_knock",
        routes.admin.accept_knock.resp,
        routes.admin.accept_knock.req,
        routes.admin.accept_knock.method,
        routes.admin.accept_knock.path,
        params,
      );
    },

    rejectKnock: (params: { id: string }) => {
      return call(
        "admin", "reject_knock",
        routes.admin.reject_knock.resp,
        routes.admin.reject_knock.req,
        routes.admin.reject_knock.method,
        routes.admin.reject_knock.path,
        params,
      );
    },

    deleteKnock: (params: { id: string }) => {
      return call(
        "admin", "delete_knock",
        routes.admin.delete_knock.resp,
        routes.admin.delete_knock.req,
        routes.admin.delete_knock.method,
        routes.admin.delete_knock.path,
        params,
      );
    },

    // public knock endpoints (for P2P access requests)
    createKnockPublic: (params: s.CreateKnockRequest) => {
      return call(
        "admin", "create_knock_public",
        routes.admin.create_knock_public.resp,
        routes.admin.create_knock_public.req,
        routes.admin.create_knock_public.method,
        routes.admin.create_knock_public.path,
        params,
      );
    },

    getKnockStatusPublic: () => {
      return call(
        "admin", "get_knock_status_public",
        routes.admin.get_knock_status_public.resp,
        routes.admin.get_knock_status_public.req,
        routes.admin.get_knock_status_public.method,
        routes.admin.get_knock_status_public.path,
      );
    },
  };
}
