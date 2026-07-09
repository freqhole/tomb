import { describe, expect, it } from "vitest";

import {
  buildFriendDirectory,
  getFriendsForPicker,
  type FriendDirectoryEntry,
} from "./friend-directory.js";

describe("buildFriendDirectory", () => {
  it("excludes friends with no profile-doc-bearing node id", () => {
    const entries: FriendDirectoryEntry[] = [
      { username: "alice", nodeIds: [{ nodeId: "node-1" }] },
    ];
    expect(buildFriendDirectory(entries)).toEqual([]);
  });

  it("prefers alias, then username, then the node's own username, then 'friend'", () => {
    const entries: FriendDirectoryEntry[] = [
      {
        alias: "besty",
        username: "alice",
        nodeIds: [{ nodeId: "node-1", profileDocId: "doc-1", username: "alice-node" }],
      },
      {
        username: "bob",
        nodeIds: [{ nodeId: "node-2", profileDocId: "doc-2", username: "bob-node" }],
      },
      {
        nodeIds: [{ nodeId: "node-3", profileDocId: "doc-3", username: "carol-node" }],
      },
      {
        nodeIds: [{ nodeId: "node-4", profileDocId: "doc-4" }],
      },
    ];

    expect(buildFriendDirectory(entries)).toEqual([
      { nodeId: "node-1", profileDocId: "doc-1", displayName: "besty" },
      { nodeId: "node-2", profileDocId: "doc-2", displayName: "bob" },
      { nodeId: "node-3", profileDocId: "doc-3", displayName: "carol-node" },
      { nodeId: "node-4", profileDocId: "doc-4", displayName: "friend" },
    ]);
  });

  it("picks the first node id that has a profile doc pointer", () => {
    const entries: FriendDirectoryEntry[] = [
      {
        nodeIds: [
          { nodeId: "node-1" },
          { nodeId: "node-2", profileDocId: "doc-2" },
        ],
      },
    ];
    expect(buildFriendDirectory(entries)).toEqual([
      { nodeId: "node-2", profileDocId: "doc-2", displayName: "friend" },
    ]);
  });
});

describe("getFriendsForPicker", () => {
  it("resolves candidates from the injected loader", async () => {
    const entries: FriendDirectoryEntry[] = [
      { username: "alice", nodeIds: [{ nodeId: "node-1", profileDocId: "doc-1" }] },
    ];
    const result = await getFriendsForPicker(async () => entries);
    expect(result).toEqual([{ nodeId: "node-1", profileDocId: "doc-1", displayName: "alice" }]);
  });

  it("returns [] when the loader throws", async () => {
    const result = await getFriendsForPicker(async () => {
      throw new Error("no friend list yet");
    });
    expect(result).toEqual([]);
  });
});
