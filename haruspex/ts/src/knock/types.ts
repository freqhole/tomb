// framework-free knock (access-request) state, mirroring haruspex's rust
// KnockScope/KnockRecord shapes so both sides of a knock describe the same
// request.
//
// this module owns the record shape and the store/transport contracts;
// sending or checking a knock over any particular wire is the caller's
// transport implementation to provide, and the accept side effect
// (creating a user, granting a role, whatever accepting actually means for
// the app) is always an injected policy callback - this package only
// tracks the knock record's lifecycle, never those side effects.

/** who initiated the knock: a peer knocking on us, or us knocking on a peer. */
export type KnockDirection = "inbound" | "outbound";

/** current resolution of a knock request. */
export type KnockStatus = "pending" | "accepted" | "denied";

/**
 * what access is being requested. mirrors rust's `KnockScope` enum
 * field-for-field so a knock raised on one side of the wire describes the
 * same request shape on the other:
 *   - account: acceptance creates or links a user identity
 *   - browse: list access, no specific resource named
 *   - resource: access to one named resource, with an optional requested role
 */
export type KnockScope =
  | { kind: "account"; requestedUsername?: string }
  | { kind: "browse" }
  | { kind: "resource"; resourceId: string; requestedRole?: string };

/** one responder decision, appended to a knock's audit log. */
export interface KnockDecision {
  /** node id of whoever made this decision (the responder). */
  byNodeId: string;
  outcome: Exclude<KnockStatus, "pending">;
  grantedRole?: string;
  /** unix epoch millis. */
  at: number;
}

export interface KnockRecord {
  id: string;
  nodeId: string;
  direction: KnockDirection;
  scope: KnockScope;
  message: string;
  status: KnockStatus;
  /** unix epoch millis. */
  createdAt: number;
  /** unix epoch millis of the most recent decision, if any. */
  processedAt?: number;
  processedBy?: string;
  /** full decision audit trail - see KnockDecision. */
  decisions: KnockDecision[];
  /**
   * resource ids granted alongside a decision, for the case where one
   * knock can cover more than the single `resourceId` named in `scope`
   * (e.g. a browse-scope knock accepted with access to several resources).
   * rust's per-decision shape carries a single `grantedRole` and no id
   * list - this field is a ts-side addition for that many-resource case,
   * not a wire concept the two sides need to agree on byte-for-byte.
   */
  grantedResourceIds?: string[];
}

/**
 * thrown by `KnockStore.createKnock` when an active (pending) knock already
 * exists for this node id + scope - the dedup rule haruspex's sqlite store
 * enforces with a partial unique index over (node_id, scope) where
 * status = 'pending'.
 */
export class KnockConflictError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly scope: KnockScope,
  ) {
    super(`an active knock already exists for node ${nodeId} and this scope`);
    this.name = "KnockConflictError";
  }
}

export interface CreateKnockInput {
  nodeId: string;
  direction: KnockDirection;
  scope: KnockScope;
  message?: string;
  /** unix epoch millis; defaults to Date.now(). */
  createdAt?: number;
}

/**
 * persistence for knock records. an idb-backed implementation is provided
 * (see store.ts); apps may supply their own to match existing storage.
 */
export interface KnockStore {
  /** enforces the dedup rule: one active (pending) knock per node id +
   *  scope. throws KnockConflictError if one already exists. */
  createKnock(input: CreateKnockInput): Promise<KnockRecord>;
  getKnock(id: string): Promise<KnockRecord | null>;
  /** all pending knock records, newest first. */
  listPending(): Promise<KnockRecord[]>;
  /** all knock records regardless of status, newest first. */
  listAll(): Promise<KnockRecord[]>;
  /** the most recent knock record for `nodeId`, regardless of status, or
   *  null if this node id has never knocked. */
  findByNodeId(nodeId: string): Promise<KnockRecord | null>;
  /** appends a decision and resolves the record's status
   *  (last-decision-wins, matching haruspex's sqlite store). */
  recordDecision(
    id: string,
    decision: KnockDecision,
    patch?: { grantedResourceIds?: string[] },
  ): Promise<KnockRecord>;
  /** permanently deletes a knock record, freeing the node id + scope to
   *  knock again (the dedup rule only covers pending rows). */
  deleteKnock(id: string): Promise<void>;
}

/** what a knock requester sends, and what the responder answers with. */
export interface KnockRequest {
  scope: KnockScope;
  message?: string;
  requesterName?: string;
}

export interface KnockStatusReply {
  status: KnockStatus;
  grantedResourceIds?: string[];
}

/**
 * the wire operations `sendKnock`/`checkKnockStatus` need - injected so
 * this package never owns a transport. one call opens a knock, the other
 * re-checks a knock already sent (a retry/poll path, never a fresh knock).
 */
export interface KnockTransport {
  sendKnock(nodeId: string, request: KnockRequest): Promise<KnockStatusReply>;
  checkKnockStatus(nodeId: string, request: KnockRequest): Promise<KnockStatusReply>;
}

export interface KnockPolicyResult {
  grantedRole?: string;
  grantedResourceIds?: string[];
}

/**
 * app-injected side effect for accepting a knock - creating a user,
 * granting a role, whatever the accept actually does. this package only
 * manages the knock record's lifecycle, never these side effects.
 */
export type KnockPolicy = (
  record: KnockRecord,
) => Promise<KnockPolicyResult> | KnockPolicyResult;
