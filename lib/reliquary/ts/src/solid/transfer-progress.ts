// a reactive per-key progress/state map: a generalized version of the
// signal-map pattern used for tracking in-flight blob transfers, where
// presence in the map means "currently tracked" (in progress, pending, or
// failed) and absence means "not currently tracked" (either settled/cached
// already, or never started).
//
// the caller supplies the state type - this module has no vocabulary of
// its own for what a transfer's state looks like (blob download, upload,
// sync progress, or anything else keyed by a string id).

import { createSignal, type Accessor } from "solid-js";

export interface TransferProgress<TState> {
  /** current snapshot of tracked keys and their state. reactive - reading
   *  this inside a solid computation subscribes to every map mutation
   *  (the underlying signal uses `{ equals: false }` so a mutated map is
   *  always seen as a change, even when the reference happens to be
   *  reused). */
  states: Accessor<ReadonlyMap<string, TState>>;
  /** set (or clear, with `null`) the state for one key without replacing
   *  the whole map. */
  setState(key: string, state: TState | null): void;
  /** clear every tracked key. */
  reset(): void;
}

/**
 * creates a reactive `key -> state` map for tracking the progress of any
 * number of concurrent, independently-keyed operations (blob downloads
 * keyed by hash, uploads keyed by id, ...).
 */
export function createTransferProgress<TState>(): TransferProgress<TState> {
  const [states, setStates] = createSignal<ReadonlyMap<string, TState>>(new Map(), { equals: false });

  function setState(key: string, state: TState | null): void {
    setStates((prev) => {
      const next = new Map(prev);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  }

  function reset(): void {
    setStates(new Map());
  }

  return { states, setState, reset };
}
