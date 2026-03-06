// auth service — abstracts webauthn authentication flows
// handles login and registration with the freqhole server

import { createHttpClient, webauthn } from "../../api/client";
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
    const client = createHttpClient(baseUrl);
    const result = await client.auth.whoami();
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
  return createHttpClient(baseUrl).app.serverInfo();
}

// login with webauthn
export async function loginWithWebauthn(
  baseUrl: string,
  username: string,
): Promise<AuthResult> {
  try {
    const client = createHttpClient(baseUrl);
    debug("webauthn", "starting login for username:", username);

    // step 1: start login
    debug("webauthn", "starting webauthn login...");
    const startResult = await client.auth.loginStart({ username });

    if (!startResult.success) {
      console.error("login start failed:", startResult);
      return { success: false, error: "failed to start login" };
    }
    debug("webauthn", "login start response:", startResult.data);

    // step 2: get webauthn credential
    debug("webauthn", "requesting credential from browser...");
    const credentialOptions = webauthn.prepareAuthenticationOptions(startResult.data);
    const credential = (await navigator.credentials.get(credentialOptions)) as PublicKeyCredential;

    if (!credential) {
      return { success: false, error: "failed to get credential" };
    }
    debug("webauthn", "credential retrieved:", credential);

    // step 3: finish login
    debug("webauthn", "finishing login...");
    const serializedCredential = webauthn.serializeAuthenticationCredential(credential);
    const finishResult = await client.auth.loginFinish(serializedCredential);

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

// check if webauthn is supported and available in current context
export function isWebAuthnAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined" &&
    typeof navigator.credentials.create === "function"
  );
}

// check if an error indicates passkey is not available (vs other errors)
function isPasskeyUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // NotAllowedError: user denied or browser/platform blocked the request
  // NotSupportedError: webauthn not supported in this context
  // SecurityError: secure context required or other security issue
  // AbortError: request was aborted
  const unavailableErrorNames = ["NotAllowedError", "NotSupportedError", "SecurityError", "AbortError"];

  return unavailableErrorNames.includes(err.name);
}

// fallback to simple invite redemption (no passkey, session-only auth)
async function fallbackToInviteRedemption(
  baseUrl: string,
  username: string,
  inviteCode: string,
): Promise<AuthResult> {
  debug("webauthn", "falling back to invite code redemption (no passkey)...");
  try {
    const client = createHttpClient(baseUrl);
    const redeemResult = await client.auth.redeemInvite({
      invite_code: inviteCode,
      username,
    });

    if (redeemResult.success) {
      debug("webauthn", "invite code redemption successful (session-only auth)");
      return { success: true };
    } else {
      console.error("invite redemption fallback failed:", redeemResult);
      return { success: false, error: "failed to redeem invite code" };
    }
  } catch (err) {
    console.error("invite redemption fallback error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "failed to redeem invite code",
    };
  }
}

// register with webauthn, with fallback to invite redemption if passkey unavailable
export async function registerWithWebauthn(
  baseUrl: string,
  username: string,
  inviteCode: string,
): Promise<AuthResult> {
  // early check: if webauthn isn't available at all, go straight to fallback
  if (!isWebAuthnAvailable()) {
    debug("webauthn", "webauthn not available, using invite code fallback");
    return fallbackToInviteRedemption(baseUrl, username, inviteCode);
  }

  try {
    const client = createHttpClient(baseUrl);
    debug("webauthn", "starting registration for username:", username);

    // step 1: start registration with invite code
    debug("webauthn", "starting webauthn registration...");
    const startResult = await client.auth.registerStart({
      username,
      invite_code: inviteCode,
    });

    if (!startResult.success) {
      console.error("register start failed:", startResult);
      return { success: false, error: "failed to start registration" };
    }
    debug("webauthn", "register start response:", startResult.data);

    // step 2: create webauthn credential (this is where passkey creation happens)
    debug("webauthn", "requesting credential creation from browser...");
    const credentialOptions = webauthn.prepareRegistrationOptions(startResult.data);

    let credential: PublicKeyCredential | null = null;
    try {
      credential = (await navigator.credentials.create(credentialOptions)) as PublicKeyCredential;
    } catch (credErr) {
      // if passkey creation failed due to unavailability, fall back to invite redemption
      if (isPasskeyUnavailableError(credErr)) {
        debug("webauthn", `passkey creation failed (${(credErr as Error).name}), falling back to invite redemption`);
        return fallbackToInviteRedemption(baseUrl, username, inviteCode);
      }
      // re-throw other errors
      throw credErr;
    }

    if (!credential) {
      // no credential and no error - unexpected, try fallback
      debug("webauthn", "no credential returned, falling back to invite redemption");
      return fallbackToInviteRedemption(baseUrl, username, inviteCode);
    }
    debug("webauthn", "credential created:", credential);

    // step 3: finish registration
    debug("webauthn", "finishing registration...");
    const serializedCredential = webauthn.serializeRegistrationCredential(credential);
    const finishResult = await client.auth.registerFinish(serializedCredential);

    if (!finishResult.success) {
      console.error("register finish failed:", finishResult);
      return { success: false, error: "failed to complete registration" };
    }
    debug("webauthn", "registration complete!");

    return { success: true };
  } catch (err) {
    console.error("webauthn registration failed:", err);

    // if the error indicates passkey unavailability, try fallback
    if (isPasskeyUnavailableError(err)) {
      debug("webauthn", `registration failed with passkey error (${(err as Error).name}), trying fallback`);
      return fallbackToInviteRedemption(baseUrl, username, inviteCode);
    }

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
    const client = createHttpClient(baseUrl);
    debug("auth", "logging out from:", baseUrl);
    const result = await client.auth.logout();
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
