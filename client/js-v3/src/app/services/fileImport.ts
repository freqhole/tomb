// file import service - handles adding music files to library
import { processMusicFiles } from "../../music/services/metadata/fileProcessor";
import { createSong, findDuplicateSong } from "../../music/services/storage/db";
import { generateUUID } from "../../utils/uuid";

export interface ImportResult {
  addedCount: number;
  skippedCount: number;
}

// import music files from file picker
export async function importMusicFiles(files: FileList): Promise<ImportResult> {
  const fileArray = Array.from(files);
  let addedCount = 0;
  let skippedCount = 0;

  // generate song ids upfront (needed for opfs storage)
  const songIds = fileArray.map(() => generateUUID());

  // process files with their ids (creates artists/albums and returns songs)
  const songsData = await processMusicFiles(fileArray, songIds);

  for (const songData of songsData) {
    // check for duplicates - match on filename, file size, and last modified
    const isDuplicate = await findDuplicateSong(
      songData.file_name!,
      songData.file_size!,
      songData.last_modified!,
    );

    if (isDuplicate) {
      console.log(
        `skipping duplicate: ${songData.file_name} (${songData.file_size} bytes)`,
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
