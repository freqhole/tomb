// playback coordinator — a tiny pub/sub that lets the music player and
// the radio service interrupt each other without a circular import.
//
// both subsystems own their own audio element + state, but only one
// should produce sound at a time. each side registers a "stop me"
// callback here at startup, and calls the other side's stop helper
// before it begins its own playback.
//
// import order is irrelevant: handlers default to no-ops until the
// owning module registers them.

type StopHandler = () => void | Promise<void>;

let stopMusicHandler: StopHandler = () => {};
let stopRadioHandler: StopHandler = () => {};

/** music player calls this on startup to register its pause/stop hook. */
export function registerStopMusic(fn: StopHandler): void {
  stopMusicHandler = fn;
}

/** radio service calls this on startup to register its leave hook. */
export function registerStopRadio(fn: StopHandler): void {
  stopRadioHandler = fn;
}

/** call before starting radio playback. silences the music player. */
export async function stopMusicForRadio(): Promise<void> {
  try {
    await stopMusicHandler();
  } catch (e) {
    console.warn("[playback-coordinator] stopMusic failed:", e);
  }
}

/** call before starting music playback. tears down any radio session. */
export async function stopRadioForMusic(): Promise<void> {
  try {
    await stopRadioHandler();
  } catch (e) {
    console.warn("[playback-coordinator] stopRadio failed:", e);
  }
}
