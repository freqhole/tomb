// queue full modal component
// shown when user tries to add songs to a full queue

import { Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { Modal } from "../../components/overlays/Modal";
import { Alert } from "../../components/feedback/Alert";
import {
  queueFullModal,
  closeQueueFullModal,
  calculateRemoveCount,
  QUEUE_SIZE_LIMIT,
} from "../services/queue/queueLimit";

export function QueueFullModal() {
  const state = () => queueFullModal();
  const removeCount = () =>
    calculateRemoveCount(state().currentQueueSize, state().songsToAdd.length);

  return (
    <Show when={state().isOpen}>
      <Modal
        isOpen={state().isOpen}
        onClose={() => closeQueueFullModal("cancel")}
        title="queue is full"
        showCloseButton={false}
      >
        <div class="space-y-4">
          <Alert variant="warning">
            <p>
              your queue has {state().currentQueueSize} songs (limit: {QUEUE_SIZE_LIMIT}).
            </p>
            <p class="mt-1">
              adding {state().songsToAdd.length} more song
              {state().songsToAdd.length === 1 ? "" : "s"} would exceed the limit.
            </p>
          </Alert>

          <div class="text-[var(--color-text-secondary)] text-sm">what would you like to do?</div>

          <div class="flex flex-col gap-2">
            <Button
              variant="primary"
              onClick={() => closeQueueFullModal("remove-from-start")}
              class="w-full justify-center"
            >
              remove {removeCount()} song{removeCount() === 1 ? "" : "s"} from start
            </Button>

            <Button
              variant="danger"
              onClick={() => closeQueueFullModal("clear-all")}
              class="w-full justify-center"
            >
              clear queue &amp; add new songs
            </Button>

            <Button
              variant="ghost"
              onClick={() => closeQueueFullModal("cancel")}
              class="w-full justify-center"
            >
              cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
