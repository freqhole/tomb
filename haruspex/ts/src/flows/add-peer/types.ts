// shapes for the add-peer flow: the headless state machine that drives
// "add a remote peer" ui across apps (address entry -> connection test ->
// knock request or auth -> saved remote).
//
// the machine (see machine.ts) is pure and synchronous: `send(event)`
// returns effect descriptors; an adapter executes the effects (async io,
// timers, aborts) and feeds their outcomes back in as events. nothing in
// this subpath imports a framework - solid/pixi/react shells all drive
// the same machine.

import type { PeerTarget } from "../../share/peer-addr.js";

export type { PeerTarget };

/** lifecycle stage of an in-progress remote addition, persisted so a
 *  closed tab/modal can resume where it left off. */
export type PendingRemoteStage =
  | "testing"
  | "connected"
  | "failed"
  | "knock_pending"
  | "knock_accepted"
  | "knock_rejected";

/** a persisted in-progress remote addition. field names are snake_case:
 *  these records live in app storage (idb) and are adopted in place. */
export interface PendingRemote {
  id: string;
  /** p2p node id / endpoint json, or the http base url. */
  peer_addr: string;
  /** app-defined transport tag (e.g. "wasm", "app", "http"). */
  transport: string;
  stage: PendingRemoteStage;
  server_name: string | null;
  server_description: string | null;
  server_version: string | null;
  server_image_data: string | null;
  server_image_type: string | null;
  knock_username: string | null;
  knock_message: string | null;
  error_message: string | null;
}

/** what a peer's public hello endpoint reports about itself. snake_case
 *  matches the wire shape. */
export interface PeerServerInfo {
  name: string;
  description?: string | null;
  version: string;
  image_url?: string | null;
  image_blob_id?: string | null;
  requires_auth: boolean;
  knocking_enabled?: boolean | null;
  passkey_p2p_enabled?: boolean | null;
}

