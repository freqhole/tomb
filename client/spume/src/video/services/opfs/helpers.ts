// opfs (origin private file system) helpers for local video storage.
// mirrors music/services/opfs/helpers.ts's audio/thumbnail pattern, kept
// as its own copy (own directory names) per the video domain's isolation
// rule — never edit music's opfs helpers to make room for video.
import { debug, error as errorLog } from "../../../utils/logger";
import { unmarkVideoSynced } from "../syncState";

// opfs directory for video files
const VIDEO_DIR = "video";
// opfs directory for poster/thumbnail images
const POSTERS_DIR = "video-posters";

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function ensureVideoDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(VIDEO_DIR, { create: true });
}

async function ensurePostersDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(POSTERS_DIR, { create: true });
}

export function isOPFSSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

// write video file to opfs, returns the stored path (e.g. "video/id.mp4")
export async function writeVideoToOPFS(blob: Blob, id: string, extension: string): Promise<string> {
  try {
    const videoDir = await ensureVideoDir();
    const fileName = `${id}.${extension}`;
    const fileHandle = await videoDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    debug("opfs", `wrote video file to opfs: ${fileName} (${blob.size} bytes)`);
    return `${VIDEO_DIR}/${fileName}`;
  } catch (error) {
    errorLog("opfs", "write video failed:", error);
    throw new Error(`failed to write video to opfs: ${error}`);
  }
}

// parse a `Content-Range: bytes <start>-<end>/<total>` (or `bytes */<total>`)
// response header, returning the total size if present.
function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const match = /\/(\d+)$/.exec(header);
  return match ? parseInt(match[1], 10) : null;
}

/** stream a remote video URL directly into an OPFS file, resuming a
 *  previously interrupted download instead of restarting from byte 0.
 *
 *  unlike `writeVideoToOPFS`, this never buffers the whole file in memory
 *  (each fetched chunk is written straight to disk) — the earlier
 *  buffer-then-write approach doubled peak memory use for large videos
 *  (once as raw chunks, again as the concatenated Blob), which could crash
 *  the tab before a large file ever finished downloading.
 *
 *  resume works because the file is named deterministically (`<id>.<ext>`,
 *  same as `writeVideoToOPFS`) and a partial file is never deleted on
 *  failure: on retry, the existing on-disk size becomes the `Range:
 *  bytes=<size>-` request offset. if the server doesn't honor the range
 *  (returns 200 instead of 206), the file is truncated and restarted from 0
 *  rather than risk corrupting it with misaligned data. requires the
 *  remote to advertise CORS access to the `Range` request header (see
 *  server/src/server.rs's CorsLayer). */
