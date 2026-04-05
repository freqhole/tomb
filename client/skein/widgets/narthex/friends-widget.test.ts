import { describe, expect, it } from "vitest";
import {
  friendDisplayName,
  friendDisplayNameFull,
  friendsSchema,
  friendsWidget,
  isValidNodeId,
  migrateV1ToV2,
  type FriendEntry,
  type OutboundFriendRequest,
} from "./friends-widget";

describe("friendsSchema", () => {
  it("parses empty object with defaults", () => {
    const result = friendsSchema.parse({});
    expect(result).toEqual({
      friends: [],
      groups: [],
      pendingRequests: [],
      outboundRequests: [],
      profileVisibility: "friends",
      friendRequestsFrom: "everyone",
    });
  });

  it("parses object with friends array using v2 shape", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "f1",
          alias: "ally",
          username: "alice",
          group: "close",
          nodeIds: [{ nodeId: "a".repeat(64), addedAt: "2025-01-01" }],
          createdAt: "2025-01-01",
        },
        { id: "f2", username: "bob" },
      ],
    });
    expect(result.friends).toHaveLength(2);
    expect(result.friends[0].username).toBe("alice");
    expect(result.friends[0].alias).toBe("ally");
    expect(result.friends[0].group).toBe("close");
    expect(result.friends[0].nodeIds).toHaveLength(1);
    expect(result.friends[0].nodeIds[0].nodeId).toBe("a".repeat(64));
    expect(result.friends[1].username).toBe("bob");
  });

  it("parses friend entry with all fields", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "friend-abc",
          alias: "bestie",
          username: "alice",
          group: "favorites",
          nodeIds: [
            {
              nodeId: "b".repeat(64),
              addedAt: "2025-06-01",
              lastSeenAt: "2025-06-10",
              username: "alice_node",
              bio: "hello world",
              avatarDataUrl: "data:image/png;base64,abc",
            },
          ],
          createdAt: "2025-06-01",
        },
      ],
    });
    const entry = result.friends[0];
    expect(entry.id).toBe("friend-abc");
    expect(entry.alias).toBe("bestie");
    expect(entry.username).toBe("alice");
    expect(entry.group).toBe("favorites");
    expect(entry.nodeIds).toHaveLength(1);
    expect(entry.nodeIds[0].nodeId).toBe("b".repeat(64));
    expect(entry.nodeIds[0].addedAt).toBe("2025-06-01");
    expect(entry.nodeIds[0].lastSeenAt).toBe("2025-06-10");
    expect(entry.nodeIds[0].username).toBe("alice_node");
    expect(entry.nodeIds[0].bio).toBe("hello world");
    expect(entry.nodeIds[0].avatarDataUrl).toBe("data:image/png;base64,abc");
    expect(entry.createdAt).toBe("2025-06-01");
  });

  it("provides defaults for optional friend entry fields", () => {
    const result = friendsSchema.parse({
      friends: [{ id: "friend-1" }],
    });
    const entry = result.friends[0];
    expect(entry.id).toBe("friend-1");
    expect(entry.alias).toBe("");
    expect(entry.username).toBe("");
    expect(entry.group).toBe("");
    expect(entry.nodeIds).toEqual([]);
    expect(entry.createdAt).toBe("");
  });

  it("provides defaults for optional nodeId fields", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "f1",
          nodeIds: [{ nodeId: "c".repeat(64) }],
        },
      ],
    });
    const node = result.friends[0].nodeIds[0];
    expect(node.nodeId).toBe("c".repeat(64));
    expect(node.addedAt).toBe("");
    expect(node.lastSeenAt).toBe("");
    expect(node.username).toBe("");
    expect(node.bio).toBe("");
    expect(node.avatarDataUrl).toBe("");
  });

  it("parses friend with multiple nodeIds", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "f1",
          nodeIds: [
            { nodeId: "a".repeat(64) },
            { nodeId: "b".repeat(64) },
            { nodeId: "c".repeat(64) },
          ],
        },
      ],
    });
    expect(result.friends[0].nodeIds).toHaveLength(3);
  });

  it("preserves friend entries when provided", () => {
    const friends = [
      {
        id: "f1",
        alias: "",
        username: "alice",
        group: "",
        nodeIds: [{ nodeId: "a".repeat(64) }],
        createdAt: "",
      },
      {
        id: "f2",
        alias: "bobby",
        username: "bob",
        group: "close",
        nodeIds: [],
        createdAt: "2025-03-01",
      },
      { id: "f3", alias: "", username: "charlie", group: "", nodeIds: [], createdAt: "" },
    ];
    const result = friendsSchema.parse({ friends });
    expect(result.friends).toHaveLength(3);
    expect(result.friends[0].username).toBe("alice");
    expect(result.friends[1].alias).toBe("bobby");
    expect(result.friends[1].group).toBe("close");
    expect(result.friends[2].username).toBe("charlie");
  });

  it("adding a friend entry to parsed result works correctly", () => {
    const result = friendsSchema.parse({});
    expect(result.friends).toHaveLength(0);

    result.friends.push({
      id: "new-friend",
      alias: "",
      username: "dave",
      group: "",
      nodeIds: [
        {
          nodeId: "d".repeat(64),
          addedAt: "2025-06-15",
          lastSeenAt: "",
          username: "",
          bio: "",
          avatarDataUrl: "",
        },
      ],
      createdAt: "2025-06-15",
    });
    expect(result.friends).toHaveLength(1);
    expect(result.friends[0].id).toBe("new-friend");
    expect(result.friends[0].username).toBe("dave");
    expect(result.friends[0].nodeIds).toHaveLength(1);
  });
});

