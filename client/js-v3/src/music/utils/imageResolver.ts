// utility for resolving blob IDs to object URLs in batch
// enriches entities with thumbnail_url field for UI consumption

import { getImageUrl } from "./images";

export interface WithThumbnail {
  thumbnail_blob_id?: string | null;
  thumbnail_url?: string | null;
}

/**
 * enrich entity with thumbnail_url by resolving thumbnail_blob_id
 */
export async function enrichWithThumbnailUrl<T extends WithThumbnail>(
  entity: T
): Promise<T & { thumbnail_url: string | null }> {
  const thumbnail_url = entity.thumbnail_blob_id
    ? await getImageUrl(entity.thumbnail_blob_id)
    : null;

  return {
    ...entity,
    thumbnail_url,
  };
}

/**
 * enrich array of entities with thumbnail_url fields
 */
export async function enrichWithThumbnailUrls<T extends WithThumbnail>(
  entities: T[]
): Promise<Array<T & { thumbnail_url: string | null }>> {
  return await Promise.all(entities.map(enrichWithThumbnailUrl));
}
