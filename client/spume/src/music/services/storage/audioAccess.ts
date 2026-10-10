// audio access abstraction - handles getting audio urls from various sources
//
// this file's own `activeBlobURLs`/`directURLSongs`/`directURLSet` are
// keyed by `songIdentityKey(song)` (sha256 || id) - the SAME key
// `appState().current_item_key` uses (written by htmlAudio.ts/
// libmpvBackend.ts, read by mediaSessionBridge.ts, playbackOrchestrator.ts,
// player.ts, queue/*, mediaItemKey, and the "currently playing" row
// highlight in VirtualSongList/PlaylistSongRow/AlbumDetailView/ArtistsView).
// this file used to maintain a SEPARATE, blake3-preferring
// `songTrackingKey(song)` for these maps - which diverged from
// `current_item_key` for a local song with a real `blake3` but no
// `sha256` (`current_item_key` fell back to `id`, this file's maps used
// `blake3`), causing `cleanupAudioURL(this.currentSongId)` to find
// nothing to clean up (a blob-URL leak). fixed by dropping the separate
// key entirely and using `songIdentityKey` throughout this file too - one
// key scheme, no possible divergence, matching the existing "never
// collide on the sha256:"" sentinel" guarantee `songIdentityKey` already
// provides (its own `id` fallback).
import { createSignal } from "solid-js";
import { getCachedBlob, preCacheBlob } from "../cache/blobCache";
import { withLoadingProgress, isSongSyncedLocally, markSongSynced } from "../download";
import { readAudioFromOPFS } from "../opfs/helpers";
import { resolveLocalAudioUrl } from "./localAudio";
import { canSyncSong, syncSongToLocal } from "../sync/syncSongToLocal";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelMode } from "../../../app/services/charnel";
import { resolveCharnelLocalBlobPath } from "../../../app/services/media/resolveCharnelLocalBlobPath";
import { songIdentityKey, syncTrackingKey, type Song } from "./types";
import { debug, warn, error as errorLog } from "../../../utils/logger";
import { resolveBlobUrl, isP2PRemote, usesBlobResolver, revokeBlobUrl } from "./blobResolver";
import type { BlobProgressCallback } from "@freqhole/api-client";

// cache of active blob urls to prevent memory leaks
// stores {url, remoteId, blobId} so we can properly cleanup from blobResolver too
// keyed by songIdentityKey(song) - see the file header comment.
const activeBlobURLs = new Map<
  string,
  { url: string; remoteId: string | null; blobId: string | null }
>();

// track songs currently playing from a direct (non-cached) remote URL
// keyed by songIdentityKey(song) -> { sourceUrl, remoteId } so
// we can swap to cached version later
const directURLSongs = new Map<string, { sourceUrl: string; remoteId: string }>();

// reactive signal tracking which songs (by songIdentityKey) are playing from a direct URL
const [directURLSet, setDirectURLSet] = createSignal<Set<string>>(new Set());

function addToDirectURLSet(key: string): void {
  setDirectURLSet((prev) => {
    const next = new Set(prev);
    next.add(key);
    return next;
  });
}

function removeFromDirectURLSet(key: string): void {
  setDirectURLSet((prev) => {
    if (!prev.has(key)) return prev;
    const next = new Set(prev);
    next.delete(key);
    return next;
  });
}

