// deterministic identity fixture builder for tests that need
// valid-shaped identity records without real crypto or a running node.

import type { P2PIdentity } from "../identity/types.js";

/** creates a test identity with deterministic fields. `nodeId` defaults to
 *  a repeating pattern for easy recognition in test output; `secretKey` is
 *  a short byte sequence sufficient for shape validation but not usable for
 *  real crypto. */
export function makeIdentity(nodeId = "ab".repeat(32), createdAt = 1000): P2PIdentity {
  return {
    secret_key: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    node_id: nodeId,
    created_at: createdAt,
  };
}

/** creates a batch of distinct test identities, each with a unique node id
 *  derived from the given prefix and an incrementing counter. */
export function makeIdentities(count: number, nodeIdPrefix = "node"): P2PIdentity[] {
  return Array.from({ length: count }, (_, i) => {
    const nodeId = `${nodeIdPrefix}-${i.toString().padStart(2, "0")}`.padEnd(64, "0");
    return makeIdentity(nodeId, 1000 + i);
  });
}
