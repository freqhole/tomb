// the unified friendz protocol message set - the normative wire-message
// shapes for peer-to-peer presence, friend requests, knocks, and identity
// updates. every message is validated against the same 20 fixture files
// the rust crate's message enum was generated from
// (haruspex/rust/fixtures/protocol/), so a message accepted here parses
// identically on both sides of the wire.
//
// normalization:
//   - the wire discriminant is a `type` field, kebab-case values.
//   - every other field is camelCase.
//   - every message carries `v` (defaulting to 1 when the sender omits it,
//     for a transition window where not every peer sends it yet).
//   - identity naming: `nodeId` everywhere; `username` for handle-like
//     names; avatars use a blob-id reference (`avatarBlobId`) on the
//     hello/hello-ok handshake, and an inline data url (`avatarDataUrl`)
//     on profile-response/identity-update.
//   - knock outcome status is `pending | accepted | denied`.

import { z } from "zod";

const wireVersion = z.number().int().nonnegative().default(1);

// ---------------------------------------------------------------------------
// shared enums
// ---------------------------------------------------------------------------

/** the grantable role vocabulary carried on the wire (knock-outcome, acl-change). */
export const WireRoleSchema = z.enum(["viewer", "member", "admin", "root"]);
export type WireRole = z.infer<typeof WireRoleSchema>;

/** resolution of a knock request. */
export const WireKnockStatusSchema = z.enum(["pending", "accepted", "denied"]);
export type WireKnockStatus = z.infer<typeof WireKnockStatusSchema>;

/** whether a peer may browse without knocking first, or must knock. */
export const BrowseCapabilitySchema = z.enum(["public", "knock"]);
export type BrowseCapability = z.infer<typeof BrowseCapabilitySchema>;

/** capability bag carried on the hello/hello-ok handshake. */
export const CapabilitiesSchema = z.object({
  browse: BrowseCapabilitySchema,
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// ---------------------------------------------------------------------------
// knock scope
// ---------------------------------------------------------------------------

/**
 * the wire shape of a knock's scope: what access is being requested.
 *   - account: acceptance creates or links a user identity
 *   - browse: list access, no specific resource named
 *   - resource: access to one named resource, with an optional requested role
 */
export const WireKnockScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("account"),
    requestedUsername: z.string().optional(),
  }),
  z.object({
    kind: z.literal("browse"),
  }),
  z.object({
    kind: z.literal("resource"),
    resourceId: z.string(),
    requestedRole: WireRoleSchema.optional(),
  }),
]);
export type WireKnockScope = z.infer<typeof WireKnockScopeSchema>;

// ---------------------------------------------------------------------------
// gossip digest sub-shapes
// ---------------------------------------------------------------------------

/** a pending-knock entry gossiped in a gossip-digest message. */
export const GossipDigestPendingKnockSchema = z.object({
  knockId: z.string(),
  nodeId: z.string(),
  username: z.string().optional(),
  message: z.string(),
  scope: WireKnockScopeSchema,
  knockedAt: z.string(),
});
export type GossipDigestPendingKnock = z.infer<typeof GossipDigestPendingKnockSchema>;

/** a profile-doc pointer entry in a gossip digest. */
export const GossipDigestProfileEntrySchema = z.object({
  peerNodeId: z.string(),
  profileDocId: z.string(),
  updatedAt: z.string(),
});
export type GossipDigestProfileEntry = z.infer<typeof GossipDigestProfileEntrySchema>;

// ---------------------------------------------------------------------------
// core message variants
// ---------------------------------------------------------------------------

const ProfileRequestSchema = z.object({
  type: z.literal("profile-request"),
  v: wireVersion,
});

const ProfileResponseSchema = z.object({
  type: z.literal("profile-response"),
  v: wireVersion,
  username: z.string(),
  bio: z.string(),
  avatarDataUrl: z.string(),
  accentColor: z.number().optional(),
  profileDocId: z.string().optional(),
  profileUpdatedAt: z.string().optional(),
  isHub: z.boolean().optional(),
});

const FriendRequestSchema = z.object({
  type: z.literal("friend-request"),
  v: wireVersion,
  fromNodeId: z.string(),
  fromUsername: z.string(),
  isHub: z.boolean().optional(),
});

const FriendAcceptSchema = z.object({
  type: z.literal("friend-accept"),
  v: wireVersion,
  fromNodeId: z.string(),
  fromUsername: z.string(),
  isHub: z.boolean().optional(),
});

const FriendAcceptAckSchema = z.object({
  type: z.literal("friend-accept-ack"),
  v: wireVersion,
  fromNodeId: z.string(),
});

const FriendRejectSchema = z.object({
  type: z.literal("friend-reject"),
  v: wireVersion,
  fromNodeId: z.string(),
});

const HeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  v: wireVersion,
  nodeId: z.string(),
  username: z.string(),
  appPayload: z.unknown().optional(),
});

const OfflineAnnouncementSchema = z.object({
  type: z.literal("offline-announcement"),
  v: wireVersion,
  nodeId: z.string(),
});

const HelloSchema = z.object({
  type: z.literal("hello"),
  v: wireVersion,
  nodeId: z.string(),
  username: z.string().optional(),
  avatarBlobId: z.string().optional(),
  capabilities: CapabilitiesSchema,
});

