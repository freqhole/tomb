import { createEffect, onCleanup } from "solid-js";

export function useEventPropagation(props: {
  containerRef: () => HTMLDivElement | undefined;
  isEditMode: () => boolean;
  onGlobalKeyDown?: (event: KeyboardEvent) => void;
}) {
  // global keyboard handler at container level
  const handleContainerKeyDown = (event: KeyboardEvent) => {
    // if any input/textarea is focused, let browser handle it
    const activeElement = document.activeElement;
    if (
      activeElement?.tagName === "INPUT" ||
      activeElement?.tagName === "TEXTAREA" ||
      activeElement?.hasAttribute("contenteditable")
    ) {
      return; // browser handles input events naturally
    }

    // if in edit mode, let edit component handle keys
    if (props.isEditMode()) {
      return;
    }

    // only handle grid-level shortcuts when not editing
    props.onGlobalKeyDown?.(event);
  };

  // attach event listener to container
  createEffect(() => {
    const container = props.containerRef();
    if (!container) return;

    container.addEventListener("keydown", handleContainerKeyDown);

    onCleanup(() => {
      container.removeEventListener("keydown", handleContainerKeyDown);
    });
  });

  return {
    // helper to stop propagation for cell-level events
    stopPropagation: (event: Event) => {
      event.stopPropagation();
    },
    // helper to prevent default browser behavior
    preventDefault: (event: Event) => {
      event.preventDefault();
    },
    // check if event should be handled by grid
    shouldHandleEvent: () => {
      const activeElement = document.activeElement;
      return (
        !props.isEditMode() &&
        activeElement?.tagName !== "INPUT" &&
        activeElement?.tagName !== "TEXTAREA" &&
        !activeElement?.hasAttribute("contenteditable")
      );
    },
  };
}
