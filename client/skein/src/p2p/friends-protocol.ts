// ---------------------------------------------------------------------------
// friends protocol handler — freqhole-friendz/1
//
// handles P2P communication for friend requests, profile sharing, and
// presence heartbeat over the freqhole-friendz/1 ALPN. runs alongside
// the automerge sync adapter, sharing the same midden WASM transport.
// ---------------------------------------------------------------------------

import type { BiStreamLike, MiddenStreamNode } from "./iroh-network-adapter";
import { FRIENDZ_ALPN } from "./iroh-network-adapter";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const TAG = "[skein:friendz]";

/** how often to send heartbeat pings to friends (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** time after last heartbeat before marking a friend offline (ms). */
export const HEARTBEAT_TIMEOUT_MS = 90_000;

/** interval for probing offline friends to see if they came back (ms). */
export const DISCOVERY_SWEEP_MS = 300_000; // 5 min

// ---------------------------------------------------------------------------
// protocol message types
// ---------------------------------------------------------------------------

/** request the peer's profile. */
export interface ProfileRequestMessage {
  type: "profile-request";
}

/** response with profile data. */
export interface ProfileResponseMessage {
  type: "profile-response";
  username: string;
  bio: string;
  avatarDataUrl: string;
}

/** send a friend request to a peer. */
export interface FriendRequestMessage {
  type: "friend-request";
  fromNodeId: string;
  fromUsername: string;
}

/** accept an incoming friend request. */
export interface FriendAcceptMessage {
  type: "friend-accept";
  fromNodeId: string;
  fromUsername: string;
}

/** reject an incoming friend request. */
export interface FriendRejectMessage {
  type: "friend-reject";
  fromNodeId: string;
}

/** lightweight activity summary for a shared canvas, piggybacked on heartbeat. */
export interface CanvasActivityEntry {
  canvasDocId: string;
  lastModifiedAt: string; // ISO timestamp of most recent change
  widgetCount: number; // cheap proxy for "how much stuff is there"
}

/** periodic presence ping. */
export interface HeartbeatMessage {
  type: "heartbeat";
  nodeId: string;
  username: string;
  canvasActivity?: CanvasActivityEntry[];
}

/** acknowledge a friend-accept (two-phase handshake). */
export interface FriendAcceptAckMessage {
  type: "friend-accept-ack";
  fromNodeId: string;
}

/** send a canvas invite (or relay via gossip). */
export interface CanvasInviteMessage {
  type: "canvas-invite";
  inviteId: string;
  canvasDocId: string;
  canvasTitle: string;
  canvasDescription?: string;
  canvasColor?: number;
  canvasPreviewUrl?: string;
  originNodeId: string;
  originUsername: string;
  role: "editor" | "viewer";
  targets: string[];
  acked: string[];
}

/** acknowledge receipt of a canvas invite. */
export interface CanvasInviteAckMessage {
  type: "canvas-invite-ack";
  inviteId: string;
  canvasDocId: string;
  ackerNodeId: string;
}

/** accept a canvas invite. */
export interface CanvasInviteAcceptMessage {
  type: "canvas-invite-accept";
  inviteId: string;
  canvasDocId: string;
  accepterNodeId: string;
}

/** decline a canvas invite. */
export interface CanvasInviteDeclineMessage {
  type: "canvas-invite-decline";
  inviteId: string;
  canvasDocId: string;
  declinerNodeId: string;
}

/** notify a peer that their ACL role changed. */
export interface AclChangeMessage {
  type: "acl-change";
  canvasDocId: string;
  canvasTitle: string;
  targetNodeId: string;
  newRole: "editor" | "viewer" | "removed";
  changedBy: string;
  changedByUsername: string;
}

/** notify a peer that a shared canvas was modified. */
export interface CanvasUpdateMessage {
  type: "canvas-update";
  canvasDocId: string;
  lastModifiedAt: string;
  widgetCount: number;
  modifiedByNodeId: string;
  modifiedByUsername: string;
}

/** sent when a peer is about to go offline (tab close / app exit). */
export interface OfflineAnnouncementMessage {
  type: "offline-announcement";
  nodeId: string;
}

