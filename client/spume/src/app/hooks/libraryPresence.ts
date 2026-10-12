// shared "does the user have any library content yet" signals.
//
// lifted out of App.tsx so AppLayout can observe the exact same live
// state (instead of keeping its own separately-updated copy) to decide
// when to show the first-run empty state on mobile (android/ios) charnel
// builds — see AppLayout.tsx's use of these for that. App.tsx keeps
// writing to these in exactly the same places it always has; only the
// signal declarations moved.
import { createSignal } from "solid-js";

export const [hasSongs, setHasSongs] = createSignal(false);
// videos count as media too - the welcome gate predates the video domain and
// used to keep showing after importing only videos.
export const [hasVideos, setHasVideos] = createSignal(false);
export const [hasRemotes, setHasRemotes] = createSignal(false);
