// playback coordinator — a tiny pub/sub that lets the music player and
// the radio service interrupt each other without a circular import.
//
// both subsystems own their own audio element + state, but only one
// should produce sound at a time. each side registers a "stop me"
// callback here at startup, and calls the other side's stop helper
// before it begins its own playback.
//
// each side may register multiple handlers (e.g. the music player
// registers a pause hook; the queue module registers a queue-wipe
// hook). all handlers fire in parallel on takeover.
//
// import order is irrelevant: with no registrations, the stop helpers
// are no-ops.

type StopHandler = () => void | Promise<void>;

const stopMusicHandlers = new Set<StopHandler>();
const stopRadioHandlers = new Set<StopHandler>();

/** register a handler to fire when radio takes over from music. */
export function registerStopMusic(fn: StopHandler): void {
  stopMusicHandlers.add(fn);
}

/** register a handler to fire when music takes over from radio. */
export function registerStopRadio(fn: StopHandler): void {
  stopRadioHandlers.add(fn);
}

async function fireAll(handlers: Set<StopHandler>, label: string): Promise<void> {
  await Promise.all(
    [...handlers].map(async (fn) => {
      try {
        await fn();
      } catch (e) {
        console.warn(`[playback-coordinator] ${label} handler failed:`, e);
      }
    }),
  );
}

/** call before starting radio playback. silences the music player. */
export async function stopMusicForRadio(): Promise<void> {
  await fireAll(stopMusicHandlers, "stopMusic");
}

/** call before starting music playback. tears down any radio session. */
export async function stopRadioForMusic(): Promise<void> {
  await fireAll(stopRadioHandlers, "stopRadio");
}

// volume mirror — the music player drives the master volume slider;
// radio is a separate sink that should track it. radio service
// registers a setter at module init; the html backend calls
// `mirrorVolumeToRadio` from `setVolume` so both sinks stay in sync.
// importing radioService directly from htmlAudio would close a circular dep
// (radioService imports player which imports htmlAudio).
type VolumeMirror = (volume: number) => void;
let volumeMirror: VolumeMirror | null = null;

/** register the radio-side volume sink. called once by radioService. */
export function registerVolumeMirror(fn: VolumeMirror): void {
  volumeMirror = fn;
}

/** mirror a master-volume change onto the radio sink (no-op if unregistered). */
export function mirrorVolumeToRadio(volume: number): void {
  if (!volumeMirror) return;
  try {
    volumeMirror(volume);
  } catch (e) {
    console.warn("[playback-coordinator] volume mirror failed:", e);
  }
}
