import { describe, expect, it } from "vitest";
import {
    colorForName,
    friendDisplayName,
    friendDisplayNameFull,
    isValidNodeId,
    truncate,
} from "./helpers";
import {
    friendEntrySchema,
    friendGroupSchema,
    friendNodeIdSchema,
    outboundFriendRequestSchema,
    pendingFriendRequestSchema,
    profileSchema,
    socialSchema,
    type FriendEntry,
} from "./schema";
import { socialWidget } from "./social-widget";

// ---------------------------------------------------------------------------
// socialSchema
// ---------------------------------------------------------------------------

describe("socialSchema", () => {
  it("parses empty object with all defaults", () => {
    const result = socialSchema.parse({});
    expect(result).toEqual({
      profile: {
        username: "",
        bio: "",
        avatarDataUrl: "",
        accentColor: 0x6366f1,
        nodeId: "",
      },
      friends: [],
      groups: [],
      pendingRequests: [],
      outboundRequests: [],
      profileVisibility: "friends",
      friendRequestsFrom: "everyone",
    });
  });

  it("parses full object with all fields populated", () => {
    const full = {
      profile: {
        username: "alice",
        bio: "hello world",
        avatarDataUrl: "data:image/png;base64,abc",
        accentColor: 0xff0000,
        nodeId: "a".repeat(64),
      },
      friends: [
        {
          id: "friend-1",
          alias: "bestie",
          username: "bob",
          group: "close",
          nodeIds: [{ nodeId: "b".repeat(64), addedAt: "2025-01-01", lastSeenAt: "2025-06-01", username: "bob", bio: "hi", avatarDataUrl: "" }],
          createdAt: "2025-01-01",
        },
      ],
      groups: [{ name: "close", createdAt: "2025-01-01" }],
      pendingRequests: [
        { fromNodeId: "c".repeat(64), fromUsername: "charlie", receivedAt: "2025-06-01", status: "pending" as const },
      ],
      outboundRequests: [
        { toNodeId: "d".repeat(64), toUsername: "dave", sentAt: "2025-06-01", status: "pending" as const },
      ],
      profileVisibility: "everyone" as const,
      friendRequestsFrom: "nobody" as const,
    };
    const result = socialSchema.parse(full);
    expect(result).toEqual(full);
  });

  it("preserves friends array with v2 shape", () => {
    const friend = {
      id: "uuid-123",
      alias: "my-alias",
      username: "bob",
      group: "work",
      nodeIds: [
        { nodeId: "a".repeat(64), addedAt: "2025-01-01", lastSeenAt: "2025-06-15", username: "bob", bio: "", avatarDataUrl: "" },
      ],
      createdAt: "2025-01-01",
    };
    const result = socialSchema.parse({ friends: [friend] });
    expect(result.friends).toHaveLength(1);
    expect(result.friends[0]).toEqual(friend);
  });

  it("fills friend entry defaults", () => {
    const result = friendEntrySchema.parse({ id: "f1" });
    expect(result.alias).toBe("");
    expect(result.username).toBe("");
    expect(result.group).toBe("");
    expect(result.nodeIds).toEqual([]);
    expect(result.createdAt).toBe("");
  });

  it("fills nodeId entry defaults", () => {
    const result = friendNodeIdSchema.parse({ nodeId: "a".repeat(64) });
    expect(result.addedAt).toBe("");
    expect(result.lastSeenAt).toBe("");
    expect(result.username).toBe("");
    expect(result.bio).toBe("");
    expect(result.avatarDataUrl).toBe("");
  });

  it("parses friend with multiple nodeIds", () => {
    const friend = {
      id: "multi-node",
      nodeIds: [
        { nodeId: "a".repeat(64) },
        { nodeId: "b".repeat(64) },
        { nodeId: "c".repeat(64) },
      ],
    };
    const result = friendEntrySchema.parse(friend);
    expect(result.nodeIds).toHaveLength(3);
    expect(result.nodeIds[0].nodeId).toBe("a".repeat(64));
    expect(result.nodeIds[1].nodeId).toBe("b".repeat(64));
    expect(result.nodeIds[2].nodeId).toBe("c".repeat(64));
  });

  it("parses groups array with defaults", () => {
    const result = socialSchema.parse({
      groups: [{ name: "family" }, { name: "work", createdAt: "2025-03-01" }],
    });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toEqual({ name: "family", createdAt: "" });
    expect(result.groups[1]).toEqual({ name: "work", createdAt: "2025-03-01" });
  });

  it("parses pending requests with all statuses", () => {
    const statuses = ["pending", "accepted", "accepted-pending-ack", "rejected"] as const;
    for (const status of statuses) {
      const result = pendingFriendRequestSchema.parse({
        fromNodeId: "a".repeat(64),
        status,
      });
      expect(result.status).toBe(status);
    }
  });

  it("parses outbound requests with all statuses", () => {
    const statuses = ["pending", "accepted", "accepted-pending-ack", "rejected"] as const;
    for (const status of statuses) {
      const result = outboundFriendRequestSchema.parse({
        toNodeId: "a".repeat(64),
        status,
      });
      expect(result.status).toBe(status);
    }
  });

  it("parses pending request defaults", () => {
    const result = pendingFriendRequestSchema.parse({ fromNodeId: "a".repeat(64) });
    expect(result.fromUsername).toBe("");
    expect(result.receivedAt).toBe("");
    expect(result.status).toBe("pending");
  });

  it("parses outbound request defaults", () => {
    const result = outboundFriendRequestSchema.parse({ toNodeId: "b".repeat(64) });
    expect(result.toUsername).toBe("");
    expect(result.sentAt).toBe("");
    expect(result.status).toBe("pending");
  });

  it("parses profileVisibility values", () => {
    for (const v of ["friends", "everyone", "nobody"] as const) {
      const result = socialSchema.parse({ profileVisibility: v });
      expect(result.profileVisibility).toBe(v);
    }
  });

  it("parses friendRequestsFrom values", () => {
    for (const v of ["everyone", "nobody"] as const) {
      const result = socialSchema.parse({ friendRequestsFrom: v });
      expect(result.friendRequestsFrom).toBe(v);
    }
  });

  it("rejects invalid profileVisibility", () => {
    expect(() => socialSchema.parse({ profileVisibility: "secret" })).toThrow();
  });

  it("rejects invalid friendRequestsFrom", () => {
    expect(() => socialSchema.parse({ friendRequestsFrom: "friends" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// profileSchema
// ---------------------------------------------------------------------------

describe("profileSchema", () => {
  it("parses empty object with defaults", () => {
    const result = profileSchema.parse({});
    expect(result).toEqual({
      username: "",
      bio: "",
      avatarDataUrl: "",
      accentColor: 0x6366f1,
      nodeId: "",
    });
  });

  it("parses full profile with all fields", () => {
    const full = {
      username: "alice",
      bio: "just vibin",
      avatarDataUrl: "data:image/png;base64,xyz",
      accentColor: 0x10b981,
      nodeId: "f".repeat(64),
    };
    const result = profileSchema.parse(full);
    expect(result).toEqual(full);
  });

  it("preserves username", () => {
    const result = profileSchema.parse({ username: "bob" });
    expect(result.username).toBe("bob");
  });

  it("preserves bio", () => {
    const result = profileSchema.parse({ bio: "hello there" });
    expect(result.bio).toBe("hello there");
  });

  it("preserves avatarDataUrl", () => {
    const result = profileSchema.parse({ avatarDataUrl: "data:image/jpeg;base64,abc" });
    expect(result.avatarDataUrl).toBe("data:image/jpeg;base64,abc");
  });

  it("preserves accentColor", () => {
    const result = profileSchema.parse({ accentColor: 0xef4444 });
    expect(result.accentColor).toBe(0xef4444);
  });

  it("preserves nodeId", () => {
    const nodeId = "ab".repeat(32);
    const result = profileSchema.parse({ nodeId });
    expect(result.nodeId).toBe(nodeId);
  });

  it("default accentColor is 0x6366f1", () => {
    const result = profileSchema.parse({});
    expect(result.accentColor).toBe(0x6366f1);
  });
});

// ---------------------------------------------------------------------------
// socialWidget metadata
// ---------------------------------------------------------------------------

describe("socialWidget", () => {
  it("type is 'social'", () => {
    expect(socialWidget.type).toBe("social");
  });

  it("metadata.name is 'social'", () => {
    expect(socialWidget.metadata.name).toBe("social");
  });

  it("metadata.category is 'narthex'", () => {
    expect(socialWidget.metadata.category).toBe("narthex");
  });

  it("metadata.singleton is true", () => {
    expect(socialWidget.metadata.singleton).toBe(true);
  });

  it("metadata.singletonId is 'skein-social'", () => {
    expect(socialWidget.metadata.singletonId).toBe("skein-social");
  });

  it("metadata.defaultWidth is 280", () => {
    expect(socialWidget.metadata.defaultWidth).toBe(280);
  });

  it("metadata.defaultHeight is 500", () => {
    expect(socialWidget.metadata.defaultHeight).toBe(500);
  });

  it("schema is defined and equals socialSchema", () => {
    expect(socialWidget.schema).toBeDefined();
    expect(socialWidget.schema).toBe(socialSchema);
  });

  it("editableProps is empty array", () => {
    expect(socialWidget.editableProps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidNodeId
// ---------------------------------------------------------------------------

describe("isValidNodeId", () => {
  it("accepts valid 64-char lowercase hex string", () => {
    const valid = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    expect(valid).toHaveLength(64);
    expect(isValidNodeId(valid)).toBe(true);
  });

  it("accepts all-zero 64-char hex", () => {
    expect(isValidNodeId("0".repeat(64))).toBe(true);
  });

  it("accepts all-f 64-char hex", () => {
    expect(isValidNodeId("f".repeat(64))).toBe(true);
  });

  it("rejects strings too short", () => {
    expect(isValidNodeId("abcdef1234")).toBe(false);
    expect(isValidNodeId("a".repeat(63))).toBe(false);
  });

  it("rejects strings too long", () => {
    expect(isValidNodeId("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isValidNodeId("A".repeat(64))).toBe(false);
    expect(isValidNodeId("ABCDEF".repeat(10) + "ABCD")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    const withG = "g" + "a".repeat(63);
    expect(isValidNodeId(withG)).toBe(false);

    const withDash = "a".repeat(32) + "-" + "a".repeat(31);
    expect(isValidNodeId(withDash)).toBe(false);

    const withSpace = " " + "a".repeat(63);
    expect(isValidNodeId(withSpace)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidNodeId("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// friendDisplayName
// ---------------------------------------------------------------------------

describe("friendDisplayName", () => {
  const makeFriend = (overrides: Partial<FriendEntry> = {}): FriendEntry => ({
    id: "test-id",
    alias: "",
    username: "",
    group: "",
    nodeIds: [],
    createdAt: "",
    ...overrides,
  });

  it("returns alias when set", () => {
    const friend = makeFriend({ alias: "bestie", username: "bob" });
    expect(friendDisplayName(friend)).toBe("bestie");
  });

  it("returns username when alias is empty", () => {
    const friend = makeFriend({ username: "bob" });
    expect(friendDisplayName(friend)).toBe("bob");
  });

  it("returns truncated nodeId when alias and username are empty", () => {
    const nodeId = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const friend = makeFriend({ nodeIds: [{ nodeId, addedAt: "", lastSeenAt: "", username: "", bio: "", avatarDataUrl: "" }] });
    const result = friendDisplayName(friend);
    expect(result).toBe("abcdef01...23456789");
    expect(result).toHaveLength(19); // 8 + 3 + 8
  });

  it("returns 'unknown' when all fields are empty", () => {
    const friend = makeFriend();
    expect(friendDisplayName(friend)).toBe("unknown");
  });

  it("prefers alias over everything else", () => {
    const nodeId = "a".repeat(64);
    const friend = makeFriend({
      alias: "my-alias",
      username: "bob",
      nodeIds: [{ nodeId, addedAt: "", lastSeenAt: "", username: "", bio: "", avatarDataUrl: "" }],
    });
    expect(friendDisplayName(friend)).toBe("my-alias");
  });
});

// ---------------------------------------------------------------------------
// friendDisplayNameFull
// ---------------------------------------------------------------------------

describe("friendDisplayNameFull", () => {
  const makeFriend = (overrides: Partial<FriendEntry> = {}): FriendEntry => ({
    id: "test-id",
    alias: "",
    username: "",
    group: "",
    nodeIds: [],
    createdAt: "",
    ...overrides,
  });

  it("returns 'username (alias)' when both are set", () => {
    const friend = makeFriend({ alias: "bestie", username: "bob" });
    expect(friendDisplayNameFull(friend)).toBe("bob (bestie)");
  });

  it("returns username alone when alias is empty", () => {
    const friend = makeFriend({ username: "bob" });
    expect(friendDisplayNameFull(friend)).toBe("bob");
  });

  it("returns alias alone when username is empty", () => {
    const friend = makeFriend({ alias: "bestie" });
    expect(friendDisplayNameFull(friend)).toBe("bestie");
  });

  it("returns truncated nodeId when alias and username are empty", () => {
    const nodeId = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const friend = makeFriend({ nodeIds: [{ nodeId, addedAt: "", lastSeenAt: "", username: "", bio: "", avatarDataUrl: "" }] });
    expect(friendDisplayNameFull(friend)).toBe("abcdef01...23456789");
  });

  it("returns 'unknown' when everything is empty", () => {
    const friend = makeFriend();
    expect(friendDisplayNameFull(friend)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// colorForName
// ---------------------------------------------------------------------------

describe("colorForName", () => {
  it("returns a number", () => {
    expect(typeof colorForName("alice", 0)).toBe("number");
  });

  it("returns deterministic color for the same name", () => {
    const a = colorForName("alice", 0);
    const b = colorForName("alice", 0);
    expect(a).toBe(b);
  });

  it("returns different colors for different names", () => {
    // not strictly guaranteed, but with these specific names the hashes differ
    const a = colorForName("alice", 0);
    const b = colorForName("zzzzz", 0);
    expect(a).not.toBe(b);
  });

  it("falls back to index-based color for empty name", () => {
    const c0 = colorForName("", 0);
    const c1 = colorForName("", 1);
    // with different indices, should cycle through palette
    expect(typeof c0).toBe("number");
    expect(typeof c1).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns string unchanged when under max length", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns string unchanged when exactly max length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates with ellipsis when over max length", () => {
    const result = truncate("hello world", 6);
    expect(result).toHaveLength(6);
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
