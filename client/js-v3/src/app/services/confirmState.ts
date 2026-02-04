// global confirm dialog state service
// provides a reactive signal-based approach instead of manual DOM manipulation

import { createSignal } from "solid-js";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger";
}

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
  resolve: ((value: boolean) => void) | null;
}

const defaultState: ConfirmState = {
  isOpen: false,
  message: "",
  resolve: null,
};

// global signal for confirm dialog state
const [confirmState, setConfirmState] = createSignal<ConfirmState>(defaultState);

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
    setConfirmState({
      ...options,
      isOpen: true,
      resolve,
    });
  });
}

// called by ConfirmDialog when user confirms
export function resolveConfirm(result: boolean): void {
  const state = confirmState();
  if (state.resolve) {
    state.resolve(result);
  }
  setConfirmState(defaultState);
}

// close the dialog (resolves with false)
export function closeConfirm(): void {
  resolveConfirm(false);
}

// export the signal for reading in components
export { confirmState };
