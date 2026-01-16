import { createEffect, onCleanup } from "solid-js";

export function useKeyboardNavigation(props: {
  totalItems: number;
  focusedIndex: () => number;
  setFocusedIndex: (index: number) => void;
  onEnter?: (index: number) => void;
  onEscape?: () => void;
  containerRef?: () => HTMLDivElement | undefined;
}) {
  const handleKeyDown = (event: KeyboardEvent) => {
    const current = props.focusedIndex();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (current < props.totalItems - 1) {
          props.setFocusedIndex(current + 1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (current > 0) {
          props.setFocusedIndex(current - 1);
        }
        break;
      case "Enter":
        event.preventDefault();
        props.onEnter?.(current);
        break;
      case "Escape":
        event.preventDefault();
        props.onEscape?.();
        break;
      case "Home":
        event.preventDefault();
        props.setFocusedIndex(0);
        break;
      case "End":
        event.preventDefault();
        props.setFocusedIndex(props.totalItems - 1);
        break;
      case "PageDown":
        event.preventDefault();
        const pageDownTarget = Math.min(current + 10, props.totalItems - 1);
        props.setFocusedIndex(pageDownTarget);
        break;
      case "PageUp":
        event.preventDefault();
        const pageUpTarget = Math.max(current - 10, 0);
        props.setFocusedIndex(pageUpTarget);
        break;
    }
  };

  // attach keyboard listener to container or document
  createEffect(() => {
    const container = props.containerRef?.();
    const target = container || document;

    const eventHandler = (event: Event) => {
      handleKeyDown(event as KeyboardEvent);
    };

    target.addEventListener("keydown", eventHandler);

    onCleanup(() => {
      target.removeEventListener("keydown", eventHandler);
    });
  });

  return { handleKeyDown };
}
