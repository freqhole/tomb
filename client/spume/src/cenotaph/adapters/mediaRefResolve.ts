// shared MediaRef -> local Song/QueuedVideo resolution: "is this already
// in my local library, and if not, pull it in from its source peer" - used
// by charnelPlaybackAdapter.ts (spume's real queue/player, the only
// playback backend now - see docs/cenotaph-player-queue-unification-plan.md
// task 2), which needs the actual domain object to hand to
// playQueue()/addToQueue().
//
// browser and charnel share the exact same shape here (query the source
// peer for full metadata, adapt, sync via the real syncSongToLocal()/
// syncVideoToLocal() - both already branch internally on isCharnelMode())
// - see docs/cenotaph-player-queue-unification-plan.md task 3. this
// supersedes the older, thinner "no sync, defer to play-time" charnel
// design recorded in docs/cenotaph-charnel-native-playback-rewire-plan.md's
// phase 1 - per explicit user direction this session, a queued item should
// always be persisted into the real local library right away, not carry
// placeholder metadata (`artist_name: "unknown artist"`, etc.) indefinitely.

import type { MediaRef } from "../index";
import { getClientForRemote, isCharnelAvailable } from "../../app/api/client";
import {
  createRemote,
  getRemoteByPeerAddr,
  getTauriManagedRemote,
} from "../../app/services/remotes/remoteManager";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getSongByBlake3 } from "../../music/services/storage/db/songs";
import { syncSongToLocal, type SyncableSong } from "../../music/services/sync/syncSongToLocal";
import { adaptSongFromAPI, type ApiSongQueryItem } from "../../music/data/remote/adapters";
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

/** reads back a just-synced song from charnel's own local grimoire, via
 * the ALREADY-WORKING `song_ids` filter (not a new `blake3` one - grimoire
 * has no such filter, see the unification plan doc's task 1/3 notes) using
 * the id `syncSongToLocal`'s charnel branch just returned. */
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

  // browser-only local-library short-circuit: a real IDB lookup by blake3
  // (already indexed, no new grimoire plumbing needed here - see
  // docs/cenotaph-migration-plan.md phase 3's "step 0"). charnel mode has
  // no client-side equivalent worth adding (that would just re-derive a
  // worse copy of the idempotent check the sync route below already does
  // server-side) - it always takes the one extra read-only metadata query
  // to the source peer, even for content it already has. cheap relative to
  // an actual blob pull; not worth a second lookup mechanism to avoid it.
  if (!isCharnelAvailable()) {
    const existing = await getSongByBlake3(item.blake3_hash);
    if (existing) {
      debug(
        "mediaRefResolve",
        `song ${hashPrefix}...: already in local library, using it directly`
      );
      return existing;
    }
  }

  try {
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    const client = await getClientForRemote(remote);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { blake3: item.blake3_hash },
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });
    if (!result.success || result.data.items.length === 0) {
      debug(
        "mediaRefResolve",
        `no song metadata for ${hashPrefix}... from ${item.source_peer_addr}`
      );
      return null;
    }

    const remoteSong = adaptSongFromAPI(
      result.data.items[0] as unknown as ApiSongQueryItem,
      remote.base_url ?? "",
      remote.remote_id
    );

    const syncResult = await syncSongToLocal(
      remoteSong as unknown as SyncableSong,
      undefined,
      remote
    );
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

  if (!isCharnelAvailable()) {
    const existing = await getVideoByBlake3(item.blake3_hash);
    if (existing) {
      debug(
        "mediaRefResolve",
        `video ${hashPrefix}...: already in local library, using it directly`
      );
      return existing as unknown as QueuedVideo;
    }
  }

  try {
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    const client = await getClientForRemote(remote);
    const result = await client.video.queryVideos({
      params: {
        q: null,
        search_fields: null,
        filters: { blake3: item.blake3_hash },
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
    if (!result.success || result.data.items.length === 0) {
      debug(
        "mediaRefResolve",
        `no video metadata for ${hashPrefix}... from ${item.source_peer_addr}`
      );
      return null;
    }

    const apiVideo = result.data.items[0];
    const queuedVideo: QueuedVideo = {
      ...apiVideo,
      source_type: "remote",
      remote_server_id: remote.remote_id,
      opfs_path: null,
      poster_opfs_path: null,
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
      return syncResult.videoId ? await getLocalVideoById(syncResult.videoId) : null;
    }

    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    return ((await getVideoByBlake3(item.blake3_hash)) as unknown as QueuedVideo) ?? null;
  } catch (err) {
    warn("mediaRefResolve", `video resolve threw for ${hashPrefix}...:`, err);
    return null;
  }
}
