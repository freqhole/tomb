// 2x2 image collage grid for multi-album listen sessions
// displays up to 4 distinct album covers in a grid layout

import { createEffect, createSignal, For, type JSX } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import {
  resolveBlobUrl,
  isP2PRemoteSync,
  usesBlobResolver,
} from "../../music/services/storage/blobResolver";
import type { ThumbnailSize } from "../../music/services/storage/blobResolver";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface ImageCollageGridProps {
  /** array of 2-4 images to display in a grid */
  images: ImageMetadata[];
  /** total size of the grid container in pixels */
  size: number;
  /** optional thumbnail size for remote HTTP images */
  thumbnailSize?: ThumbnailSize;
}

// resolve a single image to a displayable URL (sync version for initial render)
function resolveUrlSync(img: ImageMetadata, thumbnailSize?: ThumbnailSize): string | null {
  // for P2P remotes (wasm/app), we need async resolution
  if (img.remote_server_id && img.remote_blob_id && isP2PRemoteSync(img.remote_server_id)) {
    return null; // will be resolved async
  }
  if (img.remote_url) {
    // append thumbnail path for HTTP blob URLs if requested
    return thumbnailSize ? `${img.remote_url}/thumb/${thumbnailSize}` : img.remote_url;
  }
  if (img.local_blob_id) return getCachedBlobObjectURL(img.local_blob_id);
  return null;
}

export function ImageCollageGrid(props: ImageCollageGridProps): JSX.Element {
  // resolve URLs for each image, handling async local blob lookups
  const [urls, setUrls] = createSignal<(string | null)[]>(
    props.images.map((img) => resolveUrlSync(img, props.thumbnailSize))
  );

  createEffect(() => {
    const images = props.images;
    const thumbSize = props.thumbnailSize;
    // start with sync-resolved URLs
    const initial = images.map((img) => resolveUrlSync(img, thumbSize));
    setUrls(initial);

    // async-resolve any images that weren't resolved synchronously
    Promise.all(
      images.map(async (img, i) => {
        if (initial[i]) return initial[i];
        // check if this needs blob resolution (P2P or tauri-managed)
        if (img.remote_server_id && img.remote_blob_id) {
          const needsResolution = await usesBlobResolver(img.remote_server_id);
          if (needsResolution) {
            try {
              return await resolveBlobUrl(img.remote_blob_id, img.remote_server_id, "image");
            } catch {
              return img.remote_url ?? null;
            }
          }
        }
        // fallback to remote_url for standard HTTP
        if (img.remote_url) {
          return thumbSize ? `${img.remote_url}/thumb/${thumbSize}` : img.remote_url;
        }
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
