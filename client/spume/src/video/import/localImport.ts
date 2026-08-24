// local import service — handles adding video files to the local OPFS/IndexedDB
// library. mirrors music/import/localImport.ts's structure; duration comes from
// an offscreen <video> element's loadedmetadata event (instead of an audio-decode
// step) and a poster thumbnail is captured by seeking the video and drawing the
// frame to a canvas.
import {
  isOPFSSupported,
  writeVideoPosterToOPFS,
  writeVideoToOPFS,
} from "../services/opfs/helpers";
import { addLocalVideo } from "../services/storage/db/videos";
import { debug, warn } from "../../utils/logger";

export interface VideoImportResult {
  imported: number;
  errors: string[];
}

interface ExtractedVideoMetadata {
  durationSeconds: number;
  posterBlob: Blob | null;
}

// mime-to-extension fallback used only when a file's name has no extension.
const VIDEO_MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
};

function guessVideoExtension(file: File): string {
  const match = file.name.match(/\.([^.]+)$/);
  if (match) return match[1].toLowerCase();
  return VIDEO_MIME_TO_EXT[file.type] ?? "mp4";
}

// load a video file offscreen, read its duration, and capture a poster frame
// by seeking to ~1s (or the midpoint for very short clips) and drawing to canvas.
async function extractVideoMetadata(file: File): Promise<ExtractedVideoMetadata> {
  return new Promise((resolve) => {
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.muted = true;
    videoEl.playsInline = true;
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (result: ExtractedVideoMetadata) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const captureFrame = (durationSeconds: number) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth || 320;
        canvas.height = videoEl.videoHeight || 180;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish({ durationSeconds, posterBlob: null });
          return;
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish({ durationSeconds, posterBlob: blob }), "image/jpeg", 0.85);
      } catch (error) {
        warn("video/localImport", `poster capture failed for ${file.name}:`, error);
        finish({ durationSeconds, posterBlob: null });
      }
    };

    videoEl.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
      if (duration <= 0) {
        finish({ durationSeconds: 0, posterBlob: null });
        return;
      }
      const seekTime = Math.min(1, duration / 2);
      videoEl.addEventListener("seeked", () => captureFrame(Math.round(duration)), {
        once: true,
      });
      videoEl.currentTime = seekTime;
    });

    videoEl.addEventListener("error", () => {
      finish({ durationSeconds: 0, posterBlob: null });
    });

    videoEl.src = url;
  });
}

// import video files from a file picker (or dropped files) into the local library
export async function importVideoFiles(files: File[]): Promise<VideoImportResult> {
  if (!isOPFSSupported()) {
    return { imported: 0, errors: ["opfs not supported in this browser"] };
  }

  let imported = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const id = crypto.randomUUID();
      const extension = guessVideoExtension(file);
      debug("video/localImport", `writing to opfs: ${file.name}`);
      const opfsPath = await writeVideoToOPFS(file, id, extension);

      const { durationSeconds, posterBlob } = await extractVideoMetadata(file);
      let posterOpfsPath: string | null = null;
      if (posterBlob) {
        posterOpfsPath = await writeVideoPosterToOPFS(posterBlob, id);
      }

      await addLocalVideo({
        id,
        title: file.name.replace(/\.[^/.]+$/, ""),
        opfs_path: opfsPath,
        poster_opfs_path: posterOpfsPath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "video/mp4",
        duration_seconds: durationSeconds > 0 ? durationSeconds : null,
      });
      imported++;
      debug("video/localImport", `added: ${file.name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error";
      warn("video/localImport", `failed to import ${file.name}:`, error);
      errors.push(`${file.name}: ${msg}`);
    }
  }

  return { imported, errors };
}
