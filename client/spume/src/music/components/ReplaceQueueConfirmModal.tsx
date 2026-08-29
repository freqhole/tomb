// shown instead of instantly replacing the queue when picking a new
// album/artist/playlist/shuffle to play while a remote target is active
// (local-only playback replaces instantly, same as always - see
// queue.ts's playQueue()).
import { Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { Modal } from "../../components/overlays/Modal";
import {
  replaceQueueConfirm,
  closeReplaceQueueConfirm,
} from "../services/queue/queueReplaceConfirm";

export function ReplaceQueueConfirmModal() {
  const state = () => replaceQueueConfirm();

  return (
    <Show when={state().isOpen}>
      <Modal
        isOpen={state().isOpen}
        onClose={() => closeReplaceQueueConfirm("cancel")}
        title="replace the shared queue?"
        showCloseButton={false}
      >
        <div class="space-y-4">
          <p class="text-[var(--color-text-secondary)] text-sm">
            everyone listening on this player is sharing the current queue. replacing it clears
            what's already queued for them too.
          </p>

          <div class="flex flex-col gap-2">
            <Button
              variant="danger"
              onClick={() => closeReplaceQueueConfirm("replace")}
              class="w-full justify-center"
            >
              yes, replace the queue
            </Button>

            <Button
              variant="primary"
              onClick={() => closeReplaceQueueConfirm("append")}
              class="w-full justify-center"
            >
              add to end of queue instead
            </Button>

            <Button
              variant="ghost"
              onClick={() => closeReplaceQueueConfirm("cancel")}
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
