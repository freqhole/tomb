// shared MediaRef -> local Song/QueuedVideo resolution: "is this already
// in my local library, and if not, pull it in from its source peer" -
// used by localLibraryHooks.ts (cenotaph's own playback engine, which
// only needs raw bytes back - see its getLocalBlob()) and
// charnelPlaybackAdapter.ts (spume's real rodio/gst-aware player, which
// needs the actual domain object to hand to playQueue()/addToQueue()) -
// extracted so both stay in sync instead of reimplementing the same
// "check local library, else sync in from source peer" resolution twice.

import type { MediaRef } from "@freqhole/cenotaph";
import { getClientForRemote } from "../../api/client";
import { getRemoteByPeerAddr } from "../remotes/remoteManager";
import type { P2PRemote, Remote } from "../storage/schemas/remote";
import { getSongByBlake3 } from "../../../music/services/storage/db/songs";
import { syncSongToLocal } from "../../../music/services/sync/syncSongToLocal";
import { adaptSongFromAPI, type ApiSongQueryItem } from "../../../music/data/remote/adapters";
import { getVideoByBlake3 } from "../../../video/services/storage/db/videos";
import { syncVideoToLocal } from "../../../video/services/sync/syncVideoToLocal";
import type { Song } from "../../../music/services/storage/types";
import type { QueuedVideo } from "../storage/mediaItem";
import { queryClient } from "../../../queryClient";
import { queryKeys } from "../../../music/queries/queryKeys";
import { videoQueryKeys } from "../../../video/queries/queryKeys";
import { debug, warn } from "../../../utils/logger";

/** synthesize a `RemoteLike`-shaped peer reference for `item.source_peer_addr`
 * without persisting anything - mirrors `blobResolver.ts`'s
 * `resolveBlobRemote()` "pending-" remote pattern, just skipping even the
 * lightweight pending-remote store: a one-off queued item shouldn't leave
 * a permanent, user-visible entry in the remote picker just because
 * resolution happened to pull it in. */
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

/** resolves `peerAddr` to its registered `Remote`, or a throwaway
 * ephemeral stand-in if it isn't one. */
export async function resolveSourceRemote(peerAddr: string): Promise<Remote> {
  return (await getRemoteByPeerAddr(peerAddr)) ?? ephemeralPeerRemote(peerAddr);
}

/** resolves `item` to a local `Song`, syncing it in from its source peer
 * first if not already in the local library. `null` on any failure
 * (unreachable source, no metadata there, sync error). */
export async function resolveMediaRefToSong(item: MediaRef): Promise<Song | null> {
  const existing = await getSongByBlake3(item.blake3_hash);
  if (existing) return existing;

  const remote = await resolveSourceRemote(item.source_peer_addr);
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
      debug(
        "mediaRefResolve",
        `no song metadata for ${item.blake3_hash.slice(0, 8)}... from ${item.source_peer_addr}`
      );
      return null;
    }

    // same API-response -> domain-song adapter spume's normal remote
    // browsing already uses (music/data/remote/remoteSource.ts).
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
    if (!syncResult.success) {
      warn(
        "mediaRefResolve",
        `sync-to-local failed for ${item.blake3_hash.slice(0, 8)}...: ${syncResult.error}`
      );
      return null;
    }

    // so the local library browsing views (which cache via solid-query,
    // not a live IDB query) actually show what was just synced in.
    void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });

    return (await getSongByBlake3(item.blake3_hash)) ?? null;
  } catch (err) {
    warn("mediaRefResolve", `song resolve threw for ${item.blake3_hash.slice(0, 8)}...:`, err);
    return null;
  }
}

/** video counterpart of `resolveMediaRefToSong()` above - queries the
 * source peer's video domain by blake3, adapts the flat `Video` wire
 * shape into a `QueuedVideo`, then hands off to `syncVideoToLocal()`. */
export async function resolveMediaRefToVideo(item: MediaRef): Promise<QueuedVideo | null> {
  const existing = await getVideoByBlake3(item.blake3_hash);
  if (existing) return existing as unknown as QueuedVideo;

  const remote = await resolveSourceRemote(item.source_peer_addr);
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
      debug(
        "mediaRefResolve",
        `no video metadata for ${item.blake3_hash.slice(0, 8)}... from ${item.source_peer_addr}`
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

    await syncVideoToLocal(queuedVideo, remote);

    // syncVideoToLocal() is void/best-effort - confirm it actually
    // landed before declaring success.
    const synced = await getVideoByBlake3(item.blake3_hash);
    if (!synced) {
      warn(
        "mediaRefResolve",
        `video sync-to-local did not produce a local copy for ${item.blake3_hash.slice(0, 8)}...`
      );
      return null;
    }

    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });

    return synced as unknown as QueuedVideo;
  } catch (err) {
    warn("mediaRefResolve", `video resolve threw for ${item.blake3_hash.slice(0, 8)}...:`, err);
    return null;
  }
}
