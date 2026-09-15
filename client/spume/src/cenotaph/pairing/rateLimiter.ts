// basic in-memory rate limiter for pairing attempts, keyed by the dialing
// peer's node id. deters brute-forcing the 6-char pin: after
// MAX_ATTEMPTS failures within WINDOW_MS, further attempts from that node
// id are rejected without even checking the pin, until the window rolls
// off the oldest failure.

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

const failuresByNodeId = new Map<string, number[]>();

export function isRateLimited(nodeId: string): boolean {
  const failures = failuresByNodeId.get(nodeId);
  if (!failures) return false;
  const cutoff = Date.now() - WINDOW_MS;
  const recent = failures.filter((ts) => ts > cutoff);
  failuresByNodeId.set(nodeId, recent);
  return recent.length >= MAX_ATTEMPTS;
}

export function recordPairingFailure(nodeId: string): void {
  const failures = failuresByNodeId.get(nodeId) ?? [];
  failures.push(Date.now());
  failuresByNodeId.set(nodeId, failures);
}

export function clearPairingFailures(nodeId: string): void {
  failuresByNodeId.delete(nodeId);
}
