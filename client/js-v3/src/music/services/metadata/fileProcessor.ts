// file processing service - extract metadata from audio files
import { parseBlob } from "music-metadata";
import {
  getFileExtension,
  isOPFSSupported,
  writeAudioToOPFS,
} from "../opfs/helpers";
import type { MusicSong } from "../storage/types";

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  mime_type: string;
}

// extract metadata from audio file
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  const [tags, duration] = await Promise.all([
    readID3Tags(file),
    getAudioDuration(file),
  ]);

  return {
    title: tags.title || file.name.replace(/\.[^/.]+$/, ""), // fallback to filename without extension
    artist: tags.artist || "unknown artist",
    album: tags.album || "unknown album",
    duration,
    mime_type: file.type || "audio/mpeg",
  };
}

// read metadata tags from file
async function readID3Tags(
  file: File,
): Promise<{ title?: string; artist?: string; album?: string }> {
  try {
    const metadata = await parseBlob(file);
    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
    };
  } catch (error) {
    // if tag reading fails, return empty object
    console.error("failed to read metadata:", error);
    return {};
  }
}

// get audio duration by loading file in audio element
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      // fallback to 0 if duration can't be read
      resolve(0);
    });

    audio.src = url;
  });
}

// create song object from file
export async function processMusicFile(
  file: File,
  songId: string,
): Promise<Omit<MusicSong, "id">> {
  const metadata = await extractMetadata(file);

  // check opfs support
  if (!isOPFSSupported()) {
    throw new Error("opfs not supported in this browser");
  }

  // write file to opfs
  console.log(`writing to opfs: ${file.name}`);
  const extension = getFileExtension(metadata.mime_type, file.name);
  const opfsPath = await writeAudioToOPFS(file, songId, extension);

  return {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration: metadata.duration,
    mime_type: metadata.mime_type,
    added_at: Date.now(),
    source_type: "local",
    opfs_path: opfsPath,
    file_name: file.name,
    file_size: file.size,
    last_modified: file.lastModified,
    source_url: null,
    server_id: null,
    remote_song_id: null,
  };
}

// batch process multiple files
export async function processMusicFiles(
  files: FileList | File[],
  songIds: string[],
): Promise<Array<Omit<MusicSong, "id">>> {
  const fileArray = Array.from(files);

  if (fileArray.length !== songIds.length) {
    throw new Error("files and songIds arrays must have same length");
  }

  const results = await Promise.all(
    fileArray.map((file, index) => processMusicFile(file, songIds[index])),
  );
  return results;
}
