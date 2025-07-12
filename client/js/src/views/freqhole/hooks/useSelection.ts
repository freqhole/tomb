import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Song } from "../../../lib/music/schemas/song";

export interface SelectionHook {
  // Selection state
  selectedItems: () => Set<string>;
  setSelectedItems: (items: Set<string>) => void;
  lastSelectedIndex: () => number;
  setLastSelectedIndex: (index: number) => void;

  // Drag selection state
  isDragSelecting: () => boolean;
  setIsDragSelecting: (dragging: boolean) => void;
  dragStart: () => { x: number; y: number; startIndex: number } | null;
  setDragStart: (
    start: { x: number; y: number; startIndex: number } | null
  ) => void;
  dragEnd: () => { x: number; y: number; endIndex: number } | null;
  setDragEnd: (end: { x: number; y: number; endIndex: number } | null) => void;

  // Selection actions
  toggleSelection: (songId: string) => void;
  selectRange: (startIndex: number, endIndex: number, songs: Song[]) => void;
  clearSelection: () => void;
  selectAll: (songs: Song[]) => void;
  isSelected: (songId: string) => boolean;

  // Event handlers
  handleRowClick: (song: Song, index: number, event: MouseEvent) => void;
  handleRowMouseDown: (song: Song, index: number, event: MouseEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => void;

  // Get selected songs
  getSelectedSongs: (songs: Song[]) => Song[];
}

export interface UseSelectionOptions {
  onSelectionChange?: (selectedIds: Set<string>, selectedSongs: Song[]) => void;
  onBulkAction?: (action: string, selectedSongs: Song[]) => void;
}

export function useSelection(options: UseSelectionOptions = {}): SelectionHook {
  // Selection state
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(
    new Set()
  );
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number>(-1);

  // Drag selection state
  const [isDragSelecting, setIsDragSelecting] = createSignal(false);
  const [dragStart, setDragStart] = createSignal<{
    x: number;
    y: number;
    startIndex: number;
  } | null>(null);
  const [dragEnd, setDragEnd] = createSignal<{
    x: number;
    y: number;
    endIndex: number;
  } | null>(null);

  // Selection actions
  const toggleSelection = (songId: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  };

  const selectRange = (
    startIndex: number,
    endIndex: number,
    songs: Song[]
  ) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const rangeItems = songs.slice(start, end + 1);

    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      rangeItems.forEach((song) => newSet.add(song.id));
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedItems(new Set<string>());
    setLastSelectedIndex(-1);
  };

  const selectAll = (songs: Song[]) => {
    const allIds = new Set(songs.map((song) => song.id));
    setSelectedItems(allIds);
  };

  const isSelected = (songId: string): boolean => {
    return selectedItems().has(songId);
  };

  const getSelectedSongs = (songs: Song[]): Song[] => {
    const selected = selectedItems();
    return songs.filter((song) => selected.has(song.id));
  };

  // Event handlers
  const handleRowClick = (song: Song, index: number, event: MouseEvent) => {
    const songId = song.id;

    if (event.metaKey || event.ctrlKey) {
      // Prevent text selection on Ctrl/Cmd+click
      event.preventDefault();
      // Toggle selection with Cmd/Ctrl
      toggleSelection(songId);
      setLastSelectedIndex(index);
    } else if (event.shiftKey && lastSelectedIndex() >= 0) {
      // Prevent unwanted text selection on Shift+click
      event.preventDefault();
      // Range selection with Shift
      setLastSelectedIndex(index);
    } else {
      // Single selection
      const newSelection = new Set([songId]);
      setSelectedItems(newSelection);
      setLastSelectedIndex(index);
    }
  };

  const handleRowMouseDown = (
    _song: Song,
    index: number,
    event: MouseEvent
  ) => {
    // Prevent text selection during drag operations
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }

    // Only start drag selection if no modifier keys and it's a left click
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      // Prevent text selection during drag
      event.preventDefault();
      setDragStart({
        x: event.clientX,
        y: event.clientY,
        startIndex: index,
      });
      setIsDragSelecting(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Check if user is focused in a text input
    const target = event.target as HTMLElement;
    const isTextInput =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("contenteditable") === "true");

    if (isTextInput) {
      return; // Don't interfere with text editing
    }

    switch (event.key) {
      case "Escape":
        clearSelection();
        break;
      case "a":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          // selectAll requires songs array - handle in component
        }
        break;
      case "Delete":
      case "Backspace":
        if (selectedItems().size > 0) {
          event.preventDefault();
          options.onBulkAction?.("delete", []);
        }
        break;
    }
  };

  // Mouse move handler for drag selection
  const handleMouseMove = (event: MouseEvent) => {
    if (isDragSelecting() && dragStart()) {
      setDragEnd({
        x: event.clientX,
        y: event.clientY,
        endIndex: -1, // Component will calculate this
      });
    }
  };

  // Mouse up handler to end drag selection
  const handleMouseUp = () => {
    if (isDragSelecting()) {
      setIsDragSelecting(false);
      setDragStart(null);
      setDragEnd(null);
    }
  };

  // Setup global event listeners
  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("keydown", handleKeyDown);
    document.body.classList.remove("song-drag-selecting");
  });

  // Update body class when drag state changes
  createEffect(() => {
    if (isDragSelecting()) {
      document.body.classList.add("song-drag-selecting");
      // Prevent text selection during drag
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    } else {
      document.body.classList.remove("song-drag-selecting");
      // Restore text selection
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    }
  });

  // Notify about selection changes
  createEffect(() => {
    const selectedIds = selectedItems();
    if (options.onSelectionChange) {
      // We can't get songs here without props, component will handle this
      options.onSelectionChange(selectedIds, []);
    }
  });

  return {
    // Selection state
    selectedItems,
    setSelectedItems,
    lastSelectedIndex,
    setLastSelectedIndex,

    // Drag selection state
    isDragSelecting,
    setIsDragSelecting,
    dragStart,
    setDragStart,
    dragEnd,
    setDragEnd,

    // Selection actions
    toggleSelection,
    selectRange,
    clearSelection,
    selectAll,
    isSelected,

    // Event handlers
    handleRowClick,
    handleRowMouseDown,
    handleKeyDown,

    // Utilities
    getSelectedSongs,
  };
}
