import { For, Show, createEffect, createMemo, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { Icon } from "../icons/registry";
import { pushModal, popModal } from "../../music/hooks/modals";
import { pickDirectory, pickFiles } from "../../utils/filePicker";
import { getLocalLibraryName } from "../../app/services/storage/db";
import type { VideoUploadJob } from "../../video/import/remoteImport";

export interface AddVideoModalProps {
  /** whether modal is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when files are selected (always provided on web / android) */
  onFilesSelected?: (files: FileList) => void;
  /** callback when paths are selected (desktop tauri - files or directories) */
  onPathsSelected?: (paths: string[]) => void;
  /** name of the remote server (shows in header when set) */
  remoteName?: string;
  /** whether to use tauri dialog (for tauri-managed remotes) */
  useCharnelDialog?: boolean;
  /** tracked upload jobs to display */
  uploadJobs?: VideoUploadJob[];
  /** additional classes */
  class?: string;
}

export function AddVideoModal(props: AddVideoModalProps) {
  // register with the global modal stack so escape closes this modal
  createEffect(() => {
    if (!props.isOpen) return;
    const id = "add-video-modal";
    pushModal(id, () => props.onClose());
    onCleanup(() => popModal(id));
  });

  const useNativeDialog = () => !!props.useCharnelDialog;

  const handleSelectFiles = async () => {
    // unified picker - see AddMusicModal's identical handler for the full
    // rationale (desktop tauri returns paths, android returns eagerly-read
    // File objects, web returns real File objects).
    const picked = await pickFiles({
      kind: "video",
      multiple: true,
      readBytes: true,
      title: "select video files",
    });
    if (picked.length === 0) return;

    const paths = picked.map((p) => p.path).filter((p): p is string => !!p);
    if (props.onPathsSelected && paths.length > 0 && paths.length === picked.length) {
      props.onPathsSelected(paths);
      return;
    }

    const files = picked.map((p) => p.file).filter((f): f is File => !!f);
    if (files.length === 0) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    props.onFilesSelected?.(dt.files);
  };

  const handleSelectDirectory = async () => {
    if (!useNativeDialog() || !props.onPathsSelected) return;
    const selected = await pickDirectory("select video folder");
    if (selected) props.onPathsSelected([selected]);
  };

  // derived job counts (mirrors AddMusicModal's grouping)
  const transferringJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "uploading")
  );
  const processingJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "polling")
  );
  const failedJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "failed")
  );
  const completedJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "completed")
  );
  const timedOutJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "timeout")
  );
  const hasJobs = createMemo(() => (props.uploadJobs ?? []).length > 0);

  return (
    <Show when={props.isOpen}>
      <Portal>
        {/* overlay - inline styles for position/inset, see AddMusicModal for why */}
        <div
          class="bg-black/50 flex items-center justify-center p-0 wide:p-8"
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 1100 }}
          onClick={() => props.onClose()}
        >
          <div
            class={`w-full wide:max-w-3xl wide:h-auto wide:max-h-[80dvh] bg-[var(--color-bg-secondary)] wide:border wide:border-[var(--color-border-default)] wide:rounded-lg overflow-hidden flex flex-col ${props.class || ""}`}
            style={{
              height: "calc(100% - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px))",
              "max-height": "calc(100% - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px))",
              "margin-top": "var(--safe-area-top, 0px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* modal header */}
            <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)] gap-2">
              <h2
                class="heading-5 text-[var(--color-text-primary)] truncate"
                style={{ "min-width": "0" }}
              >
                add video to {props.remoteName || getLocalLibraryName()}
              </h2>
              <IconButton
                icon="close"
                variant="ghost"
                aria-label="close modal"
                onClick={props.onClose}
                class="flex-shrink-0"
              />
            </div>

            {/* file/directory picking - no tabs, just one drop zone */}
            <div class="px-4 pt-4 pb-6 overflow-y-auto flex-1 min-h-0">
              <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center">
                <div class="mb-4">
                  <Icon name="upload" size={48} color="var(--color-text-muted)" />
                </div>
                <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">add video files</h3>
                <p class="body-small text-[var(--color-text-secondary)] mb-2">
                  {props.useCharnelDialog
                    ? "select files or an entire folder"
                    : props.remoteName
                      ? `files will be uploaded to ${props.remoteName}`
                      : "drag video files here or click to select"}
                </p>
                <p class="body-xs text-[var(--color-text-tertiary)] mb-4">
                  supports mp4, mkv, webm, mov, avi
                </p>
                <div class="flex gap-2">
                  <Button variant="primary" onClick={handleSelectFiles}>
                    select files
                  </Button>
                  <Show when={useNativeDialog()}>
                    <Button variant="secondary" onClick={handleSelectDirectory}>
                      select folder
                    </Button>
                  </Show>
                </div>
              </div>
            </div>

            {/* upload progress - pinned below the drop zone */}
            <div class="flex-shrink-0 overflow-y-auto max-h-[50dvh]">
              <Show when={hasJobs()}>
                <div class="border-t border-[var(--color-border-default)] px-4 py-3">
                  <div class="flex items-center gap-2 mb-2">
                    <Show when={transferringJobs().length > 0}>
                      <div class="flex items-center gap-1.5">
                        <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span class="body-xs text-[var(--color-text-secondary)]">
                          transferring {transferringJobs().length} file
                          {transferringJobs().length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </Show>
                    <Show when={transferringJobs().length === 0 && processingJobs().length > 0}>
                      <div class="flex items-center gap-1.5">
                        <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span class="body-xs text-[var(--color-text-secondary)]">
                          processing {processingJobs().length} on{" "}
                          {props.remoteName || getLocalLibraryName()}
                        </span>
                      </div>
                    </Show>
                    <Show when={completedJobs().length > 0}>
                      <span class="body-xs text-[var(--color-text-tertiary)]">
                        {completedJobs().length} done
                      </span>
                    </Show>
                    <Show when={failedJobs().length > 0}>
                      <span class="body-xs text-red-400">{failedJobs().length} failed</span>
                    </Show>
                    <Show when={timedOutJobs().length > 0}>
                      <span class="body-xs text-amber-400">{timedOutJobs().length} queued</span>
                    </Show>
                  </div>

                  <Show when={transferringJobs().length > 0}>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-2">
                      transferring files - keep this app open until the transfer finishes. you can
                      switch tabs or add more videos.
                    </p>
                  </Show>
                  <Show when={transferringJobs().length === 0 && processingJobs().length > 0}>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-2">
                      files transferred - {props.remoteName || getLocalLibraryName()} is finishing
                      up on its own. safe to close.
                    </p>
                  </Show>

                  <div class="max-h-32 overflow-y-auto space-y-1">
                    <For each={props.uploadJobs ?? []}>
                      {(job) => (
                        <div class="flex items-center gap-2 py-0.5">
                          <div class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                            {job.status === "uploading" || job.status === "polling" ? (
                              <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            ) : job.status === "completed" ? (
                              <Icon name="check" size={14} color="var(--color-success)" />
                            ) : job.status === "timeout" ? (
                              <Icon name="recent" size={14} color="var(--color-warning, #f59e0b)" />
                            ) : (
                              <Icon name="close" size={14} color="var(--color-error)" />
                            )}
                          </div>
                          <span
                            class="body-xs truncate flex-1"
                            classList={{
                              "text-[var(--color-text-secondary)]":
                                job.status === "uploading" || job.status === "polling",
                              "text-[var(--color-text-tertiary)]": job.status === "completed",
                              "text-amber-400": job.status === "timeout",
                              "text-red-400": job.status === "failed",
                            }}
                          >
                            {job.label}
                          </span>
                          <span
                            class="body-xs flex-shrink-0 text-[var(--color-text-tertiary)] max-w-[60%] truncate"
                            title={
                              job.status === "failed"
                                ? (job.errorFull ?? job.error ?? "failed")
                                : job.status === "polling" && job.stage
                                  ? job.stage
                                  : undefined
                            }
                          >
                            {job.status === "uploading"
                              ? "transferring..."
                              : job.status === "polling"
                                ? (job.stage ?? "processing...")
                                : job.status === "completed"
                                  ? "done"
                                  : job.status === "timeout"
                                    ? "queued, check back later"
                                    : (job.error ?? "failed")}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
