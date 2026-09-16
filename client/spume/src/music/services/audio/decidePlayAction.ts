// pure decision for what `play()`/`togglePlayback()` should do given the
// active backend's raw, possibly-never-initialized snapshot state.
//
// extracted after a real bug shipped TWICE in the same spot: the first
// fix checked `state === "stopped"`, assuming that's what a fresh,
// never-loaded backend reports - but `emptySnapshot` (backend.ts) starts
// at `state: null`, not `"stopped"` (confirmed against the wire schema,
// `PlayerSnapshotSchema.state` is `nullish()`), so that check never
// actually matched and the cenotaph player's "current song never starts"
// bug shipped un-fixed. pulled into its own pure, zero-import function so
// this exact mistake is unit-tested going forward instead of re-derived
// by hand (and re-broken) at each call site.
export type PlayerSnapshotState = "stopped" | "playing" | "paused" | "loading" | null | undefined;

export type PlayAction = "noop" | "resume" | "load";

/** - "noop": already playing, nothing to do (guards against a redundant
 *    remote "resume" command interrupting ongoing playback).
 *  - "resume": something is loaded and merely paused - resume in place.
 *  - "load": nothing usable is loaded (covers `null`/`"stopped"`/
 *    `"loading"` alike, i.e. everything except `"playing"`/`"paused"`) -
 *    the current queue item must be loaded fresh instead of blindly
 *    resending a bare `play` command to an empty backend. */
export function decidePlayAction(state: PlayerSnapshotState): PlayAction {
  if (state === "playing") return "noop";
  if (state === "paused") return "resume";
  return "load";
}
