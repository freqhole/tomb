// syncs the selected playlist's primary image into the app-wide
// background image (the blurred backdrop behind the detail view) -
// extracted out of PlaylistDetailPanel.tsx to keep that file under the
// project's file-size budget. purely a side-effect hook: resolves
// whatever blob/URL shape the primary image carries (local blob id,
// remote blob id via a transport-based remote, or a plain http(s) URL)
// and pushes it to the shared background-image service, clearing it on
// unmount (covers both deselecting this playlist and navigating away).
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { setBackgroundImage, clearBackgroundImage } from "../../../app/services/backgroundImage";
import { getCurrentRemote } from "../../data";
import { getBlobObjectURL } from "../../services/storage/blobs";
import { resolveBlobUrl } from "../../services/storage/blobResolver";
import type { Playlist } from "../../services/storage/types";

export function usePlaylistBackgroundImage(playlist: Accessor<Playlist | null>) {
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<string | null>(null);

  // get the primary image metadata for selected playlist
  const primaryImageMeta = () => {
    const pl = playlist();
    if (!pl?.images?.length) return null;
    return pl.images.find((img) => img.is_primary) || pl.images[0];
  };

  // construct thumbnail URL for selected playlist
  const thumbnailUrl = () => {
    const imageMeta = primaryImageMeta();
    if (imageMeta) {
      return imageMeta.remote_url || imageMeta.local_blob_id || null;
    }
    return null;
  };

  // resolve blob URLs for background image (convert blob IDs to actual URLs)
  createEffect(() => {
    const imageMeta = primaryImageMeta();
    const url = thumbnailUrl();
    const remote = getCurrentRemote();

    // NOTE: don't manually revoke blob URLs - the blob URL cache systems
    // (BLOB_URL_CACHE and blobResolver's activeBlobUrls) manage URL lifecycles.
    // manually revoking causes "WebKitBlobResource error 1" when cached URLs
    // are reused elsewhere in the app.

    if (!url) {
      setBackgroundImageUrl(null);
      return;
    }

    // check if this is a tauri-managed or P2P remote (needs blob resolution)
    const isTransportBased =
      remote &&
      (remote.transport_type === "wasm" ||
        remote.transport_type === "app" ||
        remote.is_charnel_managed);

    // for transport-based remotes, always use resolveBlobUrl with blob ID
    if (isTransportBased && imageMeta?.remote_blob_id) {
      resolveBlobUrl(imageMeta.remote_blob_id, remote.remote_id, "image")
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
      // check for local_blob_id first (synced playlist images)
      const localBlobId = imageMeta?.local_blob_id;
      if (localBlobId) {
        getBlobObjectURL(localBlobId).then((objectUrl) => {
          setBackgroundImageUrl(objectUrl || null);
        });
      } else {
        setBackgroundImageUrl(null);
      }
      return;
    }

    // use resolveBlobUrl for P2P/Tauri remotes, getBlobObjectURL for HTTP
    if (isTransportBased) {
      resolveBlobUrl(url, remote.remote_id, "image")
        .then((objectUrl) => {
          setBackgroundImageUrl(objectUrl);
        })
        .catch(() => {
          setBackgroundImageUrl(null);
        });
    } else {
      getBlobObjectURL(url).then((objectUrl) => {
        if (objectUrl) {
          setBackgroundImageUrl(objectUrl);
        } else {
          setBackgroundImageUrl(null);
        }
      });
    }
  });

  // sync local background URL to global background service
  createEffect(() => {
    const bgUrl = backgroundImageUrl();
    if (bgUrl) {
      setBackgroundImage({ imageUrl: bgUrl, overlayOpacity: 0.6 });
    } else {
      clearBackgroundImage();
    }
  });

  onCleanup(() => {
    // covers both deselecting this playlist (this panel unmounts) and
    // navigating away from the view entirely.
    clearBackgroundImage();
  });
}