export async function streamVideoToOPFSWithResume(
  url: string,
  id: string,
  extension: string,
  expectedTotalBytes: number | null,
  onProgress?: (received: number, total: number | null) => void
): Promise<{ opfsPath: string; size: number }> {
  const videoDir = await ensureVideoDir();
  const fileName = `${id}.${extension}`;
  const opfsPath = `${VIDEO_DIR}/${fileName}`;
  const fileHandle = await videoDir.getFileHandle(fileName, { create: true });

  let existingSize = 0;
  try {
    existingSize = (await fileHandle.getFile()).size;
  } catch {
    existingSize = 0;
  }

  // already fully on disk from a previous attempt (e.g. the fetch
  // completed but a later step like addLocalVideo() failed) - skip the
  // network round-trip entirely.
  if (expectedTotalBytes != null && existingSize > 0 && existingSize >= expectedTotalBytes) {
    debug(
      "opfs",
      `video ${fileName} already fully present on disk (${existingSize} bytes), skipping fetch`
    );
    onProgress?.(existingSize, expectedTotalBytes);
    return { opfsPath, size: existingSize };
  }

  const headers: HeadersInit = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {};
  const response = await fetch(url, { credentials: "include", headers });

  if (response.status === 416) {
    // server says there's nothing left to fetch beyond existingSize -
    // treat what's on disk as complete rather than fail the whole sync.
    debug(
      "opfs",
      `video ${fileName}: range not satisfiable, treating ${existingSize} bytes as complete`
    );
    return { opfsPath, size: existingSize };
  }
  if (!response.ok) {
    throw new Error(`failed to fetch video blob: ${response.status}`);
  }

  // the server may ignore the Range header (e.g. a proxy stripped it) and
  // return the full body with 200 instead of 206 - in that case we must
  // restart from byte 0, not append the new body onto existing data.
  const isResumed = response.status === 206;
  const startPosition = isResumed ? existingSize : 0;

  const contentLength = response.headers.get("Content-Length");
  const total =
    parseContentRangeTotal(response.headers.get("Content-Range")) ??
    expectedTotalBytes ??
    (contentLength ? startPosition + parseInt(contentLength, 10) : null);

  // a FileSystemWritableFileStream only persists to the real on-disk file
  // when close() is called - writes before that land in a swap file only
  // (per spec/MDN). without periodic checkpointing, a mid-download failure
  // would discard everything back to startPosition, defeating resume
  // entirely. flush every CHECKPOINT_BYTES by closing and reopening a fresh
  // writable seeked to the current position.
  const CHECKPOINT_BYTES = 8 * 1024 * 1024;
  let writable = await fileHandle.createWritable({ keepExistingData: isResumed });
  if (isResumed) {
    await writable.seek(startPosition);
  }

  let received = startPosition;
  let sinceCheckpoint = 0;
  onProgress?.(received, total);

  try {
    if (!response.body) {
      // no streaming support in this environment - fall back to a single write
      const blob = await response.blob();
      await writable.write(blob);
      received = startPosition + blob.size;
    } else {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        received += value.length;
        sinceCheckpoint += value.length;
        onProgress?.(received, total);
        if (sinceCheckpoint >= CHECKPOINT_BYTES) {
          await writable.close();
          writable = await fileHandle.createWritable({ keepExistingData: true });
          await writable.seek(received);
          sinceCheckpoint = 0;
        }
      }
    }
    await writable.close();
  } catch (error) {
    // best-effort: persist whatever's been written since the last
    // checkpoint so the next attempt can resume from `received` rather
    // than from startPosition.
    try {
      await writable.close();
    } catch {
      // nothing more we can do - next attempt resumes from the last
      // successful checkpoint instead
    }
    throw error;
  }

  debug("opfs", `streamed video to opfs: ${fileName} (${received} bytes, resumed=${isResumed})`);
  return { opfsPath, size: received };
}

// write a poster/thumbnail image to opfs, returns the stored path
export async function writeVideoPosterToOPFS(blob: Blob, id: string): Promise<string> {
  try {
    const postersDir = await ensurePostersDir();
    const mimeType = blob.type || "image/jpeg";
    const extension = mimeType.split("/")[1] || "jpg";
    const fileName = `${id}.${extension}`;
    const fileHandle = await postersDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `${POSTERS_DIR}/${fileName}`;
  } catch (error) {
    errorLog("opfs", "write video poster failed:", error);
    throw new Error(`failed to write video poster to opfs: ${error}`);
  }
}

// read video file from opfs (path format: "video/id.ext")
export async function readVideoFromOPFS(path: string): Promise<File> {
  try {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== VIDEO_DIR) {
      throw new Error(`invalid opfs path: ${path}`);
    }
    const fileName = parts[1];
    const videoDir = await ensureVideoDir();
    const fileHandle = await videoDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    debug("opfs", `read video file from opfs: ${fileName} (${file.size} bytes)`);
    return file;
  } catch (error) {
    errorLog("opfs", `read video failed (${path}):`, error);
    throw new Error(`failed to read video from opfs: ${error}`);
  }
}

// read a poster/thumbnail image from opfs (path format: "video-posters/id.ext")
export async function readVideoPosterFromOPFS(path: string): Promise<File> {
  try {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== POSTERS_DIR) {
      throw new Error(`invalid opfs path: ${path}`);
    }
    const fileName = parts[1];
    const postersDir = await ensurePostersDir();
    const fileHandle = await postersDir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    errorLog("opfs", `read video poster failed (${path}):`, error);
    throw new Error(`failed to read video poster from opfs: ${error}`);
  }
}

