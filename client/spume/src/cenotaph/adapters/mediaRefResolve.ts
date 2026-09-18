// shared MediaRef -> local Song/QueuedVideo resolution: "is this already
// in my local library, and if not, pull it in from its source peer" - used
// by charnelPlaybackAdapter.ts (spume's real queue/player, the only
// playback backend now - see docs/cenotaph-player-queue-unification-plan.md
// task 2), which needs the actual domain object to hand to
// playQueue()/addToQueue().
//
// browser and charnel share the exact same shape here: query the source
// peer for the FULL song/video (`fetchFullSongFromSource`/
// `fetchFullVideoFromSource` below - the exact same `adaptSongFromAPI`/
// `client.video.queryVideos` pipeline every other remote-browsing path
// already uses, now reachable by content hash via grimoire's
// `media_blob_blake3`/`media_blob_ids` query filters), then sync via the
// real syncSongToLocal()/syncVideoToLocal() - both already branch
// internally on isCharnelMode(). this is what makes cenotaph's own
// artist/album/series image handling "just work" for free: those already
// live inside syncSongToLocal()/syncVideoToLocal()

import type { MediaRef } from "../index";
import { getClientForRemote, getLocalNodeIdAsync, isCharnelAvailable } from "../../app/api/client";
import {
  createRemote,
  getRemoteByPeerAddr,
  getTauriManagedRemote,
} from "../../app/services/remotes/remoteManager";
import { CENOTAPH_QUEUE_TRACE } from "../queueTrace";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getSongByBlake3 } from "../../music/services/storage/db/songs";
import { syncSongToLocal, type SyncableSong } from "../../music/services/sync/syncSongToLocal";
import {
  adaptSongFromAPI,
  type ApiSongQueryItem,
  type RemoteSong,
} from "../../music/data/remote/adapters";
import { getVideoByBlake3 } from "../../video/services/storage/db/videos";
import { syncVideoToLocal } from "../../video/services/sync/syncVideoToLocal";
import type { Song } from "../../music/services/storage/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { queryClient } from "../../queryClient";
import { queryKeys } from "../../music/queries/queryKeys";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import { debug, warn } from "../../utils/logger";

/** resolves `peerAddr` to a REAL, persisted `Remote` row - creating a
 * minimal one if this peer was never saved as a remote. required so every
 * existing playback/sync code path that resolves its source via
 * `getRemoteById(remote_server_id)` (a real db row by id, not an in-memory
 * object) can find it - same one-liner `AddRemoteModal.tsx` already uses
 * for pairing. per user direction: "if we have access to a remote, we
 * should have a remote entry... we need to persist the node ids somewhere"
 * - this is used for BOTH browser and charnel resolution now (there is no
 * charnel-only logic in this function at all), replacing the browser
 * path's old never-persisted `ephemeralPeerRemote()` stand-in. */
/** true when `peerAddr` is THIS device's own node id (e.g. a controller
 * telling us to pull from ourselves, or a MediaRef whose source is the
 * local library re-hosted under our own identity) - a real self-source
 * should always have already been caught by the local-library short-
 * circuit above; if it wasn't, dialing ourselves via `ensureRemoteForPeer`
 * would be wasteful (and, per docs/cenotaph-queue-ux-hardening-plan.md
 * issue 3, worried the user - "i'm a little nervous that the cenotaph
 * player still doesn't know if queue items are form it's own node id").
 * checked explicitly, rather than only relying on the local short-circuit
 * accidentally covering it, so a miss is a loud, traceable signal instead
 * of a silent unnecessary network round trip. */
async function isSelfPeerAddr(peerAddr: string): Promise<boolean> {
  const selfId = await getLocalNodeIdAsync();
  return !!selfId && selfId === peerAddr;
}

async function ensureRemoteForPeer(peerAddr: string): Promise<Remote> {
  const existing = await getRemoteByPeerAddr(peerAddr);
  if (existing) return existing;
  try {
    return await createRemote({ peer_addr: peerAddr, allowMissingServerInfo: true });
  } catch (err) {
    // lost a create race (or createRemote's own dedup check beat us to it)
    // - re-check rather than failing the whole resolve over it.
    const retry = await getRemoteByPeerAddr(peerAddr);
    if (retry) return retry;
    throw err;
  }
}

/** queries `remote` (the item's own source peer) for the full song behind
 * `blake3` via grimoire's `media_blob_blake3` filter - the SAME
 * `adaptSongFromAPI` result shape (real `artist_id`/`album_id`, and real
 * `images`/`album_images`/`artist_images` collections) every other
 * remote-browsing/sync path already gets from `client.music.querySongs`.
 * `null` when the source has nothing for this hash, or is unreachable -
 * callers fall back to a thinner, MediaRef-only object in that case. */