const HelloOkSchema = z.object({
  type: z.literal("hello-ok"),
  v: wireVersion,
  nodeId: z.string(),
  username: z.string().optional(),
  avatarBlobId: z.string().optional(),
  capabilities: CapabilitiesSchema,
});

const KnockRequestSchema = z.object({
  type: z.literal("knock-request"),
  v: wireVersion,
  knockId: z.string(),
  nodeId: z.string(),
  username: z.string().optional(),
  message: z.string(),
  scope: WireKnockScopeSchema,
});

const KnockAckSchema = z.object({
  type: z.literal("knock-ack"),
  v: wireVersion,
  knockId: z.string(),
  ackerNodeId: z.string(),
  resourceId: z.string().optional(),
});

const KnockOutcomeSchema = z.object({
  type: z.literal("knock-outcome"),
  v: wireVersion,
  knockId: z.string().optional(),
  status: WireKnockStatusSchema,
  grantedRole: WireRoleSchema.optional(),
  grantedResourceIds: z.array(z.string()).default([]),
  byNodeId: z.string().optional(),
});

const IdentityUpdateSchema = z.object({
  type: z.literal("identity-update"),
  v: wireVersion,
  nodeId: z.string(),
  username: z.string().optional(),
  avatarDataUrl: z.string().optional(),
});

const AclChangeSchema = z.object({
  type: z.literal("acl-change"),
  v: wireVersion,
  resourceId: z.string(),
  resourceTitle: z.string().optional(),
  targetNodeId: z.string(),
  newRole: WireRoleSchema.optional(),
  changedBy: z.string(),
  changedByUsername: z.string(),
});

const GossipDigestSchema = z.object({
  type: z.literal("gossip-digest"),
  v: wireVersion,
  pendingKnocks: z.array(GossipDigestPendingKnockSchema).default([]),
  profiles: z.array(GossipDigestProfileEntrySchema).default([]),
  appPayload: z.unknown().optional(),
});

const BlobSeekSchema = z.object({
  type: z.literal("blob-seek"),
  v: wireVersion,
  needed: z.array(z.string()).default([]),
});

const BlobOfferSchema = z.object({
  type: z.literal("blob-offer"),
  v: wireVersion,
  available: z.array(z.string()).default([]),
});

const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  v: wireVersion,
  code: z.string(),
  message: z.string(),
});

/** the discriminated union of every core (non-namespaced) friendz message. */
export const CoreMessageSchema = z.discriminatedUnion("type", [
  ProfileRequestSchema,
  ProfileResponseSchema,
  FriendRequestSchema,
  FriendAcceptSchema,
  FriendAcceptAckSchema,
  FriendRejectSchema,
  HeartbeatSchema,
  OfflineAnnouncementSchema,
  HelloSchema,
  HelloOkSchema,
  KnockRequestSchema,
  KnockAckSchema,
  KnockOutcomeSchema,
  IdentityUpdateSchema,
  AclChangeSchema,
  GossipDigestSchema,
  BlobSeekSchema,
  BlobOfferSchema,
  ErrorMessageSchema,
]);

export type CoreMessage = z.infer<typeof CoreMessageSchema>;

export type ProfileRequestMessage = z.infer<typeof ProfileRequestSchema>;
export type ProfileResponseMessage = z.infer<typeof ProfileResponseSchema>;
export type FriendRequestMessage = z.infer<typeof FriendRequestSchema>;
export type FriendAcceptMessage = z.infer<typeof FriendAcceptSchema>;
export type FriendAcceptAckMessage = z.infer<typeof FriendAcceptAckSchema>;
export type FriendRejectMessage = z.infer<typeof FriendRejectSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatSchema>;
export type OfflineAnnouncementMessage = z.infer<typeof OfflineAnnouncementSchema>;
export type HelloMessage = z.infer<typeof HelloSchema>;
export type HelloOkMessage = z.infer<typeof HelloOkSchema>;
export type KnockRequestMessage = z.infer<typeof KnockRequestSchema>;
export type KnockAckMessage = z.infer<typeof KnockAckSchema>;
export type KnockOutcomeMessage = z.infer<typeof KnockOutcomeSchema>;
export type IdentityUpdateMessage = z.infer<typeof IdentityUpdateSchema>;
export type AclChangeMessage = z.infer<typeof AclChangeSchema>;
export type GossipDigestMessage = z.infer<typeof GossipDigestSchema>;
export type BlobSeekMessage = z.infer<typeof BlobSeekSchema>;
export type BlobOfferMessage = z.infer<typeof BlobOfferSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

/** every core message's wire `type` discriminant, in enum-declaration order. */
export const CORE_MESSAGE_TYPES = [
  "profile-request",
  "profile-response",
  "friend-request",
  "friend-accept",
  "friend-accept-ack",
  "friend-reject",
  "heartbeat",
  "offline-announcement",
  "hello",
  "hello-ok",
  "knock-request",
  "knock-ack",
  "knock-outcome",
  "identity-update",
  "acl-change",
  "gossip-digest",
  "blob-seek",
  "blob-offer",
  "error",
] as const;

/** is `type` one of the core (non-namespaced) message types above? */
export function isCoreMessageType(type: string): boolean {
  return (CORE_MESSAGE_TYPES as readonly string[]).includes(type);
}
