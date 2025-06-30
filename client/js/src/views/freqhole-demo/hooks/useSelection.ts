import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { MediaBlob } from "../types";

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
  toggleSelection: (itemId: string) => void;
  selectRange: (
    startIndex: number,
    endIndex: number,
    items: MediaBlob[]
  ) => void;
  clearSelection: () => void;
  selectAll: (items: MediaBlob[]) => void;
  isSelected: (itemId: string) => boolean;

  // Event handlers
  handleRowClick: (item: MediaBlob, index: number, event: MouseEvent) => void;
  handleRowMouseDown: (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
}

export interface UseSelectionOptions {
  onSelectionChange?: (selection: Set<string>) => void;
  onDelete?: (selectedItems: Set<string>) => void;
  saveToStorage?: (selection: Set<string>) => void;
  initialSelection?: Set<string>;
}

export function useSelection(options: UseSelectionOptions = {}): SelectionHook {
  // Selection state
  const [selectedItems, setSelectedItems] = createSignal<Set<string>>(
    options.initialSelection || new Set()
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
  const toggleSelection = (itemId: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const selectRange = (
    startIndex: number,
    endIndex: number,
    items: MediaBlob[]
  ) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const rangeItems = items.slice(start, end + 1);

    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      rangeItems.forEach((item) => newSet.add(item.id));
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedItems(new Set<string>());
    setLastSelectedIndex(-1);
  };

  const selectAll = (items: MediaBlob[]) => {
    const allIds = new Set(items.map((item) => item.id));
    setSelectedItems(allIds);
  };

  const isSelected = (itemId: string): boolean => {
    return selectedItems().has(itemId);
  };

  // Event handlers
  const handleRowClick = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    const itemId = item.id;
    // const isItemSelected = selectedItems().has(itemId);

    if (event.metaKey || event.ctrlKey) {
      // Toggle selection with Cmd/Ctrl
      toggleSelection(itemId);
      setLastSelectedIndex(index);
    } else if (event.shiftKey && lastSelectedIndex() >= 0) {
      // Prevent unwanted text selection on Shift+click
      event.preventDefault();
      // Range selection with Shift
      // const startIndex = Math.min(lastSelectedIndex(), index);
      // const endIndex = Math.max(lastSelectedIndex(), index);

      // Note: This requires the items array to be passed in
      // We'll handle this in the component that uses this hook
      setLastSelectedIndex(index);
    } else {
      // Single selection
      const newSelection = new Set([itemId]);
      setSelectedItems(newSelection);
      setLastSelectedIndex(index);
    }
  };

  const handleRowMouseDown = (
    _item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    // Only start drag selection if no modifier keys and it's a left click
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      setDragStart({
        x: event.clientX,
        y: event.clientY,
        startIndex: index,
      });
      setIsDragSelecting(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Check if user is focused in a text input - don't interfere with normal text editing
    const target = event.target as HTMLElement;
    const isTextInput =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("contenteditable") === "true");

    if (event.key === "Escape") {
      clearSelection();
    } else if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      // Only prevent default if NOT in a text input
      if (!isTextInput) {
        event.preventDefault();
        // Note: selectAll requires items array - handle in component
      }
      // If in text input, let the browser handle Ctrl+A naturally
    } else if (event.key === "Delete" || event.key === "Backspace") {
      // Only delete items if NOT in a text input and we have selected items
      if (!isTextInput && selectedItems().size > 0) {
        options.onDelete?.(selectedItems());
      }
      // If in text input, let the browser handle Delete/Backspace naturally
    }
  };

  // Mouse move handler for drag selection
  const handleMouseMove = (event: MouseEvent) => {
    if (isDragSelecting() && dragStart()) {
      setDragEnd({
        x: event.clientX,
        y: event.clientY,
        endIndex: -1, // Will be calculated based on position
      });

      // Note: Actual selection calculation will be done in the component
      // that has access to the items array and grid layout
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
    document.body.classList.remove("drag-selecting");
  });

  // Update body class when drag state changes
  createEffect(() => {
    if (isDragSelecting()) {
      document.body.classList.add("drag-selecting");
    } else {
      document.body.classList.remove("drag-selecting");
    }
  });

  // Notify about selection changes
  createEffect(() => {
    const selection = selectedItems();
    options.onSelectionChange?.(selection);
    options.saveToStorage?.(selection);
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
  };
}