async function fetchFullSongFromSource(remote: Remote, blake3: string): Promise<RemoteSong | null> {
  try {
    const client = await getClientForRemote(remote);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { media_blob_blake3: [blake3] },
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });
    if (!result.success || result.data.items.length === 0) return null;
    return adaptSongFromAPI(
      result.data.items[0] as unknown as ApiSongQueryItem,
      remote.base_url ?? "",
      remote.remote_id
    );
  } catch (err) {
    warn("mediaRefResolve", `full song fetch failed for ${blake3.slice(0, 8)}...:`, err);
    return null;
  }
}

/** video counterpart of `fetchFullSongFromSource()` above. `videoz` has no
 * denormalized blake3 column the way `song_query_view` does, so this is a
 * two-step lookup: resolve `blake3` to a `media_blob_id` via the existing
 * `blob_metadata_by_blake3` route, then filter `query_videos` by it - same
 * full `Video` shape (series/season ids, `images`) `RemoteVideoDataSource`
 * already returns for every other video-browsing path. */
async function fetchFullVideoFromSource(
  remote: Remote,
  blake3: string
): Promise<QueuedVideo | null> {
  try {
    const client = await getClientForRemote(remote);
    const metaResult = await client.music.blobMetadataByBlake3({ blake3 });
    if (!metaResult.success) return null;
    const result = await client.video.queryVideos({
      params: {
        q: null,
        search_fields: null,
        filters: { media_blob_ids: [metaResult.data.id] },
        sort_by: null,
        sort_direction: null,
        limit: 1,
        offset: null,
        user_id: null,
        favorites_only: null,
        min_rating: null,
        mb_lookup_status: null,
        pending_review: null,
        caller_is_admin: null,
      },
      series_id: null,
      season_id: null,
      unassigned: false,
    });
    if (!result.success || result.data.items.length === 0) return null;
    return {
      ...result.data.items[0],
      source_type: "remote",
      remote_server_id: remote.remote_id,
      opfs_path: null,
      poster_opfs_path: null,
    } as unknown as QueuedVideo;
  } catch (err) {
    warn("mediaRefResolve", `full video fetch failed for ${blake3.slice(0, 8)}...:`, err);
    return null;
  }
}

/** reads back a just-synced song from charnel's own local grimoire, via
 * the `song_ids` filter - the id `syncSongToLocal`'s charnel branch just
 * returned is grimoire's own real db row id, so this is a plain id lookup
 * (not the new `media_blob_blake3` filter `fetchFullSongFromSource` above
 * uses - that's for the SOURCE peer, before anything local exists yet). */
async function getLocalSongById(songId: string): Promise<Song | null> {
  const local = await getTauriManagedRemote();
  if (!local) return null;
  try {
    const client = await getClientForRemote(local);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { song_ids: [songId] },
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });
    if (!result.success || result.data.items.length === 0) return null;
    return adaptSongFromAPI(
      result.data.items[0] as unknown as ApiSongQueryItem,
      local.base_url ?? "",
      local.remote_id
    );
  } catch (err) {
    warn("mediaRefResolve", `local read-back failed for synced song ${songId}:`, err);
    return null;
  }
}

/** video counterpart of `getLocalSongById()` above - uses the existing
 * single-video fetch (`client.video.getVideo({ id })`, same one
 * `remoteSource.ts`'s `getVideoById()` already uses) rather than a query
 * filter - grimoire's `query_videos` has no id-list filter to reuse here. */
async function getLocalVideoById(videoId: string): Promise<QueuedVideo | null> {
  const local = await getTauriManagedRemote();
  if (!local) return null;
  try {
    const client = await getClientForRemote(local);
    const result = await client.video.getVideo({ id: videoId });
    if (!result.success) return null;
    return {
      ...result.data,
      source_type: "remote",
      remote_server_id: local.remote_id,
      opfs_path: null,
      poster_opfs_path: null,
    } as unknown as QueuedVideo;
  } catch (err) {
    warn("mediaRefResolve", `local read-back failed for synced video ${videoId}:`, err);
    return null;
  }
}

/** resolves `item` to a local `Song`, syncing it in from its source peer
 * first if not already in the local library. `null` on any failure
 * (unreachable source, no metadata there, sync error). same shape for
 * both browser and charnel builds - only the final "read the persisted
 * row back" step differs (browser: IDB; charnel: no local IDB, re-query
 * the tauri-managed remote via `song_ids`). */
