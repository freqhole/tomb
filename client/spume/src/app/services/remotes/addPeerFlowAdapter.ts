// add-peer flow adapter - binds @freqhole/haruspex/flows' AddPeerFlow (the
// shared "add a remote peer" state machine) to spume's real api client and
// storage layer.
//
// unifies http and p2p handling: getClientForRemote already abstracts
// transport selection, so every network call here goes through the same
// generated client regardless of target type - no separate http-vs-p2p
// branch is needed the way the old hand-rolled modal logic had one for
// every network call.

import type {
  AddPeerFlowDeps,
  PeerServerInfo,
  PeerTarget,
  SavedRemote,
} from "@freqhole/haruspex/flows";
import { getClientForRemote, isCharnelAvailable, type RemoteLike } from "../../api/client";
import {
  authenticate,
  loginWithWebauthn,
  loginWithWebauthnP2P,
  registerWithWebauthnP2P,
} from "./authService";
import { formatErrorMessage } from "./formatErrorMessage";
import { createRemote, getAllRemotes } from "./remoteManager";
import {
  createPendingRemote,
  deletePendingRemote,
  deletePendingRemoteByPeerAddr,
  getAllPendingRemotes,
  getPendingRemoteByPeerAddr,
  updatePendingRemote,
} from "../storage/db";
import type { PendingRemote as SpumePendingRemote } from "../storage/types";

function remoteLikeFor(target: PeerTarget): RemoteLike {
  if (target.type === "http") return { transport: "http", base_url: target.url };
  return { transport: isCharnelAvailable() ? "app" : "wasm", peer_addr: target.peerAddr };
}

export const addPeerFlowDeps: AddPeerFlowDeps = {
  getAllRemotes: async () => (await getAllRemotes()) as SavedRemote[],
  getAllPendingRemotes,
  getPendingRemoteByPeerAddr: async (peerAddr) =>
    (await getPendingRemoteByPeerAddr(peerAddr)) ?? null,
  createPendingRemote,
  updatePendingRemote: async (id, patch) => {
    await updatePendingRemote(id, patch as Partial<Omit<SpumePendingRemote, "id" | "created_at">>);
  },
  deletePendingRemote,
  deletePendingRemoteByPeerAddr,
  createRemote: async (input) => (await createRemote(input)) as SavedRemote,

  getServerInfo: async (target) => {
    const client = await getClientForRemote(remoteLikeFor(target));
    const result = await client.app.serverInfo();
    return result.success && result.data ? (result.data as PeerServerInfo) : null;
  },

  whoami: async (target) => {
    const client = await getClientForRemote(remoteLikeFor(target));
    const result = await client.auth.whoami();
    return result.success && !!result.data;
  },

  sendKnock: async (peerAddr, username, message) => {
    const client = await getClientForRemote(remoteLikeFor({ type: "p2p", peerAddr }));
    const result = await client.admin.createKnockPublic({ username, message });
    if (!result.success) {
      throw new Error(
        "error" in result ? formatErrorMessage(result.error) : "failed to send access request"
      );
    }
  },

  checkKnockStatus: async (peerAddr) => {
    const client = await getClientForRemote(remoteLikeFor({ type: "p2p", peerAddr }));
    const result = await client.admin.getKnockStatusPublic();
    if (!result.success || !result.data) return null;
    return result.data.status;
  },

  authenticateHttp: async (url, data) => {
    const result = await authenticate(url, data);
    if (!result.success) throw new Error(result.error ?? "authentication failed");
  },

  redeemInvite: async (peerAddr, username, inviteCode) => {
    const client = await getClientForRemote(remoteLikeFor({ type: "p2p", peerAddr }));
    const result = await client.auth.redeemInvite({
      invite_code: inviteCode,
      username,
      node_id: null,
    });
    if (!result.success) {
      throw new Error(
        "error" in result ? formatErrorMessage(result.error) : "invite code redemption failed"
      );
    }
  },

  registerWithPasskey: async (peerAddr, username, inviteCode) => {
    const result = await registerWithWebauthnP2P(peerAddr, username ?? "", inviteCode);
    if (!result.success) throw new Error(result.error ?? "passkey registration failed");
  },

  loginWithPasskey: async (target, username) => {
    const result =
      target.type === "p2p"
        ? await loginWithWebauthnP2P(target.peerAddr, username)
        : await loginWithWebauthn(target.url, username);
    if (!result.success) throw new Error(result.error ?? "passkey login failed");
  },

  transportFor: (target) =>
    target.type === "p2p" ? (isCharnelAvailable() ? "app" : "wasm") : "http",

  defaultScheme:
    typeof window !== "undefined" && window.location.protocol === "http:" ? "http" : "https",
};
