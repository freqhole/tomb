import { For, Show, createSignal, createMemo } from "solid-js";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { TextArea } from "../forms/TextArea";
import { Icon } from "../icons/registry";
import { Tab, TabList, TabPanel, Tabs } from "../navigation/Tabs";
import type { UploadJob } from "../../music/import";
import type { LocalImportProgress } from "../../music/import";

export interface AddMusicModalProps {
  /** whether modal is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when files are selected (standard browser file input) */
  onFilesSelected?: (files: FileList) => void;
  /** callback when paths are selected (tauri dialog - files or directories) */
  onPathsSelected?: (paths: string[]) => void;
  /** callback when urls are submitted */
  onUrlsSubmitted?: (urls: string[]) => void;
  /** name of the remote server (shows in header when set) */
  remoteName?: string;
  /** whether to use tauri dialog (for tauri-managed remotes) */
  useTauriDialog?: boolean;
  /** tracked upload/fetch jobs to display */
  uploadJobs?: UploadJob[];
  /** local import progress */
  localImportProgress?: LocalImportProgress;
  /** additional classes */
  class?: string;
}

export function AddMusicModal(props: AddMusicModalProps) {
  const [uploadMode, setUploadMode] = createSignal("files");
  const [urlText, setUrlText] = createSignal("");
  let fileInputRef: HTMLInputElement | undefined;

  // tauri dialog open function type
  type TauriDialogOpenFn = (options: {
    multiple?: boolean;
    directory?: boolean;
    filters?: { name: string; extensions: string[] }[];
    title?: string;
  }) => Promise<string | string[] | null>;

  const handleSelectFiles = () => {
    // for tauri dialog mode, trigger the tauri dialog picker
    if (props.useTauriDialog && props.onPathsSelected) {
      handleTauriFilesPick();
      return;
    }
    // fall back to standard file input
    fileInputRef?.click();
  };

  const handleSelectDirectory = async () => {
    if (!props.useTauriDialog || !props.onPathsSelected) return;

    try {
      // dynamically import dialog plugin (only available in tauri runtime)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialogModule = (await import("@tauri-apps/plugin-dialog" as any)) as {
        open: TauriDialogOpenFn;
      };

      const selected = await dialogModule.open({
        multiple: false,
        directory: true,
        title: "select music folder",
      });

      if (selected && typeof selected === "string") {
        props.onPathsSelected([selected]);
      }
    } catch (err) {
      console.error("failed to open directory dialog:", err);
    }
  };

  const handleTauriFilesPick = async () => {
    if (!props.onPathsSelected) return;

    try {
      // dynamically import dialog plugin (only available in tauri runtime)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialogModule = (await import("@tauri-apps/plugin-dialog" as any)) as {
        open: TauriDialogOpenFn;
      };

      const selected = await dialogModule.open({
        multiple: true,
        filters: [
          { name: "audio", extensions: ["mp3", "flac", "wav", "m4a", "ogg", "aac", "alac", "wma"] },
        ],
        title: "select music files",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          props.onPathsSelected(paths);
        }
      }
    } catch (err) {
      console.error("failed to open file dialog:", err);
    }
  };

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      props.onFilesSelected?.(target.files);
      target.value = ""; // reset input
    }
  };

  const handleDownloadUrls = () => {
    const text = urlText().trim();
    if (!text) return;

    const urls = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (urls.length > 0) {
      props.onUrlsSubmitted?.(urls);
      setUrlText(""); // reset textarea
    }
  };

  // derived job counts
  const activeJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "uploading" || j.status === "polling")
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

  // local import progress helpers
  const localProgress = () => props.localImportProgress;
  const isLocalImporting = () => {
    const p = localProgress();
    return p != null && p.phase !== "idle";
  };
  const localProgressPercent = () => {
    const p = localProgress();
    if (!p || p.total === 0) return 0;
    return Math.round((p.current / p.total) * 100);
  };
  const localPhaseLabel = () => {
    const p = localProgress();
    if (!p) return "";
    switch (p.phase) {
      case "hashing":
        return `hashing ${p.current} of ${p.total}`;
      case "processing":
        return "extracting metadata...";
      case "saving":
        return `saving ${p.current} of ${p.total}`;
      case "done":
        return `done — added ${p.addedCount}${p.skippedCount > 0 ? `, skipped ${p.skippedCount} duplicate${p.skippedCount !== 1 ? "s" : ""}` : ""}`;
      case "error":
        return p.errorMessage ?? "import failed";
      default:
        return "";
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* overlay */}
      <div
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8"
        onClick={() => props.onClose()}
      >
        {/* modal content */}
        <div
          class={`max-w-3xl w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg overflow-hidden flex flex-col max-h-[80dvh] ${props.class || ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* modal header */}
          <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <h2 class="heading-5 text-[var(--color-text-primary)]">
              add music to {props.remoteName || "local library"}
            </h2>
            <IconButton
              icon="close"
              variant="ghost"
              aria-label="close modal"
              onClick={props.onClose}
            />
          </div>

          {/* tabs - scrollable area */}
          <div class="px-4 pt-4 overflow-y-auto flex-1 min-h-0">
            <Tabs activeTab={uploadMode()} onTabChange={setUploadMode}>
              <TabList class="justify-center">
                <Tab id="files" label="upload files" />
                <Tab id="urls" label="download urls" />
              </TabList>

              <div class="py-6">
                <TabPanel id="files">
                  <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center">
                    <div class="mb-4">
                      <Icon name="music" size={48} color="var(--color-text-muted)" />
                    </div>
                    <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">add music files</h3>
                    <p class="body-small text-[var(--color-text-secondary)] mb-2">
                      {props.useTauriDialog
                        ? "select files or an entire folder"
                        : props.remoteName
                          ? `files will be uploaded to ${props.remoteName}`
                          : "drag audio files here or click to select"}
                    </p>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-4">
                      supports mp3, flac, wav, m4a, ogg
                    </p>
                    <div class="flex gap-2">
                      <Button variant="primary" onClick={handleSelectFiles}>
                        select files
                      </Button>
                      <Show when={props.useTauriDialog}>
                        <Button variant="secondary" onClick={handleSelectDirectory}>
                          select folder
                        </Button>
                      </Show>
                    </div>

                    {/* hidden file input - fallback for non-tauri mode */}
                    <Show when={!props.useTauriDialog}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,.mp3,.flac,.wav,.m4a,.ogg"
                        multiple
                        class="hidden"
                        onChange={handleFileChange}
                      />
                    </Show>
                  </div>
                </TabPanel>

                <TabPanel id="urls">
                  <div class="space-y-4">
                    <div class="text-center mb-4">
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                        download from urls
                      </h3>
                      <p class="body-small text-[var(--color-text-secondary)]">
                        paste audio file urls (one per line)
                      </p>
                    </div>

                    <TextArea
                      value={urlText()}
                      onInput={(e) => setUrlText(e.currentTarget.value)}
                      placeholder="https://example.com/song.mp3"
                      rows={6}
                      variant="filled"
                    />

                    <Show when={props.remoteName}>
                      <p class="body-xs text-[var(--color-text-tertiary)] mt-1">
                        urls will be fetched by {props.remoteName}
                      </p>
                    </Show>

                    <div class="flex justify-center">
                      <Button
                        variant="primary"
                        onClick={handleDownloadUrls}
                        disabled={!urlText().trim()}
                      >
                        download
                      </Button>
                    </div>
                  </div>
                </TabPanel>
              </div>
            </Tabs>
          </div>

          {/* local import progress section */}
          <Show when={isLocalImporting()}>
            <div class="border-t border-[var(--color-border-default)] px-4 py-3">
              <div class="flex items-center gap-2 mb-2">
                <Show
                  when={localProgress()?.phase !== "done" && localProgress()?.phase !== "error"}
                  fallback={
                    <Show
                      when={localProgress()?.phase === "done"}
                      fallback={
                        <div class="flex items-center gap-1.5">
                          <Icon name="close" size={14} color="var(--color-error)" />
                          <span class="body-xs text-red-400">{localPhaseLabel()}</span>
                        </div>
                      }
                    >
                      <div class="flex items-center gap-1.5">
                        <Icon name="check" size={14} color="var(--color-success)" />
                        <span class="body-xs text-[var(--color-text-secondary)]">
                          {localPhaseLabel()}
                        </span>
                      </div>
                    </Show>
                  }
                >
                  <div class="flex items-center gap-1.5">
                    <div class="w-2 h-2 rounded-full bg-[var(--color-accent-500)] animate-pulse" />
                    <span class="body-xs text-[var(--color-text-secondary)]">
                      {localPhaseLabel()}
                    </span>
                  </div>
                </Show>
              </div>

              {/* progress bar */}
              <Show
                when={
                  localProgress()?.phase !== "done" &&
                  localProgress()?.phase !== "error" &&
                  localProgress()?.phase !== "processing"
                }
              >
                <div class="h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden mb-2">
                  <div
                    class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
                    style={{ width: `${localProgressPercent()}%` }}
                  />
                </div>
              </Show>

              {/* processing phase gets indeterminate bar */}
              <Show when={localProgress()?.phase === "processing"}>
                <div class="h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden mb-2">
                  <div class="h-full w-1/3 bg-[var(--color-accent-500)] rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                </div>
              </Show>

              {/* current file name */}
              <Show when={localProgress()?.currentFile && localProgress()?.phase !== "done"}>
                <p class="body-xs text-[var(--color-text-tertiary)] truncate">
                  {localProgress()?.currentFile}
                </p>
              </Show>

              <Show when={localProgress()?.phase !== "done" && localProgress()?.phase !== "error"}>
                <p class="body-xs text-[var(--color-text-tertiary)] mt-1">
                  you can close this modal or add more files
                </p>
              </Show>
            </div>
          </Show>

          {/* upload progress section - always visible at bottom regardless of tab */}
          <Show when={hasJobs()}>
            <div class="border-t border-[var(--color-border-default)] px-4 py-3">
              {/* status summary */}
              <div class="flex items-center gap-2 mb-2">
                <Show when={activeJobs().length > 0}>
                  <div class="flex items-center gap-1.5">
                    <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span class="body-xs text-[var(--color-text-secondary)]">
                      processing {activeJobs().length} job{activeJobs().length !== 1 ? "s" : ""}
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

              <Show when={activeJobs().length > 0}>
                <p class="body-xs text-[var(--color-text-tertiary)] mb-2">
                  processing uploads — you can close this modal or add more music
                </p>
              </Show>

              {/* job list */}
              <div class="max-h-32 overflow-y-auto space-y-1">
                <For each={props.uploadJobs ?? []}>
                  {(job) => (
                    <div class="flex items-center gap-2 py-0.5">
                      {/* status indicator */}
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
                      {/* label */}
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
                      {/* status text */}
                      <span class="body-xs flex-shrink-0 text-[var(--color-text-tertiary)]">
                        {job.status === "uploading"
                          ? "uploading..."
                          : job.status === "polling"
                            ? "processing..."
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
    </Show>
  );
}
