import { createSignal, createEffect } from "solid-js";
import type { MediaBlob } from "../../../lib/websocket-types";

export interface KeyboardNavigationConfig {
  onPreview?: (item: MediaBlob) => void;
  onToggleSelection?: (item: MediaBlob) => void;
  onSelectAll?: (items: MediaBlob[]) => void;
  onClearSelection?: () => void;
  onEscape?: () => void;
  onDelete?: (items: MediaBlob[]) => void;
  isTextInputFocused?: () => boolean;
  getSelectedItems?: () => Set<string>;
  getAllItems?: () => MediaBlob[];
  onLog?: (message: string) => void;
}

export interface KeyboardNavigationHook {
  focusedIndex: () => number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  focusNext: () => void;
  focusPrevious: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  getFocusedItem: () => MediaBlob | null;
}

export function useKeyboardNavigation(
  config: KeyboardNavigationConfig
): KeyboardNavigationHook {
  const [focusedIndex, setFocusedIndex] = createSignal(-1);

  const log = (message: string) => {
    if (config.onLog) {
      config.onLog(message);
    }
  };

  const isTextInputFocused = () => {
    if (config.isTextInputFocused) {
      return config.isTextInputFocused();
    }

    // Default implementation
    const target = document.activeElement as HTMLElement;
    return (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("contenteditable") === "true")
    );
  };

  const getAllItems = () => {
    return config.getAllItems ? config.getAllItems() : [];
  };

  const getSelectedItems = () => {
    return config.getSelectedItems
      ? config.getSelectedItems()
      : new Set<string>();
  };

  const getFocusedItem = (): MediaBlob | null => {
    const items = getAllItems();
    const index = focusedIndex();
    return index >= 0 && index < items.length ? items[index] || null : null;
  };

  const focusNext = () => {
    const items = getAllItems();
    if (items.length === 0) return;

    const currentIndex = focusedIndex();
    const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    setFocusedIndex(nextIndex);
    log(`⌨️ Focused next item: ${nextIndex + 1}/${items.length}`);
  };

  const focusPrevious = () => {
    const items = getAllItems();
    if (items.length === 0) return;

    const currentIndex = focusedIndex();
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    setFocusedIndex(prevIndex);
    log(`⌨️ Focused previous item: ${prevIndex + 1}/${items.length}`);
  };

  const focusFirst = () => {
    const items = getAllItems();
    if (items.length === 0) return;

    setFocusedIndex(0);
    log(`⌨️ Focused first item`);
  };

  const focusLast = () => {
    const items = getAllItems();
    if (items.length === 0) return;

    setFocusedIndex(items.length - 1);
    log(`⌨️ Focused last item`);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Don't interfere with text input
    if (isTextInputFocused()) {
      return;
    }

    const items = getAllItems();
    if (items.length === 0) return;

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (focusedIndex() === -1) {
          focusFirst();
        } else {
          focusNext();
        }
        break;
      }

      case "ArrowUp": {
        event.preventDefault();
        if (focusedIndex() === -1) {
          focusLast();
        } else {
          focusPrevious();
        }
        break;
      }

      case "Home": {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          focusFirst();
        }
        break;
      }

      case "End": {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          focusLast();
        }
        break;
      }

      case "PageDown": {
        event.preventDefault();
        // Jump 10 items down
        const currentIndex = focusedIndex();
        const newIndex = Math.min(currentIndex + 10, items.length - 1);
        setFocusedIndex(newIndex);
        log(`⌨️ Page down to item: ${newIndex + 1}/${items.length}`);
        break;
      }

      case "PageUp": {
        event.preventDefault();
        // Jump 10 items up
        const currentIndex = focusedIndex();
        const newIndex = Math.max(currentIndex - 10, 0);
        setFocusedIndex(newIndex);
        log(`⌨️ Page up to item: ${newIndex + 1}/${items.length}`);
        break;
      }

      case "Enter": {
        event.preventDefault();
        const focusedItem = getFocusedItem();
        if (focusedItem && config.onPreview) {
          config.onPreview(focusedItem);
          log(`⌨️ Opened preview via Enter key`);
        }
        break;
      }

      case " ": // Space bar
      case "Spacebar": {
        event.preventDefault();
        const focusedItem = getFocusedItem();
        if (focusedItem && config.onToggleSelection) {
          config.onToggleSelection(focusedItem);
          log(`⌨️ Toggled selection via Space key`);
        }
        break;
      }

      case "a": {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (config.onSelectAll) {
            config.onSelectAll(items);
            log(`⌨️ Selected all items via Ctrl+A`);
          }
        }
        break;
      }

      case "Escape": {
        event.preventDefault();
        if (config.onEscape) {
          config.onEscape();
        }
        // Also clear focus
        setFocusedIndex(-1);
        log(`⌨️ Cleared focus via Escape`);
        break;
      }

      case "Delete":
      case "Backspace": {
        const selectedItems = getSelectedItems();
        if (selectedItems.size > 0) {
          event.preventDefault();
          const items = getAllItems();
          const selectedItemObjects = items.filter((item) =>
            selectedItems.has(item.id)
          );
          if (config.onDelete) {
            config.onDelete(selectedItemObjects);
            log(`⌨️ Delete requested via ${event.key} key`);
          }
        }
        break;
      }

      case "Tab": {
        // Allow tab to work normally for accessibility
        // but ensure focus indicator is visible
        if (focusedIndex() === -1 && items.length > 0) {
          setFocusedIndex(0);
        }
        break;
      }

      // Vim-style navigation (optional bonus)
      case "j": {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (focusedIndex() === -1) {
            focusFirst();
          } else {
            focusNext();
          }
        }
        break;
      }

      case "k": {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (focusedIndex() === -1) {
            focusLast();
          } else {
            focusPrevious();
          }
        }
        break;
      }

      case "g": {
        if (event.shiftKey) {
          // Shift+G goes to end (Vim style)
          event.preventDefault();
          focusLast();
        } else {
          // g+g goes to start (would need double-tap detection for full Vim compatibility)
          event.preventDefault();
          focusFirst();
        }
        break;
      }
    }
  };

  // Auto-focus first item when items become available
  createEffect(() => {
    const items = getAllItems();
    if (items.length > 0 && focusedIndex() === -1) {
      // Don't auto-focus unless user has interacted with keyboard
      // This prevents unexpected focus on page load
    }
  });

  // Ensure focused index stays within bounds when items change
  createEffect(() => {
    const items = getAllItems();
    const currentIndex = focusedIndex();

    if (currentIndex >= items.length && items.length > 0) {
      setFocusedIndex(items.length - 1);
    } else if (items.length === 0) {
      setFocusedIndex(-1);
    }
  });

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    focusNext,
    focusPrevious,
    focusFirst,
    focusLast,
    getFocusedItem,
  };
}
