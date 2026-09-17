// tracks which remote a local-import review session should ultimately be
// sent to once reviewed. "add media" is one concept regardless of domain,
// so this is shared by both music and video import flows rather than
// duplicated per domain.
import { createStore, produce } from "solid-js/store";

export interface PendingSendTarget {
  remoteId: string;
  remoteName: string;
}

const [targets, setTargets] = createStore<Record<string, PendingSendTarget>>({});

/** register that `sessionId`'s reviewed output should be sent to `target` once review completes. */
export function setPendingSendTarget(sessionId: string, target: PendingSendTarget) {
  setTargets(sessionId, target);
}

/** reactive lookup - undefined means this session has no remote to send to (local-only import). */
export function getPendingSendTarget(
  sessionId: string | null | undefined
): PendingSendTarget | undefined {
  if (!sessionId) return undefined;
  return targets[sessionId];
}

export function clearPendingSendTarget(sessionId: string) {
  setTargets(
    produce((t) => {
      delete t[sessionId];
    })
  );
}
