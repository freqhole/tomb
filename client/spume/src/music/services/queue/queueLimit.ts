// queue limit management
// provides limit checking and modal state for queue full scenarios

import { createSignal } from "solid-js";
import type { Song } from "../storage/types";

// default queue size limit. used as the fallback when no override
// has been loaded (browser mode, or before `initQueueSizeLimit()`
// has run in tauri mode). the actual runtime value comes from the
// `[client] queue_size_limit` field in `freqhole-config.toml`,
// surfaced via the `get_client_config` tauri command and cached
// below by `initQueueSizeLimit()`.
const DEFAULT_QUEUE_SIZE_LIMIT = 150;

let cachedQueueSizeLimit = DEFAULT_QUEUE_SIZE_LIMIT;

/** current effective queue size limit. reads the cache populated by
 *  `initQueueSizeLimit()` (falls back to `DEFAULT_QUEUE_SIZE_LIMIT`). */
export function getQueueSizeLimit(): number {
  return cachedQueueSizeLimit;
}

/** hydrate the queue size limit from the host's `[client]` config.
 *  safe to call outside tauri (no-op, leaves the default). idempotent. */
export async function initQueueSizeLimit(): Promise<number> {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cfg = await invoke<{ queue_size_limit: number }>("get_client_config");
      if (cfg && Number.isFinite(cfg.queue_size_limit) && cfg.queue_size_limit > 0) {
        cachedQueueSizeLimit = Math.floor(cfg.queue_size_limit);
        return cachedQueueSizeLimit;
      }
    } catch {
      // tauri command missing or threw — fall through to default.
    }
  }
  cachedQueueSizeLimit = DEFAULT_QUEUE_SIZE_LIMIT;
  return cachedQueueSizeLimit;
}

/** @deprecated use `getQueueSizeLimit()` so config overrides take effect. */
export const QUEUE_SIZE_LIMIT = DEFAULT_QUEUE_SIZE_LIMIT;

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
  const limit = getQueueSizeLimit();
  const totalAfterAdd = currentQueueSize + songsToAddCount;
  if (totalAfterAdd <= limit) {
    return 0;
  }
  return totalAfterAdd - limit;
}
