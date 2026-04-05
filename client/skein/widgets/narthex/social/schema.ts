import { z } from "zod";

// ---------------------------------------------------------------------------
// friend sub-schemas (ported from friends-widget.ts)
// ---------------------------------------------------------------------------

export const friendNodeIdSchema = z.object({
  nodeId: z.string(),
  addedAt: z.string().default(""),
  lastSeenAt: z.string().default(""),
  // profile fields populated by fetching the peer's profile
  username: z.string().default(""),
  bio: z.string().default(""),
  avatarDataUrl: z.string().default(""),
});

export const friendEntrySchema = z.object({
  id: z.string(), // UUID — canonical friend identity
  alias: z.string().default(""), // user-set nickname (display priority)
  username: z.string().default(""), // best-effort: from most recently seen nodeId's profile
  group: z.string().default(""), // folder-style group name ("" = ungrouped)
  nodeIds: z.array(friendNodeIdSchema).default([]),
  createdAt: z.string().default(""),
});

export const friendGroupSchema = z.object({
  name: z.string(),
  createdAt: z.string().default(""),
});

export const pendingFriendRequestSchema = z.object({
  fromNodeId: z.string(),
  fromUsername: z.string().default(""),
  receivedAt: z.string().default(""),
  status: z.enum(["pending", "accepted", "accepted-pending-ack", "rejected"]).default("pending"),
});

export const outboundFriendRequestSchema = z.object({
  toNodeId: z.string(),
  toUsername: z.string().default(""),
  sentAt: z.string().default(""),
  status: z.enum(["pending", "accepted", "accepted-pending-ack", "rejected"]).default("pending"),
});

// ---------------------------------------------------------------------------
// profile sub-schema (ported from profile-widget.ts)
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  username: z.string().default(""),
  bio: z.string().default(""),
  avatarDataUrl: z.string().default(""),
  accentColor: z.number().default(0x6366f1),
  nodeId: z.string().default(""),
});

// ---------------------------------------------------------------------------
// root social schema
// ---------------------------------------------------------------------------

export const socialSchema = z.object({
  /** local identity — username, bio, avatar, accent color, node ID */
  profile: profileSchema.default({
    username: "",
    bio: "",
    avatarDataUrl: "",
    accentColor: 0x6366f1,
    nodeId: "",
  }),

  /** peer directory */
  friends: z.array(friendEntrySchema).default([]),
  groups: z.array(friendGroupSchema).default([]),

  /** friend requests */
  pendingRequests: z.array(pendingFriendRequestSchema).default([]),
  outboundRequests: z.array(outboundFriendRequestSchema).default([]),

  /** privacy settings */
  profileVisibility: z.enum(["friends", "everyone", "nobody"]).default("friends"),
  friendRequestsFrom: z.enum(["everyone", "nobody"]).default("everyone"),
});

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type FriendNodeId = z.infer<typeof friendNodeIdSchema>;
export type FriendEntry = z.infer<typeof friendEntrySchema>;
export type FriendGroup = z.infer<typeof friendGroupSchema>;
export type PendingFriendRequest = z.infer<typeof pendingFriendRequestSchema>;
export type OutboundFriendRequest = z.infer<typeof outboundFriendRequestSchema>;
export type ProfileState = z.infer<typeof profileSchema>;
export type SocialState = z.infer<typeof socialSchema>;
