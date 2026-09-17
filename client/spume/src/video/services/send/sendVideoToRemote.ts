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
import { getTransportForRemote, isP2PTransportType } from "../../../app/api/client";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import { getLocalNodeId } from "../../../app/services/charnel";
import { isP2PRemote, type Remote } from "../../../app/services/storage/schemas/remote";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { debug, info, warn, error as logError } from "../../../utils/logger";
import { buildSyncVideoByBlake3Body } from "../sync/buildSyncVideoRequest";
import { EnvelopeError, unwrapEnvelope } from "../../../music/services/send/sendToRemote";

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

  const destOk = isP2PTransportType(dest) || dest.is_charnel_managed === true;
  if (!destOk) {
    logError(TAG, `${lp} invalid dest transport: dest=${dest.remote_id}`);
    throw new SendVideoToRemoteError(
      "destination must be a p2p remote or the local charnel app",
      progress
    );
  }

  let sourceNodeId: string | null = null;
  if (isP2PRemote(source)) {
    sourceNodeId = extractNodeIdStrict(source.peer_addr);
  }
  if (!sourceNodeId && source.is_charnel_managed) {
    sourceNodeId = getLocalNodeId();
  }
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
    try {
      const blake3s = eligible.map((i) => i.blake3 as string);
      debug(TAG, `${lp} POST /api/blobz/has (${blake3s.length} hashes)`);
      const resp = await destTransport.request(
        "POST",
        "/api/blobz/has",
        JSON.stringify({ blake3s })
      );
      if (resp.status >= 200 && resp.status < 300) {
        const rawJson = JSON.parse(resp.body) as { data?: { blake3s_present?: string[] } };
        const present = rawJson?.data?.blake3s_present;
        if (Array.isArray(present)) {
          alreadyPresent = new Set(present);
          info(TAG, `${lp} dest already has ${alreadyPresent.size}/${blake3s.length} blobs`);
        }
      }
    } catch (e) {
      warn(TAG, `${lp} /api/blobz/has pre-check failed: ${String(e)}`);
    }
  }

  progress.phase = "syncing";
  emit();

  for (const item of eligible) {
    const blake3 = item.blake3 as string;
    const shortHash = blake3.slice(0, 16);
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
        progress.errors.unshift(
          `access required: ${source.name ?? "source"} has not authorized ${dest.name ?? "dest"} — an access request was sent automatically. accept it on ${source.name ?? "the source"}, then retry the send.`
        );
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
