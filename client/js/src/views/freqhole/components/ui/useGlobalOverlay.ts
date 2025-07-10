import { createSignal } from "solid-js";

// Global overlay state - only one overlay can be "active" at a time
const [activeOverlay, setActiveOverlay] = createSignal<{
  id: string;
  element: HTMLElement;
  onClose: () => void;
} | null>(null);

let isListening = false;

// Global click and escape handlers
const handleGlobalClick = (event: MouseEvent) => {
  const overlay = activeOverlay();
  if (!overlay) return;

  if (!overlay.element.contains(event.target as Node)) {
    overlay.onClose();
  }
};

const handleGlobalEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    const overlay = activeOverlay();
    if (overlay) {
      overlay.onClose();
    }
  }
};

const startListening = () => {
  if (isListening) return;
  document.addEventListener("mousedown", handleGlobalClick);
  document.addEventListener("keydown", handleGlobalEscape);
  isListening = true;
};

const stopListening = () => {
  if (!isListening) return;
  document.removeEventListener("mousedown", handleGlobalClick);
  document.removeEventListener("keydown", handleGlobalEscape);
  isListening = false;
};

// Hook for any overlay component
export function useGlobalOverlay(id: string) {
  const isActive = () => activeOverlay()?.id === id;

  const activate = (element: HTMLElement, onClose: () => void) => {
    // Close any existing overlay first
    const current = activeOverlay();
    if (current && current.id !== id) {
      current.onClose();
    }

    // Set this as active overlay
    setActiveOverlay({ id, element, onClose });
    startListening();
  };

  const deactivate = () => {
    if (isActive()) {
      setActiveOverlay(null);
      stopListening();
    }
  };

  return {
    isActive,
    activate,
    deactivate,
  };
}
