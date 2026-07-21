// a reactive per-remote auth-status cache: tracks whether each remote
// (keyed by an arbitrary string id) is logged in, being checked, or has
// never been queried yet, without any vocabulary of its own for how a
// remote is reached or how "logged in" gets determined.
//
// three states per key:
//   - absent from the map: never queried
//   - `null`: a query is in flight (or was reset to pending)
//   - `T`: resolved (the caller decides what a resolved entry looks like -
//     typically something like `{ loggedIn: boolean; username?: string }`)
//
// the caller supplies the actual resolution logic (whoami calls, offline
// heuristics, retry-on-cold-boot timing, and so on) - this module only
// owns the reactive map itself.

import { createSignal, type Accessor } from "solid-js";

export interface AuthStatusStore<T> {
  /** reactive snapshot of every tracked key's entry. */
  status: Accessor<Map<string, T | null>>;
  /** snapshot lookup for one key. `undefined` means never queried. */
  get(key: string): T | null | undefined;
  /** mark one key as pending (query in flight), without touching others. */
  markPending(key: string): void;
  /** mark every one of the given keys as pending in a single update. */
  resetPending(keys: string[]): void;
  /** store a resolved entry for one key. */
  patch(key: string, entry: T): void;
  /** drop one key's entry entirely (e.g. after the remote is deleted). */
  clear(key: string): void;
}

/**
 * creates a reactive `key -> resolved-entry-or-pending` cache for any
 * number of independently-tracked remotes/resources.
 */
export function createAuthStatus<T>(): AuthStatusStore<T> {
  const [status, setStatus] = createSignal<Map<string, T | null>>(new Map());

  function patchMap(key: string, entry: T | null): void {
    setStatus((prev) => {
      const next = new Map(prev);
      next.set(key, entry);
      return next;
    });
  }

  return {
    status,
    get(key) {
      return status().get(key);
    },
    markPending(key) {
      patchMap(key, null);
    },
    resetPending(keys) {
      setStatus(() => {
        const next = new Map<string, T | null>();
        for (const key of keys) next.set(key, null);
        return next;
      });
    },
    patch(key, entry) {
      patchMap(key, entry);
    },
    clear(key) {
      setStatus((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
  };
}