// get audio url for playback
// handles opfs, cached remote, and direct remote streaming
export async function getAudioURL(song: Song): Promise<string> {
  const key = songIdentityKey(song);
  debug("audioAccess", `getting audio url for song: ${song.title} (source: ${song.source_type})`);

  // cleanup previous url if exists
  if (activeBlobURLs.has(key)) {
    const entry = activeBlobURLs.get(key)!;
    URL.revokeObjectURL(entry.url);
    // also remove from blobResolver's store for P2P songs
    // use the stored blobId (not the tracking key) to match the cache key
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(key);
  }
  directURLSongs.delete(key);
  removeFromDirectURLSet(key);

  // local, downloaded, and synced files: read from opfs
  if (
    song.source_type === "local" ||
    song.source_type === "downloaded" ||
    song.source_type === "synced"
  ) {
    if (!song.opfs_path) {
      throw new Error(`song has no opfs path: ${key}`);
    }

    try {
      debug("audioAccess", `reading from opfs: ${song.opfs_path}`);
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(key, { url, remoteId: null, blobId: null });
      return url;
    } catch (error) {
      errorLog("audioAccess", `opfs read failed for ${key.slice(0, 8)}:`, error);
      throw new Error(`failed to read audio file from opfs`);
    }
  }

  // remote files: check cache first, then fall back to direct streaming URL
  if (song.source_type === "remote") {
    // a queue item is a snapshot taken when it was added, so a song that has
    // since been synced into the library still says "remote" here. re-read the
    // library first, otherwise playback re-fetches over the network even though
    // the file is already on disk.
    //
    // charnel mode: ask the local grimoire directly (authoritative, real fs
    // path) rather than trusting `isSongSyncedLocally`'s client-side cache -
    // that cache is only as good as every sync path's bookkeeping, and this
    // exact branch used to call `resolveLocalAudioUrl(song.sha256)` with NO
    // `localPath`, which is a guaranteed no-op in charnel mode (see
    // `localAudio.ts`) regardless of what the cache said.
    const charnelLocalPath = await resolveCharnelLocalBlobPath(song.blake3);
    if (charnelLocalPath) {
      const localUrl = await resolveLocalAudioUrl(key, charnelLocalPath);
      if (localUrl) {
        debug("audioAccess", `playing synced copy from the local library`);
        markSongSynced(syncTrackingKey(song));
        activeBlobURLs.set(key, { url: localUrl, remoteId: null, blobId: null });
        return localUrl;
      }
    } else if (!isCharnelMode() && isSongSyncedLocally(syncTrackingKey(song))) {
      // browser mode: OPFS-backed, isSongSyncedLocally is the real check.
      const localUrl = await resolveLocalAudioUrl(key);
      if (localUrl) {
        debug("audioAccess", `playing synced copy from the local library`);
        activeBlobURLs.set(key, { url: localUrl, remoteId: null, blobId: null });
        return localUrl;
      }
    }

    // sync-to-local on: the bytes belong in the library, not the api cache.
    // download once, write to the library, then play from there. falls through
    // to streaming if the sync fails so playback never hard-fails on it.
    if (getSyncQueueToLocal() && canSyncSong(song)) {
      const syncedUrl = await withLoadingProgress(key, async (onProgress) => {
        onProgress(null);
        const result = await syncSongToLocal(song, (received, total) => {
          if (total > 0) onProgress(received / total);
        });
        if (result.success) {
          const localUrl = await resolveLocalAudioUrl(key, result.localPath);
          if (localUrl) {
            debug("audioAccess", `synced "${song.title}" to the library, playing from there`);
            activeBlobURLs.set(key, { url: localUrl, remoteId: null, blobId: null });
            return localUrl;
          }
        }
        warn(
          "audioAccess",
          `sync-to-local failed for ${key.slice(0, 8)} (${result.error ?? "no local copy"}), streaming instead`
        );
        return null;
      });
      if (syncedUrl) return syncedUrl;
    }

    // check if this remote uses blobResolver (P2P or Tauri-managed)
    if (song.remote_server_id && (await usesBlobResolver(song.remote_server_id))) {
      debug("audioAccess", `using blobResolver for remote song: ${key}`);
      const remoteServerId = song.remote_server_id;

      return await withLoadingProgress(key, async (onProgress) => {
        onProgress(null); // indeterminate until we get total size
        try {
          // use blobResolver which handles P2P/Tauri transports and caching
          // pass progress callback for 0-100% loading indicator
          const blobProgress: BlobProgressCallback = (received, total) => {
            if (total > 0) {
              onProgress(received / total);
            }
          };
          // id types here:
          //   - blobId  = song.media_blob_id, the *remote's*
          //     `media_blobz.id` short pk. only valid input to
          //     `/api/blobs/{id}/*` routes on that remote.
          //   - key (songIdentityKey(song)) is this file's own tracking
          //     identity; used for loading-set / activeBlobURLs keys,
          //     never as a route param.
          // if media_blob_id is missing, bail rather than send the tracking
          // key (which would just produce "blob not found").
          const blobId = song.media_blob_id;
          if (!blobId) {
            throw new Error(`song has no media_blob_id (key=${key})`);
          }
          // pass blake3 for verified streaming via iroh-blobs.
          // pass file_size so the progress callback can report a real
          // received/total ratio (iroh-blobs streaming doesn't supply size up front).
          // pass mime_type so the assembled Blob/URL gets the right content type.
          const url = await resolveBlobUrl(
            blobId,
            remoteServerId,
            "audio",
            blobProgress,
            undefined,
            song.blake3 ?? undefined,
            song.file_size ?? undefined,
            song.mime_type ?? undefined
          );
          activeBlobURLs.set(key, { url, remoteId: remoteServerId, blobId });
          return url;
        } catch (error) {
          errorLog(
            "audioAccess",
            `blob fetch failed for ${key.slice(0, 8)} via ${remoteServerId}:`,
            error
          );
          throw new Error(`failed to fetch audio from remote`);
        }
      });
    }

    // HTTP remote: use direct URL approach
    if (!song.source_url) {
      throw new Error(`remote song has no source url: ${key}`);
    }
    if (!song.remote_server_id) {
      throw new Error(`remote song has no remote_server_id: ${key}`);
    }

    debug("audioAccess", `checking cache for remote url: ${song.source_url}`);

    // try to get from cache (keyed by remoteId + sha256 - blobCache.ts's
    // own Cache-API-backed store, a separate keying scheme from this
    // file's `activeBlobURLs`/`directURLSongs` - HTTP remotes always have
    // a real sha256 from their origin server, untouched by local-import's
    // switch to blake3, so this stays sha256-keyed on purpose)
    const cachedResponse = await getCachedBlob(song.remote_server_id, song.sha256);
    if (cachedResponse) {
      debug("audioAccess", `CACHE HIT - using cached audio for: ${song.sha256.slice(0, 8)}...`);
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      // map key is this file's own tracking key (must match the top-level
      // cleanup above); blobId stays sha256 to match getCachedBlob's key.
      activeBlobURLs.set(key, {
        url,
        remoteId: song.remote_server_id,
        blobId: song.sha256,
      });
      return url;
    }

    // not cached: return direct URL for immediate streaming
    debug("audioAccess", `CACHE MISS - streaming direct URL for: ${song.sha256.slice(0, 8)}...`);
    directURLSongs.set(key, {
      sourceUrl: song.source_url,
      remoteId: song.remote_server_id,
    });
    addToDirectURLSet(key);

    // start background caching so the song is available offline later -
    // blobCache.ts's own sha256-keyed store, see comment above.
    void preCacheBlob(song.source_url, "audio", song.remote_server_id, song.sha256);

    return song.source_url;
  }

  throw new Error(`unsupported song source type: ${song.source_type}`);
}

