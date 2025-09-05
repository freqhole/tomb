import { createSignal, createMemo } from "solid-js";
import type { AdminSong } from "./admin-api.js";

/**
 * Selection state interface
 */
export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
  selectMode: "single" | "multi" | "range";
}

/**
 * Selection actions interface
 */
export interface SelectionActions<T = AdminSong> {
  selectItem: (id: string, multi?: boolean) => void;
  selectRange: (startId: string, endId: string, items: T[]) => void;
  selectAll: (items: T[]) => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;
  isSelected: (id: string) => boolean;
  getSelectedItems: (items: T[]) => T[];
  getSelectedCount: () => number;
  setSelectMode: (mode: "single" | "multi" | "range") => void;
  setSelection: (selectedIds: Set<string>, lastSelectedId?: string) => void;
}

/**
 * Generic selection hook for admin grids
 */
export function createSelection<T extends { id: string }>() {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = createSignal<string | null>(null);
  const [selectMode, setSelectMode] = createSignal<
    "single" | "multi" | "range"
  >("multi");

  const selectedCount = createMemo(() => selectedIds().size);

  /**
   * Select a single item
   */
  const selectItem = (id: string, multi = false) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);

      if (selectMode() === "single" || !multi) {
        // Single selection mode or no modifier key - replace selection
        newSet.clear();
        newSet.add(id);
      } else {
        // Multi selection mode with modifier - toggle
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      }

      return newSet;
    });

    setLastSelectedId(id);
  };

  /**
   * Select a range of items from startId to endId
   */
  const selectRange = (startId: string, endId: string, items: T[]) => {
    const startIndex = items.findIndex((item) => item.id === startId);
    const endIndex = items.findIndex((item) => item.id === endId);

    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    setSelectedIds((prev) => {
      const newSet = new Set(prev);

      for (let i = minIndex; i <= maxIndex; i++) {
        const item = items[i];
        if (item) {
          newSet.add(item.id);
        }
      }

      return newSet;
    });

    setLastSelectedId(endId);
  };

  /**
   * Select all items
   */
  const selectAll = (items: T[]) => {
    setSelectedIds(new Set(items.map((item) => item.id)));
    setLastSelectedId(
      items.length > 0 ? items[items.length - 1]?.id || null : null
    );
  };

  /**
   * Clear all selections
   */
  const clearSelection = () => {
    setSelectedIds(new Set<string>());
    setLastSelectedId(null);
  };

  /**
   * Toggle selection of a single item
   */
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });

    setLastSelectedId(id);
  };

  /**
   * Check if an item is selected
   */
  const isSelected = (id: string): boolean => {
    return selectedIds().has(id);
  };

  /**
   * Get all selected items
   */
  const getSelectedItems = (items: T[]): T[] => {
    const selected = selectedIds();
    return items.filter((item) => selected.has(item.id));
  };

  /**
   * Get count of selected items
   */
  const getSelectedCount = (): number => {
    return selectedCount();
  };

  /**
   * Directly set the selection state
   */
  const setSelection = (selectedIds: Set<string>, lastSelectedId?: string) => {
    setSelectedIds(new Set(selectedIds));
    if (lastSelectedId !== undefined) {
      setLastSelectedId(lastSelectedId);
    }
  };

  /**
   * Handle click events with proper modifier key support
   */
  const handleItemClick = (id: string, event: MouseEvent, items: T[]) => {
    event.preventDefault();

    const isCtrlClick = event.ctrlKey || event.metaKey;
    const isShiftClick = event.shiftKey;

    if (isShiftClick && lastSelectedId()) {
      // Range selection
      selectRange(lastSelectedId()!, id, items);
    } else if (isCtrlClick) {
      // Toggle selection
      toggleSelection(id);
    } else {
      // Regular click - toggle item in selection (don't clear others)
      toggleSelection(id);
    }
  };

  /**
   * Handle keyboard navigation
   */
  const handleKeyboardNavigation = (
    event: KeyboardEvent,
    items: T[],
    currentIndex: number
  ) => {
    if (items.length === 0) return;

    let newIndex = currentIndex;

    switch (event.key) {
      case "ArrowDown":
        newIndex = Math.min(currentIndex + 1, items.length - 1);
        break;
      case "ArrowUp":
        newIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Home":
        newIndex = 0;
        break;
      case "End":
        newIndex = items.length - 1;
        break;
      case "PageDown":
        newIndex = Math.min(currentIndex + 10, items.length - 1);
        break;
      case "PageUp":
        newIndex = Math.max(currentIndex - 10, 0);
        break;
      default:
        return; // Don't handle other keys
    }

    if (newIndex !== currentIndex) {
      event.preventDefault();
      const targetItem = items[newIndex];
      if (targetItem) {
        const targetId = targetItem.id;

        if (event.shiftKey && lastSelectedId()) {
          const lastId = lastSelectedId();
          if (lastId) {
            selectRange(lastId, targetId, items);
          }
        } else if (event.ctrlKey || event.metaKey) {
          // Just move focus, don't change selection
          setLastSelectedId(targetId);
        } else {
          selectItem(targetId, false);
        }
      }
    }
  };

  const state: SelectionState = {
    get selectedIds() {
      return selectedIds();
    },
    get lastSelectedId() {
      return lastSelectedId();
    },
    get selectMode() {
      return selectMode();
    },
  };

  const actions: SelectionActions<T> = {
    selectItem,
    selectRange,
    selectAll,
    clearSelection,
    toggleSelection,
    isSelected,
    getSelectedItems,
    getSelectedCount,
    setSelectMode,
    setSelection,
  };

  return {
    state,
    actions,
    handleItemClick,
    handleKeyboardNavigation,
    // Expose signals for reactive access
    selectedIds,
    selectedCount,
    lastSelectedId,
  };
}

/**
 * Utility functions for selection management
 */
export const selectionUtils = {
  /**
   * Get items by their IDs
   */
  getItemsById<T extends { id: string }>(items: T[], ids: string[]): T[] {
    const idSet = new Set(ids);
    return items.filter((item) => idSet.has(item.id));
  },

  /**
   * Get the index of an item by its ID
   */
  getItemIndex<T extends { id: string }>(items: T[], id: string): number {
    return items.findIndex((item) => item.id === id);
  },

  /**
   * Check if selection is contiguous (for range operations)
   */
  isContiguousSelection<T extends { id: string }>(
    items: T[],
    selectedIds: Set<string>
  ): boolean {
    const selectedIndices = items
      .map((item, index) => (selectedIds.has(item.id) ? index : -1))
      .filter((index) => index !== -1)
      .sort((a, b) => a - b);

    if (selectedIndices.length <= 1) return true;

    for (let i = 1; i < selectedIndices.length; i++) {
      const current = selectedIndices[i];
      const previous = selectedIndices[i - 1];
      if (
        current !== undefined &&
        previous !== undefined &&
        current !== previous + 1
      ) {
        return false;
      }
    }

    return true;
  },

  /**
   * Get the range bounds for a selection
   */
  getSelectionBounds<T extends { id: string }>(
    items: T[],
    selectedIds: Set<string>
  ): { start: number; end: number } | null {
    const selectedIndices = items
      .map((item, index) => (selectedIds.has(item.id) ? index : -1))
      .filter((index) => index !== -1);

    if (selectedIndices.length === 0) return null;

    return {
      start: Math.min(...selectedIndices),
      end: Math.max(...selectedIndices),
    };
  },
};
