// auth domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import type { CallFn } from "./types.js";

export function createAuthMethods(call: CallFn) {
  return {
    registerStart: (params: s.RegisterStartRequest) => {
      return call(
        "auth", "register_start",
        routes.auth.register_start.resp,
        routes.auth.register_start.req,
        routes.auth.register_start.method,
        routes.auth.register_start.path,
        params,
      );
    },

    registerFinish: (params: any) => {
      return call(
        "auth", "register_finish",
        routes.auth.register_finish.resp,
        routes.auth.register_finish.req,
        routes.auth.register_finish.method,
        routes.auth.register_finish.path,
        params,
      );
    },

    loginStart: (params: s.StartLoginRequest) => {
      return call(
        "auth", "login_start",
        routes.auth.login_start.resp,
        routes.auth.login_start.req,
        routes.auth.login_start.method,
        routes.auth.login_start.path,
        params,
      );
    },

    loginFinish: (params: any) => {
      return call(
        "auth", "login_finish",
        routes.auth.login_finish.resp,
        routes.auth.login_finish.req,
        routes.auth.login_finish.method,
        routes.auth.login_finish.path,
        params,
      );
    },

    whoami: () => {
      return call(
        "auth", "whoami",
        routes.auth.whoami.resp,
        routes.auth.whoami.req,
        routes.auth.whoami.method,
        routes.auth.whoami.path,
      );
    },

    logout: () => {
      return call(
        "auth", "logout",
        routes.auth.logout.resp,
        routes.auth.logout.req,
        routes.auth.logout.method,
        routes.auth.logout.path,
      );
    },

    regenerateApiKey: () => {
      return call(
        "auth", "regenerate_api_key",
        routes.auth.regenerate_api_key.resp,
        routes.auth.regenerate_api_key.req,
        routes.auth.regenerate_api_key.method,
        routes.auth.regenerate_api_key.path,
      );
    },

    apiKeyStatus: () => {
      return call(
        "auth", "api_key_status",
        routes.auth.api_key_status.resp,
        routes.auth.api_key_status.req,
        routes.auth.api_key_status.method,
        routes.auth.api_key_status.path,
      );
    },

    redeemInvite: (params: s.RedeemInviteRequest) => {
      return call(
        "auth", "redeem_invite",
        routes.auth.redeem_invite.resp,
        routes.auth.redeem_invite.req,
        routes.auth.redeem_invite.method,
        routes.auth.redeem_invite.path,
        params,
      );
    },

    listPasskeys: () => {
      return call(
        "auth", "list_passkeys",
        routes.auth.list_passkeys.resp,
        routes.auth.list_passkeys.req,
        routes.auth.list_passkeys.method,
        routes.auth.list_passkeys.path,
      );
    },

    deletePasskey: (params: s.DeletePasskeyRequest) => {
      return call(
        "auth", "delete_passkey",
        routes.auth.delete_passkey.resp,
        routes.auth.delete_passkey.req,
        routes.auth.delete_passkey.method,
        routes.auth.delete_passkey.path,
        params,
      );
    },

    linkNode: (params: s.LinkNodeRequest) => {
      return call(
        "auth", "link_node",
        routes.auth.link_node.resp,
        routes.auth.link_node.req,
        routes.auth.link_node.method,
        routes.auth.link_node.path,
        params,
      );
    },

    updateUsername: (params: s.UpdateUsernameRequest) => {
      return call(
        "auth", "update_username",
        routes.auth.update_username.resp,
        routes.auth.update_username.req,
        routes.auth.update_username.method,
        routes.auth.update_username.path,
        params,
      );
    },

    generateSelfAccountLink: () => {
      return call(
        "auth", "generate_self_account_link",
        routes.auth.generate_self_account_link.resp,
        routes.auth.generate_self_account_link.req,
        routes.auth.generate_self_account_link.method,
        routes.auth.generate_self_account_link.path,
      );
    },

    listOwnInvites: () => {
      return call(
        "auth", "list_own_invites",
        routes.auth.list_own_invites.resp,
        routes.auth.list_own_invites.req,
        routes.auth.list_own_invites.method,
        routes.auth.list_own_invites.path,
      );
    },

    revokeOwnInvite: (params: s.RevokeOwnInviteRequest) => {
      return call(
        "auth", "revoke_own_invite",
        routes.auth.revoke_own_invite.resp,
        routes.auth.revoke_own_invite.req,
        routes.auth.revoke_own_invite.method,
        routes.auth.revoke_own_invite.path,
        params,
      );
    },

    updatePasskeyName: (params: s.UpdatePasskeyNameRequest) => {
      return call(
        "auth", "update_passkey_name",
        routes.auth.update_passkey_name.resp,
        routes.auth.update_passkey_name.req,
        routes.auth.update_passkey_name.method,
        routes.auth.update_passkey_name.path,
        params,
      );
    },
  };
}

export type AuthMethods = ReturnType<typeof createAuthMethods>;
