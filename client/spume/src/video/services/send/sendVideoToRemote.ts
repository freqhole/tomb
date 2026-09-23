// orchestrator: push videos from a source remote (in practice, always the
// local charnel-managed grimoire instance a user is adding videos on) to a
// destination remote.
//
// mirrors music's sendToRemote.ts, but much simpler: video's sync route
// already carries series/season context inline (no separate "shell" call
// needed before per-item syncs, unlike music's album-then-song two-step),
// and there is no playlist-equivalent grouping for video yet. audio bytes
// never touch the client - dest receives `POST /api/sync/video-by-blake3`
// and pulls the video directly from the source peer via iroh-blobs
// (`source_node_id` + blake3), exactly like music's song sync.

import { schema } from "@freqhole/api-client";
const { SyncVideoByBlake3ResponseSchema } = schema;
import type { SyncVideoByBlake3Response } from "@freqhole/api-client";
import { getTransportForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import {
  isValidSendDestination,
  resolveSourceNodeId,
  checkBlobsPresentOnDest,
  peerUnauthorizedMessage,
} from "../../../app/services/send/sendValidation";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { debug, info, warn, error as logError } from "../../../utils/logger";
import { buildSyncVideoByBlake3Body } from "../sync/buildSyncVideoRequest";
import { EnvelopeError, unwrapEnvelope } from "../../../music/services/send/sendToRemote";
import { ensureBlobServable } from "../../../lib/api/blobServing";
import { readVideoFromOPFS } from "../opfs/helpers";

const TAG = "sendVideoToRemote";

export interface SendVideoProgress {
  phase: "preparing" | "syncing" | "done" | "failed";
  totalVideos: number;
  syncedVideos: number;
  skippedVideos: number;
  failedVideos: number;
  errors: string[];
  syncedBlake3s: string[];
  failedBlake3s: string[];
}

function emptyProgress(total: number): SendVideoProgress {
  return {
    phase: "preparing",
    totalVideos: total,
    syncedVideos: 0,
    skippedVideos: 0,
    failedVideos: 0,
    errors: [],
    syncedBlake3s: [],
    failedBlake3s: [],
  };
}

export class SendVideoToRemoteError extends Error {
  readonly progress: SendVideoProgress;
  constructor(message: string, progress: SendVideoProgress) {
    super(message);
    this.name = "SendVideoToRemoteError";
    this.progress = progress;
  }
}

export interface SendVideoItem {
  video: QueuedVideo;
  blobId: string;
  blake3: string | null;
  sha256?: string | null;
  size?: number | null;
  mime?: string | null;
}

export interface SendVideosOptions {
  /** ask dest which blake3s it already has before syncing, to skip re-sends. defaults true. */
  skipExisting?: boolean;
  onProgress?: (progress: SendVideoProgress) => void;
}

/** share-modal payload for a video/videos send — mirrors music's
 * `SendPayload` union shape (a `kind` discriminant) so
 * `SendToRemoteSection.tsx` can accept either domain's payload through
 * one prop. */
export interface SendVideoPayload {
  kind: "video";
  videos: SendVideoItem[];
}

/**
 * push `items` from `source` to `dest`, one `POST /api/sync/video-by-blake3`
 * per video. resolves with the final progress snapshot; throws
 * `SendVideoToRemoteError` (carrying the partial progress) on fatal
 * validation errors that stop the whole send before it starts.
 */
export async function sendVideosToRemote(
  items: SendVideoItem[],
  source: Remote,
  dest: Remote,
  opts: SendVideosOptions = {}
): Promise<SendVideoProgress> {
  const skipExisting = opts.skipExisting ?? true;
  const lp = `[${source.name ?? source.remote_id} -> ${dest.name ?? dest.remote_id}]`;
  const progress = emptyProgress(items.length);
  const emit = () => opts.onProgress?.({ ...progress });
  emit();

  const destOk = isValidSendDestination(dest);
  if (!destOk) {
    logError(TAG, `${lp} invalid dest transport: dest=${dest.remote_id}`);
    throw new SendVideoToRemoteError(
      "destination must be a p2p remote or the local charnel app",
      progress
    );
  }

  const sourceNodeId = resolveSourceNodeId(source);
  if (!sourceNodeId) {
    logError(TAG, `${lp} no source node id: source=${source.remote_id}`);
    throw new SendVideoToRemoteError("source remote has no usable iroh node id", progress);
  }

  const destTransport = await getTransportForRemote(dest);
  const sourceTransport = await getTransportForRemote(source);
  const remoteName = source.name ?? source.remote_id;
  const sourceRemoteId = source.remote_id;

  let eligible = items.filter((i) => !!i.blake3);
  const skippedNoHash = items.length - eligible.length;
  if (skippedNoHash > 0) {
    progress.skippedVideos += skippedNoHash;
    progress.errors.push(`${skippedNoHash} video(s) skipped — no blake3 available`);
    warn(TAG, `${lp} ${skippedNoHash} of ${items.length} videos skipped (no blake3)`);
    emit();
  }
  info(TAG, `${lp} eligible videos: ${eligible.length}`);

  let alreadyPresent = new Set<string>();
  if (skipExisting && eligible.length > 0) {
    const blake3s = eligible.map((i) => i.blake3 as string);
    debug(TAG, `${lp} POST /api/blobz/has (${blake3s.length} hashes)`);
    alreadyPresent = await checkBlobsPresentOnDest(destTransport, blake3s, TAG, lp);
    info(TAG, `${lp} dest already has ${alreadyPresent.size}/${blake3s.length} blobs`);
  }

  progress.phase = "syncing";
  emit();

  for (const item of eligible) {
    const blake3 = item.blake3 as string;
    const shortHash = blake3.slice(0, 16);
    // stage this video's bytes with our own midden node before asking
    // dest to pull them - same reasoning as sendToRemote.ts's song loop:
    // grimoire's pull path falls back to a grimoire-only EnsureBlobRequest
    // federation message a plain browser can never answer, so a video
    // whose blake3 was never registered with this node (video's own local
    // import only computes blake3, it doesn't register it - see
    // docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 6) would
    // otherwise fail the pull outright with no fallback.
    if (item.video.opfs_path) {
      await ensureBlobServable(blake3, () => readVideoFromOPFS(item.video.opfs_path!)).catch(
        () => {}
      );
    }
    try {
      const body = await buildSyncVideoByBlake3Body({
        video: item.video,
        metadataRemote: source,
        sourceTransport,
        blake3,
        sha256: item.sha256,
        size: item.size,
        filename: item.video.title || item.blobId,
        sourceNodeId,
        sourceRemoteId,
        remoteName,
      });
      info(
        TAG,
        `${lp} POST /api/sync/video-by-blake3 "${item.video.title}" blake3=${shortHash} source_node_id=${sourceNodeId}${alreadyPresent.has(blake3) ? " (blob already on dest, reconciling links)" : ""}`
      );
      const resp = await destTransport.request(
        "POST",
        "/api/sync/video-by-blake3",
        JSON.stringify(body)
      );
      debug(TAG, `${lp} /api/sync/video-by-blake3 -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncVideoByBlake3Response>(
        "sync_video_by_blake3",
        resp.body,
        resp.status,
        (v) => SyncVideoByBlake3ResponseSchema.safeParse(v)
      );
      progress.syncedVideos += 1;
      progress.syncedBlake3s.push(blake3);
      info(
        TAG,
        `${lp} sync_video ok: "${item.video.title}" video_id=${data.video_id} blob_id=${data.media_blob_id} existing=${data.existing}`
      );
    } catch (e) {
      progress.failedVideos += 1;
      progress.failedBlake3s.push(blake3);
      const et = e instanceof EnvelopeError ? e.errorType : undefined;
      if (et === "peer_unauthorized") {
        progress.errors.unshift(peerUnauthorizedMessage(source, dest));
        logError(
          TAG,
          `${lp} video sync blocked by peer_unauthorized for "${item.video.title}" (${shortHash})`
        );
      } else {
        progress.errors.unshift(
          `sync_video_by_blake3 failed for ${item.video.title}: ${String(e)}`
        );
        logError(
          TAG,
          `${lp} video sync failed for "${item.video.title}" (${shortHash}): ${String(e)}`
        );
      }
    } finally {
      emit();
    }
  }

  progress.phase = progress.failedVideos > 0 && progress.syncedVideos === 0 ? "failed" : "done";
  emit();
  return progress;
}
