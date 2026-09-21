// bulk "send to remote" modal — driven by the shared bulkSendJobs.ts
// registry so a long-running send survives the modal being closed and
// reopened (see that file's own doc comment). used by both the albums
// and videos table views' multi-select bulk-action bars.
//
// two steps:
//   1. destination picker (shown until a job has been started)
//   2. live progress, with pause/resume + a "close" (not cancel) button -
//      closing just stops rendering this modal; the job keeps running and
//      a toast fires on completion if nobody reopened it by then.
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { Modal } from "./Modal";
import { Icon, IconNames } from "../icons/registry";
import {
  createCandidateDestinations,
  type CandidateDestination,
} from "../../music/services/send/destinationCandidates";
import {
  cancelBulkSendJob,
  clearBulkSendJob,
  closeBulkSendModal,
  getBulkSendJobs,
  openBulkSendModalFor,
  pauseBulkSendJob,
  resumeBulkSendJob,
  startBulkAlbumSend,
  startBulkVideoSend,
  type BulkSendKind,
} from "../../app/services/send/bulkSendJobs";
import type { SendVideoItem } from "../../video/services/send/sendVideoToRemote";
import type { Remote } from "../../app/services/storage/schemas/remote";

export interface BulkSendToRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: BulkSendKind;
  /** the source remote — the data being sent originates from here. */
  source: Remote;
  /** items to send when starting a brand new job (ignored once `jobId` is set). */
  albumIds?: string[];
  videoItems?: SendVideoItem[];
  /** reopen an already-running job's progress instead of the destination picker. */
  jobId?: string | null;
}

export const BulkSendToRemoteModal: Component<BulkSendToRemoteModalProps> = (props) => {
  // local mirror of the active job id — starts from `props.jobId` (reopen
  // case), otherwise null until the user picks a destination below.
  const [activeJobId, setActiveJobId] = createSignal<string | null>(props.jobId ?? null);

  onMount(() => {
    if (activeJobId()) openBulkSendModalFor(activeJobId()!);
  });
  onCleanup(() => closeBulkSendModal());

  const job = createMemo(() => {
    const id = activeJobId();
    if (!id) return null;
    return getBulkSendJobs()().get(id) ?? null;
  });

  const candidates = createCandidateDestinations({
    sourceRemoteId: () => props.source.remote_id,
  });
  // only real p2p/charnel-managed destinations can receive a bulk send -
  // no browser-local counterpart for a bulk operation (mirrors video's
  // single-item send-to-remote limitation, see SendToRemoteSection.tsx).
  const readyDestinations = createMemo(() => candidates().filter((c) => c.status.kind === "ready"));

  const itemCount = () =>
    props.kind === "albums" ? (props.albumIds?.length ?? 0) : (props.videoItems?.length ?? 0);
  const itemWord = () => (props.kind === "albums" ? "album" : "video");

  const handleStart = (dest: CandidateDestination) => {
    const jobId =
      props.kind === "albums"
        ? startBulkAlbumSend({
            albumIds: props.albumIds ?? [],
            source: props.source,
            dest: dest.remote,
          })
        : startBulkVideoSend({
            items: props.videoItems ?? [],
            source: props.source,
            dest: dest.remote,
          });
    setActiveJobId(jobId);
    openBulkSendModalFor(jobId);
  };

  const pct = () => {
    const j = job();
    if (!j || j.totalItems === 0) return 0;
    return Math.min(100, Math.round(((j.completedItems + j.failedItems) / j.totalItems) * 100));
  };

  const handleClose = () => {
    // deliberately does NOT cancel the job - it keeps running via the
    // registry, and a toast fires on completion (see bulkSendJobs.ts).
    props.onClose();
  };

  const handleClearAndClose = () => {
    const id = activeJobId();
    if (id) clearBulkSendJob(id);
    props.onClose();
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      disableBackdropClose
      title={`send ${itemCount()} ${itemWord()}${itemCount() === 1 ? "" : "s"} to remote`}
      size="md"
    >
      <div class="p-4 space-y-4">
        <Show
          when={job()}
          fallback={
            <Show
              when={readyDestinations().length > 0}
              fallback={
                <p class="text-sm text-[var(--color-text-tertiary)]">
                  no reachable p2p or local destination to send to.
                </p>
              }
            >
              <ul class="space-y-1">
                <For each={readyDestinations()}>
                  {(c) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleStart(c)}
                        class="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left rounded-md border border-[var(--color-border-default)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                      >
                        <span class="truncate text-[var(--color-text-primary)]">
                          {c.remote.name ?? c.remote.remote_id}
                        </span>
                        <Icon
                          name={IconNames.recent}
                          size={14}
                          color="var(--color-text-tertiary)"
                        />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          }
        >
          {(j) => (
            <div class="space-y-3">
              <div class="flex items-center justify-between text-sm">
                <span class="font-medium text-[var(--color-text-primary)]">{j().destName}</span>
                <span class="text-xs text-[var(--color-text-secondary)]">
                  {j().completedItems + j().failedItems}/{j().totalItems}
                </span>
              </div>

              <div class="h-1.5 w-full bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  class="h-full bg-[var(--color-accent,_currentColor)] transition-[width] duration-150"
                  style={{ width: `${pct()}%` }}
                />
              </div>

              <Show when={!j().done}>
                <p class="text-xs text-[var(--color-text-tertiary)] truncate">
                  {j().paused
                    ? "paused"
                    : j().currentItemTitle
                      ? `sending "${j().currentItemTitle}"...`
                      : "preparing..."}
                </p>
              </Show>

              <Show when={j().failedItems > 0}>
                <details class="text-xs text-[var(--color-text-tertiary)]">
                  <summary class="cursor-pointer hover:text-[var(--color-text-secondary)]">
                    {j().failedItems} failed
                  </summary>
                  <ul class="mt-1 space-y-0.5 max-h-32 overflow-y-auto pl-3 list-disc">
                    <For each={j().errors.slice(0, 20)}>
                      {(err) => <li class="break-words">{err}</li>}
                    </For>
                  </ul>
                </details>
              </Show>

              <div class="flex items-center gap-2 pt-1">
                <Show
                  when={!j().done}
                  fallback={
                    <button
                      type="button"
                      onClick={handleClearAndClose}
                      class="px-3 py-1 text-xs rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors"
                    >
                      done — dismiss
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      j().paused ? resumeBulkSendJob(j().id) : pauseBulkSendJob(j().id)
                    }
                    class="px-3 py-1 text-xs rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors"
                  >
                    {j().paused ? "resume" : "pause"}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelBulkSendJob(j().id)}
                    class="px-3 py-1 text-xs rounded-md text-[var(--color-error,_inherit)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border-default)] transition-colors"
                  >
                    stop
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    class="ml-auto px-3 py-1 text-xs rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                    title="keeps running in the background — you'll get a toast when it's done"
                  >
                    close
                  </button>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Modal>
  );
};
