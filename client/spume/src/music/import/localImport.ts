// local import service - handles adding music files to the local IndexedDB/OPFS library
import { createSignal } from "solid-js";
import { processMusicFiles } from "./fileProcessor";
import {
  createSong,
  getSongBySha256,
} from "../services/storage/db";
import { computeSHA256 } from "../../utils/hash";

export interface ImportResult {
  addedCount: number;
  skippedCount: number;
}

// local import progress — tracks the current phase and file-level progress
export type LocalImportPhase = "idle" | "hashing" | "processing" | "saving" | "done" | "error";

export interface LocalImportProgress {
  phase: LocalImportPhase;
  current: number; // current file index (1-based)
  total: number; // total files
  currentFile: string; // name of file being processed
  addedCount: number;
  skippedCount: number;
  errorMessage?: string;
}

const IDLE_PROGRESS: LocalImportProgress = {
  phase: "idle",
  current: 0,
  total: 0,
  currentFile: "",
  addedCount: 0,
  skippedCount: 0,
};

// reactive signal for local import progress
const [localImportProgress, setLocalImportProgress] = createSignal<LocalImportProgress>(IDLE_PROGRESS);

/** get reactive local import progress */
export function getLocalImportProgress() {
  return localImportProgress();
}

/** reset local import progress to idle */
export function clearLocalImportProgress() {
  setLocalImportProgress(IDLE_PROGRESS);
}

// import music files from file picker into local library
export async function importMusicFiles(files: FileList): Promise<ImportResult> {
  const fileArray = Array.from(files);
  let addedCount = 0;
  let skippedCount = 0;

  // phase 1: hashing
  setLocalImportProgress({
    phase: "hashing",
    current: 0,
    total: fileArray.length,
    currentFile: fileArray[0]?.name ?? "",
    addedCount: 0,
    skippedCount: 0,
  });

  console.log("computing sha256 hashes for uploaded files...");
  const sha256Hashes: string[] = [];
  for (let i = 0; i < fileArray.length; i++) {
    setLocalImportProgress((prev) => ({
      ...prev,
      phase: "hashing",
      current: i + 1,
      currentFile: fileArray[i].name,
    }));
    sha256Hashes.push(await computeSHA256(fileArray[i]));
  }

  // phase 2: processing metadata
  setLocalImportProgress((prev) => ({
    ...prev,
    phase: "processing",
    current: 0,
    currentFile: "extracting metadata...",
  }));

  const songsData = await processMusicFiles(fileArray, sha256Hashes);

  // phase 3: saving to idb
  for (let i = 0; i < songsData.length; i++) {
    const songData = songsData[i];

    setLocalImportProgress((prev) => ({
      ...prev,
      phase: "saving",
      current: i + 1,
      total: songsData.length,
      currentFile: songData.file_name ?? "",
      addedCount,
      skippedCount,
    }));

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
      console.log(`added: ${songData.file_name} (sha256: ${songData.sha256.slice(0, 8)}...)`);
    } catch (error) {
      // handle constraint error (duplicate sha256 from race condition or stale index)
      if (error instanceof Error && error.name === 'ConstraintError') {
        console.warn(
          `skipping duplicate (constraint error): ${songData.file_name} - sha256 ${songData.sha256.slice(0, 8)}... already exists in database`,
        );
        console.warn('this suggests getSongBySha256 did not find the existing song - possible stale index');
        skippedCount++;
      } else {
        // re-throw unexpected errors
        setLocalImportProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: error instanceof Error ? error.message : "unknown error",
        }));
        throw error;
      }
    }
  }

  // done
  setLocalImportProgress({
    phase: "done",
    current: songsData.length,
    total: songsData.length,
    currentFile: "",
    addedCount,
    skippedCount,
  });

  console.log(`added ${addedCount} songs, skipped ${skippedCount} duplicates`);
  return { addedCount, skippedCount };
}
