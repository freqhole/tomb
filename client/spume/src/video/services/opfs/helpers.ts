// opfs (origin private file system) helpers for local video storage.
// mirrors music/services/opfs/helpers.ts's audio/thumbnail pattern, kept
// as its own copy (own directory names) per the video domain's isolation
// rule — never edit music's opfs helpers to make room for video.
import { debug, error as errorLog } from "../../../utils/logger";

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
