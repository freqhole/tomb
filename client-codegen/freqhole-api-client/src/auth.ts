// auth domain wrapper functions
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import { call } from "./client.js";

// webauthn
export function registerStart(
  baseUrl: string,
  params: s.RegisterStartRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "auth",
    "register_start",
    routes.auth.register_start.resp,
    routes.auth.register_start.req,
    routes.auth.register_start.method,
    routes.auth.register_start.path,
    params,
    apiKey,
  );
}

export function registerFinish(
  baseUrl: string,
  params: any, // webauthn credential response
  apiKey?: string,
) {
  return call(
    baseUrl,
    "auth",
    "register_finish",
    routes.auth.register_finish.resp,
    routes.auth.register_finish.req,
    routes.auth.register_finish.method,
    routes.auth.register_finish.path,
    params,
    apiKey,
  );
}

export function loginStart(
  baseUrl: string,
  params: s.StartLoginRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "auth",
    "login_start",
    routes.auth.login_start.resp,
    routes.auth.login_start.req,
    routes.auth.login_start.method,
    routes.auth.login_start.path,
    params,
    apiKey,
  );
}

export function loginFinish(
  baseUrl: string,
  params: any, // webauthn credential response
  apiKey?: string,
) {
  return call(
    baseUrl,
    "auth",
    "login_finish",
    routes.auth.login_finish.resp,
    routes.auth.login_finish.req,
    routes.auth.login_finish.method,
    routes.auth.login_finish.path,
    params,
    apiKey,
  );
}

// session
export function whoami(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "auth",
    "whoami",
    routes.auth.whoami.resp,
    routes.auth.whoami.req,
    routes.auth.whoami.method,
    routes.auth.whoami.path,
    undefined,
    apiKey,
  );
}

export function logout(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "auth",
    "logout",
    routes.auth.logout.resp,
    routes.auth.logout.req,
    routes.auth.logout.method,
    routes.auth.logout.path,
    undefined,
    apiKey,
  );
}

// api key management
export function regenerateApiKey(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "auth",
    "regenerate_api_key",
    routes.auth.regenerate_api_key.resp,
    routes.auth.regenerate_api_key.req,
    routes.auth.regenerate_api_key.method,
    routes.auth.regenerate_api_key.path,
    undefined,
    apiKey,
  );
}

export function apiKeyStatus(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "auth",
    "api_key_status",
    routes.auth.api_key_status.resp,
    routes.auth.api_key_status.req,
    routes.auth.api_key_status.method,
    routes.auth.api_key_status.path,
    undefined,
    apiKey,
  );
}

// invite codes
export function redeemInvite(
  baseUrl: string,
  params: s.RedeemInviteRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "auth",
    "redeem_invite",
    routes.auth.redeem_invite.resp,
    routes.auth.redeem_invite.req,
    routes.auth.redeem_invite.method,
    routes.auth.redeem_invite.path,
    params,
    apiKey,
  );
}
