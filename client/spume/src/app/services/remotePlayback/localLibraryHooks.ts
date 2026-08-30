// dial-side implementation of cenotaph's `LocalLibraryHooks` (see
// lib/cenotaph/ts/src/playback/playbackEngine.ts) - bridges cenotaph's
// generic playback engine to spume's own browser IDB/OPFS song library,
// so queued media gets promoted into a real local library entry (not just
// an ephemeral blob cache) when "sync queue to local" is on. see
// docs/cenotaph-migration-plan.md phase 3, tier 2.
//
// registered once, unconditionally, right next to
// `initRemotePlaybackAcceptMode()` in app/api/client.ts - both sides
// (this tab being controlled, or this tab controlling itself via
// `/player/`) share the exact same `mediaPlaybackBackend` singleton, so
// hooks need to be set regardless of which side ends up actually playing.

import { setLocalLibraryHooks, type LocalLibraryHooks, type MediaRef } from "@freqhole/cenotaph";
import { getClientForRemote } from "../../api/client";
import { getRemoteByPeerAddr } from "../remotes/remoteManager";
import type { P2PRemote } from "../storage/schemas/remote";
import { getSyncQueueToLocal } from "../storage/db";
import { getSongByBlake3 } from "../../../music/services/storage/db/songs";
import { readAudioFromOPFS } from "../../../music/services/opfs/helpers";
import { syncSongToLocal } from "../../../music/services/sync/syncSongToLocal";
import { adaptSongFromAPI, type ApiSongQueryItem } from "../../../music/data/remote/adapters";
import { getVideoByBlake3 } from "../../../video/services/storage/db/videos";
import { readVideoFromOPFS } from "../../../video/services/opfs/helpers";
import { syncVideoToLocal } from "../../../video/services/sync/syncVideoToLocal";
import type { Remote } from "../storage/schemas/remote";
import type { QueuedVideo } from "../storage/mediaItem";
import { queryClient } from "../../../queryClient";
import { queryKeys } from "../../../music/queries/queryKeys";
import { videoQueryKeys } from "../../../video/queries/queryKeys";
import { debug, warn } from "../../../utils/logger";

async function getLocalBlob(blake3Hash: string): Promise<Blob | null> {
  const song = await getSongByBlake3(blake3Hash);
  if (song?.opfs_path) {
    try {
      return await readAudioFromOPFS(song.opfs_path);
    } catch (err) {
      warn(
        "localLibraryHooks",
        `failed to read local audio for ${blake3Hash.slice(0, 8)}...:`,
        err
      );
      return null;
    }
  }

  const video = await getVideoByBlake3(blake3Hash);
  if (video?.opfs_path) {
    try {
      return await readVideoFromOPFS(video.opfs_path);
    } catch (err) {
      warn(
        "localLibraryHooks",
        `failed to read local video for ${blake3Hash.slice(0, 8)}...:`,
        err
      );
      return null;
    }
  }

  return null;
}

function isSyncEnabled(): boolean {
  return getSyncQueueToLocal();
}

/** synthesize a `RemoteLike`-shaped peer reference for `item.source_peer_addr`
 * without persisting anything - mirrors `blobResolver.ts`'s
 * `resolveBlobRemote()` "pending-" remote pattern, just skipping even the
 * lightweight pending-remote store: a one-off queued item shouldn't leave
 * a permanent, user-visible entry in the remote picker just because
 * sync-to-local happened to pull it in. */
function ephemeralPeerRemote(peerAddr: string): P2PRemote {
  const now = Date.now();
  return {
    remote_id: `ephemeral-${peerAddr}`,
    name: peerAddr,
    is_active: false,
    last_connected_at: null,
    created_at: now,
    updated_at: now,
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    transport: "wasm",
    peer_addr: peerAddr,
  };
}

