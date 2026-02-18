// persist view state (tags, sort, filters) in browser history state
// follows the same replaceState pattern as scrollRestore.ts and selected entity IDs
//
// usage:
//   const [sortField, setSortField] = useHistoryState("songs.sortField", "added_at");
//   const [tagFilters, setTagFilters] = useHistoryState<TagFilter[]>("songs.tagFilters", []);

import { createSignal, type Accessor, type Setter } from "solid-js";

/**
 * read a value from the current history state under the `viewState` namespace
 */
function readHistoryValue<T>(key: string): T | undefined {
  try {
    const viewState = window.history.state?.viewState;
    if (viewState && key in viewState) {
      return viewState[key] as T;
    }
  } catch {
    // ignore — could be cross-origin or missing state
  }
  return undefined;
}

/**
 * write a value into history state under the `viewState` namespace via replaceState
 */
function writeHistoryValue<T>(key: string, value: T): void {
  try {
    const currentState = window.history.state || {};
    const viewState = currentState.viewState || {};
    viewState[key] = value;
    window.history.replaceState({ ...currentState, viewState }, "");
  } catch {
    // ignore — replaceState can fail in some edge cases
  }
}

/**
 * create a signal that is initialized from browser history state and
 * persists changes back to history state via replaceState.
 *
 * if history state has a saved value for the key, that value is used
 * as the initial value instead of `defaultValue`.
 */
export function useHistoryState<T>(
  key: string,
  defaultValue: T,
): [Accessor<T>, Setter<T>] {
  const saved = readHistoryValue<T>(key);
  const [value, setValue] = createSignal<T>(
    saved !== undefined ? saved : defaultValue,
  ) as [Accessor<T>, Setter<T>];

  // wrap setter to also persist to history state
  const persistedSetter = ((...args: any[]) => {
    const result = (setValue as any)(...args);
    // read the new value after the signal update
    writeHistoryValue(key, value());
    return result;
  }) as Setter<T>;

  return [value, persistedSetter];
}
