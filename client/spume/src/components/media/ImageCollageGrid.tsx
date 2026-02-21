// 2x2 image collage grid for multi-album listen sessions
// displays up to 4 distinct album covers in a grid layout

import { createEffect, createSignal, For, type JSX } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface ImageCollageGridProps {
  /** array of 2-4 images to display in a grid */
  images: ImageMetadata[];
  /** total size of the grid container in pixels */
  size: number;
}

// resolve a single image to a displayable URL
function resolveUrl(img: ImageMetadata): string | null {
  if (img.remote_url) return img.remote_url;
  if (img.local_blob_id) return getCachedBlobObjectURL(img.local_blob_id);
  return null;
}

export function ImageCollageGrid(props: ImageCollageGridProps): JSX.Element {
  // resolve URLs for each image, handling async local blob lookups
  const [urls, setUrls] = createSignal<(string | null)[]>(props.images.map(resolveUrl));

  createEffect(() => {
    const images = props.images;
    // start with sync-resolved URLs
    const initial = images.map(resolveUrl);
    setUrls(initial);

    // async-resolve any local blob IDs that weren't cached
    Promise.all(
      images.map(async (img, i) => {
        if (initial[i]) return initial[i];
        if (img.local_blob_id) return getBlobObjectURL(img.local_blob_id);
        return null;
      })
    ).then((resolved) => {
      // only update if any changed
      if (resolved.some((url, i) => url !== initial[i])) {
        setUrls(resolved);
      }
    });
  });

  const gap = 1; // 1px gap between grid cells

  return (
    <div
      class="w-full h-full grid grid-cols-2 grid-rows-2 rounded overflow-hidden bg-gray-800/50"
      style={{ gap: `${gap}px`, width: `${props.size}px`, height: `${props.size}px` }}
    >
      <For each={props.images.slice(0, 4)}>
        {(_, i) => {
          const url = () => urls()[i()];
          return (
            <div class="overflow-hidden bg-gray-800/50">
              {url() ? (
                <img src={url()!} alt="" class="w-full h-full object-cover" decoding="async" />
              ) : (
                <div class="w-full h-full" />
              )}
            </div>
          );
        }}
      </For>
    </div>
  );
}
