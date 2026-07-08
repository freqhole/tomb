// a solid resource that turns a blob-fetching function into an object url,
// revoking the previous url whenever a new one replaces it and revoking
// the current one when the owning computation is disposed.
//
// the blob-fetching function is supplied by the caller - this module has
// no dependency on `./blobs` or any particular blob store, so a consumer
// wires up its own resolver (a local blob store lookup, a network fetch,
// whatever it needs).

import { createEffect, createResource, onCleanup, type Resource } from "solid-js";

/**
 * fetches a blob via `getBlob` and exposes its object url as a solid
 * resource. `null` while loading, on a null blob, or after an error.
 * every previous url is revoked as soon as it's superseded (by a refetch)
 * or the resource is disposed - a caller never needs to manage
 * `URL.revokeObjectURL` itself.
 */
export function createBlobUrl(getBlob: () => Promise<Blob | null>): Resource<string | null> {
  const [url] = createResource(async () => {
    const blob = await getBlob();
    return blob ? URL.createObjectURL(blob) : null;
  });

  let previous: string | null = null;
  createEffect(() => {
    const current = url() ?? null;
    if (previous && previous !== current) URL.revokeObjectURL(previous);
    previous = current;
  });

  onCleanup(() => {
    if (previous) URL.revokeObjectURL(previous);
  });

  return url;
}
