// reusable hook for view-local remote selection.
// encapsulates the resource, signal, effect and memos that select
// and default to the first available non-offline remote.
//
// both LibraryView and FavoritesView use this so we don't duplicate
// the defaulting logic in multiple places.

import { createEffect, createMemo, createResource, createSignal } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";

export function useRemoteSelection() {
  const [remotes] = createResource(getAllRemotes);
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

  return { remotes, selectedRemoteIds, setSelectedRemoteIds, selectedRemoteId, selectedRemote };
}
