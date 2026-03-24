// player state signals - separate file to avoid circular deps
// shared between player.ts and listenProgress.ts

import { createSignal } from "solid-js";

// player state signals
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);

// pending "up next" song - the song that's downloading and will play when ready
// this is separate from isLoading because:
// - isLoading = current song is loading (blocks play button)
// - pendingUpNextSha256 = a DIFFERENT song is downloading (shows spinner, current song stays)
const [pendingUpNextSha256, setPendingUpNextSha256] = createSignal<string | null>(null);

// set visual position without affecting audio (for restoring position on page load)
export function setVisualPosition(position: number, dur?: number): void {
  setCurrentTime(position);
  if (dur !== undefined) {
    setDuration(dur);
  }
}

// clear pending up next (exported for queue operations)
export function clearPendingUpNext(): void {
  setPendingUpNextSha256(null);
}

// export signals and setters
export {
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  volume,
  setVolume,
  isLoading,
  setIsLoading,
  pendingUpNextSha256,
  setPendingUpNextSha256,
};
