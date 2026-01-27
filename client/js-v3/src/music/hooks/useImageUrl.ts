// hook to resolve image URLs - handles both local blob resolution and remote URLs
import { createResource } from "solid-js";
import { resolveLocalBlobUrl } from "../utils/images";

/**
 * resolves image URL from blob_id or passes through remote/existing URL
 * 
 * only re-resolves if existingUrl is missing or invalid
 * remote URLs and fresh blob URLs pass through unchanged
 */
export function useImageUrl(
  blobId: string | null | undefined,
  existingUrl: string | null | undefined,
): () => string | undefined {
  // if we already have a URL (blob or remote), just return it
  // no need for createResource - that causes reactive loops
  if (existingUrl) {
    return () => existingUrl;
  }
  
  // resolve from blobId - track blobId as source so resource knows when to refetch
  const [imageUrl] = createResource(
    () => blobId,  // source: when this changes, refetch
    async (id) => {
      if (!id) return undefined;
      return await resolveLocalBlobUrl(id) ?? undefined;
    }
  );
  
  return imageUrl;
}
