// playlist image-carousel state + the "view all images" resolution
// logic - extracted out of PlaylistDetailPanel.tsx to keep that file
// under the project's file-size budget.
import { createSignal, type Accessor } from "solid-js";
import { toast } from "../../../components/feedback/Toast";
import { getBlobObjectURL } from "../../services/storage/blobs";
import {
  resolveBlobUrl,
  isValidHttpUrl,
  usesBlobResolver,
  withThumbSuffix,
} from "../../services/storage/blobResolver";
import type { CarouselSlide } from "../../hooks/modals";
import type { Playlist, ImageMetadata } from "../../services/storage/types";
import type { Song } from "../../data/types";

export function usePlaylistImageCarousel(
  playlist: Accessor<Playlist | null>,
  playlistSongs: Accessor<Song[]>
) {
  const [showImageCarousel, setShowImageCarousel] = createSignal(false);
  const [carouselImages, setCarouselImages] = createSignal<CarouselSlide[]>([]);
  const [carouselInitialIndex, setCarouselInitialIndex] = createSignal(0);
  // true while handleOpenImageCarousel is still resolving image urls —
  // shows a spinner on the trigger button instead of an unresponsive click.
  const [carouselLoading, setCarouselLoading] = createSignal(false);

  // open image carousel with all playlist and song images
  const handleOpenImageCarousel = async () => {
    const pl = playlist();
    if (!pl) return;

    // give immediate feedback — resolving images (local OPFS lookups,
    // blob-resolver/p2p calls) can take a while.
    setCarouselLoading(true);

    const songs = playlistSongs();

    // collect all images, deduplicated by whichever blob id they carry
    interface CarouselImageEntry {
      localBlobId?: string;
      remoteBlobId?: string;
      remoteServerId?: string;
      url?: string;
    }
    const imageMap = new Map<string, CarouselImageEntry>();

    const addImage = (img: ImageMetadata) => {
      if (img.blob_type === "waveform") return;
      const key = img.remote_blob_id || img.local_blob_id;
      if (!key) return;
      imageMap.set(key, {
        localBlobId: img.local_blob_id,
        remoteBlobId: img.remote_blob_id,
        remoteServerId: img.remote_server_id,
        url: img.remote_url,
      });
    };

    if (pl.images?.length) {
      for (const img of pl.images) addImage(img);
    }
    for (const song of songs) {
      if (song.images?.length) {
        for (const img of song.images) addImage(img);
      }
    }

    if (imageMap.size === 0) {
      // no images at all — a normal state for a sparse playlist, not a
      // failure, so an informational toast (no error) is enough.
      toast.info("no images available for this playlist");
      setCarouselLoading(false);
      return;
    }

    // resolve each image to a displayable URL, same priority order used
    // elsewhere in the app (see blobResolver.ts's resolveImageUrlSync /
    // MediaThumbnail's resolveImageUrl): a local blob already on this
    // device wins first (this is what makes downloaded/synced-to-local
    // images work even while viewing the local library with no remote
    // selected), then the image's own recorded remote server (not
    // necessarily whichever remote happens to be selected right now),
    // and only then a URL that's already a full http(s) address - a bare
    // relative path like "/api/blobs/{id}" (e.g. a stale reference kept
    // as a fallback from before an image was downloaded locally) is never
    // trusted directly, since it has no origin to resolve against once
    // there's no active remote/transport context.
    const resolveOne = async (entry: CarouselImageEntry): Promise<CarouselSlide | null> => {
      if (entry.localBlobId) {
        const resolved = await getBlobObjectURL(entry.localBlobId);
        if (resolved) return { url: resolved };
      }
      if (entry.remoteBlobId && entry.remoteServerId) {
        try {
          const url = await resolveBlobUrl(entry.remoteBlobId, entry.remoteServerId, "image");
          // a small server-generated thumbnail variant is only cheap to
          // fetch for plain http remotes — p2p/tauri-managed remotes
          // don't support sized variants yet and would just re-fetch the
          // same full blob under a separate cache key.
          const cheapThumb = !(await usesBlobResolver(entry.remoteServerId));
          return { url, thumbnailUrl: cheapThumb ? withThumbSuffix(url, 200) : undefined };
        } catch {
          // fall through to the URL check below
        }
      }
      if (isValidHttpUrl(entry.url)) {
        return { url: entry.url!, thumbnailUrl: withThumbSuffix(entry.url!, 200) };
      }
      return null;
    };

    // resolve every image in parallel and show the full expected slide
    // count immediately as placeholders, filling each slot in (or
    // marking it failed) as its own resolution settles — instead of
    // waiting for every image before showing anything, or only
    // discovering the total count as images trickle in.
    const entries = Array.from(imageMap.values());
    setCarouselLoading(false);
    setCarouselImages(entries.map(() => ({ url: null, thumbnailUrl: null })));
    setCarouselInitialIndex(0);
    setShowImageCarousel(true);

    let anySucceeded = false;
    await Promise.allSettled(
      entries.map(async (entry, index) => {
        let slide: CarouselSlide | null;
        try {
          slide = await resolveOne(entry);
        } catch {
          slide = null;
        }
        if (slide?.url) {
          anySucceeded = true;
          setCarouselImages((prev) => {
            const next = prev.slice();
            next[index] = slide!;
            return next;
          });
        } else {
          setCarouselImages((prev) => {
            const next = prev.slice();
            next[index] = { url: null, thumbnailUrl: null, failed: true };
            return next;
          });
        }
      })
    );

    if (!anySucceeded) {
      setShowImageCarousel(false);
      toast.error("couldn't load any images for this playlist");
    }
  };

  return {
    showImageCarousel,
    setShowImageCarousel,
    carouselImages,
    carouselInitialIndex,
    carouselLoading,
    handleOpenImageCarousel,
  };
}
