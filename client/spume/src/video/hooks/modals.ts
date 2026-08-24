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
