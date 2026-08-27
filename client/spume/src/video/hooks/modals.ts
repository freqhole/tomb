// add-video modal open/close state used to live here as its own isolated
// signal (mirroring music/hooks/modals.ts). replaced by the unified
// add-media modal state in app/hooks/mediaModal.ts (openAddMedia/
// closeAddMedia/useAddMediaState).
import { createSignal } from "solid-js";

// edit-video modal open/close state — mirrors the add-video signal above.
export interface EditVideoOptions {
  videoId: string;
  onSave?: () => void;
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
