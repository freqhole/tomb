// confirm-before-replace state for playQueue's "shouldReplace" path while a
// remote target is active - see queue.ts's playQueue() and
// ReplaceQueueConfirmModal.tsx. mirrors queueLimit.ts's showQueueFullModal
// pattern (signal-backed state + a promise the caller awaits for the
// user's choice).
import { createSignal } from "solid-js";
import type { MediaItem } from "../../../app/services/storage/mediaItem";

export type ReplaceQueueChoice = "replace" | "append" | "cancel";

export interface ReplaceQueueConfirmState {
  isOpen: boolean;
  itemsToAdd: MediaItem[];
  resolve: ((choice: ReplaceQueueChoice) => void) | null;
}

const initialState: ReplaceQueueConfirmState = {
  isOpen: false,
  itemsToAdd: [],
  resolve: null,
};

const [replaceQueueConfirm, setReplaceQueueConfirm] =
  createSignal<ReplaceQueueConfirmState>(initialState);
export { replaceQueueConfirm };

/** shows the confirm dialog, resolving once the user picks an option. */
export function showReplaceQueueConfirm(itemsToAdd: MediaItem[]): Promise<ReplaceQueueChoice> {
  return new Promise((resolve) => {
    setReplaceQueueConfirm({ isOpen: true, itemsToAdd, resolve });
  });
}

export function closeReplaceQueueConfirm(choice: ReplaceQueueChoice): void {
  const state = replaceQueueConfirm();
  state.resolve?.(choice);
  setReplaceQueueConfirm(initialState);
}
