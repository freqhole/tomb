// ---------------------------------------------------------------------------
// share string encoding/decoding for P2P canvas sharing.
//
// a share string is a base64-encoded JSON object containing:
// - n: the owner's iroh node ID (64-char hex string)
// - d: the automerge document ID of the canvas
//
// format: base64({ "n": "<nodeId>", "d": "<docId>" })
//
// URL format: #share/<base64>
// ---------------------------------------------------------------------------

const TAG = "[skein:share]";

export interface SharePayload {
  nodeId: string;
  docId: string;
}

/**
 * encode a share string from a node ID and document ID.
 * returns a base64 string suitable for copying or embedding in a URL.
 */
export function encodeShareString(nodeId: string, docId: string): string {
  const payload = JSON.stringify({ n: nodeId, d: docId });
  return btoa(payload);
}

/**
 * decode a share string back to a node ID and document ID.
 * returns null if the string is invalid.
 *
 * accepts either:
 * - a raw base64 string
 * - a URL fragment like "#share/<base64>" (strips the prefix)
 */
export function decodeShareString(input: string): SharePayload | null {
  try {
    // strip URL fragment prefix if present
    let raw = input.trim();
    if (raw.startsWith("#share/")) {
      raw = raw.slice(7);
    }
    if (raw.startsWith("share/")) {
      raw = raw.slice(6);
    }

    const json = atob(raw);
    const parsed = JSON.parse(json);

    if (
      typeof parsed.n !== "string" ||
      typeof parsed.d !== "string" ||
      !parsed.n ||
      !parsed.d
    ) {
      return null;
    }

    return { nodeId: parsed.n, docId: parsed.d };
  } catch {
    console.warn(TAG, "failed to decode share string:", input.slice(0, 32) + "...");
    return null;
  }
}

/**
 * build a shareable URL fragment for a canvas.
 * returns a string like "#share/<base64>" suitable for window.location.hash.
 */
export function shareFragment(nodeId: string, docId: string): string {
  return `#share/${encodeShareString(nodeId, docId)}`;
}
