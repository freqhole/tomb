// fetches a media blob from a remote peer over iroh-blobs verified
// streaming, returning it as a Blob suitable for an <audio>/<video>
// element's src (via a blob: object URL).

import type { MiddenNode } from "@freqhole/midden";
import type { MediaRef } from "../control/schema";

export async function fetchMediaBlob(
  node: MiddenNode,
  item: MediaRef,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const bytes =
    item.size_bytes && onProgress
      ? await node.download_verified_with_ensure_progress(
          item.source_peer_addr,
          item.blake3_hash,
          item.size_bytes,
          onProgress,
        )
      : await node.download_verified_with_ensure(item.source_peer_addr, item.blake3_hash);
  return new Blob([bytes] as BlobPart[], { type: item.mime_type ?? "audio/mpeg" });
}
