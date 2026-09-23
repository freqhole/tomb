// shared validation/utility helpers for the "send to remote" orchestrators
// (music/services/send/sendToRemote.ts, video/services/send/
// sendVideoToRemote.ts) - both used to hand-duplicate this exact logic
// (dest transport validation, source node id resolution, the
// /api/blobz/has pre-check, the peer_unauthorized error message). the
// state machines and per-domain sync flows (album/playlist envelopes vs.
// video's flat item list) stay in their own files - only the genuinely
// identical, side-effect-light pieces live here.

import { schema } from "@freqhole/api-client";
import type { Transport } from "@freqhole/api-client";
const { HasBlobsResponseSchema } = schema;
import { isP2PTransportType } from "../../api/client";
import { extractNodeIdStrict } from "../remotes/peerAddr";
import { getLocalNodeId } from "../charnel";
import { isP2PRemote, type Remote } from "../storage/schemas/remote";
import { warn } from "../../../utils/logger";

/** a send destination must be a p2p remote or the local charnel app -
 * anything else (a plain http remote) has no way to pull blobs by blake3. */
export function isValidSendDestination(dest: Remote): boolean {
  return isP2PTransportType(dest) || dest.is_charnel_managed === true;
}

/** the iroh node id dest should pull FROM - null if source has none
 * (neither a p2p peer_addr nor this device's own charnel-managed node). */
export function resolveSourceNodeId(source: Remote): string | null {
  if (isP2PRemote(source)) {
    const id = extractNodeIdStrict(source.peer_addr);
    if (id) return id;
  }
  return source.is_charnel_managed ? getLocalNodeId() : null;
}

/** ask dest which of `blake3s` it already has via `/api/blobz/has`.
 * best-effort: any failure (network, bad shape) returns an empty set,
 * matching both callers' existing "treat as nothing present" fallback. */
export async function checkBlobsPresentOnDest(
  destTransport: Transport,
  blake3s: string[],
  tag: string,
  logPrefix: string
): Promise<Set<string>> {
  if (blake3s.length === 0) return new Set();
  try {
    const resp = await destTransport.request("POST", "/api/blobz/has", JSON.stringify({ blake3s }));
    if (resp.status < 200 || resp.status >= 300) return new Set();
    const rawJson = JSON.parse(resp.body) as { data?: unknown };
    const inner = rawJson?.data ?? rawJson;
    const parsed = HasBlobsResponseSchema.safeParse(inner);
    if (!parsed.success) {
      warn(tag, `${logPrefix} /api/blobz/has returned invalid shape: ${parsed.error.message}`);
      return new Set();
    }
    return new Set(parsed.data.blake3s_present);
  } catch (e) {
    warn(tag, `${logPrefix} /api/blobz/has pre-check failed: ${String(e)}`);
    return new Set();
  }
}

/** user-facing message for a `peer_unauthorized` sync failure - identical
 * wording previously hand-duplicated in sendToRemote.ts's and
 * sendVideoToRemote.ts's per-item catch blocks. */
export function peerUnauthorizedMessage(source: Remote, dest: Remote): string {
  return `access required: ${source.name ?? "source"} has not authorized ${dest.name ?? "dest"} — an access request was sent automatically. accept it on ${source.name ?? "the source"}, then retry the send.`;
}
