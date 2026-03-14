// song multi-selection state management for bulk operations
// provides centralized selection state with ctrl/cmd click and shift range selection

import { createSignal, createEffect, on, onMount, onCleanup } from "solid-js";
import { useLocation } from "@solidjs/router";

// selection state - shared across components
const [selectedSongIds, setSelectedSongIds] = createSignal<Set<string>>(
    new Set()
);
const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number | null>(
    null
);

// track the list of song IDs for range selection
// this needs to be set by the component that knows the current song order
const [songIdList, setSongIdList] = createSignal<string[]>([]);

/**
 * get the current set of selected song IDs
 */
export function getSelectedSongIds(): Set<string> {
    return selectedSongIds();
}

/**
 * get the count of selected songs
 */
export function getSelectedCount(): number {
    return selectedSongIds().size;
}

/**
 * check if a specific song is selected
 */
export function isSongSelected(songId: string): boolean {
    return selectedSongIds().has(songId);
}

/**
 * clear all selections
 */
export function clearSelection(): void {
    setSelectedSongIds(new Set<string>());
    setLastSelectedIndex(null);
}

/**
 * select a single song (replaces current selection)
 */
export function selectSong(songId: string, index?: number): void {
    setSelectedSongIds(new Set([songId]));
    if (index !== undefined) {
        setLastSelectedIndex(index);
    }
}

/**
 * update the song ID list for range selection support
 * should be called by the component rendering songs when the list changes
 */
export function updateSongIdList(ids: string[]): void {
    setSongIdList(ids);
}

/**
 * handle a click on a song row with modifier key support
 * - no modifier: select only this song
 * - ctrl/cmd: toggle this song in selection
 * - shift: select range from last selected to this song
 */
export function handleSongClick(
    songId: string,
    index: number,
    event: MouseEvent
): void {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (isShift && lastSelectedIndex() !== null) {
        // range selection
        const ids = songIdList();
        const start = Math.min(lastSelectedIndex()!, index);
        const end = Math.max(lastSelectedIndex()!, index);
        const rangeIds = ids.slice(start, end + 1);

        if (isCtrlOrCmd) {
            // add range to existing selection
            const newSet = new Set(selectedSongIds());
            rangeIds.forEach((id) => newSet.add(id));
            setSelectedSongIds(newSet);
        } else {
            // replace selection with range
            setSelectedSongIds(new Set(rangeIds));
        }
    } else if (isCtrlOrCmd) {
        // toggle single item in selection
        const newSet = new Set(selectedSongIds());
        if (newSet.has(songId)) {
            newSet.delete(songId);
        } else {
            newSet.add(songId);
        }
        setSelectedSongIds(newSet);
        setLastSelectedIndex(index);
    } else {
        // simple click - select only this song
        setSelectedSongIds(new Set([songId]));
        setLastSelectedIndex(index);
    }
}

/**
 * remove specific song IDs from selection (e.g., after deletion)
 */
export function removeFromSelection(songIds: string[]): void {
    const current = selectedSongIds();
    const newSet = new Set(current);
    let changed = false;
    for (const id of songIds) {
        if (newSet.delete(id)) {
            changed = true;
        }
    }
    if (changed) {
        setSelectedSongIds(newSet);
    }
}

/**
 * hook to clear selection on route change and handle escape key
 * call this at the top of the songs view component
 */
export function useClearSelectionOnNavigate(): void {
    const location = useLocation();

    createEffect(
        on(
            () => location.pathname,
            () => {
                clearSelection();
            },
            { defer: true }
        )
    );

    // clear selection on escape key
    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && selectedSongIds().size > 0) {
                clearSelection();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
    });
}

/**
 * reactive accessor for selected song IDs as an array
 */
export function useSelectedSongIds(): () => string[] {
    return () => Array.from(selectedSongIds());
}

/**
 * reactive accessor for selection count
 */
export function useSelectionCount(): () => number {
    return () => selectedSongIds().size;
}
