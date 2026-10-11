// shared "full page background image" hook. resolves whatever blob/URL
// shape an entity's primary image carries (local blob id, remote blob id
// via a transport-based remote, or a plain http(s) URL) and publishes it
// to the app-wide background-image service (the blurred backdrop rendered
// by AppLayout behind a detail view), clearing it on unmount - which
// covers both deselecting the entity and navigating away.
//
// entity-specific wrappers (usePlaylistBackgroundImage,
// useVideoSeriesBackgroundImage, ...) only map their own image fields
// onto a `BackgroundImageSource`; all resolution logic lives here.
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { setBackgroundImage, clearBackgroundImage } from "../services/backgroundImage";
import { getCurrentRemote } from "../../music/data";
import { getBlobObjectURL } from "../../music/services/storage/blobs";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface BackgroundImageSource {
  /** already-resolved or plain http(s)/blob/freqhole url */
  remoteUrl?: string | null;
  /** blob id in local (browser/opfs) storage */
  localBlobId?: string | null;
  /** blob id on the remote, resolved through the transport for
   *  p2p / charnel-managed remotes */
  remoteBlobId?: string | null;
  /** which remote `remoteBlobId` lives on. defaults to the current remote. */
  remoteServerId?: string | null;
}

export interface BackgroundImageOptions {
  /** opacity of the dark overlay drawn over the image (default 0.6) */
  overlayOpacity?: number;
}

export function useBackgroundImageSource(
  source: Accessor<BackgroundImageSource | null>,
  options: BackgroundImageOptions = {}
) {
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<string | null>(null);

  // resolve blob URLs for the background image (convert blob IDs to actual URLs)
  createEffect(() => {
    const src = source();
    const url = src?.remoteUrl || src?.localBlobId || null;
    const remote = getCurrentRemote();

    // NOTE: don't manually revoke blob URLs - the blob URL cache systems
    // (BLOB_URL_CACHE and blobResolver's activeBlobUrls) manage URL lifecycles.
    // manually revoking causes "WebKitBlobResource error 1" when cached URLs
    // are reused elsewhere in the app.

    if (!src || !url) {
      setBackgroundImageUrl(null);
      return;
    }

    // check if this is a tauri-managed or P2P remote (needs blob resolution)
    const isTransportBased =
      remote &&
      (remote.transport_type === "wasm" ||
        remote.transport_type === "app" ||
        remote.is_charnel_managed);
    const serverId = src.remoteServerId || remote?.remote_id;

    // for transport-based remotes, always use resolveBlobUrl with blob ID
    if (isTransportBased && src.remoteBlobId && serverId) {
      resolveBlobUrl(src.remoteBlobId, serverId, "image")
        .then((objectUrl) => {
          setBackgroundImageUrl(objectUrl);
        })
        .catch(() => {
          setBackgroundImageUrl(null);
        });
      return;
    }

    // if it's already a URL (http/https/blob/freqhole), use it directly
    if (url.startsWith("http") || url.startsWith("blob:") || url.startsWith("freqhole://")) {
      setBackgroundImageUrl(url);
      return;
    }

    // otherwise it's a blob ID, need to resolve it to a blob URL
    // no remote = local mode, resolve from local storage
    if (!remote) {
      if (src.localBlobId) {
        getBlobObjectURL(src.localBlobId).then((objectUrl) => {
          setBackgroundImageUrl(objectUrl || null);
        });
      } else {
        setBackgroundImageUrl(null);
      }
      return;
    }

    // use resolveBlobUrl for P2P/Tauri remotes, getBlobObjectURL for HTTP
    if (isTransportBased && serverId) {
      resolveBlobUrl(url, serverId, "image")
        .then((objectUrl) => {
          setBackgroundImageUrl(objectUrl);
        })
        .catch(() => {
          setBackgroundImageUrl(null);
        });
    } else {
      getBlobObjectURL(url).then((objectUrl) => {
        setBackgroundImageUrl(objectUrl || null);
      });
    }
  });

  // sync local background URL to global background service
  createEffect(() => {
    const bgUrl = backgroundImageUrl();
    if (bgUrl) {
      setBackgroundImage({ imageUrl: bgUrl, overlayOpacity: options.overlayOpacity ?? 0.6 });
    } else {
      clearBackgroundImage();
    }
  });

  onCleanup(() => {
    clearBackgroundImage();
  });
}

/** primary image if flagged, else the first one - waveforms are never a
 *  sensible full-page backdrop, so they're skipped. */
export function pickBackgroundImage(
  images: ImageMetadata[] | null | undefined
): ImageMetadata | null {
  const usable = (images ?? []).filter((img) => img.blob_type !== "waveform");
  return usable.find((img) => img.is_primary) || usable[0] || null;
}

/** background image from an entity's `ImageMetadata[]` (playlists,
 *  artists, albums - anything with an images array). */
export function useBackgroundImageFromImages(
  images: Accessor<ImageMetadata[] | null | undefined>,
  options?: BackgroundImageOptions
) {
  useBackgroundImageSource((): BackgroundImageSource | null => {
    const image = pickBackgroundImage(images());
    if (!image) return null;
    return {
      remoteUrl: image.remote_url,
      localBlobId: image.local_blob_id,
      remoteBlobId: image.remote_blob_id,
      remoteServerId: image.remote_server_id,
    };
  }, options);
}
