// add-video modal open/close state.
// own module-level signal (video domain isolation — mirrors music/hooks/modals.ts's
// add-music modal signal, kept as its own copy per the same rule already used by
// video/services/opfs/helpers.ts).
import { createSignal } from "solid-js";

const [addVideoOpen, setAddVideoOpen] = createSignal(false);

export function openAddVideo() {
  setAddVideoOpen(true);
}

export function closeAddVideo() {
  setAddVideoOpen(false);
}

export function useAddVideoState() {
  return addVideoOpen;
}

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
