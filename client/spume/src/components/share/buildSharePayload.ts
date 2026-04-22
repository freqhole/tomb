// build a `SharePayloadV1` from a `ShareTarget` plus the source `Remote`.
//
// preserves source identity correctly for the three cases:
//   - p2p remote with both base_url + peer_addr → carry both (`s.n` + `s.h`)
//   - p2p remote with only peer_addr → only `s.n`
//   - http remote with only base_url → only `s.h`
//
// throws if the source has no usable identity (no node id, no base url).

import type { Remote } from "../../app/services/storage/schemas/remote";
import { isP2PRemote } from "../../app/services/storage/schemas/remote";
import { extractNodeIdStrict } from "../../app/services/remotes/peerAddr";
import type { SharePayloadV1 } from "../../utils/permalink";
import type { ShareTarget } from "./types";

export function buildSharePayload(
  target: ShareTarget,
  source: Remote,
): SharePayloadV1 {
  const s: SharePayloadV1["s"] = {};

  if (isP2PRemote(source)) {
    const nodeId = extractNodeIdStrict(source.peer_addr);
    if (nodeId) s.n = nodeId;
  }

  // base_url, when present, is normalized to an https:// origin.
  // we accept http:// too (decoder validates), but only carry the origin —
  // strip any path/query/trailing slash.
  const base = source.base_url;
  if (base) {
    try {
      const url = new URL(base);
      // origin getter excludes path/search/hash and trailing slash.
      s.h = url.origin;
    } catch {
      // ignore — invalid base_url is treated as missing.
    }
  }

  if (s.n === undefined && s.h === undefined) {
    throw new Error(
      "cannot build share link: source remote has no node id and no base url",
    );
  }

  return {
    v: 1,
    s,
    k: target.kind,
    i: target.id,
    p: target.parentId || undefined,
    t: target.displayTitle || undefined,
  };
}
