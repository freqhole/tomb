// thin wrapper around imageCache.getImageFor for use by WalkCanvas node rendering.
//
// delegates entirely to the battle-tested implementation in components/graph/imageCache.ts:
// in-flight concurrency cap, fail/negative cache, OPFS→remote priority ordering,
// atlas-batch fetch for plain-http remotes, WKWebView ImageBitmap workaround.
//
// phase 8 will move the implementation source here (since graph2/ → graph/ rename
// collapses everything), but until then this thin import is the right approach.

import { getImageFor } from "../../graph/imageCache";
import type { ImageMetadata } from "../../../music/services/storage/types";

const noop = () => {};

/**
 * get a drawable image for a graph node synchronously if cached, or kick off
 * an async load and call `onReady` when decoded.
 *
 * `id` is the node id — used for debug logging; not needed by the underlying
 * resolver (atlas-tile keying is by serverId/blobId).
 *
 * `image` null → returns null immediately (node has no artwork).
 */
export function getNodeImage(
  _id: string,
  image: ImageMetadata | null,
  onReady?: () => void,
): HTMLImageElement | HTMLCanvasElement | null {
  if (!image) return null;
  return getImageFor(image, 200, onReady ?? noop);
}
