// auth service - abstracts webauthn authentication flows
// handles login and registration with the freqhole server
//
// the actual passkey ceremony logic (credential construction, response
// handling, error paths) lives in @freqhole/haruspex's webauthn subpath;
// this file wires that ceremony logic to spume's api client via
// createWebauthnTransport and layers spume-specific app logic on top (the
// invite-code fallback for plain-http registration when passkeys aren't
// available).

import {
  registerWithPasskey,
  loginWithPasskey,
  whoami as webauthnWhoami,
  type PasskeyCeremonyDeps,
} from "@freqhole/haruspex/webauthn";
import { getClientForRemote, httpRemote, isCharnelAvailable } from "../../api/client";
import { createWebauthnTransport } from "./webauthnTransport";
import { debug } from "../../../utils/logger";

// ============================================================================
// p2p webauthn flows
// ============================================================================

export interface P2PAuthResult {
  success: boolean;
  userId?: string;
  username?: string;
  error?: string;
}

function p2pRemoteFor(peerAddr: string) {
  const transport = isCharnelAvailable() ? ("app" as const) : ("wasm" as const);
  return { transport, peer_addr: peerAddr };
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
  debug("webauthn-p2p", "starting p2p registration for:", username);
  const result = await registerWithPasskey(createWebauthnTransport(p2pRemoteFor(peerAddr)), {
    username,
    inviteCode,
  });
  if (!result.success) {
    debug("webauthn-p2p", "p2p registration error:", result.error);
    return { success: false, error: result.error };
  }
  debug("webauthn-p2p", "p2p registration complete:", result);
  return { success: true, userId: result.userId, username: result.username };
}

/**
 * authenticate with a passkey over p2p transport.
 *
 * username is optional - if omitted the server issues a discoverable-credential
 * challenge and the platform authenticator picks the right passkey.
 * on success the server links the node_id to the user account so subsequent
 * p2p requests from this iroh node are auto-authenticated.
 */
export async function loginWithWebauthnP2P(
  peerAddr: string,
  username?: string,
): Promise<P2PAuthResult> {
  debug("webauthn-p2p", "starting p2p login, username:", username ?? "(discoverable)");
  const result = await loginWithPasskey(createWebauthnTransport(p2pRemoteFor(peerAddr)), { username });
  if (!result.success) {
    debug("webauthn-p2p", "p2p login failed:", result.error);
    return { success: false, error: result.error };
  }
  debug("webauthn-p2p", "p2p login complete:", result);
  return { success: true, userId: result.userId, username: result.username };
}

/**
 * register a first passkey using node-based authentication (no invite code needed).
 *
 * works for users already authenticated to a P2P remote - their node_id is in
 * the allowed peers list, so they can register new passkeys without an invite code.
 *
 * peerAddr - the freqhole server's iroh node address.
 * username - optional; if omitted, uses discoverable credentials.
 */
export async function addPasskeyWithNodeAuth(
  peerAddr: string,
  username?: string,
): Promise<P2PAuthResult> {
  debug(
    "webauthn-p2p-nodeauth",
    "starting first passkey registration, username:",
    username ?? "(discoverable)",
  );
  const result = await registerWithPasskey(createWebauthnTransport(p2pRemoteFor(peerAddr)), {
    username: username || "",
  });
  if (!result.success) {
    debug("webauthn-p2p-nodeauth", "registration failed:", result.error);
    return { success: false, error: result.error };
  }
  debug("webauthn-p2p-nodeauth", "first passkey registered:", result);
  return { success: true, userId: result.userId, username: result.username };
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

function toWhoamiResult(outcome: {
  authenticated: boolean;
  userId?: string;
  username?: string;
  role?: string;
}): WhoamiResult {
  if (!outcome.authenticated) return { success: false };
  return { success: true, userId: outcome.userId, username: outcome.username, role: outcome.role };
}

// check if user is authenticated on a remote
export async function whoami(baseUrl: string): Promise<WhoamiResult> {
  try {
    return toWhoamiResult(await webauthnWhoami(createWebauthnTransport(httpRemote(baseUrl))));
  } catch {
    return { success: false };
  }
}

/**
 * whoami against any remote (HTTP or P2P) using the existing client factory.
 * required for gating admin-only UI on P2P remotes where role isn't carried
 * implicitly by the iroh node id.
 *
 * NOTE: this does NOT swallow transport errors - callers (e.g. the auth
 * status store) need to distinguish "not authenticated" (success:false)
 * from "p2p transport not warm yet" (throws) so they can retry.
 */
export async function whoamiForRemote(
  remote: import("../storage/schemas/remote").Remote,
): Promise<WhoamiResult> {
  return toWhoamiResult(await webauthnWhoami(createWebauthnTransport(remote)));
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
  debug("webauthn", "starting login for username:", username);
  const result = await loginWithPasskey(createWebauthnTransport(httpRemote(baseUrl)), { username });
  if (!result.success) {
    console.error("webauthn login failed:", result.error);
    return { success: false, error: result.error };
  }
  debug("webauthn", "login complete!");
  return { success: true };
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

  debug("webauthn", "starting registration for username:", username);

  // capture the raw credential-creation error (with its DOMException name)
  // via the ceremony's injectable deps - the ceremony's own result only
  // carries a plain error message, which loses the name this fallback
  // decision depends on.
  let credentialError: unknown;
  const deps: PasskeyCeremonyDeps = {
    createCredential: (options) =>
      navigator.credentials.create(options).catch((err) => {
        credentialError = err;
        throw err;
      }) as ReturnType<NonNullable<PasskeyCeremonyDeps["createCredential"]>>,
  };

  const result = await registerWithPasskey(
    createWebauthnTransport(httpRemote(baseUrl)),
    { username, inviteCode },
    deps,
  );

  if (!result.success) {
    const noCredential = result.error === "browser did not return a credential";
    if (isPasskeyUnavailableError(credentialError) || noCredential) {
      debug("webauthn", "passkey creation unavailable, falling back to invite redemption");
      return fallbackToInviteRedemption(baseUrl, username, inviteCode);
    }
    console.error("webauthn registration failed:", result.error);
    return { success: false, error: result.error };
  }

  debug("webauthn", "registration complete!");
  return { success: true };
}

// perform auth (login or register) - unified helper
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
