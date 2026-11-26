import { appState, applyHistoryArtwork } from "../storage/db";
import { mediaItemQueueEntryId, type MediaItem } from "../storage/mediaItem";
import { getRemoteById } from "../remotes/remoteManager";
import { localDataSource } from "../../../music/data/local/localSource";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { getAlbumById, getArtistById } from "../../../music/services/storage/db";
import { localVideoDataSource } from "../../../video/data/local/localSource";
import { RemoteVideoDataSource } from "../../../video/data/remote/remoteSource";
import { generateUUID } from "../../../utils/uuid";
import { error as errorLog } from "../../../utils/logger";

export function newHistoryQueueItems(items: MediaItem[]): MediaItem[] {
  return items.map((item) => item.kind === "song"
    ? { kind: "song", song: { ...item.song, queue_entry_id: generateUUID() } }
    : { kind: "video", video: { ...item.video, queue_entry_id: generateUUID() } });
}

export function startHistoryArtworkRefresh(items: MediaItem[]): void {
  void refreshHistoryArtwork(items).catch((error) =>
    errorLog("queue.history", "artwork refresh failed:", error)
  );
}

// fetch in bounded batches after queueing, without delaying playback.
export async function refreshHistoryArtwork(items: MediaItem[]): Promise<void> {
  const ids = new Set(items.map(mediaItemQueueEntryId));
  const snapshot = (appState()?.queue ?? []).filter((item) => ids.has(mediaItemQueueEntryId(item)));
  const updates = new Map<string, { before: MediaItem; after: MediaItem }>();
  const remoteCache = new Map<string, ReturnType<typeof getRemoteById>>();
  const albumCache = new Map<string, ReturnType<typeof getAlbumById>>();
  const artistCache = new Map<string, ReturnType<typeof getArtistById>>();
  const remoteFor = (id: string) => {
    let remote = remoteCache.get(id);
    if (!remote) {
      remote = getRemoteById(id);
      remoteCache.set(id, remote);
    }
    return remote;
  };
  const jobs: Array<() => Promise<void>> = [];
  const groups = new Map<string, Array<Extract<MediaItem, { kind: "song" }>>>();
  for (const item of snapshot) {
    if (item.kind === "song") {
      const source = item.song.source_type === "remote" ? item.song.remote_server_id : "local";
      if (!source) {
        errorLog("queue.history", "cannot refresh artwork: song remote is missing", item.song.id);
        continue;
      }
      const group = groups.get(source) ?? [];
      group.push(item);
      groups.set(source, group);
    } else {
      jobs.push(async () => {
        const remoteId = item.video.source_type === "remote" ? item.video.remote_server_id : undefined;
        if (item.video.source_type === "remote" && !remoteId) {
          throw new Error(`video ${item.video.id} has no source remote`);
        }
        const remote = remoteId ? await remoteFor(remoteId) : undefined;
        if (remoteId && !remote) throw new Error(`remote ${remoteId} not found`);
        const source = remote ? new RemoteVideoDataSource(remote) : localVideoDataSource;
        const fresh = await source.getVideoById(item.video.id);
        if (!fresh) throw new Error(`video ${item.video.id} not found`);
        let images = fresh.images;
        if (!remote) {
          const localImages = await localVideoDataSource.getEntityImages({
            entityType: "video",
            entityId: item.video.id,
          });
          images = localImages.flatMap((image) => {
            const blobId = image.local_blob_id ?? image.remote_blob_id;
            return blobId ? [{
              blob_id: blobId,
              blob_type: image.blob_type,
              is_primary: Number(image.is_primary),
              remote_server_id: image.remote_server_id,
            }] : [];
          });
        }
        if (!images?.some((image) => image.blob_type === "waveform")) {
          const localWaveforms = item.video.images?.filter((image) =>
            image.blob_type === "waveform" && image.remote_server_id &&
            image.remote_server_id !== item.video.remote_server_id
          ) ?? [];
          if (localWaveforms.length) images = [...(images ?? []), ...localWaveforms];
        }
        const id = mediaItemQueueEntryId(item);
        if (id) updates.set(id, {
          before: item,
          after: { kind: "video", video: { ...item.video, images, poster_blob_id: fresh.poster_blob_id,
            poster_opfs_path: fresh.poster_opfs_path } },
        });
      });
    }
  }
  for (const [sourceId, songs] of groups) {
    for (let offset = 0; offset < songs.length; offset += 50) {
      const batch = songs.slice(offset, offset + 50);
      jobs.push(async () => {
        const remote = sourceId === "local" ? undefined : await remoteFor(sourceId);
        if (sourceId !== "local" && !remote) throw new Error(`remote ${sourceId} not found`);
        const source = remote ? new RemoteMusicDataSource(remote) : localDataSource;
        const freshSongs = await source.getSongsByIds(batch.map((item) => item.song.id));
        const freshById = new Map(freshSongs.map((song) => [song.id, song]));
        const missingIds = batch.filter((item) => !freshById.has(item.song.id)).map((item) => item.song.id);
        if (missingIds.length > 0) {
          errorLog("queue.history", "artwork refresh could not find songs:", sourceId, missingIds);
        }
        for (const item of batch) {
          const fresh = freshById.get(item.song.id);
          const id = mediaItemQueueEntryId(item);
          if (!fresh || !id) continue;
          let albumImages = fresh.album_images;
          let artistImages = fresh.artist_images;
          if (!remote) {
            if (fresh.album_id) {
              let album = albumCache.get(fresh.album_id);
              if (!album) {
                album = getAlbumById(fresh.album_id);
                albumCache.set(fresh.album_id, album);
              }
              albumImages = (await album)?.images;
            }
            if (fresh.artist_id) {
              let artist = artistCache.get(fresh.artist_id);
              if (!artist) {
                artist = getArtistById(fresh.artist_id);
                artistCache.set(fresh.artist_id, artist);
              }
              artistImages = (await artist)?.images;
            }
          }
          const localWaveforms = item.song.images?.filter((image) =>
            image.blob_type === "waveform" && image.remote_server_id &&
            image.remote_server_id !== item.song.remote_server_id
          ) ?? [];
          const images = !fresh.images?.some((image) => image.blob_type === "waveform") && localWaveforms.length
            ? [...(fresh.images ?? []), ...localWaveforms]
            : fresh.images;
          updates.set(id, { before: item, after: { kind: "song", song: {
            ...item.song,
            images,
            album_images: albumImages,
            artist_images: artistImages,
          } } });
        }
      });
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await job();
      } catch (error) {
        errorLog("queue.history", "artwork refresh failed:", error);
      }
    }
  }));
  await applyHistoryArtwork(updates);
}
