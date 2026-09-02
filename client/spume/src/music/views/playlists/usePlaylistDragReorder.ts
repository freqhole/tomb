// drag-reorder mechanics for the playlist item list - extracted out of
// PlaylistDetailPanel.tsx to keep that file under the project's
// file-size budget. supports both HTML5 drag-and-drop (desktop web) and
// pointer-based dragging (Tauri/touch, where the HTML5 drag API doesn't
// work in WKWebView or on mobile browsers). generic over any item keyed
// by `.key`, so it's shared as-is across the song+video merged list (see
// usePlaylistMergedItems's MergedPlaylistItem).
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { isCharnelMode } from "../../../app/services/charnel";

const DRAG_THRESHOLD = 8;
const ROW_HEIGHT_PX = 68;

interface KeyedItem {
  key: string;
}

export function usePlaylistDragReorder<T extends KeyedItem>(
  items: Accessor<T[]>,
  isTouch: boolean,
  onReorder: (fromKey: string, toIndex: number) => Promise<void>
) {
  const [draggedItemKey, setDraggedItemKey] = createSignal<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
  const [pointerDragItemKey, setPointerDragItemKey] = createSignal<string | null>(null);

  // pointer-based drag state for Tauri and touch devices
  let pendingPointerDrag: {
    itemKey: string;
    startY: number;
    pointerId: number;
    target: HTMLElement;
  } | null = null;
  let scrollRef: HTMLElement | undefined;

  const setScrollRef = (el: HTMLElement | undefined) => {
    scrollRef = el;
  };

  // combined dragged item key (pointer drag for charnel/touch, HTML5 drag otherwise)
  const effectiveDraggedItemKey = () =>
    isCharnelMode() || isTouch ? pointerDragItemKey() : draggedItemKey();

  onMount(() => {
    // global dragend cleanup for webkit/tauri compatibility
    const handleGlobalDragEnd = () => {
      setDraggedItemKey(null);
      setDropTargetIndex(null);
    };
    document.addEventListener("dragend", handleGlobalDragEnd);

    // pointer-based drag for Tauri and touch devices
    // (HTML5 drag API doesn't work in WKWebView or on mobile browsers)
    const handlePointerMove = (e: PointerEvent) => {
      if (!isCharnelMode() && !isTouch) return;

      // check if pending drag should activate
      if (pendingPointerDrag !== null) {
        const deltaY = Math.abs(e.clientY - pendingPointerDrag.startY);
        if (deltaY >= DRAG_THRESHOLD) {
          setPointerDragItemKey(pendingPointerDrag.itemKey);
          pendingPointerDrag.target.setPointerCapture(pendingPointerDrag.pointerId);
          pendingPointerDrag = null;
        }
        return;
      }

      const dragKey = pointerDragItemKey();
      if (!dragKey) return;

      // prevent page scroll during active drag on touch
      e.preventDefault();

      // find target index based on Y position (68px per row, account for scroll)
      const currentItems = items();
      const container = document.querySelector("[data-playlist-items]");
      const rect = container?.getBoundingClientRect();
      if (!rect) return;

      const scrollTop = scrollRef?.scrollTop ?? 0;
      const relativeY = e.clientY - rect.top + scrollTop;
      const targetIndex = Math.floor(relativeY / ROW_HEIGHT_PX);
      const clampedTarget = Math.max(0, Math.min(targetIndex, currentItems.length - 1));
      const currentIndex = currentItems.findIndex((i) => i.key === dragKey);

      if (clampedTarget !== currentIndex) {
        setDropTargetIndex(clampedTarget);
      } else {
        setDropTargetIndex(null);
      }
    };

    const handlePointerUp = async () => {
      if (!isCharnelMode() && !isTouch) return;
      pendingPointerDrag = null;

      const dragKey = pointerDragItemKey();
      const toIndex = dropTargetIndex();

      if (dragKey && toIndex !== null) {
        await onReorder(dragKey, toIndex);
      }

      setPointerDragItemKey(null);
      setDropTargetIndex(null);
    };

    // use non-passive listener so we can call e.preventDefault() during touch drag
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp);

    onCleanup(() => {
      document.removeEventListener("dragend", handleGlobalDragEnd);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    });
  });

  // handle drag start
  const handleDragStart = (itemKey: string) => (e: DragEvent) => {
    setDraggedItemKey(itemKey);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", itemKey);
      // Safari has issues with drag images on transformed elements
      const target = e.currentTarget as HTMLElement;
      const clone = target.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.top = "-9999px";
      clone.style.left = "-9999px";
      clone.style.transform = "none";
      clone.style.width = `${target.offsetWidth}px`;
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(
        clone,
        e.clientX - target.getBoundingClientRect().left,
        e.clientY - target.getBoundingClientRect().top
      );
      requestAnimationFrame(() => clone.remove());
    }
  };

  // handle drag over
  const handleDragOver = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDropTargetIndex(index);
  };

  // handle drag leave
  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  // handle drag end
  const handleDragEnd = () => {
    setDraggedItemKey(null);
    setDropTargetIndex(null);
  };

  // handle pointer down for pointer-based drag (Tauri and touch)
  const handlePointerDown = (itemKey: string) => (e: PointerEvent) => {
    if (!isCharnelMode() && !isTouch) return;
    if (e.button !== 0) return;
    // on touch, only initiate drag when the touch starts on the drag handle
    // (the handle has touch-action:none so scroll won't compete)
    const target = e.target as HTMLElement;
    if (isTouch && !target.closest("[data-drag-handle]")) return;
    pendingPointerDrag = {
      itemKey,
      startY: e.clientY,
      pointerId: e.pointerId,
      target: e.currentTarget as HTMLElement,
    };
  };

  // handle drop
  const handleDrop = async (targetIndex: number) => {
    const draggedKey = draggedItemKey();
    if (!draggedKey) return;

    try {
      await onReorder(draggedKey, targetIndex);
    } finally {
      setDraggedItemKey(null);
      setDropTargetIndex(null);
    }
  };

  return {
    dropTargetIndex,
    effectiveDraggedItemKey,
    setScrollRef,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDragEnd,
    handlePointerDown,
    handleDrop,
  };
}