/** a canvas update entry in a gossip digest. */
export interface GossipDigestCanvasUpdate {
  canvasDocId: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

/** a pending invite entry in a gossip digest. */
export interface GossipDigestPendingInvite {
  canvasDocId: string;
  canvasTitle: string;
  canvasDescription: string;
  canvasColor: number;
  canvasPreviewUrl: string;
  invitedBy: string;
  invitedByUsername: string;
  role: "editor" | "viewer";
  invitedAt: string;
}

/** gossip digest sent when a peer comes online.
 *  bundles canvas updates and pending invites for the receiving peer,
 *  computed from the sender's local canvas doc state. */
export interface GossipDigestMessage {
  type: "gossip-digest";
  canvasUpdates: GossipDigestCanvasUpdate[];
  pendingInvites: GossipDigestPendingInvite[];
  sharedCanvasIds?: string[];
}

/** batch blob availability query — "i need these blobs, which do you have?"
 *  sent by the hub to peers when it has missing blobs without snatchedBy info.
 *  the receiver checks locally and responds with blob-offer. */
export interface BlobSeekMessage {
  type: "blob-seek";
  needed: string[];
}

/** batch blob availability response — "i have these blobs."
 *  sent in response to a BlobSeek. contains the subset of requested hashes
 *  that the responder has locally. */
export interface BlobOfferMessage {
  type: "blob-offer";
  available: string[];
}

/** union of all protocol messages. */
export type FriendzMessage =
  | ProfileRequestMessage
  | ProfileResponseMessage
  | FriendRequestMessage
  | FriendAcceptMessage
  | FriendAcceptAckMessage
  | FriendRejectMessage
  | HeartbeatMessage
  | CanvasInviteMessage
  | CanvasInviteAckMessage
  | CanvasInviteAcceptMessage
  | CanvasInviteDeclineMessage
  | AclChangeMessage
  | CanvasUpdateMessage
  | OfflineAnnouncementMessage
  | GossipDigestMessage
  | BlobSeekMessage
  | BlobOfferMessage;

// ---------------------------------------------------------------------------
// message encoding / decoding
//
// messages are JSON-encoded and written as UTF-8 over the BiStream.
// the midden BiStream's write_message/read_message handles
// length-delimited framing, so we just need JSON serialization.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** encode a protocol message to bytes for sending over a BiStream. */
export function encodeMessage(msg: FriendzMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

/** decode bytes from a BiStream into a protocol message. */
export function decodeMessage(data: Uint8Array): FriendzMessage {
  const text = decoder.decode(data);
  return JSON.parse(text) as FriendzMessage;
}

// ---------------------------------------------------------------------------
// event types for the protocol handler
// ---------------------------------------------------------------------------

/** callback for when a friend request is received from a remote peer. */
export type OnFriendRequest = (request: FriendRequestMessage, fromNodeId: string) => void;

/** callback for when a friend request is accepted by a remote peer. */
export type OnFriendAccept = (accept: FriendAcceptMessage, fromNodeId: string) => void;

/** callback for when a friend request is rejected by a remote peer. */
export type OnFriendReject = (reject: FriendRejectMessage, fromNodeId: string) => void;

/** callback for when a profile response is received from a remote peer. */
export type OnProfileResponse = (profile: ProfileResponseMessage, fromNodeId: string) => void;

/** callback for when a heartbeat is received from a remote peer. */
export type OnHeartbeat = (heartbeat: HeartbeatMessage, fromNodeId: string) => void;

/** callback for when a friend-accept-ack is received from a remote peer. */
export type OnFriendAcceptAck = (ack: FriendAcceptAckMessage, fromNodeId: string) => void;

/** callback for when a canvas invite is received from a remote peer. */
export type OnCanvasInvite = (invite: CanvasInviteMessage, fromNodeId: string) => void;

/** callback for when a canvas invite ack is received from a remote peer. */
export type OnCanvasInviteAck = (ack: CanvasInviteAckMessage, fromNodeId: string) => void;

/** callback for when a canvas invite is accepted by a remote peer. */
export type OnCanvasInviteAccept = (accept: CanvasInviteAcceptMessage, fromNodeId: string) => void;

/** callback for when a canvas invite is declined by a remote peer. */
export type OnCanvasInviteDecline = (
  decline: CanvasInviteDeclineMessage,
  fromNodeId: string
) => void;

/** callback for when an ACL change notification is received from a remote peer. */
export type OnAclChange = (change: AclChangeMessage, fromNodeId: string) => void;

/** callback for when a canvas update notification is received from a remote peer. */
export type OnCanvasUpdate = (msg: CanvasUpdateMessage, fromNodeId: string) => void;

// ---------------------------------------------------------------------------
// FriendzProtocol
// ---------------------------------------------------------------------------

export interface FriendzProtocolOptions {
  /** factory to get the midden node for outbound connections. */
  getMidden: () => Promise<MiddenStreamNode>;

  /** local node ID (from identity). */
  localNodeId: string;

  /** local username (from profile). */
  localUsername: string;

  /** callback to get the local profile for responding to profile requests. */
  getLocalProfile: () => { username: string; bio: string; avatarDataUrl: string };

  /** callback to check if a node ID is a known friend. */
  isFriend: (nodeId: string) => boolean;

  /** privacy: who can see our profile ("friends" | "everyone" | "nobody"). */
  profileVisibility?: "friends" | "everyone" | "nobody";

  /** privacy: who can send us friend requests ("everyone" | "nobody"). */
  friendRequestsFrom?: "everyone" | "nobody";

  /** privacy: who can send us canvas invites ("everyone" | "friends" | "nobody"). */
  canvasInvitesFrom?: "everyone" | "friends" | "nobody";

  /** callback that returns canvas activity entries to piggyback on heartbeats. */
  getCanvasActivity?: () => CanvasActivityEntry[];
}

/**
 * handles the freqhole-friendz/1 protocol for friend requests,
 * profile sharing, and presence heartbeat.
 *
 * usage:
 *   const friendz = new FriendzProtocol({ getMidden, localNodeId, ... });
 *   adapter.registerAlpnHandler(FRIENDZ_ALPN, (stream) => friendz.handleStream(stream));
 *
 *   // send a friend request
 *   await friendz.sendFriendRequest(peerNodeId);
 *
 *   // listen for incoming requests
 *   friendz.onFriendRequest = (req, fromNodeId) => { ... };
 */
export class FriendzProtocol {
  private getMidden: () => Promise<MiddenStreamNode>;
  private localNodeId: string;
  private localUsername: string;
  private getLocalProfile: () => { username: string; bio: string; avatarDataUrl: string };
  private isFriend: (nodeId: string) => boolean;
  private profileVisibility: "friends" | "everyone" | "nobody";
  private friendRequestsFrom: "everyone" | "nobody";
  private canvasInvitesFrom: "everyone" | "friends" | "nobody";
  private getCanvasActivity: (() => CanvasActivityEntry[]) | null;

  /** active BiStreams to peers, keyed by node ID. */
  private streams = new Map<string, BiStreamLike>();

  /** in-flight stream opens to deduplicate concurrent sendMessage calls. */
  private pendingConnections = new Map<string, Promise<BiStreamLike>>();

  /** last seen timestamps for heartbeat tracking, keyed by node ID. */
  private lastSeen = new Map<string, number>();

  /** heartbeat interval timer. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** discovery sweep timer for probing offline friends. */
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;

  /** stored friend node ID getter from startHeartbeat, used by discovery sweep. */
  private getFriendNodeIds: (() => string[]) | null = null;

  /** online/offline change listeners. */
  private onlineChangeListeners: Array<() => void> = [];

  private _destroyed = false;

  // --- event handlers (set by the consumer) ---

  /** called when a friend request is received. */
  onFriendRequest: OnFriendRequest | null = null;

  /** called when a friend accept is received. */
  onFriendAccept: OnFriendAccept | null = null;

  /** called when a friend reject is received. */
  onFriendReject: OnFriendReject | null = null;

  /** called when a profile response is received. */
  onProfileResponse: OnProfileResponse | null = null;

  /** called when a heartbeat is received. */
  onHeartbeat: OnHeartbeat | null = null;

  /** called when a friend-accept-ack is received. */
  onFriendAcceptAck: OnFriendAcceptAck | null = null;

  /** called when a canvas invite is received. */
  onCanvasInvite: OnCanvasInvite | null = null;

  /** called when a canvas invite ack is received. */
  onCanvasInviteAck: OnCanvasInviteAck | null = null;

  /** called when a canvas invite is accepted. */
  onCanvasInviteAccept: OnCanvasInviteAccept | null = null;

  /** called when a canvas invite is declined. */
  onCanvasInviteDecline: OnCanvasInviteDecline | null = null;

  /** called when an ACL change notification is received. */
  onAclChange: OnAclChange | null = null;

  /** called when canvas activity entries arrive in a heartbeat. */
  onCanvasActivity: ((entries: CanvasActivityEntry[], fromNodeId: string) => void) | null = null;

  /** called when a peer stream is fully connected and the read loop has started. */
  onPeerConnected: ((peerNodeId: string) => void) | null = null;

  /** called when a peer transitions from offline/unknown to online.
   *  fires on the !wasOnline heartbeat transition, which happens on BOTH sides
   *  during the initial handshake — making gossip exchange bidirectional. */
  onPeerBecameOnline: ((peerNodeId: string) => void) | null = null;

  /** called after each heartbeat tick with the list of friend node IDs. */
  onAfterHeartbeatTick: ((friendNodeIds: string[]) => void) | null = null;

  /** called when a canvas update notification is received. */
  onCanvasUpdate: OnCanvasUpdate | null = null;

  /** called when a gossip digest is received from a peer that just came online. */
  onGossipDigest: ((msg: GossipDigestMessage, fromNodeId: string) => void) | null = null;

  /** called when a blob-seek is received from a peer. */
  onBlobSeek: ((msg: BlobSeekMessage, fromNodeId: string) => void) | null = null;

  constructor(options: FriendzProtocolOptions) {
    this.getMidden = options.getMidden;
    this.localNodeId = options.localNodeId;
    this.localUsername = options.localUsername;
    this.getLocalProfile = options.getLocalProfile;
    this.isFriend = options.isFriend;
    this.profileVisibility = options.profileVisibility ?? "friends";
    this.friendRequestsFrom = options.friendRequestsFrom ?? "everyone";
    this.canvasInvitesFrom = options.canvasInvitesFrom ?? "everyone";
    this.getCanvasActivity = options.getCanvasActivity ?? null;
  }

  // --- incoming stream handling (called by the ALPN router) ---

  /**
   * handle an incoming freqhole-friendz/1 stream.
   * this is registered as the ALPN handler with the iroh adapter.
   */
  handleStream(stream: BiStreamLike): void {
    const peerId = stream.peer_node_id();
    console.log(TAG, "incoming stream from:", peerId.slice(0, 16) + "...");

    // store the stream for potential replies
    const existing = this.streams.get(peerId);
    if (existing) {
      existing.close();
    }
    this.streams.set(peerId, stream);

    // start reading messages
    this.readLoop(peerId, stream);

    this.onPeerConnected?.(peerId);
  }

  private async readLoop(peerId: string, stream: BiStreamLike): Promise<void> {
    try {
      while (!this._destroyed) {
        const data = await stream.read_message();
        if (!data) {
          // stream closed
          console.log(TAG, "stream closed by peer:", peerId.slice(0, 16) + "...");
          break;
        }

        try {
          const msg = decodeMessage(data);
          this.handleMessage(msg, peerId, stream);
        } catch (err) {
          console.warn(TAG, "failed to decode message from:", peerId.slice(0, 16) + "...", err);
        }
      }
    } catch (err) {
      // if this stream was replaced by a newer one, the close error is expected —
      // the new stream is already handling this peer, so don't mark them offline
      const wasReplaced = this.streams.get(peerId) !== stream;
      if (!this._destroyed && !wasReplaced) {
        console.warn(TAG, "read loop error from:", peerId.slice(0, 16) + "...", err);
        // clear lastSeen so isOnline() returns false immediately
        this.lastSeen.delete(peerId);
        this.emitOnlineChange();
      }
    } finally {
      // clean up stream reference if it's still the current one
      if (this.streams.get(peerId) === stream) {
        this.streams.delete(peerId);
      }
    }
  }

  private handleMessage(msg: FriendzMessage, fromNodeId: string, stream: BiStreamLike): void {
    switch (msg.type) {
      case "profile-request":
        this.handleProfileRequest(fromNodeId, stream);
        break;

      case "profile-response":
        this.onProfileResponse?.(msg, fromNodeId);
        break;

      case "friend-request":
        this.handleFriendRequest(msg, fromNodeId);
        break;

      case "friend-accept":
        this.onFriendAccept?.(msg, fromNodeId);
        break;

      case "friend-reject":
        this.onFriendReject?.(msg, fromNodeId);
        break;

      case "heartbeat": {
        const wasOnline =
          this.lastSeen.has(fromNodeId) &&
          Date.now() - this.lastSeen.get(fromNodeId)! < HEARTBEAT_TIMEOUT_MS;
        this.lastSeen.set(fromNodeId, Date.now());
        this.emitOnlineChange();
        this.onHeartbeat?.(msg, fromNodeId);
        if (msg.canvasActivity && msg.canvasActivity.length > 0) {
          this.onCanvasActivity?.(msg.canvasActivity, fromNodeId);
        }
        // fast presence ACK: if this is the first heartbeat from a newly-online peer,
        // reply immediately so they know we're online too
        if (!wasOnline) {
          console.log(TAG, "peer online:", fromNodeId.slice(0, 16) + "...");
          const activity = this.getCanvasActivity?.() ?? [];
          const reply: HeartbeatMessage = {
            type: "heartbeat",
            nodeId: this.localNodeId,
            username: this.localUsername,
            canvasActivity: activity.length > 0 ? activity : undefined,
          };
          this.sendMessage(fromNodeId, reply).catch(() => {
            // silent — just a presence ack, not critical
          });
          this.onPeerBecameOnline?.(fromNodeId);
        }
        break;
      }

      case "friend-accept-ack":
        this.onFriendAcceptAck?.(msg, fromNodeId);
        break;

      case "canvas-invite":
        this.handleCanvasInvite(msg, fromNodeId);
        break;

      case "canvas-invite-ack":
        this.onCanvasInviteAck?.(msg, fromNodeId);
        break;

      case "canvas-invite-accept":
        this.onCanvasInviteAccept?.(msg, fromNodeId);
        break;

      case "canvas-invite-decline":
        this.onCanvasInviteDecline?.(msg, fromNodeId);
        break;

      case "acl-change":
        this.onAclChange?.(msg, fromNodeId);
        break;

      case "canvas-update":
        this.onCanvasUpdate?.(msg, fromNodeId);
        break;

      case "gossip-digest":
        this.onGossipDigest?.(msg, fromNodeId);
        break;

      case "blob-seek":
        this.onBlobSeek?.(msg, fromNodeId);
        break;

      case "blob-offer":
        // blob-offer is a response to our blob-seek — browser peers don't
        // currently send blob-seek, so this is a no-op placeholder.
        console.log(
          TAG,
          "received blob-offer from:",
          fromNodeId.slice(0, 16) + "...",
          "available:",
          (msg as BlobOfferMessage).available.length
        );
        break;

      case "offline-announcement":
        if (this.lastSeen.has(msg.nodeId)) {
          console.log(TAG, "peer offline (announced):", msg.nodeId.slice(0, 16) + "...");
          this.lastSeen.delete(msg.nodeId);
          this.emitOnlineChange();
        }
        break;

      default:
        console.warn(TAG, "unknown message type from:", fromNodeId.slice(0, 16) + "...", msg);
    }
  }

  private handleProfileRequest(fromNodeId: string, stream: BiStreamLike): void {
    // check privacy settings
    if (this.profileVisibility === "nobody") {
      console.log(TAG, "ignoring profile request (visibility: nobody)");
      return;
    }
    if (this.profileVisibility === "friends" && !this.isFriend(fromNodeId)) {
      console.log(
        TAG,
        "ignoring profile request from non-friend:",
        fromNodeId.slice(0, 16) + "..."
      );
      return;
    }

    const profile = this.getLocalProfile();
    const response: ProfileResponseMessage = {
      type: "profile-response",
      username: profile.username,
      bio: profile.bio,
      avatarDataUrl: profile.avatarDataUrl,
    };

    stream.write_message(encodeMessage(response)).catch((err) => {
      console.warn(TAG, "failed to send profile response:", err);
    });
  }

  private handleFriendRequest(msg: FriendRequestMessage, fromNodeId: string): void {
    // check privacy settings
    if (this.friendRequestsFrom === "nobody") {
      console.log(TAG, "ignoring friend request (requests disabled)");
      return;
    }

    this.onFriendRequest?.(msg, fromNodeId);
  }

  private handleCanvasInvite(msg: CanvasInviteMessage, fromNodeId: string): void {
    if (this.canvasInvitesFrom === "nobody") {
      console.log(TAG, "ignoring canvas invite (invites disabled)");
      return;
    }
    if (this.canvasInvitesFrom === "friends" && !this.isFriend(fromNodeId)) {
      console.log(TAG, "ignoring canvas invite from non-friend:", fromNodeId.slice(0, 16) + "...");
      return;
    }
    this.onCanvasInvite?.(msg, fromNodeId);
  }

  // --- outbound protocol actions ---

  /**
   * send a friend request to a peer.
   * opens a new stream if we don't have one, sends the request message.
   */
  async sendFriendRequest(peerNodeId: string): Promise<void> {
    const msg: FriendRequestMessage = {
      type: "friend-request",
      fromNodeId: this.localNodeId,
      fromUsername: this.localUsername,
    };
    await this.sendMessage(peerNodeId, msg);
  }

  /**
   * accept a friend request from a peer.
   */
  async sendFriendAccept(peerNodeId: string): Promise<void> {
    const msg: FriendAcceptMessage = {
      type: "friend-accept",
      fromNodeId: this.localNodeId,
      fromUsername: this.localUsername,
    };
    await this.sendMessage(peerNodeId, msg);
  }

  /**
   * reject a friend request from a peer.
   */
  async sendFriendReject(peerNodeId: string): Promise<void> {
    const msg: FriendRejectMessage = {
      type: "friend-reject",
      fromNodeId: this.localNodeId,
    };
    await this.sendMessage(peerNodeId, msg);
  }

  /**
   * request a peer's profile.
   */
  async requestProfile(peerNodeId: string): Promise<void> {
    const msg: ProfileRequestMessage = { type: "profile-request" };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a friend-accept-ack to complete the two-phase handshake. */
  async sendFriendAcceptAck(peerNodeId: string): Promise<void> {
    const msg: FriendAcceptAckMessage = {
      type: "friend-accept-ack",
      fromNodeId: this.localNodeId,
    };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a canvas invite to a peer. */
  async sendCanvasInvite(
    peerNodeId: string,
    invite: Omit<CanvasInviteMessage, "type">
  ): Promise<void> {
    const msg: CanvasInviteMessage = { type: "canvas-invite", ...invite };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a canvas invite ack to a peer. */
  async sendCanvasInviteAck(
    peerNodeId: string,
    ack: Omit<CanvasInviteAckMessage, "type">
  ): Promise<void> {
    const msg: CanvasInviteAckMessage = { type: "canvas-invite-ack", ...ack };
    await this.sendMessage(peerNodeId, msg);
  }

  /** accept a canvas invite. */
  async sendCanvasInviteAccept(
    peerNodeId: string,
    accept: Omit<CanvasInviteAcceptMessage, "type">
  ): Promise<void> {
    const msg: CanvasInviteAcceptMessage = { type: "canvas-invite-accept", ...accept };
    await this.sendMessage(peerNodeId, msg);
  }

  /** decline a canvas invite. */
  async sendCanvasInviteDecline(
    peerNodeId: string,
    decline: Omit<CanvasInviteDeclineMessage, "type">
  ): Promise<void> {
    const msg: CanvasInviteDeclineMessage = { type: "canvas-invite-decline", ...decline };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send an ACL change notification to a peer. */
  async sendAclChange(peerNodeId: string, change: Omit<AclChangeMessage, "type">): Promise<void> {
    const msg: AclChangeMessage = { type: "acl-change", ...change };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a canvas update notification to a peer. */
  async sendCanvasUpdate(
    peerNodeId: string,
    update: Omit<CanvasUpdateMessage, "type">
  ): Promise<void> {
    const msg: CanvasUpdateMessage = { type: "canvas-update", ...update };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a gossip digest to a peer (triggered on peer-online transition). */
  async sendGossipDigest(
    peerNodeId: string,
    digest: Omit<GossipDigestMessage, "type">
  ): Promise<void> {
    const msg: GossipDigestMessage = { type: "gossip-digest", ...digest };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a blob-offer response to a peer's blob-seek query. */
  async sendBlobOffer(peerNodeId: string, offer: Omit<BlobOfferMessage, "type">): Promise<void> {
    const msg: BlobOfferMessage = { type: "blob-offer", ...offer };
    await this.sendMessage(peerNodeId, msg);
  }

  // --- heartbeat ---

  /**
   * start the periodic heartbeat to all connected friend peers.
   * call this after the protocol handler is set up and friends are loaded.
   */
  startHeartbeat(getFriendNodeIds: () => string[]): void {
    this.stopHeartbeat();
    this.getFriendNodeIds = getFriendNodeIds;

    const buildHeartbeatMsg = (): HeartbeatMessage => {
      const activity = this.getCanvasActivity?.() ?? [];
      return {
        type: "heartbeat",
        nodeId: this.localNodeId,
        username: this.localUsername,
        canvasActivity: activity.length > 0 ? activity : undefined,
      };
    };

    // initial announce round: send to ALL friends so online peers can reply
    const allFriends = getFriendNodeIds();
    const msg = buildHeartbeatMsg();
    for (const peerId of allFriends) {
      this.sendMessage(peerId, msg).catch((err) => {
        console.warn(TAG, "initial announce failed for:", peerId.slice(0, 16) + "...", err);
      });
    }
    this.onAfterHeartbeatTick?.(allFriends);

    // regular heartbeat: send only to online peers
    const sendHeartbeats = async () => {
      const hbMsg = buildHeartbeatMsg();
      const onlinePeers = this.getOnlinePeers();
      for (const peerId of onlinePeers) {
        this.sendMessage(peerId, hbMsg).catch((err) => {
          console.warn(TAG, "heartbeat failed for:", peerId.slice(0, 16) + "...", err);
        });
      }

      // check for peers that timed out since last tick
      const now = Date.now();
      for (const [nodeId, lastSeenAt] of this.lastSeen) {
        if (now - lastSeenAt >= HEARTBEAT_TIMEOUT_MS) {
          console.log(TAG, "peer offline (timeout):", nodeId.slice(0, 16) + "...");
          this.lastSeen.delete(nodeId);
          this.emitOnlineChange();
        }
      }

      this.onAfterHeartbeatTick?.(getFriendNodeIds());
    };

    this.heartbeatTimer = setInterval(sendHeartbeats, HEARTBEAT_INTERVAL_MS);

    // discovery sweep: periodically probe offline friends
    this.discoveryTimer = setInterval(() => {
      const friends = this.getFriendNodeIds?.() ?? [];
      const sweepMsg = buildHeartbeatMsg();
      for (const peerId of friends) {
        if (this.isOnline(peerId)) continue; // skip already-online
        this.sendMessage(peerId, sweepMsg).catch(() => {
          // silent — they're probably offline
        });
      }
    }, DISCOVERY_SWEEP_MS);
  }

  /** send a single heartbeat to a specific peer (used after transport reconnection). */
  async sendHeartbeatTo(peerNodeId: string): Promise<void> {
    // invalidate any stale stream for this peer
    const existing = this.streams.get(peerNodeId);
    if (existing) {
      existing.close();
      this.streams.delete(peerNodeId);
    }

    const activity = this.getCanvasActivity?.() ?? [];
    const msg: HeartbeatMessage = {
      type: "heartbeat",
      nodeId: this.localNodeId,
      username: this.localUsername,
      canvasActivity: activity.length > 0 ? activity : undefined,
    };
    await this.sendMessage(peerNodeId, msg);
  }

  /** send a one-shot heartbeat to a single peer (e.g. when viewing their profile or sharing a canvas). */
  async probePeer(nodeId: string): Promise<void> {
    const activity = this.getCanvasActivity?.() ?? [];
    const msg: HeartbeatMessage = {
      type: "heartbeat",
      nodeId: this.localNodeId,
      username: this.localUsername,
      canvasActivity: activity.length > 0 ? activity : undefined,
    };
    await this.sendMessage(nodeId, msg);
  }

  /** announce to all online peers that we're going offline. fire-and-forget. */
  announceOffline(): void {
    const msg: OfflineAnnouncementMessage = {
      type: "offline-announcement",
      nodeId: this.localNodeId,
    };
    for (const peerId of this.getOnlinePeers()) {
      this.sendMessage(peerId, msg).catch(() => {
        // fire-and-forget — we're shutting down
      });
    }
  }

  /** stop the heartbeat interval. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  // --- online/offline status ---

  /**
   * check if a friend peer is considered online based on heartbeat.
   * a peer is online if we received a heartbeat within the timeout window.
   */
  isOnline(nodeId: string): boolean {
    const lastSeenAt = this.lastSeen.get(nodeId);
    if (!lastSeenAt) return false;
    return Date.now() - lastSeenAt < HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * get all peer node IDs that are currently considered online.
   */
  getOnlinePeers(): string[] {
    const now = Date.now();
    const online: string[] = [];
    for (const [nodeId, lastSeenAt] of this.lastSeen) {
      if (now - lastSeenAt < HEARTBEAT_TIMEOUT_MS) {
        online.push(nodeId);
      }
    }
    return online;
  }

  /**
   * subscribe to online/offline state changes.
   * returns an unsubscribe function.
   */
  onOnlineChange(handler: () => void): () => void {
    this.onlineChangeListeners.push(handler);
    return () => {
      const idx = this.onlineChangeListeners.indexOf(handler);
      if (idx !== -1) this.onlineChangeListeners.splice(idx, 1);
    };
  }

  private emitOnlineChange(): void {
    for (const handler of this.onlineChangeListeners) {
      handler();
    }
  }

  // --- internal helpers ---

  /**
   * send a message to a peer, opening a new stream if needed.
   */
  private async sendMessage(peerNodeId: string, msg: FriendzMessage): Promise<void> {
    let stream = this.streams.get(peerNodeId);

    if (!stream) {
      // check if there's an in-flight connection attempt
      let pending = this.pendingConnections.get(peerNodeId);
      if (!pending) {
        // start a new connection
        pending = this.openStream(peerNodeId);
        this.pendingConnections.set(peerNodeId, pending);
      }

      try {
        stream = await pending;
      } finally {
        this.pendingConnections.delete(peerNodeId);
      }
    }

    await stream.write_message(encodeMessage(msg));
  }

  private async openStream(peerNodeId: string): Promise<BiStreamLike> {
    try {
      const midden = await this.getMidden();
      const stream = await midden.open_bi(peerNodeId, FRIENDZ_ALPN);
      this.streams.set(peerNodeId, stream);
      // start reading responses on this stream
      this.readLoop(peerNodeId, stream);
      return stream;
    } catch (err) {
      console.error(TAG, "failed to open stream to:", peerNodeId.slice(0, 16) + "...", err);
      throw err;
    }
  }

  /** get the current local username. */
  getLocalUsername(): string {
    return this.localUsername;
  }

  /** update the local username (e.g. when profile changes). */
  setLocalUsername(username: string): void {
    this.localUsername = username;
  }

  /** update the local node ID (e.g. after identity creation). */
  setLocalNodeId(nodeId: string): void {
    this.localNodeId = nodeId;
  }

  /** update privacy settings. */
  setProfileVisibility(visibility: "friends" | "everyone" | "nobody"): void {
    this.profileVisibility = visibility;
  }

  /** update privacy settings. */
  setFriendRequestsFrom(from: "everyone" | "nobody"): void {
    this.friendRequestsFrom = from;
  }

  /** update canvas invite privacy settings. */
  setCanvasInvitesFrom(from: "everyone" | "friends" | "nobody"): void {
    this.canvasInvitesFrom = from;
  }

  /**
   * clean up all streams, timers, and listeners.
   */
  destroy(): void {
    this._destroyed = true;
    this.stopHeartbeat();

    for (const [, stream] of this.streams) {
      stream.close();
    }
    this.streams.clear();
    this.pendingConnections.clear();
    this.lastSeen.clear();
    this.getFriendNodeIds = null;
    this.onlineChangeListeners = [];
    this.onFriendRequest = null;
    this.onFriendAccept = null;
    this.onFriendReject = null;
    this.onProfileResponse = null;
    this.onHeartbeat = null;
    this.onFriendAcceptAck = null;
    this.onCanvasInvite = null;
    this.onCanvasInviteAck = null;
    this.onCanvasInviteAccept = null;
    this.onCanvasInviteDecline = null;
    this.onAclChange = null;
    this.onCanvasActivity = null;
    this.onPeerConnected = null;
    this.onPeerBecameOnline = null;
    this.onAfterHeartbeatTick = null;
    this.onCanvasUpdate = null;
    this.onGossipDigest = null;
  }
}
