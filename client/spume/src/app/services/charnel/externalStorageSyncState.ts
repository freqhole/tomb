// global "is a removable-storage sync currently running" flag, plus the
// current sync's live per-song progress.
//
// the playerbar's sd-card icon (mounted once in AppLayout.tsx) needs both
// even when the user isn't looking at StorageOverviewView, so neither can
// just be local state on that view - these are shared signals, set by a
// listener that also lives in AppLayout.tsx (see its
// `onExternalStorageSyncProgress` subscription) so progress keeps
// updating even after navigating away mid-sync, mirroring the
// `localNodeId.ts` accessor pattern.

import { createSignal } from "solid-js";

export interface ExternalStorageSyncProgress {
  title: string;
  current: number;
  total: number;
}

const [externalStorageSyncing, setExternalStorageSyncingSignal] = createSignal(false);
const [externalStorageSyncProgress, setExternalStorageSyncProgressSignal] =
  createSignal<ExternalStorageSyncProgress | null>(null);

/** reactive accessor for solid components (e.g. the playerbar). */
export const externalStorageSyncingSignal = externalStorageSyncing;

/** reactive accessor for the current sync's per-song progress, if any. */
export const externalStorageSyncProgressSignal = externalStorageSyncProgress;

/** set by whoever kicks off/finishes a sync (currently just StorageOverviewView). */
export function setExternalStorageSyncing(value: boolean): void {
  setExternalStorageSyncingSignal(value);
  if (!value) {
    // clear any stale "N/M" reading once a sync ends, so a later busy
    // state (or the playerbar icon) never briefly shows the last run's
    // numbers before fresh ones arrive.
    setExternalStorageSyncProgressSignal(null);
  }
}

/** set by the global sync-progress event listener in `AppLayout.tsx`. */
export function setExternalStorageSyncProgress(progress: ExternalStorageSyncProgress | null): void {
  setExternalStorageSyncProgressSignal(progress);
}
