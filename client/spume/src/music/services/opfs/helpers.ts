// opfs (origin private file system) helpers for audio storage
// used as fallback when file system access api is not available
import { debug, error as errorLog } from "../../../utils/logger";

// opfs directory for audio files
const AUDIO_DIR = "audio";
// opfs directory for thumbnail images
const THUMBNAILS_DIR = "thumbnails";

// get opfs root directory
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

// ensure audio directory exists
async function ensureAudioDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(AUDIO_DIR, { create: true });
}

// ensure thumbnails directory exists
async function ensureThumbnailsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(THUMBNAILS_DIR, { create: true });
}

// write audio file to opfs
export async function writeAudioToOPFS(blob: Blob, id: string, extension: string): Promise<string> {
  try {
    const audioDir = await ensureAudioDir();
    const fileName = `${id}.${extension}`;

    // create or get file handle
    const fileHandle = await audioDir.getFileHandle(fileName, { create: true });

    // create writable stream and write blob
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    debug("opfs", `wrote audio file to opfs: ${fileName} (${blob.size} bytes)`);
    return `${AUDIO_DIR}/${fileName}`;
  } catch (error) {
    errorLog("opfs", "write audio failed:", error);
    throw new Error(`failed to write audio to opfs: ${error}`);
  }
}

// how often a chunk-sink writable is flushed to disk - a
// FileSystemWritableFileStream only persists past its internal swap file
// once close() is called (per spec/MDN), so without periodic checkpoints a
// mid-download failure would discard everything. mirrors video's own
// streamVideoToOPFSWithResume checkpoint size.
const CHUNK_SINK_CHECKPOINT_BYTES = 8 * 1024 * 1024;

/**
 * open an OPFS destination for a synced audio file and return a sink that
 * can be driven directly by Transport.streamBlobToSink's onChunk callback,
 * so a p2p download never has to be assembled into one in-memory buffer
 * before landing on disk - see
 * docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 2. no resume
 * support (unlike streamVideoToOPFSWithResume's HTTP Range-based resume) -
 * a p2p download's own resume/pause lives in midden's persistent blob
 * store instead, so this always starts the destination file fresh.
 */
export async function openAudioOPFSChunkSink(
  id: string,
  extension: string
): Promise<{
  writeChunk: (chunk: Uint8Array) => Promise<void>;
  finish: () => Promise<{ opfsPath: string; size: number }>;
}> {
  const audioDir = await ensureAudioDir();
  const fileName = `${id}.${extension}`;
  const opfsPath = `${AUDIO_DIR}/${fileName}`;
  const fileHandle = await audioDir.getFileHandle(fileName, { create: true });

  let writable = await fileHandle.createWritable();
  let written = 0;
  let sinceCheckpoint = 0;
  let closed = false;

  const writeChunk = async (chunk: Uint8Array): Promise<void> => {
    // chunks arriving via Comlink/wasm transfers are always plain
    // ArrayBuffers, never SharedArrayBuffer - safe to assert.
    const buffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength
    ) as ArrayBuffer;
    await writable.write(buffer);
    written += chunk.length;
    sinceCheckpoint += chunk.length;
    if (sinceCheckpoint >= CHUNK_SINK_CHECKPOINT_BYTES) {
      await writable.close();
      writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(written);
      sinceCheckpoint = 0;
    }
  };

  const finish = async (): Promise<{ opfsPath: string; size: number }> => {
    if (!closed) {
      closed = true;
      await writable.close();
    }
    debug("opfs", `streamed audio chunks to opfs: ${fileName} (${written} bytes)`);
    return { opfsPath, size: written };
  };

  return { writeChunk, finish };
}

