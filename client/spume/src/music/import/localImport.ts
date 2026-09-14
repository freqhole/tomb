// local import service - handles adding music files to the local IndexedDB/OPFS library
import { createSignal } from "solid-js";
import { processMusicFiles } from "./fileProcessor";
import { createSong, getSongBySha256 } from "../services/storage/db";
import {
  createLocalImportSession,
  recordLocalImportBlob,
  type LocalImportReviewSendTarget,
} from "../services/storage/db/importReview";
import { computeSHA256 } from "../../utils/hash";
import { debug, warn } from "../../utils/logger";
import { errorMessageFrom } from "../../utils/humanizeJobError";

export interface ImportResult {
  addedCount: number;
  skippedCount: number;
  /** local review session this batch landed in - see importReview.ts.
   * always created, even for a batch that turns out to be all duplicates
   * (mirrors grimoire's import_music_paths, which does the same). */
  sessionId: string;
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
const [localImportProgress, setLocalImportProgress] =
  createSignal<LocalImportProgress>(IDLE_PROGRESS);

/** get reactive local import progress */
export function getLocalImportProgress() {
  return localImportProgress();
}

/** reset local import progress to idle */
export function clearLocalImportProgress() {
  setLocalImportProgress(IDLE_PROGRESS);
}

// import music files from file picker into local library. every batch is
// tracked as a review session (see importReview.ts) so web/browser clients
// get the same "review before send" flow desktop/android already have via
// grimoire - `target`, when set, tags the session to be sent to that
// remote once reviewed (see AddMediaModal's local-review wiring).
export async function importMusicFiles(
  files: FileList,
  target?: LocalImportReviewSendTarget
): Promise<ImportResult> {
  const fileArray = Array.from(files);
  let addedCount = 0;
  let skippedCount = 0;
  const sessionId = await createLocalImportSession(target);

  // phase 1: hashing
  setLocalImportProgress({
    phase: "hashing",
    current: 0,
    total: fileArray.length,
    currentFile: fileArray[0]?.name ?? "",
    addedCount: 0,
    skippedCount: 0,
  });

  debug("localImport", "computing sha256 hashes for uploaded files...");
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
      debug(
        "localImport",
        `skipping duplicate (sha256 match): ${songData.file_name} - already exists as song id ${existingSong.id}`
      );
      skippedCount++;
      continue;
    }

    // no duplicate found, add the song
    try {
      const song = await createSong(songData);
      await recordLocalImportBlob(sessionId, song.id);
      addedCount++;
      debug(
        "localImport",
        `added: ${songData.file_name} (sha256: ${songData.sha256.slice(0, 8)}...)`
      );
    } catch (error) {
      // handle constraint error (duplicate sha256 from race condition or stale index)
      if (error instanceof Error && error.name === "ConstraintError") {
        warn(
          "localImport",
          `skipping duplicate (constraint error): ${songData.file_name} - sha256 ${songData.sha256.slice(0, 8)}... already exists in database`
        );
        warn(
          "localImport",
          "this suggests getSongBySha256 did not find the existing song - possible stale index"
        );
        skippedCount++;
      } else {
        // re-throw unexpected errors
        setLocalImportProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: errorMessageFrom(error),
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

  debug("localImport", `added ${addedCount} songs, skipped ${skippedCount} duplicates`);
  return { addedCount, skippedCount, sessionId };
}
