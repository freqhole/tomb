import { describe, expect, it } from "vitest";

import { makeIdentities, makeIdentity } from "./identity-fixtures.js";

describe("makeIdentity", () => {
  it("produces a valid-shaped identity with default values", () => {
    const identity = makeIdentity();
    expect(identity.node_id).toHaveLength(64);
    expect(identity.secret_key).toBeInstanceOf(Uint8Array);
    expect(identity.created_at).toBe(1000);
  });

  it("accepts custom node id and timestamp", () => {
    const identity = makeIdentity("custom-node-id".padEnd(64, "x"), 5000);
    expect(identity.node_id).toBe("custom-node-id".padEnd(64, "x"));
    expect(identity.created_at).toBe(5000);
  });
});

describe("makeIdentities", () => {
  it("creates a batch of distinct identities", () => {
    const identities = makeIdentities(3);
    expect(identities).toHaveLength(3);
    const nodeIds = identities.map((i) => i.node_id);
    expect(new Set(nodeIds).size).toBe(3);
  });

  it("uses the given prefix in node ids", () => {
    const identities = makeIdentities(2, "test");
    expect(identities[0].node_id).toMatch(/^test-00/);
    expect(identities[1].node_id).toMatch(/^test-01/);
  });
});
