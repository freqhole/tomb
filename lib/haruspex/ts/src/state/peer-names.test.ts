import { afterEach, describe, expect, it } from "vitest";

import { clearPeerNames, peerNameFor, registerPeerName } from "./peer-names.js";

afterEach(() => {
  clearPeerNames();
});

describe("peer-names", () => {
  it("returns null for an unknown node id", () => {
    expect(peerNameFor("node-unknown")).toBeNull();
  });

  it("registers and looks up a display name", () => {
    registerPeerName("node-abc", "alice");
    expect(peerNameFor("node-abc")).toBe("alice");
  });

  it("updates an existing registration", () => {
    registerPeerName("node-abc", "alice");
    registerPeerName("node-abc", "alice-2");
    expect(peerNameFor("node-abc")).toBe("alice-2");
  });

  it("ignores empty node ids or names", () => {
    registerPeerName("", "alice");
    registerPeerName("node-abc", "");
    expect(peerNameFor("node-abc")).toBeNull();
  });

  it("clears every registration", () => {
    registerPeerName("node-abc", "alice");
    clearPeerNames();
    expect(peerNameFor("node-abc")).toBeNull();
  });
});
