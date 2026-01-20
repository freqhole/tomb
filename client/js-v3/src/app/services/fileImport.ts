// file import service - handles adding music files to library
import { processMusicFiles } from "../../music/services/metadata/fileProcessor";
import {
  createSong,
  findDuplicateSong,
  getSongById,
} from "../../music/services/storage/db";
import { computeSHA256 } from "../../utils/hash";

export interface ImportResult {
  addedCount: number;
  skippedCount: number;
}

// import music files from file picker
export async function importMusicFiles(files: FileList): Promise<ImportResult> {
  const fileArray = Array.from(files);
  let addedCount = 0;
  let skippedCount = 0;

  // compute sha256 hashes for all files upfront (used as primary keys and opfs storage)
  console.log("computing sha256 hashes for uploaded files...");
  const sha256Hashes = await Promise.all(
    fileArray.map((file) => computeSHA256(file)),
  );

  // process files with their sha256 hashes (creates artists/albums and returns songs)
  const songsData = await processMusicFiles(fileArray, sha256Hashes);

  for (const songData of songsData) {
    // check for duplicates by sha256 first (content-based deduplication)
    const existingSong = await getSongById(songData.sha256);

    if (existingSong) {
      console.log(
        `skipping duplicate (sha256 match): ${songData.file_name} - already exists as ${existingSong.file_name}`,
      );
      skippedCount++;
      continue;
    }

    // fallback: check for duplicates by file metadata
    const isDuplicate = await findDuplicateSong(
      songData.file_name!,
      songData.file_size!,
      songData.last_modified!,
    );

    if (isDuplicate) {
      console.log(
        `skipping duplicate (metadata match): ${songData.file_name} (${songData.file_size} bytes)`,
      );
      skippedCount++;
    } else {
      await createSong(songData);
      addedCount++;
    }
  }

  console.log(`added ${addedCount} songs, skipped ${skippedCount} duplicates`);
  return { addedCount, skippedCount };
}
