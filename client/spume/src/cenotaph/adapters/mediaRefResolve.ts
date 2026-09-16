// shared MediaRef -> local Song/QueuedVideo resolution: "is this already
// in my local library, and if not, pull it in from its source peer" -
// used by localLibraryHooks.ts (cenotaph's own playback engine, which
// only needs raw bytes back - see its getLocalBlob()) and
// charnelPlaybackAdapter.ts (spume's real rodio/gst-aware player, which
// needs the actual domain object to hand to playQueue()/addToQueue()) -
// extracted so both stay in sync instead of reimplementing the same
// "check local library, else sync in from source peer" resolution twice.

import type { MediaRef } from "../index";
import { getClientForRemote, isCharnelAvailable } from "../../app/api/client";
import {
  createRemote,
  getRemoteByPeerAddr,
  getTauriManagedRemote,
} from "../../app/services/remotes/remoteManager";
import type { P2PRemote, Remote } from "../../app/services/storage/schemas/remote";
import { getSongByBlake3 } from "../../music/services/storage/db/songs";
import { syncSongToLocal } from "../../music/services/sync/syncSongToLocal";
import { adaptSongFromAPI, type ApiSongQueryItem } from "../../music/data/remote/adapters";
import { getVideoByBlake3 } from "../../video/services/storage/db/videos";
import { syncVideoToLocal } from "../../video/services/sync/syncVideoToLocal";
import type { Song } from "../../music/services/storage/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { queryClient } from "../../queryClient";
import { queryKeys } from "../../music/queries/queryKeys";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import { debug, warn } from "../../utils/logger";

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
    transport: isCharnelAvailable() ? "app" : "wasm",
    peer_addr: peerAddr,
  };
}

/** resolves `peerAddr` to its registered `Remote`, or a throwaway
 * ephemeral stand-in if it isn't one - browser mode only (its resolve
 * paths call `syncSongToLocal`/`syncVideoToLocal` directly with an
 * in-hand `Remote` object, no persisted-by-id lookup involved). charnel
 * mode uses `ensureRemoteForPeer()` below instead. */
export async function resolveSourceRemote(peerAddr: string): Promise<Remote> {
  return (await getRemoteByPeerAddr(peerAddr)) ?? ephemeralPeerRemote(peerAddr);
}

/** charnel mode only: resolves `peerAddr` to a REAL, persisted `Remote`
 * row - creating a minimal one if this peer was never saved as a remote.
 * required because every existing charnel playback path
 * (`rodioBackend.ts`'s ephemeral fetch, `getAudioURL`'s/`getVideoURL`'s
 * P2P streaming fallback, `syncSongToLocal`/`syncVideoToLocal`) resolves
 * its source via `getRemoteById(song.remote_server_id)` - a real db row
 * by id, not an in-memory object. by the time a queue-pushed `MediaRef`
 * reaches here, `source_peer_addr` is already something this device CAN
 * reach - `playerQueuePush.ts`'s `tryBridgeToSourceRemote()` already
 * granted this player direct trust on the real source (if the dispatching
 * controller is admin there) or re-pointed it at the controller's own
 * node id after importing the bytes itself. this is purely local
 * bookkeeping so the existing playback code can find that peer by id -
 * same one-liner `AddRemoteModal.tsx` already uses for pairing. */
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

/** charnel mode only: is this content already sitting in THIS device's
 * own grimoire library? checked via the local (tauri-managed) remote's
 * own querySongs, which `getClientForRemote` dispatches in-process (no
 * network at all - see client.ts's `createCharnelLocalTransport`) -
 * exactly the same query a normal "browse my own library" would make.
 * returns a `Song` shaped identically to a normal local-library browse
 * result (same `source_type`/`remote_server_id`), so the rest of the
 * playback pipeline treats it exactly like content the user browsed to
 * directly and never attempts to reach the original `source_peer_addr`
 * at all - that peer may be slow/offline/irrelevant once the content is
 * already here. without this check every charnel queue-push resolved a
 * "remote" object pointing at the ORIGINAL source peer even when this
 * exact content (by blake3) was already local, so playback paid for a
 * P2P round-trip for something already on disk. */
