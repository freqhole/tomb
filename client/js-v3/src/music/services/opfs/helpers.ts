// opfs (origin private file system) helpers for audio storage
// used as fallback when file system access api is not available

// opfs directory for audio files
const AUDIO_DIR = "audio";

// get opfs root directory
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

// ensure audio directory exists
async function ensureAudioDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle(AUDIO_DIR, { create: true });
}

// write audio file to opfs
export async function writeAudioToOPFS(
  blob: Blob,
  id: string,
  extension: string,
): Promise<string> {
  try {
    const audioDir = await ensureAudioDir();
    const fileName = `${id}.${extension}`;

    // create or get file handle
    const fileHandle = await audioDir.getFileHandle(fileName, { create: true });

    // create writable stream and write blob
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    console.log(`wrote audio file to opfs: ${fileName} (${blob.size} bytes)`);
    return `${AUDIO_DIR}/${fileName}`;
  } catch (error) {
    console.error("failed to write audio to opfs:", error);
    throw new Error(`failed to write audio to opfs: ${error}`);
  }
}

// read audio file from opfs
export async function readAudioFromOPFS(
  path: string,
): Promise<File> {
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

    console.log(`read audio file from opfs: ${fileName} (${file.size} bytes)`);
    return file;
  } catch (error) {
    console.error(`failed to read audio from opfs (${path}):`, error);
    throw new Error(`failed to read audio from opfs: ${error}`);
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

    console.log(`deleted audio file from opfs: ${fileName}`);
  } catch (error) {
    console.error(`failed to delete audio from opfs (${path}):`, error);
    throw new Error(`failed to delete audio from opfs: ${error}`);
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
    console.error("failed to get opfs usage:", error);
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
export function getFileExtension(
  mimeType: string,
  fileName?: string,
): string {
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