describe("friendsSchema groups", () => {
  it("parses groups array", () => {
    const result = friendsSchema.parse({
      groups: [{ name: "close friends", createdAt: "2025-01-01" }, { name: "work" }],
    });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].name).toBe("close friends");
    expect(result.groups[0].createdAt).toBe("2025-01-01");
    expect(result.groups[1].name).toBe("work");
    expect(result.groups[1].createdAt).toBe("");
  });

  it("defaults groups to empty array", () => {
    const result = friendsSchema.parse({});
    expect(result.groups).toEqual([]);
  });
});

describe("friendsSchema pendingRequests", () => {
  it("parses pending requests array", () => {
    const result = friendsSchema.parse({
      pendingRequests: [
        {
          fromNodeId: "e".repeat(64),
          fromUsername: "eve",
          receivedAt: "2025-06-01",
          status: "pending",
        },
        {
          fromNodeId: "f".repeat(64),
          status: "accepted",
        },
        {
          fromNodeId: "d".repeat(64),
          status: "rejected",
        },
      ],
    });
    expect(result.pendingRequests).toHaveLength(3);
    expect(result.pendingRequests[0].fromNodeId).toBe("e".repeat(64));
    expect(result.pendingRequests[0].fromUsername).toBe("eve");
    expect(result.pendingRequests[0].receivedAt).toBe("2025-06-01");
    expect(result.pendingRequests[0].status).toBe("pending");
    expect(result.pendingRequests[1].status).toBe("accepted");
    expect(result.pendingRequests[2].status).toBe("rejected");
  });

  it("defaults pending requests to empty array", () => {
    const result = friendsSchema.parse({});
    expect(result.pendingRequests).toEqual([]);
  });

  it("defaults status to pending", () => {
    const result = friendsSchema.parse({
      pendingRequests: [{ fromNodeId: "a".repeat(64) }],
    });
    expect(result.pendingRequests[0].status).toBe("pending");
    expect(result.pendingRequests[0].fromUsername).toBe("");
    expect(result.pendingRequests[0].receivedAt).toBe("");
  });
});

describe("friendsSchema outboundRequests", () => {
  it("defaults outboundRequests to empty array", () => {
    const result = friendsSchema.parse({});
    expect(result.outboundRequests).toEqual([]);
  });

  it("parses outbound requests with all fields", () => {
    const result = friendsSchema.parse({
      outboundRequests: [
        {
          toNodeId: "a".repeat(64),
          toUsername: "alice",
          sentAt: "2025-06-15",
          status: "pending",
        },
      ],
    });
    expect(result.outboundRequests).toHaveLength(1);
    expect(result.outboundRequests[0].toNodeId).toBe("a".repeat(64));
    expect(result.outboundRequests[0].toUsername).toBe("alice");
    expect(result.outboundRequests[0].sentAt).toBe("2025-06-15");
    expect(result.outboundRequests[0].status).toBe("pending");
  });

  it("provides defaults for optional outbound request fields", () => {
    const result = friendsSchema.parse({
      outboundRequests: [{ toNodeId: "b".repeat(64) }],
    });
    const req = result.outboundRequests[0];
    expect(req.toNodeId).toBe("b".repeat(64));
    expect(req.toUsername).toBe("");
    expect(req.sentAt).toBe("");
    expect(req.status).toBe("pending");
  });

  it("accepts accepted and rejected status", () => {
    const result = friendsSchema.parse({
      outboundRequests: [
        { toNodeId: "a".repeat(64), status: "accepted" },
        { toNodeId: "b".repeat(64), status: "rejected" },
      ],
    });
    expect(result.outboundRequests[0].status).toBe("accepted");
    expect(result.outboundRequests[1].status).toBe("rejected");
  });
});