/** a saved remote, as returned by the app's remote store. */
export interface SavedRemote {
  remote_id: string;
  name: string;
  base_url?: string;
  peer_addr?: string;
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------

export type AddPeerState =
  | {
      step: "url";
      subStep: "input" | "knock_form";
      error: string | null;
      pendingRemotes: PendingRemote[];
      serverInfo: PeerServerInfo | null;
      peerAddr: string | null;
    }
  | {
      step: "testing";
      progress: string | null;
      peerAddr: string | null;
      url: string;
    }
  | {
      step: "auth";
      error: string | null;
      serverInfo: PeerServerInfo | null;
      peerAddr: string | null;
      url: string;
    }
  | { step: "knock_sent" }
  | { step: "complete"; remote: SavedRemote };

// ---------------------------------------------------------------------------
// events (ui events + async effect outcomes)
// ---------------------------------------------------------------------------

/** outcome of a connection probe (hello + whoami against the target). */
export type ConnectionOutcome =
  | { kind: "already_authed"; serverInfo: PeerServerInfo }
  | { kind: "needs_knock"; serverInfo: PeerServerInfo; error?: string }
  | { kind: "needs_auth"; serverInfo: PeerServerInfo }
  | { kind: "failed"; error: string };

/** outcome of a knock-status re-check for a pending knock. */
export type KnockStatusOutcome =
  | { kind: "accepted_authed"; serverInfo: PeerServerInfo | null }
  | { kind: "accepted_needs_auth"; serverInfo: PeerServerInfo | null }
  | { kind: "denied" }
  | { kind: "pending" }
  | { kind: "unreachable" };

export type AddPeerEvent =
  // ui events
  | { type: "MODAL_OPEN"; initialInput?: string }
  | { type: "MODAL_CLOSE" }
  | { type: "INPUT_CHANGE"; input: string }
  | { type: "QR_SCAN"; input: string }
  | { type: "SUBMIT_URL"; input: string }
  | { type: "SUBMIT_KNOCK"; username: string; message: string }
  | { type: "CANCEL_KNOCK" }
  | { type: "USE_INVITE_CODE" }
  | { type: "PASSKEY_SIGNIN" }
  | {
      type: "SUBMIT_AUTH";
      mode: "login" | "register";
      username: string;
      inviteCode?: string;
    }
  | {
      type: "PASSKEY_AUTH";
      mode: "login" | "register";
      username?: string;
      inviteCode?: string;
    }
  | { type: "BACK" }
  | { type: "RETRY_PENDING"; pending: PendingRemote }
  | { type: "DELETE_PENDING"; pending: PendingRemote }
  // async effect outcomes (fed back by the adapter)
  | { type: "PENDING_LOADED"; records: PendingRemote[] }
  | { type: "DUPLICATE_RESULT"; duplicateName: string | null }
  | { type: "CONNECTION_RESULT"; outcome: ConnectionOutcome }
  | { type: "KNOCK_SENT_RESULT"; ok: boolean; error?: string }
  | { type: "KNOCK_STATUS_RESULT"; outcome: KnockStatusOutcome }
  | { type: "AUTH_RESULT"; ok: boolean; error?: string }
  | {
      type: "REMOTE_CREATED";
      ok: boolean;
      remote?: SavedRemote;
      error?: string;
    }
  // external push: a knock-accepted / device-linked notification arrived
  // over p2p for this peer - completes the flow from any state
  | { type: "COMPLETE_PEER_ADDR"; peerAddr: string }
  | { type: "TIMER_FIRED"; id: string };

// ---------------------------------------------------------------------------
// effects (descriptors the adapter executes)
// ---------------------------------------------------------------------------

export type AddPeerEffect =
  | { type: "LOAD_PENDING_REMOTES" }
  | { type: "CHECK_DUPLICATE"; target: PeerTarget }
  | {
      type: "UPSERT_PENDING";
      peerAddr: string;
      patch: Partial<Omit<PendingRemote, "id" | "peer_addr">>;
    }
  | { type: "DELETE_PENDING"; id: string }
  | { type: "DELETE_PENDING_BY_ADDR"; peerAddr: string }
  | { type: "CHECK_CONNECTION"; target: PeerTarget }
  | { type: "SEND_KNOCK"; peerAddr: string; username: string; message: string }
  | { type: "CHECK_KNOCK_STATUS"; pending: PendingRemote }
  | {
      type: "AUTH_HTTP";
      url: string;
      mode: "login" | "register";
      username: string;
      inviteCode?: string;
    }
  | {
      type: "AUTH_REDEEM_INVITE";
      peerAddr: string;
      username: string;
      inviteCode: string;
    }
  | {
      type: "AUTH_PASSKEY_REGISTER";
      peerAddr: string;
      username?: string;
      inviteCode: string;
    }
  | { type: "AUTH_PASSKEY_LOGIN"; target: PeerTarget; username?: string }
  | { type: "CREATE_REMOTE"; peerAddr: string | null; url: string }
  | { type: "CANCEL_IN_FLIGHT" }
  | { type: "SCHEDULE_TIMER"; id: string; ms: number }
  | { type: "CLEAR_QUERY_PARAM" }
  | { type: "CALL_ON_SUCCESS"; remote: SavedRemote }
  | { type: "CALL_ON_CLOSE" };

// ---------------------------------------------------------------------------
// dependencies (what the bundled effect runner binds to)
// ---------------------------------------------------------------------------

/** everything the bundled effect runner needs from the app. each dep is a
 *  thin binding over the app's own storage/client layer; the machine
 *  itself never calls these - only `runEffect` does. */
export interface AddPeerFlowDeps {
  // storage
  getAllRemotes(): Promise<SavedRemote[]>;
  getAllPendingRemotes(): Promise<PendingRemote[]>;
  getPendingRemoteByPeerAddr(peerAddr: string): Promise<PendingRemote | null>;
  createPendingRemote(record: Omit<PendingRemote, "id">): Promise<PendingRemote>;
  updatePendingRemote(id: string, patch: Partial<Omit<PendingRemote, "id">>): Promise<void>;
  deletePendingRemote(id: string): Promise<void>;
  deletePendingRemoteByPeerAddr(peerAddr: string): Promise<void>;
  createRemote(input: { base_url?: string; peer_addr?: string }): Promise<SavedRemote>;
  // network (each returns null-ish/throws on failure; the runner maps
  // outcomes onto result events)
  getServerInfo(target: PeerTarget): Promise<PeerServerInfo | null>;
  whoami(target: PeerTarget): Promise<boolean>;
  sendKnock(peerAddr: string, username: string, message: string): Promise<void>;
  checkKnockStatus(peerAddr: string): Promise<"accepted" | "rejected" | "pending" | null>;
  authenticateHttp(
    url: string,
    data: { mode: "login" | "register"; username: string; inviteCode?: string }
  ): Promise<void>;
  redeemInvite(peerAddr: string, username: string, inviteCode: string): Promise<void>;
  registerWithPasskey(peerAddr: string, username: string | undefined, inviteCode: string): Promise<void>;
  loginWithPasskey(target: PeerTarget, username?: string): Promise<void>;
  // platform
  /** app-defined transport tag recorded on pending remotes ("wasm", "app", "http"). */
  transportFor(target: PeerTarget): string;
  /** default scheme for scheme-less http input. default "https". */
  defaultScheme?: "http" | "https";
  // adapter-only hooks (invoked by the runner for the app-shell effects)
  clearQueryParam?(): void;
  onSuccess?(remote: SavedRemote): void;
  onClose?(): void;
  /** timer scheduling seam - override in tests. defaults to setTimeout. */
  scheduleTimer?(id: string, ms: number, fire: () => void): () => void;
}
