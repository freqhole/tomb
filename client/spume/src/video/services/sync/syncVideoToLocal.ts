// sync-to-local for remote video playback — mirrors the essential shape of
// music/services/sync/syncSongToLocal.ts, deliberately scoped down: dedup
// by the video's own id (not a content hash — `Video` has no sha256 field
// yet). plain http remotes stream straight to opfs with byte-range resume
// (see streamVideoToOPFSWithResume) so a large video that fails partway
// through picks back up where it left off instead of restarting from byte
// 0 on every retry/replay. P2P/charnel remotes still go through
// preCacheP2PBlob/getCachedBlob (iroh-blobs is already content-addressed
// and block-verified — a different resume story, out of scope here).
//
// fired (fire-and-forget) from VideoBackend.loadAndPlay whenever a remote
// video is played and the "sync queue to local" setting is on.

import { usesBlobResolver } from "../../../music/services/storage/blobResolver";
import {
  addToLoadingSet,
  updateLoadingProgress,
  removeFromLoadingSet,
} from "../../../music/services/download";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelMode } from "../../../app/services/charnel";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getClientForRemote, getTransportForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { addLocalVideo, getLocalVideoById, updateLocalVideo } from "../storage/db/videos";
import { getOrCreateLocalVideoSeries, updateLocalVideoSeries } from "../storage/db/series";
import type { LocalVideoSeriesRow } from "../storage/db/series";
import { getOrCreateLocalVideoSeason, updateLocalVideoSeason } from "../storage/db/seasons";
import type { LocalVideoSeasonRow } from "../storage/db/seasons";
import { downloadAndStoreImages } from "../../../music/services/sync/syncSongToLocal";
import { pickBestImage, imagesAreStale } from "../../../utils/images";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { invalidateVideoLibraryQueries } from "../../queries/cacheUpdates";
import { markVideoSynced } from "../syncState";
import {
  writeVideoPosterToOPFS,
  writeVideoToOPFS,
  streamVideoToOPFSWithResume,
} from "../opfs/helpers";
import { resolvePlaybackBlobId } from "../playbackBlobId";
import { syncVideoViaLocalGrimoire } from "./syncVideoViaLocalGrimoire";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import type { BlobMetadataResponse } from "@freqhole/api-client";
import { debug, warn } from "../../../utils/logger";

const MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

function extensionFromMime(mime: string): string {
  return MIME_TO_EXTENSION[mime] ?? "mp4";
}

/** look up size/mime/blake3 for a video's blob up front - lets the http
 *  download path pick the right (stable, resume-friendly) file extension
 *  and know the total size *before* fetching, and avoids a second
 *  metadata round-trip later just for blake3. best-effort: a failure here
 *  just means less metadata, never blocks the sync. */
async function fetchBlobMetadata(
  remoteId: string,
  blobId: string,
  remoteOverride?: Remote
): Promise<Partial<BlobMetadataResponse>> {
  try {
    const remote = remoteOverride ?? (await getRemoteById(remoteId));
    if (!remote) return {};
    const client = await getClientForRemote(remote);
    const metadataResult = await client.music.blobMetadata({ id: blobId });
    if (metadataResult.success && metadataResult.data) {
      return metadataResult.data;
    }
  } catch (err) {
    warn("videoSync", `failed to fetch blob metadata for ${blobId} (non-fatal):`, err);
  }
  return {};
}

/** fetch the full video blob via the P2P/charnel path, tracking download
 *  progress under `video.id`.
 *
 *  fetches with `cache: "skip"`: these bytes are headed for OPFS, and
 *  caching them on the way would store the video twice. */
