// gossip invite encoding/decoding utilities
//
// invite data travels as a compact base64url-encoded JSON string.
// can be embedded in a URL: https://spume.freqhole.net/?g=<encoded>
// or copied as raw JSON for manual pasting.

export interface GossipInvite {
  topic_id: string;
  channel_name: string;
  creator_node_id: string;
  music_only?: boolean;
}

/** encode an invite as a base64url string (URL-safe, no padding) */
export function encodeInvite(invite: GossipInvite): string {
  const json = JSON.stringify(invite);
  // btoa produces base64, then convert to base64url
  const b64 = btoa(json);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** decode a base64url-encoded invite string back to an object */
export function decodeInvite(encoded: string): GossipInvite {
  // base64url → base64
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  // add padding
  while (b64.length % 4 !== 0) b64 += "=";
  const json = atob(b64);
  const parsed = JSON.parse(json);
  if (!parsed.topic_id || !parsed.channel_name || !parsed.creator_node_id) {
    throw new Error("invalid invite: missing required fields");
  }
  return parsed as GossipInvite;
}

/** build a shareable invite URL */
export function inviteToUrl(invite: GossipInvite): string {
  return `https://spume.freqhole.net/?g=${encodeInvite(invite)}`;
}

/**
 * try to parse invite data from various input formats:
 * - base64url-encoded string (from ?g= param or QR scan)
 * - full URL with ?g= param
 * - raw JSON object
 */
export function parseInviteInput(input: string): GossipInvite {
  const trimmed = input.trim();

  // try as URL with ?g= param
  try {
    const url = new URL(trimmed);
    const gParam = url.searchParams.get("g");
    if (gParam) return decodeInvite(gParam);
  } catch {
    // not a URL
  }

  // try as URL without scheme
  if (trimmed.includes("?g=")) {
    const match = trimmed.match(/[?&]g=([A-Za-z0-9_-]+)/);
    if (match) return decodeInvite(match[1]);
  }

  // try as raw JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.topic_id && parsed.channel_name && parsed.creator_node_id) {
      return parsed as GossipInvite;
    }
  } catch {
    // not JSON
  }

  // try as bare base64url
  try {
    return decodeInvite(trimmed);
  } catch {
    // not base64
  }

  throw new Error("could not parse invite — paste a link, QR code result, or JSON invite token");
}
