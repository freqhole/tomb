// auth service — abstracts webauthn authentication flows
// handles login and registration with the freqhole server

import { getClientForRemote, httpRemote, webauthn } from "../../api/client";
import { debug } from "../../../utils/logger";

// ============================================================================
// p2p webauthn flows
//
// the p2p handlers differ from http in two ways:
//   1. start calls require `origin: window.location.origin` in the body
//      (http handlers get origin from the validated request header)
//   2. finish calls wrap the credential as { nonce, origin, credential }
//      (http handlers use session cookies to carry the nonce)
// ============================================================================

export interface P2PAuthResult {
  success: boolean;
  userId?: string;
  username?: string;
  error?: string;
}

// extract a human-readable message from a failed SafeParseResult.
// the client wraps all server errors as ZodError with the message in issues[0].
function parseErrorMsg(err: import("zod").ZodError, fallback: string): string {
  return err.issues?.[0]?.message ?? fallback;
}

/**
 * register a new passkey over p2p transport.
 *
 * peerAddr - the freqhole server's iroh node address (node_id string).
 * username - the username to register.
 * inviteCode - an AccountLink invite code (required for first passkey on a new identity).
 */
export async function registerWithWebauthnP2P(
  peerAddr: string,
  username: string,
  inviteCode: string,
): Promise<P2PAuthResult> {
  const origin = window.location.origin;
  const remote = { transport: "wasm" as const, peer_addr: peerAddr };

  try {
    const client = await getClientForRemote(remote);
    debug("webauthn-p2p", "starting p2p registration for:", username);

    // step 1: start - include origin so server can derive rp_id
    const startResult = await client.auth.registerStart({
      username,
      invite_code: inviteCode,
      origin,
    });

    if (!startResult.success) {
      return { success: false, error: parseErrorMsg(startResult.error, "failed to start registration") };
    }

    // startResult.data is { nonce, challenge } for p2p; { publicKey, ... } for http
    const { nonce, challenge } = startResult.data as { nonce: string; challenge: unknown };

    // step 2: browser creates credential from the challenge
    const credentialOptions = webauthn.prepareRegistrationOptions(challenge);
    const credential = (await navigator.credentials.create(credentialOptions)) as PublicKeyCredential;
    if (!credential) {
      return { success: false, error: "browser did not return a credential" };
    }

    // step 3: finish - wrap with nonce + origin
    const serialized = webauthn.serializeRegistrationCredential(credential);
    const finishResult = await client.auth.registerFinish({ nonce, origin, credential: serialized });

    if (!finishResult.success) {
      return { success: false, error: parseErrorMsg(finishResult.error, "failed to finish registration") };
    }

    const data = finishResult.data as { user_id?: string; username?: string } | undefined;
    debug("webauthn-p2p", "p2p registration complete:", data);
    return { success: true, userId: data?.user_id, username: data?.username };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "registration failed";
    debug("webauthn-p2p", "p2p registration error:", err);
    return { success: false, error: msg };
  }
}

/**
 * authenticate with a passkey over p2p transport.
 *
 * on success the server links the node_id to the user account so subsequent
 * p2p requests from this iroh node are auto-authenticated.
 */
export async function loginWithWebauthnP2P(
  peerAddr: string,
  username: string,
): Promise<P2PAuthResult> {
  const origin = window.location.origin;
  const remote = { transport: "wasm" as const, peer_addr: peerAddr };

  try {
    const client = await getClientForRemote(remote);
    debug("webauthn-p2p", "starting p2p login for:", username);

    // step 1: start - include origin
    const startResult = await client.auth.loginStart({
      username,
      origin,
    });

    if (!startResult.success) {
      return { success: false, error: parseErrorMsg(startResult.error, "failed to start login") };
    }

    const { nonce, challenge } = startResult.data as { nonce: string; challenge: unknown };

    // step 2: browser asserts credential
    const credentialOptions = webauthn.prepareAuthenticationOptions(challenge);
    const credential = (await navigator.credentials.get(credentialOptions)) as PublicKeyCredential;
    if (!credential) {
      return { success: false, error: "browser did not return a credential" };
    }

    // step 3: finish
    const serialized = webauthn.serializeAuthenticationCredential(credential);
    const finishResult = await client.auth.loginFinish({ nonce, origin, credential: serialized });

    if (!finishResult.success) {
      return { success: false, error: parseErrorMsg(finishResult.error, "failed to finish login") };
    }

    const data = finishResult.data as { user_id?: string; username?: string } | undefined;
    debug("webauthn-p2p", "p2p login complete:", data);
    return { success: true, userId: data?.user_id, username: data?.username };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "login failed";
    debug("webauthn-p2p", "p2p login error:", err);
    return { success: false, error: msg };
  }
}

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
    const client = await getClientForRemote(httpRemote(baseUrl));
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

/**
 * whoami against any remote (HTTP or P2P) using the existing client factory.
 * required for gating admin-only UI on P2P remotes where role isn't carried
 * implicitly by the iroh node id.
 *
 * NOTE: this does NOT swallow transport errors — callers (e.g. the auth
 * status store) need to distinguish "not authenticated" (success:false)
 * from "p2p transport not warm yet" (throws) so they can retry.
 */
export async function whoamiForRemote(
  remote: import("../storage/schemas/remote").Remote,
): Promise<WhoamiResult> {
  const client = await getClientForRemote(remote);
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
}

// get server info (public endpoint)
export async function getServerInfo(baseUrl: string) {
  const client = await getClientForRemote(httpRemote(baseUrl));
  return client.app.serverInfo();
}

// login with webauthn
export async function loginWithWebauthn(
  baseUrl: string,
  username: string,
): Promise<AuthResult> {
  try {
    const client = await getClientForRemote(httpRemote(baseUrl));
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
    const client = await getClientForRemote(httpRemote(baseUrl));
    const redeemResult = await client.auth.redeemInvite({
      invite_code: inviteCode,
      username,
      node_id: null,
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
    const client = await getClientForRemote(httpRemote(baseUrl));
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
    const client = await getClientForRemote(httpRemote(baseUrl));
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
