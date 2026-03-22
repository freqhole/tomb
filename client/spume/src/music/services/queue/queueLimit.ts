// queue limit management
// provides limit checking and modal state for queue full scenarios

import { createSignal } from "solid-js";
import type { Song } from "../storage/types";

// maximum number of songs allowed in the queue
export const QUEUE_SIZE_LIMIT = 150;

// user's choice when queue is full
export type QueueFullChoice = "cancel" | "remove-from-start" | "clear-all";

// state for queue full modal
export interface QueueFullModalState {
  isOpen: boolean;
  songsToAdd: Song[];
  currentQueueSize: number;
  resolve: ((choice: QueueFullChoice) => void) | null;
}

// initial state for the modal
const initialState: QueueFullModalState = {
  isOpen: false,
  songsToAdd: [],
  currentQueueSize: 0,
  resolve: null,
};

// reactive signal for modal state
const [queueFullModal, setQueueFullModal] = createSignal<QueueFullModalState>(initialState);

// export read-only access to modal state
export { queueFullModal };

// show the queue full modal and wait for user's choice
// returns a Promise that resolves with the user's choice
export function showQueueFullModal(
  songsToAdd: Song[],
  currentQueueSize: number,
): Promise<QueueFullChoice> {
  return new Promise((resolve) => {
    setQueueFullModal({
      isOpen: true,
      songsToAdd,
      currentQueueSize,
      resolve,
    });
  });
}

// close the modal with a specific choice
export function closeQueueFullModal(choice: QueueFullChoice): void {
  const state = queueFullModal();
  if (state.resolve) {
    state.resolve(choice);
  }
  setQueueFullModal(initialState);
}

// calculate how many songs need to be removed to fit new songs
export function calculateRemoveCount(
  currentQueueSize: number,
  songsToAddCount: number,
): number {
  const totalAfterAdd = currentQueueSize + songsToAddCount;
  if (totalAfterAdd <= QUEUE_SIZE_LIMIT) {
    return 0;
  }
  return totalAfterAdd - QUEUE_SIZE_LIMIT;
}
