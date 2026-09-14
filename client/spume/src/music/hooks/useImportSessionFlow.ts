// Solid-reactive registry wrapping importSessionReducer.ts's pure state
// machine - one ImportSessionState per target (remote id, or the "local"
// sentinel for the browser-local/charnel-managed backend). module-level
// singleton (like music/data/currentState.ts's pattern) so state survives
// AddMediaModal/ImportReviewModal being unmounted - see
// docs/add-media-review-refactor-plan.md §7 (background transfers) and §11
// (remote/target switcher) in the tomb repo for why this must be keyed by
// target rather than a singleton value.
import { createSignal } from "solid-js";
import {
  importSessionReducer,
  initialImportSessionState,
  type ImportSessionEvent,
  type ImportSessionState,
} from "./importSessionReducer";

/** sentinel target key for the browser-local/charnel-managed backend -
 * there's no remote id to key on for a purely local session. */
export const LOCAL_TARGET_KEY = "local";

const [registry, setRegistry] = createSignal<Record<string, ImportSessionState>>({});

/** current state for one target. `idle` if nothing has ever happened for
 * this target key. */
export function importSessionState(targetKey: string): ImportSessionState {
  return registry()[targetKey] ?? initialImportSessionState;
}

/** dispatch one transition for `targetKey` through the reducer. every
 * other target's state is left completely untouched (structurally, not
 * just "in practice") - this is what makes switching the add-media modal's
 * target (§11) safe: it only ever changes which key the UI reads. */
export function dispatchImportSession(targetKey: string, event: ImportSessionEvent): void {
  setRegistry((prev) => {
    const current = prev[targetKey] ?? initialImportSessionState;
    const next = importSessionReducer(current, event);
    if (next === current) return prev; // no-op transition - skip the signal update entirely
    return { ...prev, [targetKey]: next };
  });
}

/** test-only: reset every target back to idle. production code has no
 * reason to ever do this - a target's state only ever moves forward
 * through `dispatchImportSession`. */
export function resetImportSessionRegistryForTests(): void {
  setRegistry({});
}
