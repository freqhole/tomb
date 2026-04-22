// helpers for working with iroh `peer_addr` values stored on remotes.
//
// `peer_addr` may be either:
//   - the bare 64-hex iroh node id, or
//   - a json blob `{ "node_id": "...", "relay_url": "...", ... }`
//
// the helpers here normalize both forms.

/**
 * extract the 64-hex iroh node id from a `peer_addr` string.
 * falls back to returning the raw value when it cannot be parsed.
 */
export function extractNodeId(peerAddr: string): string {
  if (/^[0-9a-f]{64}$/i.test(peerAddr)) return peerAddr;
  try {
    const parsed = JSON.parse(peerAddr);
    if (typeof parsed?.node_id === "string") return parsed.node_id;
  } catch {
    // ignore - not json
  }
  return peerAddr;
}

/** strict variant: returns null when a 64-hex node id could not be derived. */
export function extractNodeIdStrict(peerAddr: string): string | null {
  const id = extractNodeId(peerAddr);
  return /^[0-9a-f]{64}$/i.test(id) ? id : null;
}
