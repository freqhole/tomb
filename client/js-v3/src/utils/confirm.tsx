// confirmation dialog utility for showing "are you sure?" prompts
// provides a simple API for confirmation without managing modal state in every component

import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger";
}

/**
 * show a confirmation dialog and return a promise that resolves to true if confirmed
 *
 * usage:
 * ```typescript
 * const confirmed = await confirm({
 *   title: "delete song",
 *   message: "are you sure you want to delete this song? this cannot be undone.",
 *   confirmText: "delete",
 *   variant: "danger",
 * });
 *
 * if (confirmed) {
 *   // proceed with delete
 * }
 * ```
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // create a container for the dialog
    const container = document.createElement("div");
    document.body.appendChild(container);

    // track if we've already cleaned up to prevent double-removal
    let cleaned = false;

    // create signals for dialog state
    let isOpen: () => boolean;
    let setIsOpen: (value: boolean) => void;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      dispose();
      document.body.removeChild(container);
    };

    const handleConfirm = () => {
      setIsOpen(false);
      cleanup();
      resolve(true);
    };

    const handleClose = () => {
      setIsOpen(false);
      cleanup();
      resolve(false);
    };

    // render the dialog with solid-js
    const dispose = render(() => {
      [isOpen, setIsOpen] = createSignal(true);

      return (
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title={options.title}
          message={options.message}
          confirmText={options.confirmText}
          cancelText={options.cancelText}
          variant={options.variant || "primary"}
        />
      );
    }, container);
  });
}