// check if a song is playing from a direct (non-cached) URL. `key` must
// be `songIdentityKey(song)` - this maps into `directURLSongs`, which
// `getAudioURL`/`refreshBlobURL` above populate using that same key, not
// raw `song.sha256`.
export function isPlayingDirectURL(key: string): boolean {
  return directURLSongs.has(key);
}

// reactive version for UI binding - see isPlayingDirectURL's doc comment.
export function isPlayingDirectURLReactive(key: string | undefined): boolean {
  if (!key) return false;
  return directURLSet().has(key);
}

// attempt to swap a direct-URL song to its cached version. `key` must be
// `songIdentityKey(song)` (see isPlayingDirectURL) - only ever reachable
// for HTTP-remote songs (per getAudioURL/refreshBlobURL, the only paths
// that populate `directURLSongs`), which always have a real, non-empty
// `sha256` from their origin server - so `key` and the song's real
// `sha256` are the same value here, and doubling as the blobCache.ts
// lookup key below is correct, not a shortcut.
// returns the new blob URL if swap is possible, null otherwise
export async function trySwapToCachedURL(key: string): Promise<string | null> {
  const entry = directURLSongs.get(key);
  if (!entry) return null; // not playing from direct URL

  const cached = await getCachedBlob(entry.remoteId, key);
  if (!cached) return null; // not yet cached

  const blob = await cached.blob();
  const url = URL.createObjectURL(blob);

  // cleanup old blob URL if any
  if (activeBlobURLs.has(key)) {
    const oldEntry = activeBlobURLs.get(key)!;
    URL.revokeObjectURL(oldEntry.url);
    if (oldEntry.remoteId && oldEntry.blobId) {
      revokeBlobUrl(oldEntry.blobId, oldEntry.remoteId);
    }
  }
  // for HTTP cache swap, blobId is the song's real sha256 (== key here)
  activeBlobURLs.set(key, { url, remoteId: entry.remoteId, blobId: key });
  directURLSongs.delete(key);
  removeFromDirectURLSet(key);

  debug("audioAccess", `prepared cached URL swap for song: ${key}`);
  return url;
}

