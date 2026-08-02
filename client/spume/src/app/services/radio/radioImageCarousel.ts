// opens the shared image carousel for the currently-playing radio track,
// gathering every "original" image from the song, its album, and its
// artist — not just the tiny (~96px) inline preview used for the live
// control-channel payload (see grimoire's PublicNowPlaying.art_thumb_b64
// and the thumbnail-preferring resolution order in radio/art.rs, both
// deliberately small since that payload broadcasts on every track change
// to every listener).
import type { MusicDataSource } from "../../../music/data/types";
import { localDataSource } from "../../../music/data/local/localSource";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import type { Remote } from "../storage/types";
import { getRemoteById, getRemoteByPeerAddr, getTauriManagedRemote } from "../remotes/remoteManager";
import {
  resolveBlobUrl,
  usesBlobResolver,
  withThumbSuffix,
} from "../../../music/services/storage/blobResolver";
import { resolveLocalBlobUrl } from "../../../music/utils/images";
import {
  openImageCarouselFromResolvers,
  beginImageCarouselLoading,
  endImageCarouselLoading,
  formatImageCarouselTitle,
  showImageCarousel,
  type ImageResolveResult,
} from "../../../music/hooks/modals";
import {
  radioNowPlaying,
  radioArtUrl,
  radioCurrentIsLocal,
  radioCurrentRemoteServerId,
  radioCurrentPeerAddr,
} from "./radioService";

async function resolveRadioRemote(): Promise<Remote | null> {
  if (radioCurrentIsLocal()) {
    return await getTauriManagedRemote();
  }
  const remoteId = radioCurrentRemoteServerId();
  if (remoteId) {
    const remote = await getRemoteById(remoteId);
    if (remote) return remote;
  }
  const peerAddr = radioCurrentPeerAddr();
  return peerAddr ? (await getRemoteByPeerAddr(peerAddr)) ?? null : null;
}

export async function openRadioImageCarousel(): Promise<void> {
  const np = radioNowPlaying();
  const songId = np?.song_id?.trim();
  const title = formatImageCarouselTitle(np?.title);
  const fallbackArt = radioArtUrl();

  if (!songId) {
    if (fallbackArt) showImageCarousel({ images: [{ url: fallbackArt }], title });
    return;
  }

  beginImageCarouselLoading();

  const remote = await resolveRadioRemote();
  const localSession = radioCurrentIsLocal();
  const ds: MusicDataSource | null = remote
    ? new RemoteMusicDataSource(remote)
    : localSession
      ? localDataSource
      : null;

  type ImageItem = { blobId?: string; url?: string; serverId?: string; localBlobId?: string };
  const seen = new Set<string>();
  const imageItems: ImageItem[] = [];
  const addImage = (img: {
    remote_blob_id?: string;
    local_blob_id?: string;
    remote_url?: string;
    remote_server_id?: string;
    blob_type: string;
  }) => {
    // only "original" (full-res) records — thumbnail/preview/waveform
    // variants render as duplicate-looking slides.
    if (img.blob_type !== "original") return;
    const key = img.remote_blob_id || img.local_blob_id || img.remote_url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    imageItems.push({
      blobId: img.remote_blob_id,
      url: img.remote_url,
      serverId: img.remote_server_id,
      localBlobId: img.local_blob_id,
    });
  };

  if (ds) {
    try {
      const song = await ds.getSongById(songId);
      if (song) {
        for (const img of song.images ?? []) addImage(img);
        for (const img of song.album_images ?? []) addImage(img);
        for (const img of song.artist_images ?? []) addImage(img);

        // hydrate from the canonical album/artist records — song rows
        // often only carry the song's own image, not the full gallery.
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
      }
    } catch {
      // best-effort — fall through to whatever we already have
    }
  }

  if (imageItems.length === 0) {
    endImageCarouselLoading();
    if (fallbackArt) showImageCarousel({ images: [{ url: fallbackArt }], title });
    return;
  }

  const firstWithServerId = imageItems.find((item) => item.serverId);
  const needsResolution = firstWithServerId
    ? await usesBlobResolver(firstWithServerId.serverId!)
    : false;

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
    // plain http remote: a small server-generated thumbnail variant is
    // cheap here, unlike the p2p/tauri blob-resolver path above.
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
    { title, entityLabel: np?.title ?? "this station" }
  );
}
