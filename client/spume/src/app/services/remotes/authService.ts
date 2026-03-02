// auth service — abstracts webauthn authentication flows
// handles login and registration with the freqhole server

import * as apiClient from "freqhole-api-client";
import { debug } from "../../../utils/logger";

export interface AuthResult {
  success: boolean;
  error?: string;
}

export interface WhoamiResult {
  success: boolean;
  userId?: string;
  username?: string;
  role?: string;
}

// check if user is authenticated on a remote
export async function whoami(baseUrl: string): Promise<WhoamiResult> {
  try {
    const result = await apiClient.auth.whoami(baseUrl);
    if (result.success && result.data) {
      return {
        success: true,
        userId: result.data.user_id,
        username: result.data.username,
        role: result.data.role,
      };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

// get server info (public endpoint)
export async function getServerInfo(baseUrl: string) {
  return apiClient.app.getServerInfo(baseUrl);
}

// login with webauthn
export async function loginWithWebauthn(
  baseUrl: string,
  username: string,
): Promise<AuthResult> {
  try {
    debug("webauthn", "starting login for username:", username);

    // step 1: start login
    debug("webauthn", "starting webauthn login...");
    const startResult = await apiClient.auth.loginStart(baseUrl, { username });

    if (!startResult.success) {
      console.error("login start failed:", startResult);
      return { success: false, error: "failed to start login" };
    }
    debug("webauthn", "login start response:", startResult.data);

    // step 2: get webauthn credential
    debug("webauthn", "requesting credential from browser...");
    const credentialOptions = apiClient.webauthn.prepareAuthenticationOptions(startResult.data);
    const credential = (await navigator.credentials.get(credentialOptions)) as PublicKeyCredential;

    if (!credential) {
      return { success: false, error: "failed to get credential" };
    }
    debug("webauthn", "credential retrieved:", credential);

    // step 3: finish login
    debug("webauthn", "finishing login...");
    const serializedCredential = apiClient.webauthn.serializeAuthenticationCredential(credential);
    const finishResult = await apiClient.auth.loginFinish(baseUrl, serializedCredential);

    if (!finishResult.success) {
      console.error("login finish failed:", finishResult);
      return { success: false, error: "failed to complete login" };
    }
    debug("webauthn", "login complete!");

    return { success: true };
  } catch (err) {
    console.error("webauthn login failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "authentication failed",
    };
  }
}

// register with webauthn
export async function registerWithWebauthn(
  baseUrl: string,
  username: string,
  inviteCode: string,
): Promise<AuthResult> {
  try {
    debug("webauthn", "starting registration for username:", username);

    // step 1: start registration with invite code
    debug("webauthn", "starting webauthn registration...");
    const startResult = await apiClient.auth.registerStart(baseUrl, {
      username,
      invite_code: inviteCode,
    });

    if (!startResult.success) {
      console.error("register start failed:", startResult);
      return { success: false, error: "failed to start registration" };
    }
    debug("webauthn", "register start response:", startResult.data);

    // step 2: create webauthn credential
    debug("webauthn", "requesting credential creation from browser...");
    const credentialOptions = apiClient.webauthn.prepareRegistrationOptions(startResult.data);
    const credential = (await navigator.credentials.create(credentialOptions)) as PublicKeyCredential;

    if (!credential) {
      return { success: false, error: "failed to create credential" };
    }
    debug("webauthn", "credential created:", credential);

    // step 3: finish registration
    debug("webauthn", "finishing registration...");
    const serializedCredential = apiClient.webauthn.serializeRegistrationCredential(credential);
    const finishResult = await apiClient.auth.registerFinish(baseUrl, serializedCredential);

    if (!finishResult.success) {
      console.error("register finish failed:", finishResult);
      return { success: false, error: "failed to complete registration" };
    }
    debug("webauthn", "registration complete!");

    return { success: true };
  } catch (err) {
    console.error("webauthn registration failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "registration failed",
    };
  }
}

// perform auth (login or register) — unified helper
export async function authenticate(
  baseUrl: string,
  data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  },
): Promise<AuthResult> {
  if (data.mode === "register") {
    if (!data.inviteCode) {
      return { success: false, error: "invite code required for registration" };
    }
    return registerWithWebauthn(baseUrl, data.username, data.inviteCode);
  }
  return loginWithWebauthn(baseUrl, data.username);
}

// logout from a remote server
export async function logout(baseUrl: string): Promise<AuthResult> {
  try {
    debug("auth", "logging out from:", baseUrl);
    const result = await apiClient.auth.logout(baseUrl);
    if (result.success) {
      debug("auth", "logout successful");
      return { success: true };
    }
    return { success: false, error: "logout failed" };
  } catch (err) {
    console.error("logout failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "logout failed",
    };
  }
}