export async function resolveMediaRefToSong(item: MediaRef): Promise<Song | null> {
  const hashPrefix = item.blake3_hash.slice(0, 8);
  debug(
    "mediaRefResolve",
    `${CENOTAPH_QUEUE_TRACE} resolveMediaRefToSong start: hash=${hashPrefix}... title=${item.title ?? "(none)"} source_peer_addr=${item.source_peer_addr}`
  );

  // browser-only local-library short-circuit: a real IDB lookup by blake3
  // (already indexed, no new grimoire plumbing needed here - see
  // docs/cenotaph-migration-plan.md phase 3's "step 0").
  if (!isCharnelAvailable()) {
    const existing = await getSongByBlake3(item.blake3_hash);
    if (existing) {
      debug(
        "mediaRefResolve",
        `song ${hashPrefix}...: already in local library, using it directly`
      );
      return existing;
    }
  } else {
    // charnel counterpart of the browser short-circuit above: the same
    // `media_blob_blake3` query filter `fetchFullSongFromSource` uses for
    // the SOURCE peer, pointed at the local tauri-managed grimoire instead
    // - avoids the source-peer round trip, the per-image inline-base64
    // fetch, and the sync IPC call entirely for a song already synced, so
    // a repeatedly-requeued already-synced song costs nothing over the
    // network on every replay.
    const local = await getTauriManagedRemote();
    if (local) {
      const existing = await fetchFullSongFromSource(local, item.blake3_hash);
      if (existing) {
        debug(
          "mediaRefResolve",
          `song ${hashPrefix}...: already synced locally (charnel), using it directly`
        );
        return existing;
      }
    }
  }

  if (await isSelfPeerAddr(item.source_peer_addr)) {
    warn(
      "mediaRefResolve",
      `${CENOTAPH_QUEUE_TRACE} song ${hashPrefix}...: source_peer_addr is THIS device's own node id, but it wasn't found in the local library above - refusing to dial myself, treating as unresolved`
    );
    return null;
  }

  try {
    debug(
      "mediaRefResolve",
      `${CENOTAPH_QUEUE_TRACE} song ${hashPrefix}...: dialing source peer ${item.source_peer_addr}`
    );
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    // prefer the FULL song from the source peer (real artist_name/
    // album_title/images/album_images/artist_images - the exact same
    // `adaptSongFromAPI` result every other remote-browsing/sync path
    // already uses) - falls back to a thin, MediaRef-only object (title/
    // artist strings, single artwork url) only when the source is
    // unreachable or has nothing for this hash, so a queue push still
    // isn't blocked entirely by a flaky/offline peer.
    const full = await fetchFullSongFromSource(remote, item.blake3_hash);
    const artworkUrl = item.artwork_full_url ?? item.artwork_thumb_url;
    // `RemoteSong.remote_server_id` is typed `string | null` (inherited
    // from `Song`'s broader local-or-remote union) even though
    // `adaptSongFromAPI` always sets it to a real string - safe to assert
    // here rather than widen `SyncableSong`'s own (correctly strict) type.
    const syncableSong: SyncableSong = (full as SyncableSong | null) ?? {
      // MediaRef has no sha256 of its own. browser-mode sync uses this as
      // its local IDB primary key (never sent anywhere for verification),
      // so blake3 is a fine stand-in there - but charnel mode forwards it
      // straight to grimoire's sync_song_by_blake3, which used to pass it
      // on unconditionally as a "verify the download against this sha256"
      // check - the blake3 hash re-used as a fake sha256 could never match
      // the real downloaded file's actual sha256, so every charnel pull
      // failed with a bogus Sha256Mismatch. an empty string tells grimoire
      // this is genuinely unknown (skip that check, trust iroh-blobs' own
      // blake3-verified streaming instead - see sync_song_by_blake3's own
      // handling of an empty `req.sha256`).
      sha256: isCharnelAvailable() ? "" : item.blake3_hash,
      media_blob_id: item.blake3_hash,
      title: item.title ?? "untitled",
      artist_name: item.artist ?? "unknown artist",
      album_title: "unknown album",
      track_number: 0,
      disc_number: 1,
      duration_seconds: item.duration_ms ? item.duration_ms / 1000 : 0,
      remote_server_id: remote.remote_id,
      blake3: item.blake3_hash,
      // artwork IS carried on the wire even in this thin fallback
      // (already resolved by the controller via the same
      // `getSongDisplayImages()`/`pickBestImage()` priority chain every
      // other song image uses - see `playerQueuePush.ts`'s
      // `resolveArtwork`) - `syncSongToLocal.ts`'s `inlineRawUrlForSync`
      // handles a plain url/data-url with no blob id.
      images: artworkUrl
        ? [{ remote_url: artworkUrl, is_primary: true, blob_type: "thumbnail" }]
        : undefined,
    };

    const syncResult = await syncSongToLocal(syncableSong, undefined, remote);
    if (!syncResult.success) {
      warn("mediaRefResolve", `sync-to-local failed for ${hashPrefix}...: ${syncResult.error}`);
      return null;
    }

    if (isCharnelAvailable()) {
      // charnel's SyncResult.localSongId is the real grimoire db row id
      // (see syncSongViaLocalGrimoire) - not blake3/sha256.
      return syncResult.localSongId ? await getLocalSongById(syncResult.localSongId) : null;
    }

    // so the local library browsing views (which cache via solid-query,
    // not a live IDB query) actually show what was just synced in.
    void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
    return (await getSongByBlake3(item.blake3_hash)) ?? null;
  } catch (err) {
    warn("mediaRefResolve", `song resolve threw for ${hashPrefix}...:`, err);
    return null;
  }
}

