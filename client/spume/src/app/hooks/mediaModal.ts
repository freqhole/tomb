// unified "add media" modal open/close state.
// replaces the old, separately-domain-scoped signals: music/hooks/modals.ts's
// addMusicOpen and video/hooks/modals.ts's addVideoOpen. one modal now
// covers both domains (AddMediaModal detects file type / lets the user pick
// a fetch domain rather than requiring two separate buttons+modals).
import { createSignal } from "solid-js";

const [addMediaOpen, setAddMediaOpen] = createSignal(false);

export function openAddMedia() {
  setAddMediaOpen(true);
}

export function closeAddMedia() {
  setAddMediaOpen(false);
}

export function useAddMediaState() {
  return addMediaOpen;
}