async function fetchP2PVideoBlob(
  video: QueuedVideo,
  remoteId: string,
  blobId: string,
  meta: Partial<BlobMetadataResponse>,
  remoteOverride?: Remote
): Promise<Blob> {
  const remote = remoteOverride ?? (await getRemoteById(remoteId));
  if (!remote) throw new Error(`remote ${remoteId} not found`);
  const transport = await getTransportForRemote(remote);

  addToLoadingSet(video.id);
  updateLoadingProgress(video.id, null);
  try {
    const onProgress = (received: number, total: number) => {
      if (total > 0) updateLoadingProgress(video.id, received / total);
    };

    if (transport.getBlobUrlWithProgress) {
      const url = await transport.getBlobUrlWithProgress(
        blobId,
        onProgress,
        meta.blake3 ?? undefined,
        meta.size ?? undefined,
        meta.mime ?? undefined,
        { cache: "skip" }
      );
      const response = await fetch(url);
      if (!response.ok) throw new Error(`failed to fetch video blob: ${response.statusText}`);
      return response.blob();
    }

    const url = await transport.getBlobUrl(blobId, meta.blake3 ?? undefined, { cache: "skip" });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch video blob: ${response.statusText}`);
    return response.blob();
  } finally {
    removeFromLoadingSet(video.id);
  }
}

/** map the source remote's series/season onto local rows.
 *
 * grimoire matches series/season by title + number rather than by the source's
 * ids (see syncVideoViaLocalGrimoire's resolveSeriesContext) - the browser
 * library has to do the same, or a synced episode lands with no series and
 * shows up as a loose clip. */
async function resolveLocalSeriesContext(
  video: QueuedVideo,
  remoteOverride?: Remote
): Promise<{ seriesId: string | null; seasonId: string | null }> {
  if (!video.series_id || !video.remote_server_id) return { seriesId: null, seasonId: null };
  try {
    const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
    if (!remote) return { seriesId: null, seasonId: null };
    const client = await getClientForRemote(remote);
    const result = await client.video.getVideoSeriesDetail({ id: video.series_id });
    if (!result.success || !result.data) return { seriesId: null, seasonId: null };

    const { series, seasons } = result.data;
    const localSeries = await getOrCreateLocalVideoSeries(series.title);

    // refresh artwork/description whenever the source has changed them - an
    // existing local row is not a reason to stop syncing, the remote may have
    // added or replaced its poster since.
    const existingSeries = localSeries as LocalVideoSeriesRow;
    const seriesUpdates: Parameters<typeof updateLocalVideoSeries>[1] = {};
    const seriesPosterIds = series.poster_blob_id ? [series.poster_blob_id] : [];
    if (seriesPosterIds.length && imagesAreStale(existingSeries.images, seriesPosterIds)) {
      const images = await downloadAndStoreImages(remote, [
        {
          remote_blob_id: series.poster_blob_id,
          remote_server_id: remote.remote_id,
          is_primary: true,
          blob_type: "thumbnail",
        } as ImageMetadata,
      ]);
      if (images.length > 0) {
        seriesUpdates.images = images;
        // grid tiles and detail panels read poster_blob_id, not the images
        // gallery - for a local row it holds the *local* blob id (same
        // convention as localSource.ts's uploadImage).
        seriesUpdates.poster_blob_id = pickBestImage(images)?.local_blob_id ?? null;
      }
    }
    if (series.description && series.description !== existingSeries.description) {
      seriesUpdates.description = series.description;
    }
    if (Object.keys(seriesUpdates).length > 0) {
      await updateLocalVideoSeries(localSeries.id, seriesUpdates);
      invalidateVideoLibraryQueries();
    }

    let seasonId: string | null = null;
    const sourceSeason = video.season_id
      ? seasons.find((s) => s.season.id === video.season_id)?.season
      : undefined;
    if (sourceSeason) {
      const localSeason = await getOrCreateLocalVideoSeason({
        series_id: localSeries.id,
        season_number: sourceSeason.season_number,
        title: sourceSeason.title ?? null,
        description: sourceSeason.description ?? null,
      });
      seasonId = localSeason.id;

      const existingSeason = localSeason as LocalVideoSeasonRow;
      const seasonPosterIds = sourceSeason.poster_blob_id ? [sourceSeason.poster_blob_id] : [];
      if (seasonPosterIds.length && imagesAreStale(existingSeason.images, seasonPosterIds)) {
        const seasonImages = await downloadAndStoreImages(remote, [
          {
            remote_blob_id: sourceSeason.poster_blob_id,
            remote_server_id: remote.remote_id,
            is_primary: true,
            blob_type: "thumbnail",
          } as ImageMetadata,
        ]);
        if (seasonImages.length > 0) {
          await updateLocalVideoSeason(localSeason.id, {
            images: seasonImages,
            poster_blob_id: pickBestImage(seasonImages)?.local_blob_id ?? null,
          });
          invalidateVideoLibraryQueries();
        }
      }
    }
    return { seriesId: localSeries.id, seasonId };
  } catch (err) {
    // a video with no resolvable series still syncs fine, just unattached
    warn("videoSync", `series lookup failed for video ${video.id} (non-fatal):`, err);
    return { seriesId: null, seasonId: null };
  }
}

/** check if a video can be synced (is remote and has required fields) —
 *  mirrors music's `canSyncSong` (syncSongToLocal.ts). */
export function canSyncVideo(video: QueuedVideo): boolean {
  return video.source_type === "remote" && !!video.remote_server_id && !!video.media_blob_id;
}

/** outcome of a sync. `void`-ing the promise stays valid for the
 * fire-and-forget callers; the play path uses it to build a url. */
export interface VideoSyncOutcome {
  success: boolean;
  /** charnel only — absolute fs path of the local copy. */
  localPath?: string;
  error?: string;
}

/** charnel/tauri: hand the sync off to the local grimoire, which pulls the
 * video bytes itself over iroh. progress is reported under the video's own id
 * so the queue row's indicator behaves the same as the browser path. */
async function syncVideoViaCharnel(
  video: QueuedVideo,
  remoteOverride?: Remote
): Promise<VideoSyncOutcome> {
  const remoteId = video.remote_server_id!;
  const remote = remoteOverride ?? (await getRemoteById(remoteId));
  if (!remote) {
    warn("videoSync", `remote ${remoteId} not found, skipping charnel sync for ${video.id}`);
    return { success: false, error: `remote ${remoteId} not found` };
  }

  const blobId = await resolvePlaybackBlobId(video, remoteId);
  const meta = await fetchBlobMetadata(remoteId, blobId, remoteOverride);

  addToLoadingSet(video.id);
  updateLoadingProgress(video.id, null); // grimoire's pull reports no progress back
  try {
    const result = await syncVideoViaLocalGrimoire(
      video,
      remote,
      blobId,
      meta.blake3 ?? null,
      meta.size,
      meta.mime
    );
    if (!result.success) {
      warn("videoSync", `charnel sync failed for video ${video.id}: ${result.error}`);
      return { success: false, error: result.error };
    }
    markVideoSynced(video.id);
    debug(
      "videoSync",
      `synced video "${video.title}" (${video.id}) into the local library via grimoire (existing=${result.skipped})`
    );
    invalidateVideoLibraryQueries();
    return { success: true, localPath: result.localPath };
  } finally {
    removeFromLoadingSet(video.id);
  }
}

/** sync the currently-playing remote video to the local OPFS-backed video
 * library, if "sync queue to local" is enabled and it hasn't already been
 * synced. syncs whichever blob is actually being played (the selected
 * rendition, if any, else the original) — the same file downloaded to
 * play, per the user's own framing. never throws; failures are logged
 * and simply skip the sync so playback is never affected.
 *
 * @param remoteOverride - skip the internal `getRemoteById(remote_server_id)`
 *   lookup and use this instead - for callers with a peer that was never
 *   added as a persisted `Remote` (e.g. cenotaph's tier-2 sync-to-local).
 *   see syncSongToLocal.ts's identical param for the full rationale. */
export async function syncVideoToLocal(
  video: QueuedVideo,
  remoteOverride?: Remote
): Promise<VideoSyncOutcome> {
  if (video.source_type !== "remote") return { success: false, error: "not a remote video" };
  if (!video.remote_server_id || !video.media_blob_id) {
    return { success: false, error: "video missing remote or blob id" };
  }
  if (!getSyncQueueToLocal()) return { success: false, error: "sync-to-local is off" };
  // tauri's webview (WKWebView on macOS) supports OPFS getFileHandle/
  // getDirectoryHandle but not the async createWritable() writable-stream
  // api, so writeVideoToOPFS below would throw. charnel-mode syncs instead go
  // through the local grimoire, which pulls the bytes natively by blake3 -
  // same split music's syncSongToLocal.ts uses.
  if (isCharnelMode()) {
    return syncVideoViaCharnel(video, remoteOverride);
  }

  try {
    const existing = await getLocalVideoById(video.id);
    if (existing) {
      // the video itself is already local, but the queued item is remote
      // (guarded above), so the source can still tell us about series
      // artwork/description changes - and about a series link this video
      // never got, if it was synced before series support existed.
      const { seriesId, seasonId } = await resolveLocalSeriesContext(video, remoteOverride);
      if (seriesId && (existing.series_id !== seriesId || existing.season_id !== seasonId)) {
        await updateLocalVideo(existing.id, { series_id: seriesId, season_id: seasonId });
      }
      invalidateVideoLibraryQueries();
      return { success: true };
    }

    const blobId = await resolvePlaybackBlobId(video, video.remote_server_id);

    let opfsPath: string;
    let fileSize: number;
    let mimeType: string;
    let blake3: string | null = null;

    if (await usesBlobResolver(video.remote_server_id)) {
      // P2P/charnel: fetch the bytes directly, without caching them.
      // metadata comes first so the fetch can report real progress (blake3 +
      // size) rather than sitting on an indeterminate indicator.
      const meta = await fetchBlobMetadata(video.remote_server_id, blobId, remoteOverride);
      let videoBlob: Blob;
      try {
        videoBlob = await fetchP2PVideoBlob(
          video,
          video.remote_server_id,
          blobId,
          meta,
          remoteOverride
        );
      } catch (err) {
        warn("videoSync", `fetch failed for video ${video.id}, skipping sync:`, err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      const extension = extensionFromMime(videoBlob.type);
      opfsPath = await writeVideoToOPFS(videoBlob, video.id, extension);
      fileSize = videoBlob.size;
      mimeType = videoBlob.type || "video/mp4";
      blake3 = meta.blake3 ?? null;
    } else {
      // plain http remote: stream straight to opfs, resuming a previously
      // interrupted download instead of restarting from byte 0 - critical
      // for large videos, which are otherwise prone to failing partway
      // through and starting over on every retry/replay.
      const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
      if (!remote?.base_url) {
        warn(
          "videoSync",
          `remote ${video.remote_server_id} has no base_url, skipping sync for ${video.id}`
        );
        return { success: false, error: "remote has no base_url" };
      }
      const meta = await fetchBlobMetadata(video.remote_server_id, blobId, remoteOverride);
      const extension = extensionFromMime(meta.mime ?? "video/mp4");
      mimeType = meta.mime ?? "video/mp4";
      blake3 = meta.blake3 ?? null;

      const directUrl = `${remote.base_url}/api/blobs/${blobId}`;
      addToLoadingSet(video.id);
      updateLoadingProgress(video.id, null);
      try {
        const result = await streamVideoToOPFSWithResume(
          directUrl,
          video.id,
          extension,
          meta.size ?? null,
          (received, total) => updateLoadingProgress(video.id, total ? received / total : null)
        );
        opfsPath = result.opfsPath;
        fileSize = result.size;
      } catch (err) {
        warn(
          "videoSync",
          `fetch failed for video ${video.id}, skipping sync (bytes written so far are kept on disk for the next attempt to resume from):`,
          err
        );
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        removeFromLoadingSet(video.id);
      }
    }

    // a video synced in from a remote already has a blake3 on its
    // media_blobz record there - never hash client-side for a remote video
    // (only local uploads need that, see video/import/localImport.ts). a
    // missing blake3 just means this synced copy won't be servable by
    // blake3 to a further peer, not a sync failure.

    let posterOpfsPath: string | null = null;
    if (video.poster_blob_id) {
      try {
        // via the transport rather than resolveBlobUrl: these bytes go to
        // OPFS, and resolveBlobUrl has no way to opt out of caching them.
        const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
        if (remote) {
          const transport = await getTransportForRemote(remote);
          const posterUrl = await transport.getBlobUrl(video.poster_blob_id, undefined, {
            cache: "skip",
          });
          const posterResponse = await fetch(posterUrl);
          if (posterResponse.ok) {
            posterOpfsPath = await writeVideoPosterToOPFS(await posterResponse.blob(), video.id);
          }
        }
      } catch (err) {
        warn("videoSync", `poster sync failed for video ${video.id} (non-fatal):`, err);
      }
    }

    const { seriesId, seasonId } = await resolveLocalSeriesContext(video, remoteOverride);

    // the video's own artwork, beyond the poster already written to OPFS
    let videoImages: ImageMetadata[] = [];
    if (video.images?.length && video.remote_server_id) {
      const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
      if (remote) {
        videoImages = await downloadAndStoreImages(
          remote,
          video.images.map(
            (img) =>
              ({
                remote_blob_id: img.blob_id,
                remote_server_id: video.remote_server_id,
                is_primary: !!img.is_primary,
                blob_type: img.blob_type,
              }) as ImageMetadata
          )
        );
      }
    }

    await addLocalVideo({
      id: video.id,
      title: video.title,
      opfs_path: opfsPath,
      poster_opfs_path: posterOpfsPath,
      file_name: opfsPath.split("/").pop()!,
      file_size: fileSize,
      mime_type: mimeType,
      duration_seconds: video.duration_seconds ?? null,
      blake3,
      series_id: seriesId,
      season_id: seasonId,
      episode_number: video.episode_number ?? null,
      content_type: video.content_type,
      description: video.description ?? null,
      images: videoImages,
      poster_blob_id: pickBestImage(videoImages)?.local_blob_id ?? null,
    });
    markVideoSynced(video.id);

    // the library views are query-backed; without this a video synced during
    // playback doesn't appear until something else invalidates.
    invalidateVideoLibraryQueries();

    debug("videoSync", `synced video "${video.title}" (${video.id}) to local library`);
    return { success: true };
  } catch (err) {
    warn("videoSync", `sync-to-local failed for video ${video.id}:`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
