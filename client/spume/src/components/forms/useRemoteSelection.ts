// reusable hook for view-local remote selection.
// encapsulates the resource, signal, effect and memos that select
// and default to the first available non-offline remote.
//
// both LibraryView and FavoritesView use this so we don't duplicate
// the defaulting logic in multiple places.

import { createEffect, createMemo, createSignal, on } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getAllRemotes, remoteDataVersion } from "../../app/services/remotes/remoteManager";

// fields that churn on routine health checks / connection bookkeeping and
// don't change what a remote *is*. ignored when deciding whether a re-read
// remote is "the same" as the one already held.
const VOLATILE_REMOTE_FIELDS = new Set<string>([
  "last_checked",
  "updated_at",
  "last_connected_at",
  "last_info_check",
  "offline_since",
]);

function sameRemote(a: Remote, b: Remote): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (VOLATILE_REMOTE_FIELDS.has(k)) continue;
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** merge a fresh remotes read into the previous one, reusing previous
 *  `Remote` objects (and the previous array) when nothing meaningful
 *  changed. consumers render remotes with `<For>`, which diffs by
 *  reference - handing it brand-new objects on every health-check bump
 *  would remount each row (e.g. refetch every graph album loader). */
export function reconcileRemotes(prev: Remote[] | undefined, next: Remote[]): Remote[] {
  if (!prev) return next;
  const prevById = new Map(prev.map((r) => [r.remote_id, r]));
  const merged = next.map((r) => {
    const old = prevById.get(r.remote_id);
    return old && sameRemote(old, r) ? old : r;
  });
  if (merged.length === prev.length && merged.every((r, i) => r === prev[i])) return prev;
  return merged;
}

export function useRemoteSelection() {
  // re-read whenever remoteManager reports a change (remote added, removed,
  // renamed, came online...) so views don't keep showing the list as it was
  // when they mounted.
  const [remotes, setRemotes] = createSignal<Remote[] | undefined>(undefined);
  let readSeq = 0;
  createEffect(
    on(remoteDataVersion, () => {
      // drop out-of-order results when bumps land back to back
      const seq = ++readSeq;
      void getAllRemotes().then((next) => {
        if (seq !== readSeq) return;
        setRemotes((prev) => reconcileRemotes(prev, next));
      });
    })
  );
  const [selectedRemoteIds, setSelectedRemoteIds] = createSignal<Set<string>>(new Set());

  // default to the first non-offline remote once the list loads.
  // does not override an explicit selection already made.
  createEffect(() => {
    const r = remotes();
    if (!r || r.length === 0) return;
    if (selectedRemoteIds().size > 0) return;
    const preferred = r.find((rem) => !rem.is_offline) ?? r[0];
    setSelectedRemoteIds(new Set([preferred.remote_id]));
  });

  const selectedRemoteId = createMemo<string | null>(() => {
    const ids = [...selectedRemoteIds()];
    return ids[0] ?? null;
  });

  const selectedRemote = createMemo<Remote | undefined>(() => {
    const id = selectedRemoteId();
    if (!id) return undefined;
    return (remotes() ?? []).find((r) => r.remote_id === id);
  });

  /** all selected remotes resolved to full Remote records, in the same
   *  order as the underlying remotes resource. used by multi-select
   *  consumers (e.g. the library graph subview). */
  const selectedRemotes = createMemo<Remote[]>(() => {
    const ids = selectedRemoteIds();
    return (remotes() ?? []).filter((r) => ids.has(r.remote_id));
  });

  return {
    remotes,
    selectedRemoteIds,
    setSelectedRemoteIds,
    selectedRemoteId,
    selectedRemote,
    selectedRemotes,
  };
}
