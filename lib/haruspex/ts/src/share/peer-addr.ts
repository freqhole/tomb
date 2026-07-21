// peer-address helpers: classify and normalize the strings apps use to
// address a peer. a `peer_addr` may be a bare 64-hex iroh node id, or a
// json endpoint blob carrying the node id under `node_id` (full endpoint
// dumps) or `id` (compact share forms); anything else is treated as an
// http url.

const NODE_ID_RE = /^[0-9a-f]{64}$/i;

/** true when `value` is a bare 64-hex node id. */
export function isValidNodeId(value: string): boolean {
  return NODE_ID_RE.test(value.trim());
}

/**
 * extract the 64-hex node id from a `peer_addr` string (bare id or json
 * endpoint blob). falls back to returning the raw value when it cannot
 * be parsed.
 */
export function extractNodeId(peerAddr: string): string {
  const trimmed = peerAddr.trim();
  if (NODE_ID_RE.test(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { node_id?: unknown; id?: unknown };
    if (typeof parsed?.node_id === "string") return parsed.node_id;
    if (typeof parsed?.id === "string") return parsed.id;
  } catch {
    // not json
  }
  return peerAddr;
}

/** strict variant: null when a 64-hex node id could not be derived. */
export function extractNodeIdStrict(peerAddr: string): string | null {
  const id = extractNodeId(peerAddr);
  return NODE_ID_RE.test(id) ? id : null;
}

/** a classified peer target: p2p (addressed by node id / endpoint json)
 *  or http (addressed by base url). */
export type PeerTarget = { type: "p2p"; peerAddr: string } | { type: "http"; url: string };

/**
 * classify raw user input as a p2p peer address or an http url.
 *
 * - a bare 64-hex string is a node id (p2p)
 * - a json blob with a string `id` or `node_id` field is a full endpoint (p2p)
 * - anything else is treated as an http url, scheme-prefixed with
 *   `defaultScheme` when missing and trailing-slash trimmed
 *
 * returns null for empty input. url VALIDITY is not checked here - the
 * caller decides how to validate/normalize further.
 */
export function parsePeerAddress(
  input: string,
  defaultScheme: "http" | "https" = "https"
): PeerTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (NODE_ID_RE.test(trimmed)) {
    return { type: "p2p", peerAddr: trimmed };
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { node_id?: unknown; id?: unknown };
      if (typeof parsed?.id === "string" || typeof parsed?.node_id === "string") {
        return { type: "p2p", peerAddr: trimmed };
      }
    } catch {
      // not valid json, fall through to url handling
    }
  }

  let url = trimmed;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `${defaultScheme}://${url}`;
  }
  url = url.replace(/\/+$/, "");
  return { type: "http", url };
}
