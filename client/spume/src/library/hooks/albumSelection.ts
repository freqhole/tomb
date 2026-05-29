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
const [albumMbLookupStatusById, setAlbumMbLookupStatusById] = createSignal<
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

/** track per-album `mb_lookup_status` for callers that want to filter
 *  by it (e.g. the bulk-review entry point in LibraryView skips
 *  albums already terminally `enriched` or `skipped`). populated by
 *  AlbumsTable as rows load. */
export function updateAlbumMbLookupStatusMap(
  entries: Array<[string, string | null | undefined]>,
): void {
  const m = new Map<string, string>();
  for (const [id, status] of entries) {
    if (status) m.set(id, status);
  }
  setAlbumMbLookupStatusById(m);
}

/** look up the loaded mb_lookup_status for an album id, or undefined
 *  if the row isn't currently in view. */
export function getAlbumMbLookupStatus(albumId: string): string | undefined {
  return albumMbLookupStatusById().get(albumId);
}

/** filter a set of selected ids to those NOT yet in a terminal
 *  reviewed state (`enriched` or `skipped`). ids whose status is
 *  unknown (not currently loaded) are included optimistically — the
 *  bulk-review modal will see whatever the server says. */
export function filterReviewableAlbumIds(ids: Iterable<string>): string[] {
  const m = albumMbLookupStatusById();
  const out: string[] = [];
  for (const id of ids) {
    const s = m.get(id);
    if (s === undefined || (s !== "enriched" && s !== "skipped")) out.push(id);
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

/** add the given album ids to the current selection (idempotent). */
export function addAlbumsToSelection(ids: string[]): void {
  const next = new Set(selectedAlbumIds());
  let changed = false;
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  if (changed) setSelectedAlbumIds(next);
}

/** toggle a single album in the selection; updates `lastSelectedIndex`
 *  so subsequent shift-clicks anchor from this row. */
export function toggleAlbumSelection(albumId: string, index: number): void {
  const next = new Set(selectedAlbumIds());
  if (next.has(albumId)) next.delete(albumId);
  else next.add(albumId);
  setSelectedAlbumIds(next);
  setLastSelectedIndex(index);
}

/** clear selection on route change + escape key. also installs the
 *  global ctrl/cmd-A handler that selects all loaded rows. attach this
 *  to the LibraryView.
 *
 *  pass `isActive` to scope all behaviors to a specific subview; the
 *  graph subview doesn't want ctrl/cmd-A binding the album table's
 *  selection (which would in turn pop the AlbumBulkActionBar over the
 *  graph). when `isActive` is omitted the hook is always active. */
export function useAlbumSelectionLifecycle(isActive?: () => boolean): void {
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

  // whenever the hosting subview becomes inactive, drop any selection
  // that may have been carried over so it doesn't reappear when the
  // user comes back via a different entry point.
  if (isActive) {
    createEffect(
      on(
        isActive,
        (active) => {
          if (!active) clearAlbumSelection();
        },
        { defer: true },
      ),
    );
  }

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // gate the entire handler on subview active-ness; don't
      // want escape clearing selection when the table isn't on
      // screen, since that selection isn't visible anywhere.
      if (isActive && !isActive()) return;
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
