// add-video modal open/close state used to live here as its own isolated
// signal (mirroring music/hooks/modals.ts). replaced by the unified
// add-media modal state in app/hooks/mediaModal.ts (openAddMedia/
// closeAddMedia/useAddMediaState).
import { createSignal } from "solid-js";

// edit-video modal open/close state — mirrors the add-video signal above.
export interface EditVideoOptions {
  videoId: string;
  onSave?: () => void;
  /** called after a successful delete so callers can navigate away from the now-gone video */
  onDeleted?: () => void;
}

const [editVideoState, setEditVideoState] = createSignal<EditVideoOptions | null>(null);

export function showEditVideo(options: EditVideoOptions) {
  setEditVideoState(options);
}

export function hideEditVideo() {
  setEditVideoState(null);
}

export function useEditVideoState() {
  return editVideoState;
}

// edit-video-series modal open/close state — mirrors the edit-video signal above.
export interface EditVideoSeriesOptions {
  seriesId: string;
  onSave?: () => void;
  /** called after a successful delete so callers can navigate away from the now-gone series */
  onDeleted?: () => void;
}

const [editVideoSeriesState, setEditVideoSeriesState] = createSignal<EditVideoSeriesOptions | null>(
  null
);

export function showEditVideoSeries(options: EditVideoSeriesOptions) {
  setEditVideoSeriesState(options);
}

export function hideEditVideoSeries() {
  setEditVideoSeriesState(null);
}

export function useEditVideoSeriesState() {
  return editVideoSeriesState;
}

// bulk-edit-videos modal open/close state — lets any caller (e.g. a
// series-level context menu) open the same series/season/taxon editor
// VideosTable.tsx's multi-select toolbar uses, without needing its own
// locally-rendered modal instance.
export interface BulkEditVideosOptions {
  videoIds: string[];
  onSuccess?: () => void;
}

const [bulkEditVideosState, setBulkEditVideosState] = createSignal<BulkEditVideosOptions | null>(
  null
);

export function showBulkEditVideos(options: BulkEditVideosOptions) {
  setBulkEditVideosState(options);
}

export function hideBulkEditVideos() {
  setBulkEditVideosState(null);
}

export function useBulkEditVideosState() {
  return bulkEditVideosState;
}
