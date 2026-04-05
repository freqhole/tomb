import type { FriendEntry } from "./schema";

// ---------------------------------------------------------------------------
// visual constants used by helpers
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  0xd946ef, 0x6366f1, 0x06b6d4, 0x10b981, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6,
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** simple hash to pick a palette color from a string. */
export function colorForName(name: string, index: number): number {
  if (!name) return COLOR_PALETTE[index % COLOR_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

/** truncate a string with an ellipsis if it exceeds maxChars. */
export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1).trimEnd() + "\u2026";
}

/**
 * check if a string looks like a valid iroh node ID.
 * iroh node IDs are 64-character lowercase hex strings (32-byte ed25519 public key).
 */
export function isValidNodeId(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

/**
 * resolve the best display name for a friend.
 * priority: alias > username > truncated first nodeId > "unknown"
 */
export function friendDisplayName(friend: FriendEntry): string {
  if (friend.alias) return friend.alias;
  if (friend.username) return friend.username;
  if (friend.nodeIds.length > 0 && friend.nodeIds[0].nodeId) {
    const id = friend.nodeIds[0].nodeId;
    return id.slice(0, 8) + "..." + id.slice(-8);
  }
  return "unknown";
}

/**
 * format the display name with alias annotation.
 * if alias is set and username exists: "username (alias)"
 * otherwise: just the display name
 */
export function friendDisplayNameFull(friend: FriendEntry): string {
  if (friend.alias && friend.username) {
    return `${friend.username} (${friend.alias})`;
  }
  return friendDisplayName(friend);
}
