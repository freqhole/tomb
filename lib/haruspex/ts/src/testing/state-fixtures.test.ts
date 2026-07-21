import { describe, expect, it } from "vitest";

import {
  createFakeEndpointAdapter,
  makeFriendDirectoryEntries,
  makeFriendDirectoryEntry,
  makePendingRemote,
  makeSavedRemote,
} from "./state-fixtures.js";

describe("makeFriendDirectoryEntry", () => {
  it("produces a valid entry with default values", () => {
    const entry = makeFriendDirectoryEntry();
    expect(entry.username).toBe("alice");
    expect(entry.nodeIds).toHaveLength(1);
    expect(entry.nodeIds[0].nodeId).toHaveLength(64);
  });

  it("accepts overrides", () => {
    const entry = makeFriendDirectoryEntry({ username: "bob", alias: "bobby" });
    expect(entry.username).toBe("bob");
    expect(entry.alias).toBe("bobby");
  });
});

describe("makeFriendDirectoryEntries", () => {
  it("creates a batch of distinct entries", () => {
    const entries = makeFriendDirectoryEntries(3);
    expect(entries).toHaveLength(3);
    const usernames = entries.map((e) => e.username);
    expect(new Set(usernames).size).toBe(3);
  });
});

describe("makeSavedRemote", () => {
  it("produces a valid saved remote", () => {
    const remote = makeSavedRemote();
    expect(remote.remote_id).toMatch(/^r-/);
    expect(remote.name).toBe("hub");
    expect(remote.peer_addr).toHaveLength(64);
  });

  it("accepts overrides", () => {
    const remote = makeSavedRemote({ name: "custom", base_url: "https://test" });
    expect(remote.name).toBe("custom");
    expect(remote.base_url).toBe("https://test");
  });
});

describe("makePendingRemote", () => {
  it("produces a valid pending remote", () => {
    const pending = makePendingRemote();
    expect(pending.id).toMatch(/^p-/);
    expect(pending.stage).toBe("testing");
  });

  it("accepts overrides", () => {
    const pending = makePendingRemote({ stage: "failed", error_message: "timeout" });
    expect(pending.stage).toBe("failed");
    expect(pending.error_message).toBe("timeout");
  });
});

describe("createFakeEndpointAdapter", () => {
  it("starts in the given initial state", () => {
    const adapter = createFakeEndpointAdapter("off");
    expect(adapter.getEndpointState()).toBe("off");
  });

  it("transitions state on stop and restart", async () => {
    const adapter = createFakeEndpointAdapter("online");
    adapter.stop();
    expect(adapter.getEndpointState()).toBe("off");
    await adapter.restart();
    expect(adapter.getEndpointState()).toBe("online");
  });

  it("notifies listeners on state changes", () => {
    const adapter = createFakeEndpointAdapter("online");
    const seen: string[] = [];
    adapter.onEndpointStateChange((state) => seen.push(state));
    adapter.stop();
    expect(seen).toEqual(["off"]);
  });
});