async function findLocalSong(blake3: string): Promise<Song | null> {
  const local = await getTauriManagedRemote();
  if (!local) return null;
  try {
    const client = await getClientForRemote(local);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { blake3 },
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
    warn("mediaRefResolve", `local-library lookup failed for song ${blake3.slice(0, 8)}...:`, err);
    return null;
  }
}

/** video counterpart of `findLocalSong()` above - see its doc comment. */
async function findLocalVideo(blake3: string): Promise<QueuedVideo | null> {
  const local = await getTauriManagedRemote();
  if (!local) return null;
  try {
    const client = await getClientForRemote(local);
    const result = await client.video.queryVideos({
      params: {
        q: null,
        search_fields: null,
        filters: { blake3 },
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
      remote_server_id: local.remote_id,
      opfs_path: null,
      poster_opfs_path: null,
    } as unknown as QueuedVideo;
  } catch (err) {
    warn("mediaRefResolve", `local-library lookup failed for video ${blake3.slice(0, 8)}...:`, err);
    return null;
  }
}

/** resolves `item` to a local `Song`, syncing it in from its source peer
 * first if not already in the local library. `null` on any failure
 * (unreachable source, no metadata there, sync error).
 *
 * charnel/tauri builds skip straight to `resolveMediaRefToSongCharnel()` -
 * the wire `MediaRef` already carries everything grimoire's native sync
 * needs (title/artist/duration/blake3), so there's no reason to re-query
 * the source peer for metadata it already gave us (that P2P round-trip
 * was also the thing actually failing - see mediaRefResolve's git
 * history/session notes). browser mode still needs the full metadata
 * query since it builds a real IDB `Song` row via `syncSongToLocal`. */
export async function resolveMediaRefToSong(item: MediaRef): Promise<Song | null> {
  if (isCharnelAvailable()) return resolveMediaRefToSongCharnel(item);
  return resolveMediaRefToSongBrowser(item);
}

/** charnel path: no syncing here at all - just ensures a persisted
 * `Remote` row exists for the source peer (see `ensureRemoteForPeer()`),
 * then hands back a plain `source_type: "remote"` `Song` built straight
 * from the wire `MediaRef`'s own fields (title/artist/duration/blake3 -
 * no metadata re-query needed, the push already told us everything).
 * this is exactly the shape a normal remote-library browse result has -
 * `rodioBackend.ts`'s `loadAndPlay()` and `audioAccess.ts`'s
 * `getAudioURL()` already do 100% of the "already local? sync if on,
 * stream/ephemeral if off" decision for a `"remote"` song, so none of
 * that logic needs to be duplicated here. */
async function resolveMediaRefToSongCharnel(item: MediaRef): Promise<Song | null> {
  const hashPrefix = item.blake3_hash.slice(0, 8);
  const local = await findLocalSong(item.blake3_hash);
  if (local) {
    debug("mediaRefResolve", `song ${hashPrefix}...: already in local library, using it directly`);
    return local;
  }
  try {
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    debug("mediaRefResolve", `song ${hashPrefix}...: resolved to remote ${remote.remote_id}`);
    return {
      id: item.blake3_hash,
      // MediaRef is blake3-only (no sha256 on the wire) - reused as a
      // stable placeholder, same fallback convention already used
      // elsewhere in this codebase (e.g. `mediaItemToRef`'s `s.blake3 ??
      // s.sha256`). sha256 is slated for deprecation in favor of blake3
      // everywhere - see docs/cenotaph-charnel-native-playback-rewire-plan.md.
      sha256: item.blake3_hash,
      // no real remote media_blob_id on the wire (a MediaRef only ever
      // carries blake3) - reused as a placeholder so audioAccess.ts's
      // P2P streaming path doesn't bail out on a missing id before ever
      // reaching its blake3-preferred verified-streaming branch. mirrors
      // resolveMediaRefToVideoCharnel's identical `media_blob_id:
      // item.blake3_hash` placeholder just below.
      media_blob_id: item.blake3_hash,
      title: item.title ?? "untitled",
      artist_id: "",
      artist_name: item.artist ?? "unknown artist",
      album_id: "",
      album_title: "unknown album",
      track_number: 0,
      disc_number: 1,
      duration_seconds: item.duration_ms ? item.duration_ms / 1000 : 0,
      year: null,
      bpm: null,
      track_artist: null,
      lyrics: null,
      metadata: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      album_added_at: Date.now(),
      album_primary_genre_id: null,
      source_type: "remote",
      opfs_path: null,
      file_name: null,
      file_size: item.size_bytes ?? null,
      last_modified: null,
      mime_type: item.mime_type ?? null,
      source_url: null,
      downloaded_at: null,
      remote_server_id: remote.remote_id,
      remote_song_id: null,
      blake3: item.blake3_hash,
      added_at: Date.now(),
    };
  } catch (err) {
    warn("mediaRefResolve", `charnel song resolve threw for ${hashPrefix}...:`, err);
    return null;
  }
}

/** browser path: unchanged - queries the source peer for full metadata
 * (needed to build a real IDB `Song` row) then syncs via OPFS/IDB. */
async function resolveMediaRefToSongBrowser(item: MediaRef): Promise<Song | null> {
  try {
    const existing = await getSongByBlake3(item.blake3_hash);
    if (existing) return existing;

    const remote = await resolveSourceRemote(item.source_peer_addr);
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

/** video counterpart of `resolveMediaRefToSong()` above. charnel/tauri
 * builds skip to `resolveMediaRefToVideoCharnel()` for the same reason
 * the song path does - see that function's doc comment. */
export async function resolveMediaRefToVideo(item: MediaRef): Promise<QueuedVideo | null> {
  if (isCharnelAvailable()) return resolveMediaRefToVideoCharnel(item);
  return resolveMediaRefToVideoBrowser(item);
}

/** charnel path: same shape change as `resolveMediaRefToSongCharnel()` -
 * no syncing here, just a persisted remote + a plain `source_type:
 * "remote"` `QueuedVideo` built from the `MediaRef`'s own fields.
 * `localVideo.ts::resolveLocalVideoPath` and `videoBlobAccess.ts::
 * getVideoURL` do the actual "already local? sync-if-on, stream-if-off"
 * work from there - matching audio's `rodioBackend.ts`/`getAudioURL`.
 *
 * `blake3` is set explicitly (unlike a normal remote-browsed video, which
 * has no blake3 until synced) so `getVideoURL`'s sync-off P2P streaming
 * path can do verified iroh-blobs fetch directly, without needing the
 * source's real server-side `media_blob_id` (which a `MediaRef` never
 * carries) - see `getVideoURL`'s own doc comment. `resolveLocalVideoPath`
 * (the native gst window's sync-off path) still has no such fallback at
 * all yet - that's phase 4 in docs/cenotaph-charnel-native-playback-rewire-plan.md. */
async function resolveMediaRefToVideoCharnel(item: MediaRef): Promise<QueuedVideo | null> {
  const hashPrefix = item.blake3_hash.slice(0, 8);
  const local = await findLocalVideo(item.blake3_hash);
  if (local) {
    debug("mediaRefResolve", `video ${hashPrefix}...: already in local library, using it directly`);
    return local;
  }
  try {
    const remote = await ensureRemoteForPeer(item.source_peer_addr);
    debug("mediaRefResolve", `video ${hashPrefix}...: resolved to remote ${remote.remote_id}`);
    return {
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
  } catch (err) {
    warn("mediaRefResolve", `charnel video resolve threw for ${hashPrefix}...:`, err);
    return null;
  }
}

/** browser path: unchanged - queries the source peer for full metadata
 * (needed to build a real IDB video row) then syncs via OPFS/IDB. */
async function resolveMediaRefToVideoBrowser(item: MediaRef): Promise<QueuedVideo | null> {
  try {
    const existing = await getVideoByBlake3(item.blake3_hash);
    if (existing) return existing as unknown as QueuedVideo;

    const remote = await resolveSourceRemote(item.source_peer_addr);
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
