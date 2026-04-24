// playback mode — derived signal that says whether we're currently in
// "music", "radio", or "idle" mode. used by the unified player bar
// (2c-iii) to swap its inner content. when both are technically active
// mid-transition, radio wins (radio just stopped music via the
// playback coordinator anyway).

import { createMemo } from "solid-js";
import { radioStatus } from "./radio/radioService";
import { appState } from "./storage/db";

export type PlaybackMode = "idle" | "music" | "radio";

export const playbackMode = createMemo<PlaybackMode>(() => {
  if (radioStatus() !== "idle") return "radio";
  if ((appState()?.queue.length ?? 0) > 0) return "music";
  return "idle";
});
