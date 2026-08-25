import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { TextArea } from "../forms/TextArea";
import { Icon } from "../icons/registry";
import { Tab, TabList, TabPanel, Tabs } from "../navigation/Tabs";
import { pushModal, popModal } from "../../music/hooks/modals";
import { pickDirectory, pickFiles } from "../../utils/filePicker";
import { getLocalLibraryName } from "../../app/services/storage/db";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import type { PreCheckFetchResponse } from "@freqhole/api-client";
import type { VideoUploadJob } from "../../video/import/remoteImport";

// ---------------------------------------------------------------------------
// module-level precheck state so it survives the modal being closed/reopened
// while a job is still running (mirrors AddMusicModal's identical pattern)
// ---------------------------------------------------------------------------

type UrlPrecheckState = "idle" | "checking" | "confirm" | "error";

const [_urlPrecheckState, _setUrlPrecheckState] = createSignal<UrlPrecheckState>("idle");
const [_precheckResult, _setPrecheckResult] = createSignal<PreCheckFetchResponse | null>(null);
const [_precheckError, _setPrecheckError] = createSignal<string | null>(null);
const [_precheckUrls, _setPrecheckUrls] = createSignal<string[]>([]);
const [_precheckJobId, _setPrecheckJobId] = createSignal<string | null>(null);
// running count emitted by precheck_progress stage events
const [_precheckLiveCount, _setPrecheckLiveCount] = createSignal<number | null>(null);

// active poller instance - stopped when cancel is called
let _activePoller: JobPoller | null = null;

export interface AddVideoModalProps {
  /** whether modal is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when files are selected (always provided on web / android) */
  onFilesSelected?: (files: FileList) => void;
  /** callback when paths are selected (desktop tauri - files or directories) */
  onPathsSelected?: (paths: string[]) => void;
  /** callback when urls are submitted */
  onUrlsSubmitted?: (urls: string[]) => void;
  /** name of the remote server (shows in header when set) */
  remoteName?: string;
  /** whether to use tauri dialog (for tauri-managed remotes) */
  useCharnelDialog?: boolean;
  /** tracked upload jobs to display */
  uploadJobs?: VideoUploadJob[];
  /** whether the remote has url precheck (yt-dlp) configured */
  fetchPrecheckEnabled?: boolean;
  /** additional classes */
  class?: string;
}