// write thumbnail image to opfs
export async function writeThumbnailToOPFS(blob: Blob, id: string): Promise<string> {
  try {
    const thumbnailsDir = await ensureThumbnailsDir();

    // determine extension from mime type
    const mimeType = blob.type || "image/jpeg";
    const extension = mimeType.split("/")[1] || "jpg";
    const fileName = `${id}.${extension}`;

    // create or get file handle
    const fileHandle = await thumbnailsDir.getFileHandle(fileName, {
      create: true,
    });

    // create writable stream and write blob
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    return `${THUMBNAILS_DIR}/${fileName}`;
  } catch (error) {
    errorLog("opfs", "write thumbnail failed:", error);
    throw new Error(`failed to write thumbnail to opfs: ${error}`);
  }
}

// read audio file from opfs
export async function readAudioFromOPFS(path: string): Promise<File> {
  try {
    // path format: "audio/id.ext"
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== AUDIO_DIR) {
      throw new Error(`invalid opfs path: ${path}`);
    }

    const fileName = parts[1];
    const audioDir = await ensureAudioDir();
    const fileHandle = await audioDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    debug("opfs", `read audio file from opfs: ${fileName} (${file.size} bytes)`);
    return file;
  } catch (error) {
    errorLog("opfs", `read audio failed (${path}):`, error);
    throw new Error(`failed to read audio from opfs: ${error}`);
  }
}

// read thumbnail image from opfs
export async function readThumbnailFromOPFS(path: string): Promise<File> {
  try {
    // path format: "thumbnails/id.ext"
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== THUMBNAILS_DIR) {
      throw new Error(`invalid opfs path: ${path}`);
    }

    const fileName = parts[1];
    const thumbnailsDir = await ensureThumbnailsDir();
    const fileHandle = await thumbnailsDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    return file;
  } catch (error) {
    errorLog("opfs", `read thumbnail failed (${path}):`, error);
    throw new Error(`failed to read thumbnail from opfs: ${error}`);
  }
}

// delete audio file from opfs
export async function deleteAudioFromOPFS(path: string): Promise<void> {
  try {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== AUDIO_DIR) {
      throw new Error(`invalid opfs path: ${path}`);
    }

    const fileName = parts[1];
    const audioDir = await ensureAudioDir();
    await audioDir.removeEntry(fileName);

    debug("opfs", `deleted audio file from opfs: ${fileName}`);
  } catch (error) {
    errorLog("opfs", `delete audio failed (${path}):`, error);
    throw new Error(`failed to delete audio from opfs: ${error}`);
  }
}

// delete thumbnail file from opfs by blob id
export async function deleteThumbnailFromOPFS(blobId: string): Promise<void> {
  try {
    const thumbnailsDir = await ensureThumbnailsDir();

    // we don't know the exact extension, so iterate to find the file
    for await (const [name, handle] of thumbnailsDir.entries()) {
      if (handle.kind === "file" && name.startsWith(blobId + ".")) {
        await thumbnailsDir.removeEntry(name);
        debug("opfs", `deleted thumbnail from opfs: ${name}`);
        return;
      }
    }

    // if not found by prefix, try exact match (for legacy files without extension)
    try {
      await thumbnailsDir.removeEntry(blobId);
      debug("opfs", `deleted thumbnail from opfs: ${blobId}`);
    } catch {
      // file doesn't exist, that's fine
    }
  } catch (error) {
    errorLog("opfs", `delete thumbnail failed (${blobId}):`, error);
    throw new Error(`failed to delete thumbnail from opfs: ${error}`);
  }
}

// get opfs storage usage info
export async function getOPFSUsage(): Promise<{
  usage: number;
  quota: number;
}> {
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
    };
  } catch (error) {
    errorLog("opfs", "get usage failed:", error);
    return { usage: 0, quota: 0 };
  }
}

// check if opfs is supported
export function isOPFSSupported(): boolean {
  return (
    "storage" in navigator &&
    "getDirectory" in navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

// get file extension from mime type or filename
export function getFileExtension(mimeType: string, fileName?: string): string {
  // try to get from filename first
  if (fileName) {
    const match = fileName.match(/\.([^.]+)$/);
    if (match) return match[1];
  }

  // fallback to mime type
  const mimeToExt: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
  };

  return mimeToExt[mimeType] || "audio";
}
