/**
 * sqlite-backed social doc adapter for tauri mode.
 *
 * implements the SocialDoc interface using IPC calls to grimoire's social
 * module (via skein_dispatch) instead of automerge. the widget code sees
 * the same { current, change(), on() } API regardless of backend.
 *
 * architecture:
 * - reads: social_get_state IPC returns a SocialSnapshot from sqlite
 * - writes: change() applies the mutation to a clone, diffs prev vs next,
 *   and dispatches the appropriate social_* IPC actions
 * - reactivity: listens for "social-state-changed" tauri events (emitted
 *   after every IPC mutation) and refetches the full snapshot
 *
 * the diff engine handles all 17 mutation patterns used by the widget tabs
 * and friendz-wiring. see docs/peer-identity-unification-plan.md phase 4.
 */

import type { FriendEntry, FriendNodeId, SocialState } from "../../widgets/narthex/social/schema";
import type { SocialDoc } from "../../widgets/narthex/social/types";

const TAG = "[sqlite-social-doc]";

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

/**
 * invoke skein_dispatch on the Rust side.
 * dynamic import so the module graph doesn't fail in non-Tauri builds.
 */
async function dispatch(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("skein_dispatch", { action, payload });
}

/**
 * listen for a tauri event. returns an unlisten function.
 */
async function listenForEvent(event: string, handler: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(event, handler);
}

// ---------------------------------------------------------------------------
// timestamp helpers
// ---------------------------------------------------------------------------

/** convert a unix timestamp (seconds) to an ISO 8601 string, or "" if falsy */
function unixToIso(unix: number | null | undefined): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// raw snapshot types (matches grimoire JSON serialization, snake_case)
// ---------------------------------------------------------------------------

interface RawUserProfile {
  user_id: string;
  username: string;
  alias: string;
  bio: string;
  avatar_url: string;
  accent_color: number;
  node_id: string;
}

interface RawPeerNodeProfile {
  node_id: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  accent_color: number;
  instance_name: string | null;
  last_seen_at: number | null;
  created_at: number;
}

interface RawPeerFriendDetail {
  id: string;
  group_name: string;
  created_at: number;
  friend_user_id: string;
  username: string;
  alias: string;
  bio: string;
  avatar_url: string;
  accent_color: number;
  node_ids: RawPeerNodeProfile[];
}

interface RawFriendRequest {
  id: string;
  user_id: string;
  remote_user_id: string;
  direction: string;
  status: string;
  created_at: number;
  updated_at: number;
  remote_username: string;
  remote_alias: string;
  remote_node_id: string | null;
  remote_display_name: string | null;
}

interface RawFriendGroup {
  id: string;
  user_id: string;
  name: string;
  color: number;
}

interface RawSocialSettings {
  profile_visibility: string;
  friend_requests_from: string;
}

interface RawSocialSnapshot {
  profile: RawUserProfile;
  friends: RawPeerFriendDetail[];
  groups: RawFriendGroup[];
  pending_requests: RawFriendRequest[];
  outbound_requests: RawFriendRequest[];
  settings: RawSocialSettings;
}

// ---------------------------------------------------------------------------
// internal ID maps — maintained across refetches so the diff engine can
// translate TS-level identifiers to the IPC arguments grimoire expects
// ---------------------------------------------------------------------------

interface IdMaps {
  /** peer_friendz.id → user_accountz.id of the friend */
  friendIdToUserId: Map<string, string>;
  /** pending request fromNodeId → friend_requestz.id */
  pendingNodeToRequestId: Map<string, string>;
  /** outbound request toNodeId → friend_requestz.id */
  outboundNodeToRequestId: Map<string, string>;
}

function createIdMaps(): IdMaps {
  return {
    friendIdToUserId: new Map(),
    pendingNodeToRequestId: new Map(),
    outboundNodeToRequestId: new Map(),
  };
}

// ---------------------------------------------------------------------------
// snapshot → SocialState transformer
// ---------------------------------------------------------------------------

/**
 * transform the raw grimoire SocialSnapshot into the Zod SocialState shape
 * that widgets expect. also rebuilds the internal ID maps.
 */
