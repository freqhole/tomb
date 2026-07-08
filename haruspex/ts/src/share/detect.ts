// classification of raw strings a user might paste or type into a
// peer-address / share-link input box.

import { decodeShareToken, extractShareToken } from "./codec.js";
import type { ShareTokenPayload } from "./codec.js";
import { extractNodeIdStrict } from "./peer-addr.js";

/**
 * classification of a raw string: a bare node id, a share token
 * (optionally embedded in a url fragment), or neither.
 */
export type ShareInputDetection =
  | { kind: "node_id"; nodeId: string }
  | { kind: "share_token"; token: string; payload: ShareTokenPayload }
  | { kind: "invalid" };

/**
 * classify raw input as a node id, a share token, or neither. node id
 * detection reuses extractNodeIdStrict so this never diverges from
 * parsePeerAddress's own notion of a valid peer address; share-token
 * detection reuses decodeShareToken/extractShareToken so a full url with
 * the token in its fragment classifies the same way a bare token does.
 */
export function detectShareInput(input: string): ShareInputDetection {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "invalid" };

  const nodeId = extractNodeIdStrict(trimmed);
  if (nodeId) {
    return { kind: "node_id", nodeId };
  }

  const token = extractShareToken(trimmed);
  const payload = decodeShareToken(token);
  if (!payload) return { kind: "invalid" };

  return { kind: "share_token", token, payload };
}
