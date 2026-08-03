import {
  For,
  Show,
  createSignal,
  createMemo,
  createResource,
  createEffect,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";

import { routes } from "../../music/utils/routing";
import { Button } from "../buttons/Button";
import { IconButton } from "../buttons/IconButton";
import { TextArea } from "../forms/TextArea";
import { Icon } from "../icons/registry";
import { Tab, TabList, TabPanel, Tabs } from "../navigation/Tabs";
import type { UploadJob } from "../../music/import";
import type { LocalImportProgress } from "../../music/import";
import { pushModal, popModal } from "../../music/hooks/modals";
import { pickDirectory, pickFiles } from "../../utils/filePicker";
import { getLocalLibraryName } from "../../app/services/storage/db";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import type { PreCheckFetchResponse, PendingReviewSession } from "@freqhole/api-client";
import { ImportPendingReviewCard } from "../import/ImportPendingReviewCard";
import { debug } from "../../utils/logger";
import { toast } from "../feedback/Toast";

// ---------------------------------------------------------------------------
// module-level precheck state so it survives the modal being closed/reopened
// while a job is still running (user can close and reopen without losing it)
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

export interface AddMusicModalProps {
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
  /** tracked upload/fetch jobs to display */
  uploadJobs?: UploadJob[];
  /** local import progress */
  localImportProgress?: LocalImportProgress;
  /** whether the remote has url precheck (yt-dlp) configured */
  fetchPrecheckEnabled?: boolean;
  /** additional classes */
  class?: string;
  /** called when user wants to review a completed import session */
  onReviewSession?: (sessionId: string) => void;
  /** increment to trigger a refetch of pending review sessions */
  refetchReviewKey?: number;
  /** whether the current user is an admin (shows uploader usernames in review tab) */
  isAdmin?: boolean;
  /** session id that has just been reviewed - auto-dismisses its upload card */
  dismissedReviewSessionId?: string | null;
}

export function AddMusicModal(props: AddMusicModalProps) {
  const [uploadMode, setUploadMode] = createSignal("files");
  const [urlText, setUrlText] = createSignal("");
  const [showFullItemList, setShowFullItemList] = createSignal(false);

  // register with the global modal stack so escape closes this modal
  createEffect(() => {
    if (!props.isOpen) return;
    const id = "add-music-modal";
    pushModal(id, () => props.onClose());
    onCleanup(() => popModal(id));
  });

  // pending review sessions - fetched whenever the modal is open.
  // re-fetches when refetchReviewKey changes (e.g. after a review modal closes).
  const [pendingSessions, { refetch: refetchPendingSessions }] = createResource<
    PendingReviewSession[],
    number | null
  >(
    () => (props.isOpen ? (props.refetchReviewKey ?? 0) : null),
    async (_key: number | null) => {
      const remote = getCurrentRemote();
      if (!remote) return [];
      try {
        const client = await getClientForRemote(remote);
        const resp = await client.music.listPendingImportReview({ session_id: null });
        if (!resp.success) return [];
        return resp.data ?? [];
      } catch {
        return [];
      }
    },
    { initialValue: [] }
  );

  // session_id of a bulk "mark reviewed" currently in flight, if any
  const [markingSessionReviewed, setMarkingSessionReviewed] = createSignal<string | null>(null);

  const handleMarkSessionReviewed = async (session: PendingReviewSession) => {
    const remote = getCurrentRemote();
    if (!remote) return;
    setMarkingSessionReviewed(session.session_id);
    try {
      const client = await getClientForRemote(remote);
      for (const album of session.albums) {
        const resp = await client.music.markAlbumReviewed({
          album_id: album.album_id,
          session_id: session.session_id,
        });
        if (!resp.success) {
          toast.error(
            `mark reviewed failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`
          );
          return;
        }
      }
      void refetchPendingSessions();
    } catch (err) {
      toast.error(`mark reviewed failed: ${(err as Error).message}`);
    } finally {
      setMarkingSessionReviewed(null);
    }
  };

  // aliases to module-level signals so the rest of the component reads normally
  const urlPrecheckState = _urlPrecheckState;
  const precheckResult = _precheckResult;
  const precheckError = _precheckError;
  const precheckUrls = _precheckUrls;
  const precheckLiveCount = _precheckLiveCount;

  const useNativeDialog = () => !!props.useCharnelDialog;

  const handleSelectFiles = async () => {
    // unified picker. desktop tauri returns real paths; android tauri
    // returns content:// uris (unusable as paths) and eagerly reads bytes
    // into `File` objects; web returns `File` objects. we always ask for
    // bytes so that android can still dispatch file-based handlers, then
    // dispatch based on what the picker actually surfaced.
    const picked = await pickFiles({
      kind: "audio",
      multiple: true,
      readBytes: true,
      title: "select music files",
    });
    if (picked.length === 0) return;

    // prefer path mode when the caller supports it AND we actually got
    // real filesystem paths (desktop tauri). on android, picked entries
    // only carry `contentUri` + `file`, so this branch is skipped.
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
    const selected = await pickDirectory("select music folder");
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
      if (u.searchParams.has("list") && u.searchParams.has("start_radio")) {
        return "this url will generate a radio playlist - it may queue hundreds of tracks";
      }
      if (u.searchParams.has("start_radio")) {
        return "this url will generate a radio playlist - it may queue hundreds of tracks";
      }
      if (u.searchParams.has("list")) {
        return "this url includes a playlist param - all playlist tracks will be downloaded";
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
            // parse "found N track(s)..." to show a running count
            const m = message.match(/(\d+)/);
            if (m) _setPrecheckLiveCount(parseInt(m[1], 10));
          }
        },
      });
      _activePoller = null;

      if (pollResult.status !== "completed") {
        // if it timed out while the modal is closed and then reopened,
        // we still want to recover the result - check job status once
        if (pollResult.status === "timeout") {
          const snap = await client.music.getJobStatus({ job_ids: [jobId] });
          const snapData = snap.success
            ? (snap.data as { jobs: Record<string, { status?: string; result?: string | null }> })
            : null;
          const snapJob = snapData?.jobs?.[jobId];
          if (snapJob?.status === "Completed" && snapJob.result) {
            const parsed = JSON.parse(snapJob.result) as PreCheckFetchResponse;
            _setPrecheckResult(parsed);
            _setUrlPrecheckState("confirm");
            return;
          }
        }
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

  // derived job counts
  // jobs still transferring bytes to the remote. during this phase the
  // remote pulls the blob from this app (P2P) or the HTTP POST is in flight,
  // so the app must stay open and reachable until it finishes.
  const transferringJobs = createMemo(() =>
    (props.uploadJobs ?? []).filter((j) => j.status === "uploading")
  );
  // jobs whose bytes have reached the remote and are now being processed
  // server-side. the remote no longer needs this app, so it's safe to close.
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

  // reviewableSessions cross-checks completed sessions against pendingSessions
  // (fetched only on modal open/refetchReviewKey), which would otherwise be
  // stale for a session that finishes while the modal is already open -
  // refetch whenever the completed-job count grows so a freshly-finished
  // session's real album count shows up promptly instead of only on reopen.
  let lastCompletedJobCount = 0;
  createEffect(() => {
    const count = completedJobs().length;
    if (count > lastCompletedJobCount) {
      lastCompletedJobCount = count;
      void refetchPendingSessions();
    }
  });

  // completed sessions that have a sessionId - one review card per unique session.
  // jobCount tracks completed jobs, but a session's files can all turn out to be
  // duplicates of already-imported songs, which never get registered for review -
  // so jobCount alone can't tell us whether there's anything to actually review.
  // cross-check against `pendingSessions` (the real backend-fetched review queue)
  // and only surface a card for sessions that have at least one album pending.
  const reviewableSessions = createMemo(() => {
    const sessionMap = new Map<string, { jobCount: number; label?: string }>();
    for (const j of props.uploadJobs ?? []) {
      if (j.status === "completed" && j.sessionId) {
        const entry = sessionMap.get(j.sessionId);
        if (entry) {
          entry.jobCount++;
        } else {
          sessionMap.set(j.sessionId, { jobCount: 1, label: j.label });
        }
      }
    }
    const realAlbumCounts = new Map(
      (pendingSessions() ?? []).map((s) => [s.session_id, s.albums.length])
    );
    return [...sessionMap.entries()]
      .map(([sessionId, data]) => ({
        sessionId,
        ...data,
        albumCount: realAlbumCounts.get(sessionId) ?? 0,
      }))
      .filter((s) => s.albumCount > 0);
  });
  // track which sessions the user has dismissed from this modal session
  const [dismissedSessions, setDismissedSessions] = createSignal<Set<string>>(new Set());

  // auto-dismiss the upload card when a review completes
  createEffect(() => {
    const sid = props.dismissedReviewSessionId;
    if (sid) setDismissedSessions((prev) => new Set([...prev, sid]));
  });

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
      <Portal>
        {/* overlay - uses inline styles for position/inset to avoid Tailwind
           var(--spacing) calc breaking on older Android WebView */}
        <div
          class="bg-black/50 flex items-center justify-center p-0 wide:p-8"
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 1100 }}
          onClick={() => props.onClose()}
        >
          {/* modal content - full screen on narrow, constrained on wide */}
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
                add music to {props.remoteName || getLocalLibraryName()}
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
              <Tabs
                activeTab={uploadMode()}
                onTabChange={(tab) => {
                  setUploadMode(tab);
                }}
              >
                <TabList class="justify-center">
                  <Tab id="files" label="upload files" />
                  <Tab id="urls" label="download urls" />
                  <Tab
                    id="review"
                    label="review"
                    badge={pendingSessions()?.reduce((n, s) => n + s.albums.length, 0) || undefined}
                  />
                </TabList>

                <div class="py-6">
                  <TabPanel id="files">
                    <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center">
                      <div class="mb-4">
                        <Icon name="music" size={48} color="var(--color-text-muted)" />
                      </div>
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
                        add music files
                      </h3>
                      <p class="body-small text-[var(--color-text-secondary)] mb-2">
                        {props.useCharnelDialog
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
                                  ? (r.items?.[0]?.title ?? "1 track")
                                  : `${r.item_count} tracks`}
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
                            found {precheckLiveCount()} track{precheckLiveCount() !== 1 ? "s" : ""}
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

                  <TabPanel id="review">
                    {/* toolbar: refetch button */}
                    <div class="flex justify-center mb-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void refetchPendingSessions()}
                        disabled={pendingSessions.loading}
                      >
                        <Show when={pendingSessions.loading} fallback={<span>refresh</span>}>
                          <Icon name="loader" size={14} color="currentColor" />
                          <span class="ml-1">loading...</span>
                        </Show>
                      </Button>
                    </div>
                    <Show when={!pendingSessions.loading && (pendingSessions() ?? []).length === 0}>
                      <div class="flex flex-col items-center justify-center py-12 gap-2 text-[var(--color-text-muted)]">
                        <Icon name="check" size={32} color="currentColor" />
                        <p class="body-small">no pending reviews</p>
                      </div>
                    </Show>
                    <Show when={(pendingSessions() ?? []).length > 0}>
                      <div class="flex flex-col gap-3">
                        <For each={pendingSessions() ?? []}>
                          {(session) => (
                            <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
                              <div class="flex items-start justify-between gap-3">
                                <div class="flex flex-col gap-1 min-w-0">
                                  <div class="flex items-center gap-2 flex-wrap">
                                    <p class="body-small font-medium text-[var(--color-text-primary)]">
                                      {session.albums.length} album
                                      {session.albums.length !== 1 ? "s" : ""}
                                      {" · "}
                                      {session.albums.reduce(
                                        (n, a) => n + a.pending_blob_count,
                                        0
                                      )}{" "}
                                      unreviewed
                                    </p>
                                    <Show when={props.isAdmin && session.uploader_username}>
                                      <span class="body-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                                        {session.uploader_username}
                                      </span>
                                    </Show>
                                  </div>
                                  <p class="body-xs text-[var(--color-text-muted)]">
                                    {new Date(session.created_at * 1000).toLocaleString()}
                                  </p>
                                  <div class="flex flex-wrap gap-1 mt-1">
                                    <For each={session.albums.slice(0, 3)}>
                                      {(album) => {
                                        const remoteId = getCurrentRemote()?.remote_id;
                                        const href = remoteId
                                          ? `#/${remoteId}/albums/${encodeURIComponent(album.album_id)}`
                                          : undefined;
                                        return (
                                          <a
                                            href={href}
                                            class="body-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] truncate max-w-[160px] hover:text-[var(--color-accent-500)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                                          >
                                            {album.title}
                                          </a>
                                        );
                                      }}
                                    </For>
                                    <Show when={session.albums.length > 3}>
                                      <span class="body-xs text-[var(--color-text-muted)]">
                                        +{session.albums.length - 3} more
                                      </span>
                                    </Show>
                                  </div>
                                </div>
                                {/* extra gap (vs a plain gap-1.5) puts real distance
                                    between the two buttons so a mis-tap on mobile
                                    doesn't land on the wrong one - not stretched to
                                    the card's full height, which would crowd the
                                    next card's review button instead */}
                                <div class="flex flex-col items-end gap-6 shrink-0">
                                  <Button
                                    variant="primary"
                                    onClick={() => props.onReviewSession?.(session.session_id)}
                                  >
                                    review
                                  </Button>
                                  <button
                                    onClick={() => void handleMarkSessionReviewed(session)}
                                    disabled={markingSessionReviewed() === session.session_id}
                                    class="px-2 py-1 text-xs rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border border-yellow-500/30 transition-colors disabled:opacity-50"
                                  >
                                    {markingSessionReviewed() === session.session_id
                                      ? "marking..."
                                      : "mark reviewed"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </TabPanel>
                </div>
              </Tabs>
            </div>

            {/* progress regions — pinned below tabs, can scroll internally if they
                grow too tall to fit alongside the tabs area */}
            <div class="flex-shrink-0 overflow-y-auto max-h-[50dvh]">
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

                  <Show
                    when={localProgress()?.phase !== "done" && localProgress()?.phase !== "error"}
                  >
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

                  {/* close-safety guidance: while bytes are still transferring the
                      remote is pulling from this app, so it must stay open. once
                      transfer completes the remote finishes on its own. */}
                  <Show when={transferringJobs().length > 0}>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-2">
                      transferring files - keep this app open until the transfer finishes. you can
                      switch tabs or add more music.
                    </p>
                  </Show>
                  <Show when={transferringJobs().length === 0 && processingJobs().length > 0}>
                    <p class="body-xs text-[var(--color-text-tertiary)] mb-2">
                      files transferred - {props.remoteName || getLocalLibraryName()} is finishing
                      up on its own. safe to close.
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
                                  ? (job.resultSummary ??
                                    (job.isDuplicate ? "already in your library" : "done"))
                                  : job.status === "timeout"
                                    ? "queued, check back later"
                                    : (job.error ?? "failed")}
                          </span>
                          {/* album link - shown whenever albumId is known, even for
                              failed/duplicate jobs (the track is already in that album) */}
                          <Show when={job.albumId}>
                            <a
                              class="body-xs flex-shrink-0 text-[var(--color-link)] hover:underline"
                              href={`#${routes.albumOn(job.remoteId, job.albumId!)}`}
                              title="view album"
                              onClick={(e) => {
                                e.preventDefault();
                                // capture before onClose(), which clears completed jobs
                                // from the store - reading job.* after that could race
                                const target = routes.albumOn(job.remoteId, job.albumId!);
                                debug("addMusic", "view album clicked:", {
                                  remoteId: job.remoteId,
                                  albumId: job.albumId,
                                  target,
                                });
                                props.onClose();
                                window.location.hash = target;
                              }}
                            >
                              view album
                            </a>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              {/* review cards - one per completed import session that has pending review items */}
              <For each={reviewableSessions().filter((s) => !dismissedSessions().has(s.sessionId))}>
                {(session) => (
                  <div class="px-4 pb-2">
                    <ImportPendingReviewCard
                      sessionLabel={session.label}
                      pendingCount={session.albumCount}
                      onReview={() => {
                        props.onReviewSession?.(session.sessionId);
                      }}
                      onDismiss={() => {
                        setDismissedSessions((prev) => {
                          const next = new Set(prev);
                          next.add(session.sessionId);
                          return next;
                        });
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
