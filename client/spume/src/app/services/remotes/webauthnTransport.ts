// webauthn transport binding - adapts spume's api client to the
// WebauthnTransport interface @freqhole/haruspex's webauthn ceremony runs
// against. the http and p2p remotes share the same four ceremony calls; the
// only difference is whether origin/nonce are threaded through explicitly
// (p2p, no session cookie to carry ceremony state) or left for the server to
// derive from the request itself (http, cookie-backed).

import type {
  AuthenticationChallenge,
  RegistrationChallenge,
  WebauthnTransport,
} from "@freqhole/haruspex/webauthn";
import { getClientForRemote, type RemoteLike } from "../../api/client";

// extract a human-readable message from a failed SafeParseResult.
// the client wraps all server errors as ZodError with the message in issues[0].
function parseErrorMsg(err: import("zod").ZodError, fallback: string): string {
  return err.issues?.[0]?.message ?? fallback;
}

/** binds a webauthn ceremony to one remote (http or p2p). */
export function createWebauthnTransport(remote: RemoteLike): WebauthnTransport {
  const isP2P = remote.transport !== "http";

  return {
    async registerStart(req) {
      const client = await getClientForRemote(remote);
      const result = await client.auth.registerStart(
        isP2P
          ? { username: req.username, invite_code: req.inviteCode, origin: req.origin }
          : { username: req.username, invite_code: req.inviteCode },
      );
      if (!result.success) {
        return { success: false, error: parseErrorMsg(result.error, "failed to start registration") };
      }
      const data = result.data as { nonce?: string; challenge: unknown };
      return {
        success: true,
        data: { nonce: data.nonce, challenge: data.challenge as RegistrationChallenge },
      };
    },

    async registerFinish(req) {
      const client = await getClientForRemote(remote);
      const result = await client.auth.registerFinish(
        isP2P ? { nonce: req.nonce, origin: req.origin, credential: req.credential } : req.credential,
      );
      if (!result.success) {
        return { success: false, error: parseErrorMsg(result.error, "failed to finish registration") };
      }
      const data = result.data as { user_id?: string; username?: string } | undefined;
      return { success: true, data: { userId: data?.user_id, username: data?.username } };
    },

    async loginStart(req) {
      const client = await getClientForRemote(remote);
      const result = await client.auth.loginStart(
        isP2P ? { username: req.username || undefined, origin: req.origin } : { username: req.username },
      );
      if (!result.success) {
        return { success: false, error: parseErrorMsg(result.error, "failed to start login") };
      }
      const data = result.data as { nonce?: string; challenge: unknown };
      return {
        success: true,
        data: { nonce: data.nonce, challenge: data.challenge as AuthenticationChallenge },
      };
    },

    async loginFinish(req) {
      const client = await getClientForRemote(remote);
      const result = await client.auth.loginFinish(
        isP2P ? { nonce: req.nonce, origin: req.origin, credential: req.credential } : req.credential,
      );
      if (!result.success) {
        return { success: false, error: parseErrorMsg(result.error, "failed to finish login") };
      }
      const data = result.data as { user_id?: string; username?: string } | undefined;
      return { success: true, data: { userId: data?.user_id, username: data?.username } };
    },

    async whoami() {
      const client = await getClientForRemote(remote);
      const result = await client.auth.whoami();
      if (result.success && result.data) {
        return {
          authenticated: true,
          userId: result.data.user_id,
          username: result.data.username,
          role: result.data.role,
        };
      }
      return { authenticated: false };
    },
  };
}