describe("migrateV1ToV2", () => {
  it("migrates empty v1 data", () => {
    const result = migrateV1ToV2({});
    expect(result).toEqual({
      friends: [],
      groups: [],
      pendingRequests: [],
      outboundRequests: [],
      profileVisibility: "friends",
      friendRequestsFrom: "everyone",
    });
  });

  it("migrates v1 friends with nodeId to v2 nodeIds array", () => {
    const result = migrateV1ToV2({
      friends: [
        {
          id: "f1",
          name: "alice",
          description: "cool person",
          nodeId: "a".repeat(64),
          createdAt: "2025-01-01",
        },
      ],
    });
    expect(result.friends).toHaveLength(1);
    const f = result.friends[0];
    expect(f.id).toBe("f1");
    expect(f.alias).toBe("");
    expect(f.username).toBe("alice");
    expect(f.group).toBe("");
    expect(f.nodeIds).toHaveLength(1);
    expect(f.nodeIds[0].nodeId).toBe("a".repeat(64));
    expect(f.nodeIds[0].addedAt).toBe("2025-01-01");
    expect(f.nodeIds[0].lastSeenAt).toBe("");
    expect(f.nodeIds[0].username).toBe("");
    expect(f.nodeIds[0].bio).toBe("");
    expect(f.nodeIds[0].avatarDataUrl).toBe("");
    expect(f.createdAt).toBe("2025-01-01");
  });

  it("migrates v1 friend without nodeId to empty nodeIds array", () => {
    const result = migrateV1ToV2({
      friends: [{ id: "f2", name: "bob" }],
    });
    const f = result.friends[0];
    expect(f.username).toBe("bob");
    expect(f.nodeIds).toEqual([]);
  });

  it("migrates v1 friend with empty nodeId to empty nodeIds array", () => {
    const result = migrateV1ToV2({
      friends: [{ id: "f3", name: "charlie", nodeId: "" }],
    });
    const f = result.friends[0];
    expect(f.username).toBe("charlie");
    expect(f.nodeIds).toEqual([]);
  });

  it("migrates multiple v1 friends", () => {
    const result = migrateV1ToV2({
      friends: [
        { id: "f1", name: "alice", nodeId: "a".repeat(64), createdAt: "2025-01-01" },
        { id: "f2", name: "bob" },
        { id: "f3", name: "charlie", nodeId: "c".repeat(64), createdAt: "2025-03-01" },
      ],
    });
    expect(result.friends).toHaveLength(3);
    expect(result.friends[0].nodeIds).toHaveLength(1);
    expect(result.friends[1].nodeIds).toHaveLength(0);
    expect(result.friends[2].nodeIds).toHaveLength(1);
    expect(result.groups).toEqual([]);
    expect(result.pendingRequests).toEqual([]);
    expect(result.outboundRequests).toEqual([]);
    expect(result.profileVisibility).toBe("friends");
    expect(result.friendRequestsFrom).toBe("everyone");
  });

  it("handles v1 friend with missing name", () => {
    const result = migrateV1ToV2({
      friends: [{ id: "f4" }],
    });
    expect(result.friends[0].username).toBe("");
    expect(result.friends[0].alias).toBe("");
  });

  it("produces output that passes the v2 schema", () => {
    const migrated = migrateV1ToV2({
      friends: [{ id: "f1", name: "alice", nodeId: "a".repeat(64), createdAt: "2025-01-01" }],
    });
    const parsed = friendsSchema.parse(migrated);
    expect(parsed.friends).toHaveLength(1);
    expect(parsed.friends[0].username).toBe("alice");
    expect(parsed.friends[0].nodeIds[0].nodeId).toBe("a".repeat(64));
  });
});

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
    const friend = makeFriend({ alias: "bestie", username: "alice" });
    expect(friendDisplayName(friend)).toBe("bestie");
  });

  it("returns username when alias is empty", () => {
    const friend = makeFriend({ username: "alice" });
    expect(friendDisplayName(friend)).toBe("alice");
  });

  it("returns truncated nodeId when alias and username are empty", () => {
    const nodeId = "a1b2c3d4e5f6a7b8" + "0".repeat(48);
    const friend = makeFriend({
      nodeIds: [{ nodeId, addedAt: "", lastSeenAt: "", username: "", bio: "", avatarDataUrl: "" }],
    });
    const result = friendDisplayName(friend);
    expect(result).toBe(nodeId.slice(0, 8) + "..." + nodeId.slice(-8));
    expect(result).toHaveLength(19); // 8 + 3 + 8
  });

  it("returns 'unknown' when all fields are empty", () => {
    const friend = makeFriend();
    expect(friendDisplayName(friend)).toBe("unknown");
  });

  it("returns 'unknown' when nodeIds is empty array", () => {
    const friend = makeFriend({ nodeIds: [] });
    expect(friendDisplayName(friend)).toBe("unknown");
  });

  it("prefers alias over everything else", () => {
    const friend = makeFriend({
      alias: "nickname",
      username: "realname",
      nodeIds: [
        {
          nodeId: "a".repeat(64),
          addedAt: "",
          lastSeenAt: "",
          username: "",
          bio: "",
          avatarDataUrl: "",
        },
      ],
    });
    expect(friendDisplayName(friend)).toBe("nickname");
  });
});

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
    const friend = makeFriend({ alias: "bestie", username: "alice" });
    expect(friendDisplayNameFull(friend)).toBe("alice (bestie)");
  });

  it("returns username alone when alias is empty", () => {
    const friend = makeFriend({ username: "alice" });
    expect(friendDisplayNameFull(friend)).toBe("alice");
  });

  it("returns alias alone when username is empty", () => {
    const friend = makeFriend({ alias: "bestie" });
    expect(friendDisplayNameFull(friend)).toBe("bestie");
  });

  it("returns truncated nodeId when alias and username are empty", () => {
    const nodeId = "a".repeat(64);
    const friend = makeFriend({
      nodeIds: [{ nodeId, addedAt: "", lastSeenAt: "", username: "", bio: "", avatarDataUrl: "" }],
    });
    expect(friendDisplayNameFull(friend)).toBe(nodeId.slice(0, 8) + "..." + nodeId.slice(-8));
  });

  it("returns 'unknown' when everything is empty", () => {
    const friend = makeFriend();
    expect(friendDisplayNameFull(friend)).toBe("unknown");
  });
});