function mapSnapshot(raw: RawSocialSnapshot, maps: IdMaps): SocialState {
  // rebuild maps
  maps.friendIdToUserId.clear();
  maps.pendingNodeToRequestId.clear();
  maps.outboundNodeToRequestId.clear();

  for (const f of raw.friends) {
    maps.friendIdToUserId.set(f.id, f.friend_user_id);
  }
  for (const r of raw.pending_requests) {
    if (r.remote_node_id) {
      maps.pendingNodeToRequestId.set(r.remote_node_id, r.id);
    }
  }
  for (const r of raw.outbound_requests) {
    if (r.remote_node_id) {
      maps.outboundNodeToRequestId.set(r.remote_node_id, r.id);
    }
  }

  return {
    profile: {
      // the TS "username" field is the user's display name — map from alias
      // (free-form) with fallback to system username (char-restricted)
      username: raw.profile.alias || raw.profile.username,
      bio: raw.profile.bio,
      avatarDataUrl: raw.profile.avatar_url,
      accentColor: raw.profile.accent_color,
      nodeId: raw.profile.node_id,
    },

    friends: raw.friends.map(
      (f): FriendEntry => ({
        id: f.id,
        alias: f.alias,
        // friend-level username: prefer most-recent node display_name, fall back to system username
        username: bestNodeDisplayName(f.node_ids) || f.username,
        group: f.group_name,
        nodeIds: f.node_ids.map(
          (n): FriendNodeId => ({
            nodeId: n.node_id,
            addedAt: unixToIso(n.created_at),
            lastSeenAt: unixToIso(n.last_seen_at),
            username: n.display_name,
            bio: n.bio,
            avatarDataUrl: n.avatar_url,
          })
        ),
        createdAt: unixToIso(f.created_at),
      })
    ),

    groups: raw.groups.map((g) => ({
      name: g.name,
      createdAt: "", // grimoire groups don't track createdAt
    })),

    pendingRequests: raw.pending_requests.map((r) => ({
      fromNodeId: r.remote_node_id || "",
      fromUsername: r.remote_display_name || r.remote_alias || r.remote_username,
      receivedAt: unixToIso(r.created_at),
      status: r.status as "pending" | "accepted" | "accepted-pending-ack" | "rejected",
    })),

    outboundRequests: raw.outbound_requests.map((r) => ({
      toNodeId: r.remote_node_id || "",
      toUsername: r.remote_display_name || r.remote_alias || r.remote_username,
      sentAt: unixToIso(r.created_at),
      status: r.status as "pending" | "accepted" | "accepted-pending-ack" | "rejected",
    })),

    profileVisibility: raw.settings.profile_visibility as "friends" | "everyone" | "nobody",
    friendRequestsFrom: raw.settings.friend_requests_from as "everyone" | "nobody",
  };
}

/** pick the display_name from the most-recently-seen node, or "" */
function bestNodeDisplayName(nodes: RawPeerNodeProfile[]): string {
  if (!nodes.length) return "";
  // nodes are already sorted by last_seen_at DESC from the repository
  for (const n of nodes) {
    if (n.display_name) return n.display_name;
  }
  return "";
}

// ---------------------------------------------------------------------------
// SqliteSocialDoc
// ---------------------------------------------------------------------------

/**
 * SocialDoc implementation backed by grimoire's sqlite social tables.
 *
 * used in tauri mode. the browser mode continues to use the automerge-backed
 * WidgetDoc created by createWidgetDoc().
 *
 * usage:
 *   const doc = await SqliteSocialDoc.create();
 *   doc.current.profile.username; // read
 *   doc.change(d => { d.profile.username = "new name"; }); // write
 *   const unsub = doc.on("change", state => { ... }); // subscribe
 */
export class SqliteSocialDoc implements SocialDoc {
  private state: SocialState;
  private readonly listeners = new Set<(state: SocialState) => void>();
  private readonly maps: IdMaps;
  private unlisten: (() => void) | null = null;

  private constructor(state: SocialState, maps: IdMaps) {
    this.state = state;
    this.maps = maps;
  }

  /**
   * create and initialize a SqliteSocialDoc.
   * fetches the initial snapshot from sqlite and starts listening for changes.
   */
  static async create(): Promise<SqliteSocialDoc> {
    const raw = (await dispatch("social_get_state")) as RawSocialSnapshot;
    const maps = createIdMaps();
    const state = mapSnapshot(raw, maps);
    const doc = new SqliteSocialDoc(state, maps);

    // listen for tauri events emitted after any social mutation
    doc.unlisten = await listenForEvent("social-state-changed", () => {
      doc.refetch().catch((err) => {
        console.warn(TAG, "refetch after event failed:", err);
      });
    });

    console.log(
      TAG,
      "initialized —",
      raw.friends.length,
      "friends,",
      raw.pending_requests.length,
      "pending requests"
    );
    return doc;
  }