// delete video file from opfs
export async function deleteVideoFromOPFS(path: string): Promise<void> {
  try {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== VIDEO_DIR) return;
    const videoDir = await ensureVideoDir();
    await videoDir.removeEntry(parts[1]);
  } catch (error) {
    errorLog("opfs", `delete video failed (${path}):`, error);
  }
}

// delete a poster/thumbnail image from opfs
export async function deleteVideoPosterFromOPFS(path: string): Promise<void> {
  try {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== POSTERS_DIR) return;
    const postersDir = await ensurePostersDir();
    await postersDir.removeEntry(parts[1]);
  } catch (error) {
    errorLog("opfs", `delete video poster failed (${path}):`, error);
  }
}

// get aggregate video OPFS usage stats (mirrors music's getOPFSUsage pattern but for video/video-posters dirs)
export async function getVideoOPFSUsage(): Promise<{
  videoSize: number;
  postersSize: number;
  videoCount: number;
  postersCount: number;
  totalSize: number;
}> {
  try {
    if (!isOPFSSupported()) {
      return { videoSize: 0, postersSize: 0, videoCount: 0, postersCount: 0, totalSize: 0 };
    }

    const root = await getOPFSRoot();
    let videoSize = 0;
    let postersSize = 0;
    let videoCount = 0;
    let postersCount = 0;

    // count video directory
    try {
      const videoDir = await root.getDirectoryHandle(VIDEO_DIR);
      for await (const entry of (videoDir as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          videoSize += file.size;
          videoCount++;
        }
      }
    } catch {
      // directory doesn't exist yet, not an error
    }

    // count posters directory
    try {
      const postersDir = await root.getDirectoryHandle(POSTERS_DIR);
      for await (const entry of (postersDir as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          postersSize += file.size;
          postersCount++;
        }
      }
    } catch {
      // directory doesn't exist yet, not an error
    }

    return {
      videoSize,
      postersSize,
      videoCount,
      postersCount,
      totalSize: videoSize + postersSize,
    };
  } catch (error) {
    errorLog("opfs", "get video opfs usage failed:", error);
    return { videoSize: 0, postersSize: 0, videoCount: 0, postersCount: 0, totalSize: 0 };
  }
}

// purge a single video from OPFS (delete OPFS files + IDB row) - a coherent single operation
export async function purgeVideoFromOPFS(videoId: string): Promise<void> {
  const { getLocalVideoById } = await import("../storage/db/videos");
  const { deleteLocalVideo } = await import("../storage/db/videos");

  try {
    const video = await getLocalVideoById(videoId);
    if (!video) {
      debug("opfs", `purgeVideoFromOPFS: video ${videoId} not found in IDB, skipping`);
      return;
    }

    // delete OPFS files first (if they exist)
    if (video.opfs_path) {
      await deleteVideoFromOPFS(video.opfs_path);
    }
    if (video.poster_opfs_path) {
      await deleteVideoPosterFromOPFS(video.poster_opfs_path);
    }

    // then delete the IDB row (so we never leave a dangling row pointing at deleted OPFS files)
    await deleteLocalVideo(videoId);
    unmarkVideoSynced(videoId);
    debug("opfs", `purged video ${videoId} from OPFS + IDB`);
  } catch (error) {
    errorLog("opfs", `purge video ${videoId} failed:`, error);
    throw error;
  }
}

// purge all videos from OPFS - continues past individual failures, doesn't abort the whole batch on one error
export async function purgeAllVideosFromOPFS(): Promise<void> {
  const { getLocalVideos } = await import("../storage/db/videos");

  try {
    // fetch all local videos (no pagination, get them all)
    const result = await getLocalVideos({ limit: 10000, offset: 0 });
    const videos = result.items;

    debug("opfs", `purging ${videos.length} videos from OPFS`);

    let successCount = 0;
    let failCount = 0;

    for (const video of videos) {
      try {
        await purgeVideoFromOPFS(video.id);
        successCount++;
      } catch (error) {
        errorLog("opfs", `failed to purge video ${video.id}:`, error);
        failCount++;
        // continue to next video, don't abort
      }
    }

    debug("opfs", `purge complete: ${successCount} success, ${failCount} failed`);
  } catch (error) {
    errorLog("opfs", "purge all videos failed:", error);
    throw error;
  }
}
