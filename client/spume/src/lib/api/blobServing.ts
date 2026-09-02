// registers content with this device's own midden node so it becomes
// fetchable by a peer via iroh-blobs verified download - a step grimoire's
// plain-file http serving never needs (a song already on disk is
// immediately fetchable by any http range request), but iroh-blobs'
// content-addressed transfer model requires explicitly: bytes aren't
// servable by hash until `import_blob()` has registered them with this
// node. no rust-side equivalent to mirror here - this file exists purely
// because of that iroh-blobs requirement.
//
// mirrors the exact pattern already used by playerQueuePush.ts's
// `importMediaBytes()` (pushing a queue to a paired player) and
// WasmTransport.ts's upload path (uploading to a remote grimoire server) -
// this is a third caller, for "any peer querying this browser's own local
// library by blake3" (docs/cenotaph-migration-plan.md phase 3, tier 2).

import { getMiddenNode } from "../../app/api/client";
import { warn } from "../../utils/logger";

const staged = new Set<string>();

/**
 * ensures `blake3`'s bytes are registered with this device's midden node.
 * safe to call repeatedly for the same hash (no-ops after the first
 * successful call this session) and safe to call speculatively - swallows
 * every failure (bytes not found locally, this transport can't stage
 * blobs, node unavailable) rather than throwing, since staging is always
 * a best-effort step ahead of a peer's fetch, never a hard requirement.
 */
export async function ensureBlobServable(
  blake3: string,
  getBytes: () => Promise<Blob | null>
): Promise<void> {
  if (staged.has(blake3)) return;

  try {
    const node = await getMiddenNode();
    if (!node.import_blob) return;

    const blob = await getBytes();
    if (!blob) return;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const imported = await node.import_blob(bytes);
    if (imported !== blake3) {
      warn(
        "blobServing",
        `import_blob returned ${imported.slice(0, 8)}... but expected ${blake3.slice(0, 8)}...`
      );
    }
    staged.add(blake3);
  } catch (err) {
    warn("blobServing", `failed to stage ${blake3.slice(0, 8)}...:`, err);
  }
}
