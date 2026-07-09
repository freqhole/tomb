// peer-names - a tiny session-scoped registry mapping node ids to display
// names. exists so deep ui code (a property tray, a picker row, a log
// line) can show a human name without threading a social/friends doc
// through every mount context. read-side consumers must always have a
// fallback (e.g. a shortened node id) for a node id the registry hasn't
// seen a name for yet - it only knows about peers registered this session.

const names = new Map<string, string>();

/** register (or update) a display name for a node id. empty values are ignored. */
export function registerPeerName(nodeId: string, name: string): void {
  if (!nodeId || !name) return;
  names.set(nodeId, name);
}

/** the display name for a node id, or null when unknown. */
export function peerNameFor(nodeId: string): string | null {
  return names.get(nodeId) ?? null;
}

/** clear the registry (identity switch, sign-out, test teardown). */
export function clearPeerNames(): void {
  names.clear();
}