export function AddVideoModal(props: AddVideoModalProps) {
  const [uploadMode, setUploadMode] = createSignal("files");
  const [urlText, setUrlText] = createSignal("");
  const [showFullItemList, setShowFullItemList] = createSignal(false);

  // register with the global modal stack so escape closes this modal
  createEffect(() => {
    if (!props.isOpen) return;
    const id = "add-video-modal";
    pushModal(id, () => props.onClose());
    onCleanup(() => popModal(id));
  });

  // aliases to module-level signals so the rest of the component reads normally
  const urlPrecheckState = _urlPrecheckState;
  const precheckResult = _precheckResult;
  const precheckError = _precheckError;
  const precheckUrls = _precheckUrls;
  const precheckLiveCount = _precheckLiveCount;

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

  const parseUrls = () =>
    urlText()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  // detect youtube urls that contain a list= or start_radio= param (any yt domain)
  const youtubeListWarning = (): string | null => {
    const text = urlText().trim();
    if (!text) return null;
    const firstUrl = text.split("\n")[0].trim();
    try {
      const u = new URL(firstUrl);
      const isYoutube =
        u.hostname === "youtube.com" ||
        u.hostname === "www.youtube.com" ||
        u.hostname === "youtu.be" ||
        u.hostname === "music.youtube.com" ||
        u.hostname.endsWith(".youtube.com");
      if (!isYoutube) return null;
      if (u.searchParams.has("start_radio")) {
        return "this url will generate a radio playlist - it may queue hundreds of videos";
      }
      if (u.searchParams.has("list")) {
        return "this url includes a playlist param - all playlist videos will be downloaded";
      }
    } catch {
      // not a valid url, ignore
    }
    return null;
  };

  const handleDownloadUrls = () => {
    const urls = parseUrls();
    if (urls.length > 0) {
      props.onUrlsSubmitted?.(urls);
      setUrlText("");
    }
  };

  const handlePrecheckUrls = async () => {
    const urls = parseUrls();
    if (urls.length === 0) return;

    const remote = getCurrentRemote();
    if (!remote) return;

    _setPrecheckUrls(urls);
    _setPrecheckError(null);
    _setPrecheckResult(null);
    _setPrecheckLiveCount(null);
    _setPrecheckJobId(null);
    setShowFullItemList(false);
    _setUrlPrecheckState("checking");

    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.createPrecheckFetchJob({ url: urls[0] });
      if (!result.success) {
        const msg = result.error?.issues?.[0]?.message ?? "precheck failed";
        _setPrecheckError(msg);
        _setUrlPrecheckState("error");
        return;
      }

      const jobId = result.data.id;
      _setPrecheckJobId(jobId);

      const poller = new JobPoller(remote, 3000);
      _activePoller = poller;
      const pollResult = await poller.waitForJob(jobId, 600_000, {
        onStage: (stage, message) => {
          if (stage === "precheck_progress" && message) {
            // parse "found N item(s)..." to show a running count
            const m = message.match(/(\d+)/);
            if (m) _setPrecheckLiveCount(parseInt(m[1], 10));
          }
        },
      });
      _activePoller = null;

      if (pollResult.status !== "completed") {
        const msg = pollResult.errorMessage ?? "precheck did not complete";
        _setPrecheckError(msg);
        _setUrlPrecheckState("error");
        return;
      }

      // fetch full job to get result payload
      const jobResp = await client.music.getJobStatus({ job_ids: [jobId] });
      const jobData = jobResp.success
        ? (jobResp.data as { jobs: Record<string, { result?: string | null }> })
        : null;
      const job = jobData?.jobs?.[jobId];
      if (!job?.result) {
        _setPrecheckError("no result returned from precheck");
        _setUrlPrecheckState("error");
        return;
      }

      const parsed = JSON.parse(job.result) as PreCheckFetchResponse;
      _setPrecheckResult(parsed);
      _setUrlPrecheckState("confirm");
    } catch (err) {
      _activePoller = null;
      _setPrecheckError(String(err));
      _setUrlPrecheckState("error");
    }
  };

  const handlePrecheckConfirm = () => {
    const urls = precheckUrls();
    if (urls.length > 0) {
      props.onUrlsSubmitted?.(urls);
      setUrlText("");
    }
    _setUrlPrecheckState("idle");
    _setPrecheckResult(null);
    _setPrecheckUrls([]);
    _setPrecheckJobId(null);
    _setPrecheckLiveCount(null);
  };

  const handlePrecheckCancel = async () => {
    // stop the local poller subscription immediately
    _activePoller?.stop();
    _activePoller = null;

    // tell the server to cancel so it kills the yt-dlp process
    const jobId = _precheckJobId();
    if (jobId) {
      const remote = getCurrentRemote();
      if (remote) {
        try {
          const client = await getClientForRemote(remote);
          await client.music.cancelJob({ job_id: jobId });
        } catch {
          // best-effort, don't block the UI
        }
      }
    }

    _setUrlPrecheckState("idle");
    _setPrecheckResult(null);
    _setPrecheckError(null);
    _setPrecheckUrls([]);
    _setPrecheckJobId(null);
    _setPrecheckLiveCount(null);
    setShowFullItemList(false);
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
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
                        <Icon name="upload" size={48} color="var(--color-text-muted)" />
                      </div>
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                        add video files
                      </h3>
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
                  </TabPanel>

                  <TabPanel id="urls">
                    {/* precheck confirm screen */}
                    <Show when={urlPrecheckState() === "confirm" && precheckResult() !== null}>
                      {(_) => {
                        const r = precheckResult()!;
                        const PREVIEW_COUNT = 5;
                        const previewItems = r.items?.slice(0, PREVIEW_COUNT) ?? [];
                        const remainingCount = (r.items?.length ?? 0) - PREVIEW_COUNT;
                        const duplicateCount = r.duplicate_count ?? 0;
                        return (
                          <div class="space-y-4">
                            <div>
                              <h3 class="heading-6 text-[var(--color-text-primary)] mb-1">
                                {r.item_count === 1
                                  ? (r.items?.[0]?.title ?? "1 video")
                                  : `${r.item_count} videos`}
                                {r.playlist_title ? ` from "${r.playlist_title}"` : ""}
                              </h3>
                              <div class="flex flex-wrap gap-x-3 gap-y-1 body-small text-[var(--color-text-secondary)]">
                                <Show when={r.platform}>
                                  <span class="capitalize">{r.platform}</span>
                                </Show>
                                <Show when={r.total_duration_seconds}>
                                  <span>{formatDuration(r.total_duration_seconds)}</span>
                                </Show>
                                <Show when={duplicateCount > 0}>
                                  <span class="text-amber-400">
                                    {duplicateCount} already in library
                                  </span>
                                </Show>
                              </div>
                            </div>

                            {/* item preview list */}
                            <Show when={previewItems.length > 0}>
                              <div class="space-y-1">
                                <For each={previewItems}>
                                  {(item) => (
                                    <div class="flex items-center gap-2 py-0.5">
                                      <Show when={item.is_duplicate}>
                                        <span class="body-xs text-amber-400 flex-shrink-0">
                                          dup
                                        </span>
                                      </Show>
                                      <span class="body-xs text-[var(--color-text-primary)] truncate flex-1">
                                        {item.title ?? item.content_id}
                                      </span>
                                      <Show when={item.duration_seconds}>
                                        <span class="body-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                                          {formatDuration(item.duration_seconds)}
                                        </span>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                                <Show when={remainingCount > 0 && !showFullItemList()}>
                                  <button
                                    class="body-xs text-[var(--color-link)] hover:underline mt-1"
                                    onClick={() => setShowFullItemList(true)}
                                  >
                                    and {remainingCount} more
                                  </button>
                                </Show>
                                <Show when={showFullItemList()}>
                                  <div class="max-h-40 overflow-y-auto space-y-1 mt-1 border border-[var(--color-border-default)] rounded p-2">
                                    <For each={r.items?.slice(PREVIEW_COUNT) ?? []}>
                                      {(item) => (
                                        <div class="flex items-center gap-2 py-0.5">
                                          <Show when={item.is_duplicate}>
                                            <span class="body-xs text-amber-400 flex-shrink-0">
                                              dup
                                            </span>
                                          </Show>
                                          <span class="body-xs text-[var(--color-text-primary)] truncate flex-1">
                                            {item.title ?? item.content_id}
                                          </span>
                                          <Show when={item.duration_seconds}>
                                            <span class="body-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                                              {formatDuration(item.duration_seconds)}
                                            </span>
                                          </Show>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </Show>

                            <div class="flex gap-2 justify-end">
                              <Button
                                variant="secondary"
                                onClick={() => void handlePrecheckCancel()}
                              >
                                cancel
                              </Button>
                              <Button variant="primary" onClick={handlePrecheckConfirm}>
                                download all
                              </Button>
                            </div>
                          </div>
                        );
                      }}
                    </Show>

                    {/* precheck running */}
                    <Show when={urlPrecheckState() === "checking"}>
                      <div class="flex flex-col items-center justify-center py-12 gap-3">
                        <div class="w-2 h-2 rounded-full bg-[var(--color-accent-500)] animate-pulse" />
                        <Show
                          when={precheckLiveCount() !== null}
                          fallback={
                            <p class="body-small text-[var(--color-text-secondary)]">
                              checking url...
                            </p>
                          }
                        >
                          <p class="body-small text-[var(--color-text-secondary)]">
                            found {precheckLiveCount()} video{precheckLiveCount() !== 1 ? "s" : ""}
                            ...
                          </p>
                        </Show>
                        <Button variant="ghost" onClick={() => void handlePrecheckCancel()}>
                          cancel
                        </Button>
                      </div>
                    </Show>

                    {/* precheck error */}
                    <Show when={urlPrecheckState() === "error"}>
                      <div class="space-y-4">
                        <div class="text-center">
                          <p class="body-small text-red-400 mb-1">precheck failed</p>
                          <p class="body-xs text-[var(--color-text-tertiary)]">{precheckError()}</p>
                        </div>
                        <div class="flex gap-2 justify-center">
                          <Button variant="secondary" onClick={() => void handlePrecheckCancel()}>
                            back
                          </Button>
                          <Button variant="primary" onClick={handlePrecheckConfirm}>
                            download anyway
                          </Button>
                        </div>
                      </div>
                    </Show>

                    {/* url input (idle state) */}
                    <Show when={urlPrecheckState() === "idle"}>
                      <div class="space-y-4">
                        <div class="text-center mb-4">
                          <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                            download from urls
                          </h3>
                          <p class="body-small text-[var(--color-text-secondary)]">
                            paste video urls (one per line)
                          </p>
                        </div>

                        <TextArea
                          value={urlText()}
                          onInput={(e) => setUrlText(e.currentTarget.value)}
                          placeholder="https://example.com/video"
                          rows={6}
                          variant="filled"
                        />

                        {/* youtube playlist / radio warning */}
                        <Show when={youtubeListWarning()}>
                          <p class="body-xs text-amber-400 mt-1">{youtubeListWarning()}</p>
                        </Show>

                        <Show when={props.remoteName}>
                          <p class="body-xs text-[var(--color-text-tertiary)] mt-1">
                            urls will be fetched by {props.remoteName}
                          </p>
                        </Show>

                        <div class="flex justify-center">
                          <Show
                            when={props.fetchPrecheckEnabled}
                            fallback={
                              <Button
                                variant="primary"
                                onClick={handleDownloadUrls}
                                disabled={!urlText().trim()}
                              >
                                download
                              </Button>
                            }
                          >
                            <Button
                              variant="primary"
                              onClick={() => void handlePrecheckUrls()}
                              disabled={!urlText().trim()}
                            >
                              check url
                            </Button>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </TabPanel>
                </div>
              </Tabs>
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
                            ) : job.status === "completed" && job.warning ? (
                              <Icon name="recent" size={14} color="var(--color-warning, #f59e0b)" />
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
                              "text-[var(--color-text-tertiary)]":
                                job.status === "completed" && !job.warning,
                              "text-amber-400":
                                job.status === "timeout" ||
                                (job.status === "completed" && !!job.warning),
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
                                : job.status === "completed" && job.warning
                                  ? job.warning
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
                                  ? job.warning
                                    ? `done - ${job.warning}`
                                    : "done"
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
