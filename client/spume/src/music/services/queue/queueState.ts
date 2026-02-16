// shared queue state used by both queue.ts and player.ts
// lives in its own module to avoid circular imports
import { appState } from "../../../app/services/storage/db";

// track if playback has ended (all songs in queue finished)
let playbackEnded = false;

export function markPlaybackEnded(): void {
  playbackEnded = true;
}

export function resetPlaybackEnded(): void {
  playbackEnded = false;
}

export function hasPlaybackEnded(): boolean {
  return playbackEnded;
}

// computed queue position helpers

export function canGoNext(): boolean {
  const { queue, current_sha256 } = appState();
  if (!queue.length) return false;
  const currentIdx = current_sha256
    ? queue.findIndex((s) => s.sha256 === current_sha256)
    : -1;
  return currentIdx >= 0 && currentIdx < queue.length - 1;
}

export function canGoPrevious(): boolean {
  const { queue, current_sha256 } = appState();
  if (!queue.length) return false;
  const currentIdx = current_sha256
    ? queue.findIndex((s) => s.sha256 === current_sha256)
    : -1;
  return currentIdx > 0;
}
