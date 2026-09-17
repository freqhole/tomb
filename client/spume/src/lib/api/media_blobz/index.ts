// mirrors grimoire/src/offal/media_blobz/mod.rs::get_metadata() -
// route-level glue around service.ts's getMediaBlob(), the actual
// business logic.

import type { ApiRouteHandler } from "../../../cenotaph";
import { getData, getMediaBlob } from "./service";

export const getMetadata: ApiRouteHandler = async (body) => {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { status: 400, body: { error: "missing id" } };
  }

  const blob = await getMediaBlob(id);
  if (!blob) return { status: 404, body: { error: "blob not found" } };

  return { status: 200, body: blob };
};

/** mirrors grimoire/src/offal/media_blobz/mod.rs::get_metadata_by_blake3() -
 * `fetchFullVideoFromSource()` (mediaRefResolve.ts) calls `POST /api/
 * blob_metadata_by_blake3` to resolve a video's blake3 hash to a
 * `media_blob_id` before querying videos by it - this route was never
 * registered for a browser (non-grimoire) source peer, so a cenotaph
 * queue-push of a video sourced from a plain browser tab could never
 * resolve on the receiving side. `getMediaBlob(id)` already tries blake3
 * first (see its own doc comment), so no separate lookup is needed here. */
export const getMetadataByBlake3: ApiRouteHandler = async (body) => {
  const blake3 = (body as { blake3?: unknown } | null)?.blake3;
  if (typeof blake3 !== "string" || blake3.length === 0) {
    return { status: 400, body: { error: "missing blake3" } };
  }

  const blob = await getMediaBlob(blake3);
  if (!blob) return { status: 404, body: { error: "blob not found" } };

  return { status: 200, body: blob };
};

/** mirrors grimoire/src/offal/media_blobz/mod.rs::get_data() -
 * `WasmTransport.fetchBlob()`'s base64 fallback (used when iroh-blobs
 * verified streaming isn't attempted/fails) calls `GET /api/blobs/{id}/
 * data` - registered as a prefix route (see apiRouter.ts's
 * `registerPrefixRoute`) since this router has no `{id}` path-param
 * syntax; `rest` is `{id}/data` with the `/api/blobs/` prefix already
 * stripped. */
export const getBlobData: (rest: string, body: unknown) => ReturnType<ApiRouteHandler> = async (
  rest
) => {
  const id = rest.endsWith("/data") ? rest.slice(0, -"/data".length) : null;
  if (!id) return { status: 404, body: { error: "not found" } };

  const blob = await getData(id);
  if (!blob) return { status: 404, body: { error: "blob not found" } };

  return { status: 200, body: { success: true, message: "blob data", data: blob } };
};
