// player-bar image carousel construction - resolves a song's own images plus
// its album/artist images into a deduplicated, resolver-based image carousel.
// extracted out of AppLayout.tsx's player-image click handler since it's a
// pure function of the clicked song (no other component state needed).
import { getDataSource } from "../../music/data";
import {
  resolveBlobUrl,
  usesBlobResolver,
  withThumbSuffix,
} from "../../music/services/storage/blobResolver";
import { resolveLocalBlobUrl } from "../../music/utils/images";
import type { Song } from "../../music/services/storage/types";
import {
  beginImageCarouselLoading,
  endImageCarouselLoading,
  formatImageCarouselTitle,
  openImageCarouselFromResolvers,
  type ImageResolveResult,
} from "../../music/hooks/modals";

type ImageItem = {
  blobId?: string;
  url?: string;
  serverId?: string;
  localBlobId?: string;
};

/** show a song + its album/artist images in the shared image carousel modal. */
export async function openPlayerImageCarousel(song: Song): Promise<void> {
  // give immediate feedback on click — the hydration + url-resolution
  // work below can take a while (network/p2p lookups), and without this
  // the button just looks unresponsive until everything settles.
  beginImageCarouselLoading();

  const seen = new Set<string>();
  const imageItems: ImageItem[] = [];

  const addImage = (img: {
    remote_blob_id?: string;
    local_blob_id?: string;
    remote_url?: string;
    remote_server_id?: string;
    blob_type: string;
  }) => {
    // skip waveforms (audio viz) and the size-derivative variants
    // (`thumbnail`, `preview`) — those are different blob ids that
    // visually render as the same logical image, so including them
    // produces a carousel full of duplicate-looking slides. only
    // keep `original` (full-res) records for the carousel.
    if (img.blob_type !== "original") return;
    const key = img.remote_blob_id || img.local_blob_id || img.remote_url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    imageItems.push({
      // remote blob id only — local blob ids aren't fetchable via
      // the blobResolver path (they're resolved through OPFS via
      // resolveLocalBlobUrl instead).
      blobId: img.remote_blob_id,
      url: img.remote_url,
      serverId: img.remote_server_id,
      localBlobId: img.local_blob_id,
    });
  };

  // add song images (except waveforms), deduplicate by blob_id
  if (song.images?.length) {
    for (const img of song.images) addImage(img);
  }

  // add album images (except waveforms), deduplicate by blob_id
  if (song.album_images?.length) {
    for (const img of song.album_images) addImage(img);
  }

  // add artist images too — gives the player-bar carousel full
  // context (song → album → artist art) with the same `seen` set
  // dedup'ing across all three sources.
  if (song.artist_images?.length) {
    for (const img of song.artist_images) addImage(img);
  }

  // hydrate from the canonical album + artist records. song entries
  // (especially local OPFS songs, and pre-album_images queue rows)
  // often carry only the song's own image — the album / artist may
  // have additional artwork that isn't denormalized onto the song.
  // fetching here makes the carousel reflect the full set even
  // when the song row is sparse. errors are swallowed so a failed
  // lookup doesn't kill the click.
  try {
    const ds = getDataSource();
    const tasks: Promise<void>[] = [];
    if (song.album_id && ds.getAlbums) {
      tasks.push(
        ds
          .getAlbums({ album_id: song.album_id, limit: 1 })
          .then((res) => {
            for (const img of res.items[0]?.images ?? []) addImage(img);
          })
          .catch(() => {})
      );
    }
    if (song.artist_id && ds.getArtists) {
      tasks.push(
        ds
          .getArtists({ artist_id: song.artist_id, limit: 1 })
          .then((res) => {
            for (const img of res.items[0]?.images ?? []) addImage(img);
          })
          .catch(() => {})
      );
    }
    if (tasks.length) await Promise.all(tasks);
  } catch {
    // best-effort hydration — proceed with whatever we already have
  }

  if (imageItems.length === 0) {
    // no images found at all — a normal state (many songs simply
    // have no artwork), not a failure, so clear the spinner silently.
    endImageCarouselLoading();
    return;
  }

  // check if we need blob resolution (P2P or tauri-managed)
  const firstWithServerId = imageItems.find((item) => item.serverId);
  const needsResolution = firstWithServerId
    ? await usesBlobResolver(firstWithServerId.serverId!)
    : false;

  // resolve each item's url independently so the carousel can open as
  // soon as the first one lands, instead of waiting on every image.
  const resolveOne = async (item: ImageItem): Promise<ImageResolveResult> => {
    if (needsResolution) {
      if (item.blobId && item.serverId) {
        try {
          const url = await resolveBlobUrl(item.blobId, item.serverId, "image");
          return { url };
        } catch {
          // fall through to other paths below
        }
      }
      if (item.localBlobId) {
        try {
          const url = await resolveLocalBlobUrl(item.localBlobId);
          return url ? { url } : null;
        } catch {
          /* ignore */
        }
      }
      return item.url ? { url: item.url } : null;
    }
    // mixed http remote + local: prefer remote_url (a small server-
    // generated thumbnail variant is cheap here since it's a plain
    // http remote), fall back to an OPFS-resolved object url for
    // local-only images.
    if (item.url) {
      return { url: item.url, thumbnailUrl: withThumbSuffix(item.url, 200) };
    }
    if (item.localBlobId) {
      try {
        const url = await resolveLocalBlobUrl(item.localBlobId);
        return url ? { url } : null;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  await openImageCarouselFromResolvers(
    imageItems.map((item) => () => resolveOne(item)),
    { title: formatImageCarouselTitle(song.title), entityLabel: song.title }
  );
}
