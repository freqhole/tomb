// album selection state for the library view (multi-select with modifier-key
// support, mirrors the songSelection hook).
//
// scope: standalone module-level state (Set<string> of album_ids) so the
// table rows + the bulk action bar can reactively share selection without
// prop-drilling. cleared on route change + escape key.

import { createSignal, createEffect, on, onMount, onCleanup } from "solid-js";
import { useLocation } from "@solidjs/router";

const [selectedAlbumIds, setSelectedAlbumIds] = createSignal<Set<string>>(new Set());
const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number | null>(null);
const [albumIdList, setAlbumIdList] = createSignal<string[]>([]);
const [albumReviewStatusById, setAlbumReviewStatusById] = createSignal<
  Map<string, string>
>(new Map());

export function getSelectedAlbumIds(): Set<string> {
  return selectedAlbumIds();
}

export function getSelectedAlbumCount(): number {
  return selectedAlbumIds().size;
}

export function isAlbumSelected(albumId: string): boolean {
  return selectedAlbumIds().has(albumId);
}

export function clearAlbumSelection(): void {
  setSelectedAlbumIds(new Set<string>());
  setLastSelectedIndex(null);
}

/** keep the row order list in sync with what's currently rendered.
 *  call from the table whenever its visible items change. */
export function updateAlbumIdList(ids: string[]): void {
  setAlbumIdList(ids);
}

/** track per-album review_status for callers that want to filter by it
 *  (e.g. the bulk-review entry point in LibraryView only opens the
 *  wizard for `pending` albums). populated by AlbumsTable as rows load. */
export function updateAlbumReviewStatusMap(
  entries: Array<[string, string | null | undefined]>,
): void {
  const m = new Map<string, string>();
  for (const [id, status] of entries) {
    if (status) m.set(id, status);
  }
  setAlbumReviewStatusById(m);
}

/** look up the loaded review_status for an album id, or undefined if
 *  the row isn't currently in view. */
export function getAlbumReviewStatus(albumId: string): string | undefined {
  return albumReviewStatusById().get(albumId);
}

/** filter a set of selected ids to those with `review_status === 'pending'`.
 *  ids whose status is unknown (not currently loaded) are included
 *  optimistically — the modal will see whatever the server says. */
export function filterPendingReviewAlbumIds(ids: Iterable<string>): string[] {
  const m = albumReviewStatusById();
  const out: string[] = [];
  for (const id of ids) {
    const s = m.get(id);
    if (s === undefined || s === "pending") out.push(id);
  }
  return out;
}

/** select every loaded album. */
export function selectAllLoadedAlbums(): void {
  setSelectedAlbumIds(new Set(albumIdList()));
}

/** click handler with modifier-key support:
 *   - none:        select only this album
 *   - ctrl/cmd:    toggle this album in selection
 *   - shift:       range from last-selected to here
 *   - shift+cmd:   add range to existing selection
 */
export function handleAlbumClick(
  albumId: string,
  index: number,
  event: MouseEvent,
): void {
  const isCtrlOrCmd = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;

  if (isShift && lastSelectedIndex() !== null) {
    const ids = albumIdList();
    const start = Math.min(lastSelectedIndex()!, index);
    const end = Math.max(lastSelectedIndex()!, index);
    const rangeIds = ids.slice(start, end + 1);

    if (isCtrlOrCmd) {
      const next = new Set(selectedAlbumIds());
      rangeIds.forEach((id) => next.add(id));
      setSelectedAlbumIds(next);
    } else {
      setSelectedAlbumIds(new Set(rangeIds));
    }
  } else if (isCtrlOrCmd) {
    const next = new Set(selectedAlbumIds());
    if (next.has(albumId)) next.delete(albumId);
    else next.add(albumId);
    setSelectedAlbumIds(next);
    setLastSelectedIndex(index);
  } else {
    setSelectedAlbumIds(new Set([albumId]));
    setLastSelectedIndex(index);
  }
}

export function removeAlbumsFromSelection(ids: string[]): void {
  const next = new Set(selectedAlbumIds());
  let changed = false;
  for (const id of ids) {
    if (next.delete(id)) changed = true;
  }
  if (changed) setSelectedAlbumIds(next);
}

/** clear selection on route change + escape key. also installs the
 *  global ctrl/cmd-A handler that selects all loaded rows. attach this
 *  to the LibraryView. */
export function useAlbumSelectionLifecycle(): void {
  const location = useLocation();

  createEffect(
    on(
      () => location.pathname,
      () => {
        clearAlbumSelection();
      },
      { defer: true },
    ),
  );

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedAlbumIds().size > 0) {
        clearAlbumSelection();
        return;
      }
      // ctrl/cmd-a → select all loaded (when not focused in a text input)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
          return;
        }
        if (albumIdList().length === 0) return;
        event.preventDefault();
        selectAllLoadedAlbums();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
}

export function useSelectedAlbumIds(): () => string[] {
  return () => Array.from(selectedAlbumIds());
}

export function useAlbumSelectionCount(): () => number {
  return () => selectedAlbumIds().size;
}
