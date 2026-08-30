// mirrors grimoire/src/offal/media_blobz/mod.rs::get_metadata() -
// route-level glue around service.ts's getMediaBlob(), the actual
// business logic.

import type { ApiRouteHandler } from "@freqhole/cenotaph";
import { getMediaBlob } from "./service";

export const getMetadata: ApiRouteHandler = async (body) => {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { status: 400, body: { error: "missing id" } };
  }

  const blob = await getMediaBlob(id);
  if (!blob) return { status: 404, body: { error: "blob not found" } };

  return { status: 200, body: blob };
};