  /** the current validated social state */
  get current(): SocialState {
    return this.state;
  }

  /**
   * mutate the social state. the mutation function receives a mutable draft.
   * the adapter diffs prev vs draft and dispatches the appropriate IPC calls.
   * updates are optimistic — the local state is updated immediately, then
   * confirmed (or corrected) when the refetch arrives.
   */
  change(fn: (draft: SocialState) => void): void {
    const prev = structuredClone(this.state);
    const draft = structuredClone(this.state);
    fn(draft);

    // optimistic update so UI reacts immediately
    this.state = draft;
    this.notifyListeners();

    // dispatch IPC calls based on the diff (fire-and-forget)
    this.dispatchDiff(prev, draft).catch((err) => {
      console.warn(TAG, "diff dispatch error:", err);
    });
  }

  /** subscribe to state changes. returns an unsubscribe function. */
  on(_event: "change", handler: (state: SocialState) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** tear down the event listener and clear subscriptions */
  destroy(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private notifyListeners(): void {
    const state = this.state;
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch (e) {
        console.warn(TAG, "listener error:", e);
      }
    }
  }

  /** refetch the full snapshot from sqlite and update state */
  private async refetch(): Promise<void> {
    const raw = (await dispatch("social_get_state")) as RawSocialSnapshot;
    this.state = mapSnapshot(raw, this.maps);
    this.notifyListeners();
  }

  // -------------------------------------------------------------------------
  // diff engine — compares prev and next SocialState and dispatches the
  // appropriate social_* IPC actions. each diff category is independent.
  // -------------------------------------------------------------------------

  private async dispatchDiff(prev: SocialState, next: SocialState): Promise<void> {
    const promises: Promise<unknown>[] = [];

    // -- profile --
    this.diffProfile(prev, next, promises);

    // -- settings --
    this.diffSettings(prev, next, promises);

    // -- friends --
    this.diffFriends(prev, next, promises);

    // -- groups --
    this.diffGroups(prev, next, promises);

    // -- pending requests --
    this.diffPendingRequests(prev, next, promises);

    // -- outbound requests --
    this.diffOutboundRequests(prev, next, promises);

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  // -- profile diffs --------------------------------------------------------

  private diffProfile(prev: SocialState, next: SocialState, promises: Promise<unknown>[]): void {
    const p = prev.profile;
    const n = next.profile;

    // skip nodeId changes — runtime-only, not persisted via profile update
    const usernameChanged = p.username !== n.username;
    const bioChanged = p.bio !== n.bio;
    const avatarChanged = p.avatarDataUrl !== n.avatarDataUrl;
    const colorChanged = p.accentColor !== n.accentColor;

    if (usernameChanged || bioChanged || avatarChanged || colorChanged) {
      const payload: Record<string, unknown> = {};
      // TS "username" maps to grimoire "alias" (free-form display name)
      if (usernameChanged) payload.alias = n.username;
      if (bioChanged) payload.bio = n.bio;
      if (avatarChanged) payload.avatar_url = n.avatarDataUrl;
      if (colorChanged) payload.accent_color = n.accentColor;
      promises.push(dispatch("social_update_profile", payload));
    }
  }

  // -- settings diffs -------------------------------------------------------

  private diffSettings(prev: SocialState, next: SocialState, promises: Promise<unknown>[]): void {
    if (
      prev.profileVisibility !== next.profileVisibility ||
      prev.friendRequestsFrom !== next.friendRequestsFrom
    ) {
      promises.push(
        dispatch("social_update_settings", {
          profile_visibility: next.profileVisibility,
          friend_requests_from: next.friendRequestsFrom,
        })
      );
    }
  }

  // -- friend diffs ---------------------------------------------------------

  private diffFriends(prev: SocialState, next: SocialState, promises: Promise<unknown>[]): void {
    const prevById = new Map<string, FriendEntry>(prev.friends.map((f) => [f.id, f]));
    const nextById = new Map<string, FriendEntry>(next.friends.map((f) => [f.id, f]));

    // added friends
    for (const [id, f] of nextById) {
      if (!prevById.has(id)) {
        const nodeId = f.nodeIds[0]?.nodeId;
        if (nodeId) {
          promises.push(
            dispatch("social_add_friend", {
              node_id: nodeId,
              alias: f.alias || f.username || undefined,
            })
          );
        }
      }
    }

    // removed friends
    for (const [id] of prevById) {
      if (!nextById.has(id)) {
        promises.push(dispatch("social_remove_friend", { id }));
      }
    }

    // changed friends
    for (const [id, nextF] of nextById) {
      const prevF = prevById.get(id);
      if (!prevF) continue;

      // alias changed
      if (prevF.alias !== nextF.alias) {
        const friendUserId = this.maps.friendIdToUserId.get(id);
        if (friendUserId) {
          promises.push(
            dispatch("social_set_friend_alias", {
              friend_user_id: friendUserId,
              alias: nextF.alias,
            })
          );
        }
      }

      // group changed
      if (prevF.group !== nextF.group) {
        promises.push(
          dispatch("social_update_friend", {
            id,
            group_name: nextF.group,
          })
        );
      }

      // per-node profile changes (username/bio/avatar updates from profile responses)
      this.diffFriendNodes(prevF, nextF, promises);
    }
  }

  private diffFriendNodes(
    prevF: FriendEntry,
    nextF: FriendEntry,
    promises: Promise<unknown>[]
  ): void {
    const prevNodes = new Map<string, FriendNodeId>(prevF.nodeIds.map((n) => [n.nodeId, n]));

    for (const nextNode of nextF.nodeIds) {
      const prevNode = prevNodes.get(nextNode.nodeId);
      if (!prevNode) continue;

      const nameChanged = prevNode.username !== nextNode.username;
      const bioChanged = prevNode.bio !== nextNode.bio;
      const avatarChanged = prevNode.avatarDataUrl !== nextNode.avatarDataUrl;
      const seenChanged = prevNode.lastSeenAt !== nextNode.lastSeenAt;

      if (nameChanged || bioChanged || avatarChanged || seenChanged) {
        const payload: Record<string, unknown> = { node_id: nextNode.nodeId };
        if (nameChanged) payload.display_name = nextNode.username;
        if (bioChanged) payload.bio = nextNode.bio;
        if (avatarChanged) payload.avatar_url = nextNode.avatarDataUrl;
        promises.push(dispatch("social_update_node_profile", payload));
      }
    }
  }

  // -- group diffs ----------------------------------------------------------

  private diffGroups(prev: SocialState, next: SocialState, promises: Promise<unknown>[]): void {
    const prevNames = new Set<string>(prev.groups.map((g) => g.name));
    const nextNames = new Set<string>(next.groups.map((g) => g.name));

    // added groups
    for (const g of next.groups) {
      if (!prevNames.has(g.name)) {
        promises.push(dispatch("social_upsert_group", { name: g.name, color: 0 }));
      }
    }

    // removed groups
    for (const g of prev.groups) {
      if (!nextNames.has(g.name)) {
        promises.push(dispatch("social_delete_group", { name: g.name }));
      }
    }
  }

  // -- pending request diffs ------------------------------------------------

  private diffPendingRequests(
    prev: SocialState,
    next: SocialState,
    promises: Promise<unknown>[]
  ): void {
    type PendingReq = SocialState["pendingRequests"][number];
    const prevByNode = new Map<string, PendingReq>(
      prev.pendingRequests.map((r) => [r.fromNodeId, r])
    );
    const nextByNode = new Map<string, PendingReq>(
      next.pendingRequests.map((r) => [r.fromNodeId, r])
    );

    // added pending requests (new inbound request received)
    for (const [nodeId, r] of nextByNode) {
      if (!prevByNode.has(nodeId)) {
        promises.push(
          dispatch("social_create_request", {
            node_id: nodeId,
            direction: "inbound",
            display_name: r.fromUsername || undefined,
          })
        );
      }
    }

    // status changes on existing pending requests
    for (const [nodeId, nextR] of nextByNode) {
      const prevR = prevByNode.get(nodeId);
      if (!prevR || prevR.status === nextR.status) continue;

      const requestId = this.maps.pendingNodeToRequestId.get(nodeId);
      if (!requestId) continue;

      if (nextR.status === "accepted-pending-ack" || nextR.status === "accepted") {
        // widget sets "accepted-pending-ack" when user taps accept.
        // the IPC "accepted" status triggers the full accept flow
        // (sets DB to "accepted-pending-ack" + creates friendship).
        // when the ack comes back and status becomes "accepted", the
        // IPC handler detects the state and completes the handshake.
        promises.push(dispatch("social_update_request", { id: requestId, status: "accepted" }));
      } else if (nextR.status === "rejected") {
        promises.push(dispatch("social_update_request", { id: requestId, status: "rejected" }));
      }
    }
  }

  // -- outbound request diffs -----------------------------------------------

  private diffOutboundRequests(
    prev: SocialState,
    next: SocialState,
    promises: Promise<unknown>[]
  ): void {
    type OutboundReq = SocialState["outboundRequests"][number];
    const prevByNode = new Map<string, OutboundReq>(
      prev.outboundRequests.map((r) => [r.toNodeId, r])
    );
    const nextByNode = new Map<string, OutboundReq>(
      next.outboundRequests.map((r) => [r.toNodeId, r])
    );

    // added outbound requests (user sent a new friend request)
    for (const [nodeId] of nextByNode) {
      if (!prevByNode.has(nodeId)) {
        promises.push(
          dispatch("social_create_request", {
            node_id: nodeId,
            direction: "outbound",
          })
        );
      }
    }

    // removed outbound requests (cancel pending, or clear completed)
    for (const [nodeId, prevR] of prevByNode) {
      if (nextByNode.has(nodeId)) continue;

      const requestId = this.maps.outboundNodeToRequestId.get(nodeId);
      if (!requestId) continue;

      if (prevR.status === "pending") {
        // cancel: reject the outbound request
        promises.push(dispatch("social_update_request", { id: requestId, status: "rejected" }));
      } else {
        // clear completed: delete the request row from the DB
        promises.push(dispatch("social_delete_request", { id: requestId }));
      }
    }

    // status changes on existing outbound requests
    for (const [nodeId, nextR] of nextByNode) {
      const prevR = prevByNode.get(nodeId);
      if (!prevR || prevR.status === nextR.status) continue;

      const requestId = this.maps.outboundNodeToRequestId.get(nodeId);
      if (requestId) {
        promises.push(dispatch("social_update_request", { id: requestId, status: nextR.status }));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// display name resolution helper
// ---------------------------------------------------------------------------

/**
 * resolve the best display name, avatar, and accent color for a friend.
 * follows the priority chain:
 *   alias > online node display_name > most-recent node display_name > username > truncated node_id
 *
 * @param friend - the friend entry from the social state
 * @param onlineNodeId - if known, the node_id of the currently-online node
 */
export function resolveFriendDisplay(
  friend: FriendEntry,
  onlineNodeId?: string
): { name: string; avatar: string; accentColor: number } {
  // 1. alias (local admin's free-form label)
  if (friend.alias) {
    // still pick avatar/color from the best node
    const node = pickBestNode(friend.nodeIds, onlineNodeId);
    return {
      name: friend.alias,
      avatar: node?.avatarDataUrl || "",
      accentColor: 0x6366f1,
    };
  }

  // 2-3. online node display_name, or most-recent node display_name
  const onlineNode = onlineNodeId
    ? friend.nodeIds.find((n) => n.nodeId === onlineNodeId)
    : undefined;
  if (onlineNode?.username) {
    return {
      name: onlineNode.username,
      avatar: onlineNode.avatarDataUrl || "",
      accentColor: 0x6366f1,
    };
  }

  // most-recent node (first in array, already sorted by last_seen DESC)
  const recentNode = friend.nodeIds[0];
  if (recentNode?.username) {
    return {
      name: recentNode.username,
      avatar: recentNode.avatarDataUrl || "",
      accentColor: 0x6366f1,
    };
  }

  // 4. system username
  if (friend.username) {
    return {
      name: friend.username,
      avatar: recentNode?.avatarDataUrl || "",
      accentColor: 0x6366f1,
    };
  }

  // 5. truncated node_id
  const nodeId = friend.nodeIds[0]?.nodeId || "unknown";
  return {
    name: nodeId.length > 12 ? nodeId.slice(0, 12) + "..." : nodeId,
    avatar: "",
    accentColor: 0x6366f1,
  };
}

/** pick the best node for avatar/color: prefer online, then most-recent */
function pickBestNode(
  nodes: readonly FriendNodeId[],
  onlineNodeId?: string
): FriendNodeId | undefined {
  if (onlineNodeId) {
    const online = nodes.find((n) => n.nodeId === onlineNodeId);
    if (online) return online;
  }
  return nodes[0]; // already sorted by last_seen DESC
}
