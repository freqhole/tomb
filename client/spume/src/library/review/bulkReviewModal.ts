// signal-based modal state for the bulk-enrichment review wizard
// (phase 11 / slice 1). mirrors the `showAlbumEditor` / `useAlbumEditorState`
// pattern in `music/hooks/modals.ts` so the modal can be mounted globally
// in App.tsx and driven from any caller without prop-drilling.

import { createSignal } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";

export interface BulkReviewOptions {
  /** ordered list of album_ids in the review batch (as filtered by the
   *  caller — typically `review_status='pending'`). */
  ids: string[];
  /** which entry to show first (0-based). */
  currentIndex: number;
  /** remote that owns the batch. all proposal / apply / status calls
   *  go through this remote. */
  remote: Remote;
  /** advance to next album. caller owns the cursor. */
  onNext: () => void;
  /** go back one album. */
  onPrev: () => void;
  /** close the modal but leave the bulk-enrichment session running. */
  onExit: () => void;
}

const [bulkReviewState, setBulkReviewState] =
  createSignal<BulkReviewOptions | null>(null);

export function showBulkReview(options: BulkReviewOptions) {
  setBulkReviewState(options);
}

export function hideBulkReview() {
  setBulkReviewState(null);
}

export function useBulkReviewState() {
  return bulkReviewState;
}