/** video counterpart of `resolveMediaRefToSong()` above - same shape. */
export async function resolveMediaRefToVideo(item: MediaRef): Promise<QueuedVideo | null> {
  const hashPrefix = item.blake3_hash.slice(0, 8);
  debug(
    "mediaRefResolve",
    `${CENOTAPH_QUEUE_TRACE} resolveMediaRefToVideo start: hash=${hashPrefix}... title=${item.title ?? "(none)"} source_peer_addr=${item.source_peer_addr}`
  );

  if (!isCharnelAvailable()) {
    const existing = await getVideoByBlake3(item.blake3_hash);
    if (existing) {
      debug(
        "mediaRefResolve",
        `video ${hashPrefix}...: already in local library, using it directly`
      );
      return existing as unknown as QueuedVideo;
    }
  } else {
    // charnel counterpart of the browser short-circuit above - see
    // resolveMediaRefToSong()'s identical short-circuit for why.
    const local = await getTauriManagedRemote();
    if (local) {
      const existing = await fetchFullVideoFromSource(local, item.blake3_hash);
      if (existing) {
        debug(
          "mediaRefResolve",
          `video ${hashPrefix}...: already synced locally (charnel), using it directly`
        );
        return { ...existing, blake3: item.blake3_hash };
      }
    }
  }

  if (await isSelfPeerAddr(item.source_peer_addr)) {
    warn(
      "mediaRefResolve",
      `${CENOTAPH_QUEUE_TRACE} video ${hashPrefix}...: source_peer_addr is THIS device's own node id, but it wasn't found in the local library above - refusing to dial myself, treating as unresolved`
    );
    return null;
  }

  try {
    debug(
      "mediaRefResolve",
      `${CENOTAPH_QUEUE_TRACE} video ${hashPrefix}...: dialing source peer ${item.source_peer_addr}`
    );
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    // prefer the FULL video from the source peer (real series_id/
    // season_id/images/description - the same shape `RemoteVideoDataSource`
    // already returns for every other video-browsing path) - falls back to
    // a thin, MediaRef-only object only when the source is unreachable or
    // has nothing for this hash.
    const full = await fetchFullVideoFromSource(remote, item.blake3_hash);
    const queuedVideo: QueuedVideo = full
      ? // grimoire's wire `Video` type has no `blake3` field at all (see
        // the charnel-branch comment below) - re-attach the hash we
        // already know from the wire `MediaRef` so `syncVideoViaCharnel`'s
        // "prefer an already-known hash" optimization applies here too.
        { ...full, blake3: item.blake3_hash }
      : {
          id: item.blake3_hash,
          content_type: "movie",
          title: item.title ?? "untitled",
          media_blob_id: item.blake3_hash,
          duration_seconds: item.duration_ms ? item.duration_ms / 1000 : null,
          created_at: Date.now(),
          updated_at: Date.now(),
          source_type: "remote",
          remote_server_id: remote.remote_id,
          opfs_path: null,
          poster_opfs_path: null,
          blake3: item.blake3_hash,
        };

    const syncResult = await syncVideoToLocal(queuedVideo, remote);
    if (!syncResult.success) {
      warn(
        "mediaRefResolve",
        `video sync-to-local failed for ${hashPrefix}...: ${syncResult.error}`
      );
      return null;
    }

    if (isCharnelAvailable()) {
      if (!syncResult.videoId) return null;
      const local = await getLocalVideoById(syncResult.videoId);
      // grimoire's wire `Video` type has no `blake3` field at all (unlike
      // `Song`, which does carry one) - `getLocalVideoById`'s read-back
      // can never recover it, so it must be re-attached here from the
      // wire `MediaRef`'s own value. without this, every charnel-resolved
      // video silently lost its content hash, breaking both
      // controller-side queue drain and this player's own already-queued
      // dedup (`currentQueueHashes()` in `charnelPlaybackAdapter.ts`),
      // since both match by `mediaItemBlake3()`.
      return local ? { ...local, blake3: item.blake3_hash } : null;
    }

    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    return ((await getVideoByBlake3(item.blake3_hash)) as unknown as QueuedVideo) ?? null;
  } catch (err) {
    warn("mediaRefResolve", `video resolve threw for ${hashPrefix}...:`, err);
    return null;
  }
}
