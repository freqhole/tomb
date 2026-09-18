// charnel/tauri path for video sync-to-local.
//
// mirrors music's `syncSongViaLocalGrimoire`: instead of writing to OPFS
// (unavailable in WKWebView, which has no async `createWritable()`), hand the
// source peer's iroh node id + full metadata to the local grimoire and let it
// pull the video bytes itself by blake3 over verified streaming.

import { getTransportForRemote } from "../../../app/api/client";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import { isP2PRemote } from "../../../app/services/storage/schemas/remote";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { buildSyncVideoByBlake3Body } from "./buildSyncVideoRequest";
import { debug, error as errorLog } from "../../../utils/logger";

export interface VideoSyncResult {
  success: boolean;
  error?: string;
  videoId?: string;
  /** absolute fs path grimoire wrote the video to, so callers can build a
   * playable url without re-resolving it. */
  localPath?: string;
  /** true if the destination already had this video */
  skipped?: boolean;
}

/** invoke `sync_video_by_blake3_with_progress` instead of the generic
 * `api_call` - see syncSongToLocal.ts's `invokeSyncSongWithProgress` for
 * the full rationale, this is the same pattern for video. */
async function invokeSyncVideoWithProgress(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  body: unknown,
  totalBytes: number,
  onProgress: (received: number, total: number) => void
): Promise<unknown> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const tauri = await import("@tauri-apps/api/core");
  const channel = new tauri.Channel<{ bytes_downloaded: number }>();
  channel.onmessage = (message) => {
    onProgress(message?.bytes_downloaded ?? 0, totalBytes);
  };
  return invoke("sync_video_by_blake3_with_progress", { body, onProgress: channel });
}

/**
 * sync a video into the local charnel-managed grimoire via the iroh-blobs
 * pull path. requires a P2P source remote (the node id is what grimoire dials
 * to fetch the bytes) and a blake3 for the blob being synced.
 *
 * `onProgress`, when given, is wired to `sync_video_by_blake3_with_progress`
 * instead of the plain `api_call`/`sync_video_by_blake3` dispatch - see
 * `syncSongToLocal.ts`'s `syncSongViaLocalGrimoire` doc comment for why.
 */
export async function syncVideoViaLocalGrimoire(
  video: QueuedVideo,
  remote: Remote,
  blobId: string,
  blake3: string | null,
  size?: number | null,
  mime?: string | null,
  onProgress?: (received: number, total: number) => void
): Promise<VideoSyncResult> {
  if (!blake3) {
    return { success: false, error: "video blob has no blake3 (cannot pull via iroh)" };
  }
  if (!isP2PRemote(remote)) {
    return { success: false, error: "source remote is not p2p — cannot resolve iroh node id" };
  }
  const sourceNodeId = extractNodeIdStrict(remote.peer_addr);
  if (!sourceNodeId) {
    return { success: false, error: "source remote has no usable iroh node id" };
  }

  const label = `[video "${video.title}"]`;

  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");

    const sourceTransport = await getTransportForRemote(remote);
    const body = await buildSyncVideoByBlake3Body({
      video,
      metadataRemote: remote,
      sourceTransport,
      blake3,
      sha256: null,
      size,
      // no reliable extension yet (bytes aren't fetched client-side here) -
      // leave the stem alone so grimoire sniffs the real mime after download
      filename: video.title || blobId,
      sourceNodeId,
      sourceRemoteId: remote.remote_id,
      remoteName: remote.name,
    });

    debug(
      "syncVideoViaLocalGrimoire",
      `${label} pulling blake3=${blake3.slice(0, 8)} from ${sourceNodeId.slice(0, 8)} series=${body.series_title ?? "none"} season=${body.season_number ?? "none"} images=${body.video_images.length}/${body.series_images.length}/${body.season_images.length} mime=${mime ?? "unknown"}`
    );

    const response = (await (onProgress
      ? invokeSyncVideoWithProgress(invoke, body, size ?? 0, onProgress)
      : invoke("api_call", { path: "/api/sync/video-by-blake3", body }))) as {
      success: boolean;
      message: string;
      errors?: Array<{ error_type: string; title: string; detail: string }>;
      data?: {
        video_id: string;
        media_blob_id: string;
        file_path: string;
        series_id: string | null;
        season_id: string | null;
        existing: boolean;
        images_linked: number;
        missing_image_sha256s: string[];
      };
    };

    if (!response.success) {
      errorLog("videoSync", `sync_video_by_blake3 failed for "${video.title}":`, response.message);
      // same stale-portal-grant case syncSongToLocal.ts translates
      if (response.errors?.some((e) => e.error_type === "stale_doc_portal_path")) {
        return {
          success: false,
          error:
            "fetched media folder is no longer accessible - reselect it in settings > fetched music storage.",
        };
      }
      return { success: false, error: response.message };
    }

    const data = response.data;
    debug(
      "syncVideoViaLocalGrimoire",
      `${label} synced video=${data?.video_id} existing=${data?.existing ?? false} series=${data?.series_id ?? "none"} images_linked=${data?.images_linked ?? 0}`
    );
    return {
      success: true,
      videoId: data?.video_id,
      localPath: data?.file_path,
      skipped: data?.existing ?? false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errorLog("videoSync", "local grimoire video sync failed:", e);
    return { success: false, error: message };
  }
}
