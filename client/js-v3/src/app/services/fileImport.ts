// file import service - handles adding music files to library
import { processMusicFiles } from "../../music/services/metadata/fileProcessor";
import {
  createSong,
  getSongBySha256,
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
    // check for duplicates by sha256 (content-based deduplication)
    const existingSong = await getSongBySha256(songData.sha256);

    if (existingSong) {
      console.log(
        `skipping duplicate (sha256 match): ${songData.file_name} - already exists as song id ${existingSong.id}`,
      );
      skippedCount++;
      continue;
    }

    // no duplicate found, add the song
    try {
      await createSong(songData);
      addedCount++;
      console.log(`✓ added: ${songData.file_name} (sha256: ${songData.sha256.slice(0, 8)}...)`);
    } catch (error) {
      // handle constraint error (duplicate sha256 from race condition or stale index)
      if (error instanceof Error && error.name === 'ConstraintError') {
        console.warn(
          `⚠ skipping duplicate (constraint error): ${songData.file_name} - sha256 ${songData.sha256.slice(0, 8)}... already exists in database`,
        );
        console.warn('this suggests getSongBySha256 did not find the existing song - possible stale index');
        skippedCount++;
      } else {
        // re-throw unexpected errors
        throw error;
      }
    }
  }

  console.log(`added ${addedCount} songs, skipped ${skippedCount} duplicates`);
  return { addedCount, skippedCount };
}
