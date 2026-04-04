import { describe, expect, it } from "vitest";
import { friendsSchema, friendsWidget, isValidNodeId } from "./friends-widget";

describe("friendsSchema", () => {
  it("parses empty object with defaults", () => {
    const result = friendsSchema.parse({});
    expect(result).toEqual({
      friends: [],
    });
  });

  it("parses object with friends array", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "f1",
          name: "alice",
          description: "cool person",
          nodeId: "node-1",
          createdAt: "2025-01-01",
        },
        { id: "f2", name: "bob" },
      ],
    });
    expect(result.friends).toHaveLength(2);
    expect(result.friends[0].name).toBe("alice");
    expect(result.friends[1].name).toBe("bob");
  });

  it("parses friend entry with all fields", () => {
    const result = friendsSchema.parse({
      friends: [
        {
          id: "friend-abc",
          name: "alice",
          description: "a good friend",
          nodeId: "node-xyz",
          createdAt: "2025-06-01",
        },
      ],
    });
    const entry = result.friends[0];
    expect(entry.id).toBe("friend-abc");
    expect(entry.name).toBe("alice");
    expect(entry.description).toBe("a good friend");
    expect(entry.nodeId).toBe("node-xyz");
    expect(entry.createdAt).toBe("2025-06-01");
  });

  it("provides defaults for optional friend entry fields", () => {
    const result = friendsSchema.parse({
      friends: [{ id: "friend-1" }],
    });
    const entry = result.friends[0];
    expect(entry.id).toBe("friend-1");
    expect(entry.name).toBe("");
    expect(entry.description).toBe("");
    expect(entry.nodeId).toBe("");
    expect(entry.createdAt).toBe("");
  });

  it("preserves friend entries when provided", () => {
    const friends = [
      { id: "f1", name: "alice", description: "", nodeId: "n1", createdAt: "" },
      { id: "f2", name: "bob", description: "hey", nodeId: "n2", createdAt: "2025-03-01" },
      { id: "f3", name: "charlie", description: "", nodeId: "", createdAt: "" },
    ];
    const result = friendsSchema.parse({ friends });
    expect(result.friends).toHaveLength(3);
    expect(result.friends[0].name).toBe("alice");
    expect(result.friends[1].name).toBe("bob");
    expect(result.friends[1].description).toBe("hey");
    expect(result.friends[2].name).toBe("charlie");
  });

  it("adding a friend entry to parsed result works correctly", () => {
    const result = friendsSchema.parse({});
    expect(result.friends).toHaveLength(0);

    result.friends.push({
      id: "new-friend",
      name: "dave",
      description: "just added",
      nodeId: "node-dave",
      createdAt: "2025-06-15",
    });
    expect(result.friends).toHaveLength(1);
    expect(result.friends[0].id).toBe("new-friend");
    expect(result.friends[0].name).toBe("dave");
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
    expect(friendsWidget.metadata.defaultWidth).toBe(260);
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