// cleanup audio url for a song. `key` must be `songIdentityKey(song)` -
// activeBlobURLs is keyed by it, not raw `song.sha256`.
export function cleanupAudioURL(key: string): void {
  if (activeBlobURLs.has(key)) {
    const entry = activeBlobURLs.get(key)!;
    URL.revokeObjectURL(entry.url);
    // also remove from blobResolver's store for P2P songs
    // use the stored blobId to match the cache key
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(key);
    debug("audioAccess", `cleaned up audio url for song: ${key}`);
  }
}

// cleanup all audio urls
export function cleanupAllAudioURLs(): void {
  for (const [key, entry] of activeBlobURLs.entries()) {
    URL.revokeObjectURL(entry.url);
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    debug("audioAccess", `cleaned up audio url for song: ${key}`);
  }
  activeBlobURLs.clear();
}

// re-create a blob URL from underlying storage (OPFS or API Cache)
// used when iOS revokes blob URLs after PWA suspension
export async function refreshBlobURL(song: Song): Promise<string | null> {
  const key = songIdentityKey(song);
  debug("audioAccess", `refreshing blob URL for song: ${song.title} (source: ${song.source_type})`);

  // cleanup old blob URL if exists
  if (activeBlobURLs.has(key)) {
    const entry = activeBlobURLs.get(key)!;
    URL.revokeObjectURL(entry.url);
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(key);
  }

  // local/downloaded: re-read from OPFS
  if (song.source_type === "local" || song.source_type === "downloaded") {
    if (!song.opfs_path) {
      warn(
        "audioAccess",
        `cannot refresh: no opfs_path for ${key.slice(0, 8)} (source=${song.source_type})`
      );
      return null;
    }
    try {
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(key, { url, remoteId: null, blobId: null });
      debug("audioAccess", `refreshed blob URL from OPFS: ${key}`);
      return url;
    } catch (error) {
      errorLog("audioAccess", `opfs refresh failed for ${key.slice(0, 8)}:`, error);
      return null;
    }
  }

  // remote: try API Cache first (or use P2P resolver)
  if (song.source_type === "remote") {
    // P2P remotes: use blobResolver
    if (song.remote_server_id && (await isP2PRemote(song.remote_server_id))) {
      try {
        // `media_blob_id` is the *remote's* media_blobz.id pk - the
        // only id `/api/blobs/{id}/*` accepts. the tracking key (sha256/
        // id, see songIdentityKey) is NOT a valid route param; if
        // media_blob_id is somehow missing, bail rather than fabricate a
        // doomed call.
        const blobId = song.media_blob_id;
        if (!blobId) {
          warn("audioAccess", `cannot refresh p2p blob: no media_blob_id (key=${key.slice(0, 8)})`);
          return null;
        }
        // pass blake3 for verified streaming via iroh-blobs.
        const url = await resolveBlobUrl(
          blobId,
          song.remote_server_id,
          "audio",
          undefined,
          undefined,
          song.blake3 ?? undefined
        );
        activeBlobURLs.set(key, { url, remoteId: song.remote_server_id, blobId });
        debug("audioAccess", `refreshed blob URL from P2P: ${key}`);
        return url;
      } catch (error) {
        errorLog("audioAccess", `p2p blob refresh failed for ${key.slice(0, 8)}:`, error);
        return null;
      }
    }

    // HTTP remotes: use cache (blobCache.ts's own sha256-keyed store - see
    // getAudioURL's identical comment for why this stays sha256, not key)
    if (song.source_url && song.remote_server_id) {
      const cachedResponse = await getCachedBlob(song.remote_server_id, song.sha256);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const url = URL.createObjectURL(blob);
        activeBlobURLs.set(key, {
          url,
          remoteId: song.remote_server_id,
          blobId: song.sha256,
        });
        debug("audioAccess", `refreshed blob URL from API Cache: ${key}`);
        return url;
      }
      // not in cache - fall back to remote URL (browser will handle it)
      debug("audioAccess", `not in cache, falling back to remote URL: ${song.source_url}`);
      directURLSongs.set(key, {
        sourceUrl: song.source_url,
        remoteId: song.remote_server_id,
      });
      addToDirectURLSet(key);
      return song.source_url;
    }
  }

  errorLog(
    "audioAccess",
    `cannot refresh: unsupported source type "${song.source_type}" for ${key.slice(0, 8)}`
  );
  return null;
}