async function syncToLocal(item: MediaRef): Promise<Blob | null> {
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/localLibraryHooks] syncToLocal called:`, {
    kind: item.kind,
    blake3: item.blake3_hash.slice(0, 8),
    source_peer_addr: item.source_peer_addr,
  });
  const remote =
    (await getRemoteByPeerAddr(item.source_peer_addr)) ??
    ephemeralPeerRemote(item.source_peer_addr);

  if (item.kind === "video") {
    return syncVideoToLocalHook(item, remote);
  }

  try {
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
      // TEMP DEBUG - remove once sync-to-local wiring bug is found
      console.log(
        `[debug/localLibraryHooks] querySongs for ${item.blake3_hash.slice(0, 8)}... came back ${result.success ? "empty" : "failed"}`,
        result
      );
      debug(
        "localLibraryHooks",
        `no metadata for ${item.blake3_hash.slice(0, 8)}... from ${item.source_peer_addr} - falling back to raw blob fetch`
      );
      return null;
    }

    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/localLibraryHooks] querySongs for ${item.blake3_hash.slice(0, 8)}... found:`,
      result.data.items[0]
    );

    // same API-response -> domain-song adapter spume's normal remote
    // browsing already uses (music/data/remote/remoteSource.ts) -
    // `RemoteSong` is a structural superset of `SyncableSong` (see
    // sendToLocalLibrary.ts's identical cast).
    const remoteSong = adaptSongFromAPI(
      result.data.items[0] as unknown as ApiSongQueryItem,
      remote.base_url ?? "",
      remote.remote_id
    );

    const syncResult = await syncSongToLocal(
      remoteSong as unknown as Parameters<typeof syncSongToLocal>[0],
      undefined,
      remote
    );
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/localLibraryHooks] syncSongToLocal result for ${item.blake3_hash.slice(0, 8)}...:`,
      syncResult
    );
    if (!syncResult.success) {
      warn(
        "localLibraryHooks",
        `sync-to-local failed for ${item.blake3_hash.slice(0, 8)}...: ${syncResult.error}`
      );
      return null;
    }

    // so the local library browsing views (which cache via solid-query,
    // not a live IDB query) actually show what was just synced in - same
    // precedent as autoDownload/manager.ts's downloadSong().
    void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });

    return getLocalBlob(item.blake3_hash);
  } catch (err) {
    warn("localLibraryHooks", `sync-to-local threw for ${item.blake3_hash.slice(0, 8)}...:`, err);
    return null;
  }
}

/** video counterpart of the song sync path above - queries the source
 * peer's video domain by blake3, adapts the flat `Video` wire shape into
 * a `QueuedVideo` (same spread video/data/remote/remoteSource.ts's
 * `mapVideo()` already uses for the classic remote-browsing path - `Video`
 * and `QueuedVideo` share field names 1:1, no richer adapter needed the
 * way song requires), then hands off to `syncVideoToLocal()`. */
async function syncVideoToLocalHook(item: MediaRef, remote: Remote): Promise<Blob | null> {
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(
    `[debug/localLibraryHooks] syncVideoToLocalHook called for ${item.blake3_hash.slice(0, 8)}... via remote ${remote.remote_id}`
  );
  try {
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
      // TEMP DEBUG - remove once sync-to-local wiring bug is found
      console.log(
        `[debug/localLibraryHooks] queryVideos for ${item.blake3_hash.slice(0, 8)}... came back ${result.success ? "empty" : "failed"}`,
        result
      );
      debug(
        "localLibraryHooks",
        `no video metadata for ${item.blake3_hash.slice(0, 8)}... from ${item.source_peer_addr} - falling back to raw blob fetch`
      );
      return null;
    }

    const apiVideo = result.data.items[0];
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/localLibraryHooks] queryVideos for ${item.blake3_hash.slice(0, 8)}... found:`,
      apiVideo
    );
    const queuedVideo: QueuedVideo = {
      ...apiVideo,
      source_type: "remote",
      remote_server_id: remote.remote_id,
      opfs_path: null,
      poster_opfs_path: null,
    };

    await syncVideoToLocal(queuedVideo, remote);

    // syncVideoToLocal() is void/best-effort (see its own header comment) -
    // confirm it actually landed before declaring success, same as the
    // song path's `syncResult.success` check above.
    const synced = await getVideoByBlake3(item.blake3_hash);
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/localLibraryHooks] post-syncVideoToLocal getVideoByBlake3(${item.blake3_hash.slice(0, 8)}...) =`,
      synced
    );
    if (!synced) {
      warn(
        "localLibraryHooks",
        `video sync-to-local did not produce a local copy for ${item.blake3_hash.slice(0, 8)}...`
      );
      return null;
    }

    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });

    return getLocalBlob(item.blake3_hash);
  } catch (err) {
    warn(
      "localLibraryHooks",
      `video sync-to-local threw for ${item.blake3_hash.slice(0, 8)}...:`,
      err
    );
    return null;
  }
}

const hooks: LocalLibraryHooks = { getLocalBlob, isSyncEnabled, syncToLocal };

let started = false;

/** wires spume's browser library into cenotaph's playback engine. safe to
 * call more than once (no-ops after the first call). */
export function initLocalLibraryHooks(): void {
  if (started) return;
  started = true;
  setLocalLibraryHooks(hooks);
}
