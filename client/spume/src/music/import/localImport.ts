// local import service - handles adding music files to the local IndexedDB/OPFS library
import { createSignal } from "solid-js";
import { processMusicFiles } from "./fileProcessor";
import { createSong, getSongBySha256, getSongByBlake3 } from "../services/storage/db";
import {
  createLocalImportSession,
  recordLocalImportBlob,
  type LocalImportReviewSendTarget,
} from "../services/storage/db/importReview";
import { generateUUID } from "../../utils/uuid";
import { hashBlake3Streaming } from "@freqhole/reliquary/worker";
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

  // phase 0: cheap blake3-only dedup pre-check (streaming, no full-file
  // buffer - see hashBlake3Streaming). also doubles as this batch's ONLY
  // hashing pass now - a fresh local import no longer computes a real
  // sha256 at all (see fileProcessor.ts's processMusicFile doc comment
  // for the full reasoning/tradeoff - part of the ongoing sha256->blake3
  // deprecation, docs/blob-transfer-opfs-and-sha256-refactor-plan.md
  // phase 7). `Song.sha256` stays a real, required string field for now
  // (still the identity for OLDER, pre-this-change songs) - new rows
  // just leave it "" and rely on `blake3` instead.
  setLocalImportProgress({
    phase: "hashing",
    current: 0,
    total: fileArray.length,
    currentFile: fileArray[0]?.name ?? "",
    addedCount: 0,
    skippedCount: 0,
  });

  const candidates: File[] = [];
  for (let i = 0; i < fileArray.length; i++) {
    setLocalImportProgress((prev) => ({
      ...prev,
      phase: "hashing",
      current: i + 1,
      currentFile: fileArray[i].name,
    }));
    let blake3: string | null = null;
    try {
      blake3 = await hashBlake3Streaming(fileArray[i]);
    } catch (err) {
      warn("localImport", `failed to blake3-hash ${fileArray[i].name} for dedup pre-check:`, err);
    }
    if (blake3 && (await getSongByBlake3(blake3))) {
      debug("localImport", `skipping duplicate (blake3 match): ${fileArray[i].name}`);
      skippedCount++;
      continue;
    }
    candidates.push(fileArray[i]);
  }

  // phase 1: generate an opaque per-file OPFS storage key for each
  // surviving candidate - NOT a content hash, just a random id (same idea
  // as Song.id) used only to name the file on disk (audio/<key>.<ext>).
  // see fileProcessor.ts's processMusicFile doc comment for why this
  // replaced a whole-file sha256 read here.
  const opfsKeys: string[] = candidates.map(() => generateUUID());

  // phase 2: processing metadata
  setLocalImportProgress((prev) => ({
    ...prev,
    phase: "processing",
    current: 0,
    currentFile: "extracting metadata...",
  }));

  const songsData = await processMusicFiles(candidates, opfsKeys);

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

    // safety-net duplicate check: `songData.sha256` is "" for every new
    // import now (see fileProcessor.ts), so `getSongBySha256` guards
    // against that and returns undefined immediately - this only ever
    // matches an OLDER song that still has a real, pre-this-change
    // sha256 stored (the phase-0 blake3 pre-check already handled the
    // common "re-imported the same file" case above).
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
        `added: ${songData.file_name} (${songData.blake3 ? `blake3: ${songData.blake3.slice(0, 8)}` : "no blake3"})`
      );
    } catch (error) {
      // handle constraint error (duplicate real sha256 from a race
      // condition against an OLDER song, or a stale index) - a fresh
      // import's own "" sha256 can no longer cause this (by_sha256 is
      // non-unique as of DB v20, see db/init.ts).
      if (error instanceof Error && error.name === "ConstraintError") {
        warn(
          "localImport",
          `skipping duplicate (constraint error): ${songData.file_name} - already exists in database`
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
