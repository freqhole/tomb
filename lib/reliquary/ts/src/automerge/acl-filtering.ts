// ---------------------------------------------------------------------------
// acl-filtering network adapter wrapper for automerge-repo
//
// enforces read-only access at the network boundary for peers whose role
// on a document doesn't permit writes. automerge-repo's DocSynchronizer
// calls Automerge.receiveSyncMessage() unconditionally for every inbound
// "sync"/"request" message - there's no hook inside automerge-repo to
// reject a peer's changes before they're applied to the local doc. this
// wrapper sits in front of a real NetworkAdapter and strips any CRDT
// changes carried by a read-only peer's sync/request messages before
// automerge-repo ever sees them, while still letting "have"/"need"/"heads"
// through so that peer keeps receiving updates normally.
//
// the role model itself (what roles exist, what document a role applies
// to, how a role is stored) is left entirely to the caller: this module
// only needs a synchronous function from (documentId, senderId) to some
// role value, and a predicate over that role value saying whether it may
// write. this keeps the module free of any particular app's resource/
// subject/role vocabulary while still giving it the exact seam a
// consuming app's own role model can implement.
//
// usage:
//   const adapter = createAclFilteringAdapter(realAdapter, {
//     resolveRole: myRoleResolver,
//     isReadOnly: (role) => role === "viewer",
//   });
//   new Repo({ network: [adapter], ... });
// ---------------------------------------------------------------------------

import { decodeSyncMessage, encodeSyncMessage } from "@automerge/automerge";
import {
  NetworkAdapter,
  type DocumentId,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo";

/**
 * resolves the effective role a peer has on a given document, so the
 * adapter can decide whether to strip that peer's changes. must be
 * synchronous - it's called inline while handling an inbound message.
 */
export type RoleResolver<TRole> = (documentId: DocumentId, senderId: PeerId) => TRole;

export interface AclFilteringOptions<TRole> {
  /** looks up the role a peer has on a document. */
  resolveRole: RoleResolver<TRole>;
  /** returns true when a role may not write - its sync/request changes
   *  get stripped. roles for which this returns false pass through
   *  unchanged (e.g. members, admins, or any other writable role). */
  isReadOnly(role: TRole): boolean;
  /** optional logger hook, called once per message that actually had
   *  changes stripped. defaults to a no-op. */
  onStrip?(info: { documentId: DocumentId; senderId: PeerId; changeCount: number }): void;
}

/**
 * a NetworkAdapter that wraps another NetworkAdapter and strips CRDT
 * changes out of read-only peers' inbound sync/request messages.
 *
 * everything else - connect/send/disconnect, peer-candidate/
 * peer-disconnected/close events, and any message that isn't a
 * sync/request carrying changes from a read-only peer - passes through
 * completely unchanged, so this is a drop-in replacement for the wrapped
 * adapter from automerge-repo's point of view.
 */
export class AclFilteringNetworkAdapter<TRole> extends NetworkAdapter {
  private wrapped: NetworkAdapter;
  private options: AclFilteringOptions<TRole>;

  constructor(wrapped: NetworkAdapter, options: AclFilteringOptions<TRole>) {
    super();
    this.wrapped = wrapped;
    this.options = options;

    this.wrapped.on("peer-candidate", (payload) => this.emit("peer-candidate", payload));
    this.wrapped.on("peer-disconnected", (payload) => this.emit("peer-disconnected", payload));
    this.wrapped.on("close", () => this.emit("close"));
    this.wrapped.on("message", (message) => this.handleMessage(message));
  }

  isReady(): boolean {
    return this.wrapped.isReady();
  }

  whenReady(): Promise<void> {
    return this.wrapped.whenReady();
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.wrapped.connect(peerId, peerMetadata);
  }

  send(message: Message): void {
    this.wrapped.send(message);
  }

  disconnect(): void {
    this.wrapped.disconnect();
  }

  /**
   * inspect an inbound message from the wrapped adapter. sync/request
   * messages from a read-only peer that carry changes get those changes
   * stripped (heads/need/have are preserved so the peer's own reads keep
   * working); everything else is re-emitted untouched.
   */
  private handleMessage(message: Message): void {
    if (message.type !== "sync" && message.type !== "request") {
      this.emit("message", message);
      return;
    }

    if (!message.documentId || !message.data) {
      this.emit("message", message);
      return;
    }

    const role = this.options.resolveRole(message.documentId, message.senderId);
    if (!this.options.isReadOnly(role)) {
      this.emit("message", message);
      return;
    }

    const decoded = decodeSyncMessage(message.data);
    if (decoded.changes.length === 0) {
      this.emit("message", message);
      return;
    }

    this.options.onStrip?.({
      documentId: message.documentId,
      senderId: message.senderId,
      changeCount: decoded.changes.length,
    });

    const filtered = encodeSyncMessage({ ...decoded, changes: [] });
    this.emit("message", { ...message, data: filtered });
  }
}

/**
 * build an AclFilteringNetworkAdapter wrapping `wrapped`, stripping CRDT
 * changes from any peer `options.isReadOnly` marks as read-only for the
 * document a message targets.
 */
export function createAclFilteringAdapter<TRole>(
  wrapped: NetworkAdapter,
  options: AclFilteringOptions<TRole>
): AclFilteringNetworkAdapter<TRole> {
  return new AclFilteringNetworkAdapter(wrapped, options);
}

/**
 * minimal shape this module needs from an automerge-repo `Repo` to build
 * a handle-cache-backed role resolver, without depending on the `Repo`
 * class's full type (which would pull automerge-repo's document-loading
 * machinery into this module's public surface for no reason).
 */
export interface HandleLookup {
  handles: Record<string, { isReady(): boolean; doc(): unknown } | undefined>;
}

/**
 * build a `RoleResolver` backed by a repo's already-cached document
 * handles.
 *
 * looks up the cached handle for `documentId` via `repo.handles` (a plain
 * synchronous record the repo already knows about) and hands its current
 * doc value to the caller-supplied `readRole` function - this
 * deliberately avoids `repo.find()`, which can trigger a network fetch
 * and has side effects (creating a new handle, marking it as requested
 * from peers) that have no place in a message-filtering hot path. if the
 * repo has never seen this document, or the cached handle isn't ready
 * yet, there's nothing to check against, so this returns `defaultRole`.
 *
 * `readRole` owns all app-specific vocabulary: what shape the doc's acl
 * data takes, how a raw value is validated, and what the fallback should
 * be for a missing or invalid entry - this function only owns the
 * handle-cache lookup mechanics.
 */
export function createHandleBasedRoleResolver<TRole>(
  repo: HandleLookup,
  readRole: (doc: unknown, senderId: PeerId) => TRole,
  defaultRole: TRole
): RoleResolver<TRole> {
  return (documentId, senderId) => {
    const handle = repo.handles[documentId];
    if (!handle || !handle.isReady()) {
      return defaultRole;
    }
    return readRole(handle.doc(), senderId);
  };
}
