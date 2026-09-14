// pure, dependency-free state machine for the "add media -> review -> send"
// session lifecycle (see docs/add-media-review-refactor-plan.md §3.1 in the
// tomb repo). replaces the ~10 loose App.tsx signals
// (reviewSessionId/reviewRemote/reviewSessionAlbumIds/reviewSendProgress/
// completedReviewSessionId/autoSendClaimedSessions/...) with one state value
// per target, transitioned only through this reducer.
//
// no Solid/DOM dependency here on purpose - this file is plain, synchronous
// TypeScript so its transition logic can be unit-tested without mounting
// anything. `useImportSessionFlow.ts` wraps this in a Solid-reactive registry.
//
// keyed by target, not a singleton: switching which remote/local target the
// add-media modal is pointed at (the remote picker) must never lose or
// blend state for a different target - see §11. `"local"` is the sentinel
// key for the browser-local/charnel-managed backend.

import type { SendReviewProgress } from "../../app/services/send/sendReviewProgress";
import { emptyProgress } from "../../app/services/send/sendReviewProgress";

export type ImportSessionState =
  | { kind: "idle" }
  | { kind: "reviewing"; sessionId: string; albumIds: string[] }
  | { kind: "sending"; sessionId: string; albumIds: string[]; progress: SendReviewProgress }
  | { kind: "done"; sessionId: string; progress: SendReviewProgress | null };

export interface SendTarget {
  id: string;
  name: string;
}

export type ImportSessionEvent =
  /** a new review session was opened for this target - always yields a
   *  fresh `reviewing` state, regardless of what the previous state was. */
  | { type: "opened"; sessionId: string }
  /** accumulate album ids seen while reviewing - albums disappear from the
   *  live pending list as soon as they're marked reviewed, so this is the
   *  only way to know the session's full album set once it drains to zero. */
  | { type: "albumsSeen"; albumIds: string[] }
  /** the pending-albums list for this session just drained to zero. `target`
   *  is the destination to auto-send to, or `null` for a purely local
   *  import with nothing further to do. */
  | { type: "albumsDrained"; target: SendTarget | null }
  /** a progress snapshot from the in-flight send. */
  | { type: "sendProgress"; progress: SendReviewProgress }
  /** the in-flight send settled (success or failure - `progress` already
   *  carries per-album failure detail; this just marks the transfer over). */
  | { type: "sendFinished" }
  /** the user closed the review modal / dismissed the result. */
  | { type: "closed" };

/**
 * the one function that owns every transition for a single target's
 * session state. pure - same inputs always produce the same output, no
 * reads of ambient state.
 */
export function importSessionReducer(
  state: ImportSessionState,
  event: ImportSessionEvent
): ImportSessionState {
  switch (event.type) {
    case "opened":
      // constructing a brand-new object here - never spreads `state` - is
      // what makes the stale-progress-on-reopen bug (finding A) structurally
      // impossible: there is no field of the previous state (whatever kind
      // it was) that can leak into the new session.
      return { kind: "reviewing", sessionId: event.sessionId, albumIds: [] };

    case "albumsSeen":
      if (state.kind !== "reviewing") return state;
      return {
        ...state,
        albumIds: Array.from(new Set([...state.albumIds, ...event.albumIds])),
      };

    case "albumsDrained": {
      if (state.kind !== "reviewing") return state;
      if (event.target && state.albumIds.length > 0) {
        return {
          kind: "sending",
          sessionId: state.sessionId,
          albumIds: state.albumIds,
          progress: emptyProgress(event.target.name, state.albumIds.length),
        };
      }
      // no send target, or nothing was ever seen (e.g. every blob in the
      // session was a duplicate and got auto-skipped) - nothing to send.
      return { kind: "done", sessionId: state.sessionId, progress: null };
    }

    case "sendProgress":
      if (state.kind !== "sending") return state;
      return { ...state, progress: event.progress };

    case "sendFinished":
      if (state.kind !== "sending") return state;
      return { kind: "done", sessionId: state.sessionId, progress: state.progress };

    case "closed":
      return { kind: "idle" };

    default:
      return state;
  }
}

export const initialImportSessionState: ImportSessionState = { kind: "idle" };