describe("friendsWidget", () => {
  it("has correct type", () => {
    expect(friendsWidget.type).toBe("friends");
  });

  it("has correct metadata name", () => {
    expect(friendsWidget.metadata.name).toBe("friends");
  });

  it("has correct metadata category", () => {
    expect(friendsWidget.metadata.category).toBe("narthex");
  });

  it("is not hidden from flyout", () => {
    expect(friendsWidget.metadata.hidden).toBeFalsy();
  });

  it("has correct default dimensions", () => {
    expect(friendsWidget.metadata.defaultWidth).toBe(280);
    expect(friendsWidget.metadata.defaultHeight).toBe(400);
  });

  it("has a schema", () => {
    expect(friendsWidget.schema).toBe(friendsSchema);
  });

  it("has empty editableProps", () => {
    expect(friendsWidget.editableProps).toEqual([]);
  });
});

describe("isValidNodeId", () => {
  it("accepts valid 64-char hex string", () => {
    expect(isValidNodeId("a".repeat(64))).toBe(true);
    expect(isValidNodeId("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("rejects strings that are too short", () => {
    expect(isValidNodeId("abc123")).toBe(false);
  });

  it("rejects strings that are too long", () => {
    expect(isValidNodeId("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isValidNodeId("A".repeat(64))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidNodeId("g" + "a".repeat(63))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidNodeId("")).toBe(false);
  });
});
