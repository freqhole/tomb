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
import type { VideoUploadJob } from "../../video/import/remoteImport";
import { pushModal, popModal } from "../../music/hooks/modals";
import { pickDirectory, pickFiles, classifyFile, classifyFileName } from "../../utils/filePicker";
import { getLocalLibraryName } from "../../app/services/storage/db";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import type {
  PreCheckFetchResponse,
  PendingReviewSession,
  PendingVideoReviewSession,
} from "@freqhole/api-client";
import { ImportPendingReviewCard } from "../import/ImportPendingReviewCard";
import { ImportVideoPendingReviewCard } from "../import/ImportVideoPendingReviewCard";
import { debug } from "../../utils/logger";
import { toast } from "../feedback/Toast";

// ---------------------------------------------------------------------------
// module-level precheck state so it survives the modal being closed/reopened
// while a job is still running (mirrors the old AddMusicModal/AddVideoModal's
// identical pattern - merged here since both used the exact same
// client.music.createPrecheckFetchJob/getJobStatus/cancelJob calls anyway).
// ---------------------------------------------------------------------------

type UrlPrecheckState = "idle" | "checking" | "confirm" | "error";
type MediaDomain = "music" | "video" | "both";

const [_urlPrecheckState, _setUrlPrecheckState] = createSignal<UrlPrecheckState>("idle");
const [_precheckResult, _setPrecheckResult] = createSignal<PreCheckFetchResponse | null>(null);
const [_precheckError, _setPrecheckError] = createSignal<string | null>(null);
const [_precheckUrls, _setPrecheckUrls] = createSignal<string[]>([]);
const [_precheckJobId, _setPrecheckJobId] = createSignal<string | null>(null);
// running count emitted by precheck_progress stage events
const [_precheckLiveCount, _setPrecheckLiveCount] = createSignal<number | null>(null);
// 1-based index of the url currently being prechecked, out of
// _precheckUrls().length - each pasted url gets its own precheck job (the
// backend only ever prechecks one url per job), run sequentially and
// merged into one combined result for the confirm screen.
const [_precheckUrlIndex, _setPrecheckUrlIndex] = createSignal(0);
// set by handlePrecheckCancel to stop the sequential precheck loop between
// (or mid-) url iterations - not a signal since it's only read synchronously
// inside the loop, never rendered.
let _precheckAbortRequested = false;
// bulk domain choice for the currently in-flight (or about to be
// submitted) url batch. lives at module level for the same reopen-survival
// reason as the rest of the precheck state.
const [_urlDomain, _setUrlDomain] = createSignal<MediaDomain>("music");

// active poller instance - stopped when cancel is called
let _activePoller: JobPoller | null = null;

export interface AddMediaModalProps {
  /** whether modal is open */
  isOpen: boolean;
  /** callback when close button clicked */
  onClose: () => void;
  /** callback when files classified as music are selected/read */
  onMusicFilesSelected?: (files: FileList) => void;
  /** callback when paths classified as music are selected (desktop tauri) */
  onMusicPathsSelected?: (paths: string[]) => void;
  /** callback when music urls are submitted */
  onMusicUrlsSubmitted?: (urls: string[]) => void;
  /** callback when files classified as video are selected/read */
  onVideoFilesSelected?: (files: FileList) => void;
  /** callback when paths classified as video are selected (desktop tauri) */
  onVideoPathsSelected?: (paths: string[]) => void;
  /** callback when video urls are submitted */
  onVideoUrlsSubmitted?: (urls: string[]) => void;
  /** name of the remote server (shows in header when set) */
  remoteName?: string;
  /** whether to use tauri dialog (for tauri-managed remotes) */
  useCharnelDialog?: boolean;
  /** tracked music upload/fetch jobs to display */
  musicUploadJobs?: UploadJob[];
  /** tracked video upload jobs to display */
  videoUploadJobs?: VideoUploadJob[];
  /** local import progress (music) */
  localImportProgress?: LocalImportProgress;
  /** local import progress (video) */
  videoLocalImportProgress?: LocalImportProgress;
  /** whether the remote has url precheck (yt-dlp) configured */
  fetchPrecheckEnabled?: boolean;
  /** whether the remote has video url fetching (fetch_video) enabled and configured */
  fetchVideoEnabled?: boolean;
  /** additional classes */
  class?: string;
  /** called when user wants to review a completed music import session */
  onReviewSession?: (sessionId: string) => void;
  /** called when user wants to review a completed video import session */
  onReviewVideoSession?: (sessionId: string) => void;
  /** increment to trigger a refetch of pending review sessions */
  refetchReviewKey?: number;
  /** whether the current user is an admin (shows uploader usernames in review tab) */
  isAdmin?: boolean;
  /** session id that has just been reviewed - auto-dismisses its upload card */
  dismissedReviewSessionId?: string | null;
  /** video session id that has just been reviewed - auto-dismisses its upload card */
  dismissedVideoReviewSessionId?: string | null;
}

// a job entry tagged with which domain's store it came from, so the merged
// job list can render domain-specific bits (album link for music, warning
// for video) without needing two near-identical list bodies.
type JobEntry = { domain: "music"; job: UploadJob } | { domain: "video"; job: VideoUploadJob };

export function AddMediaModal(props: AddMediaModalProps) {
  const [uploadMode, setUploadMode] = createSignal("files");
  const [urlText, setUrlText] = createSignal("");
  const [showFullItemList, setShowFullItemList] = createSignal(false);
  // ids of failed jobs whose error text has been clicked-open to show the full message
  const [expandedErrorJobIds, setExpandedErrorJobIds] = createSignal<Set<string>>(new Set());
  const toggleErrorExpanded = (id: string) => {
    setExpandedErrorJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // register with the global modal stack so escape closes this modal
  createEffect(() => {
    if (!props.isOpen) return;
    const id = "add-media-modal";
    pushModal(id, () => props.onClose());
    onCleanup(() => popModal(id));
  });

  // pending review sessions (music only) - fetched whenever the modal is open.
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

  // pending video review sessions - fetched whenever the modal is open.
  const [videoPendingSessions, { refetch: refetchVideoPendingSessions }] = createResource<
    PendingVideoReviewSession[],
    number | null
  >(
    () => (props.isOpen ? (props.refetchReviewKey ?? 0) : null),
    async (_key: number | null) => {
      const remote = getCurrentRemote();
      if (!remote) return [];
      try {
        const client = await getClientForRemote(remote);
        const resp = await client.video.listPendingVideoImportReview({ session_id: null });
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
  const [markingVideoSessionReviewed, setMarkingVideoSessionReviewed] = createSignal<string | null>(
    null
  );

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

  const handleMarkVideoSessionReviewed = async (session: PendingVideoReviewSession) => {
    const remote = getCurrentRemote();
    if (!remote) return;
    setMarkingVideoSessionReviewed(session.session_id);
    try {
      const client = await getClientForRemote(remote);
      for (const group of session.groups) {
        const resp = await client.video.markVideoGroupReviewed({
          group_key: group.group_key,
          session_id: session.session_id,
        });
        if (!resp.success) {
          toast.error(
            `mark reviewed failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`
          );
          return;
        }
      }
      void refetchVideoPendingSessions();
    } catch (err) {
      toast.error(`mark reviewed failed: ${(err as Error).message}`);
    } finally {
      setMarkingVideoSessionReviewed(null);
    }
  };

  // aliases to module-level signals so the rest of the component reads normally
  const urlPrecheckState = _urlPrecheckState;
  const precheckResult = _precheckResult;
  const precheckError = _precheckError;
  const precheckUrls = _precheckUrls;
  const precheckLiveCount = _precheckLiveCount;
  const precheckUrlIndex = _precheckUrlIndex;
  const urlDomain = _urlDomain;
  const setUrlDomain = _setUrlDomain;

  const useNativeDialog = () => !!props.useCharnelDialog;

  const handleSelectFiles = async () => {
    // one unified picker showing both audio + video extensions. desktop
    // tauri returns real paths; android returns eagerly-read `File`
    // objects (content:// uris aren't usable as paths); web returns real
    // `File` objects. each entry is classified by mime/extension and
    // routed to the matching domain's callback - a mixed selection is
    // auto-split into up to two batches, one per domain.
    const picked = await pickFiles({
      kind: "media",
      multiple: true,
      readBytes: true,
      title: "select media files",
    });
    if (picked.length === 0) return;

    const paths = picked.map((p) => p.path).filter((p): p is string => !!p);
    if (paths.length > 0 && paths.length === picked.length) {
      // desktop tauri: classify by extension since these are individual
      // file paths (not directories - "select folder" is a separate flow
      // below that intentionally skips this classification, see its comment).
      const musicPaths: string[] = [];
      const videoPaths: string[] = [];
      let unknownCount = 0;
      for (const path of paths) {
        const domain = classifyFileName(path);
        if (domain === "music") musicPaths.push(path);
        else if (domain === "video") videoPaths.push(path);
        else unknownCount++;
      }
      if (unknownCount > 0) {
        toast.warning(
          `skipped ${unknownCount} file${unknownCount !== 1 ? "s" : ""} with an unrecognized type`,
          { title: "unsupported file" }
        );
      }
      if (musicPaths.length > 0) props.onMusicPathsSelected?.(musicPaths);
      if (videoPaths.length > 0) props.onVideoPathsSelected?.(videoPaths);
      return;
    }

    const files = picked.map((p) => p.file).filter((f): f is File => !!f);
    if (files.length === 0) return;
    const musicFiles: File[] = [];
    const videoFiles: File[] = [];
    let unknownCount = 0;
    for (const file of files) {
      const domain = classifyFile(file);
      if (domain === "music") musicFiles.push(file);
      else if (domain === "video") videoFiles.push(file);
      else unknownCount++;
    }
    if (unknownCount > 0) {
      toast.warning(
        `skipped ${unknownCount} file${unknownCount !== 1 ? "s" : ""} with an unrecognized type`,
        { title: "unsupported file" }
      );
    }
    if (musicFiles.length > 0) {
      const dt = new DataTransfer();
      musicFiles.forEach((f) => dt.items.add(f));
      props.onMusicFilesSelected?.(dt.files);
    }
    if (videoFiles.length > 0) {
      const dt = new DataTransfer();
      videoFiles.forEach((f) => dt.items.add(f));
      props.onVideoFilesSelected?.(dt.files);
    }
  };

  const handleSelectDirectory = async () => {
    if (!useNativeDialog()) return;
    const selected = await pickDirectory("select media folder");
    if (!selected) return;
    // a directory can't be classified up front - fan the same path out to
    // both domain handlers. each one expands the directory and filters to
    // its own extension list (expandPathsToAudioFiles/expandPathsToVideoFiles
    // in App.tsx), so this is safe and picks up both music and video files
    // in one folder without double-importing anything.
    props.onMusicPathsSelected?.([selected]);
    props.onVideoPathsSelected?.([selected]);
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
        return "this url will generate a radio playlist - it may queue hundreds of items";
      }
      if (u.searchParams.has("list")) {
        return "this url includes a playlist param - all playlist items will be downloaded";
      }
    } catch {
      // not a valid url, ignore
    }
    return null;
  };

  const submitUrls = (urls: string[]) => {
    const domain = urlDomain();
    if (domain === "music" || domain === "both") props.onMusicUrlsSubmitted?.(urls);
    if (domain === "video" || domain === "both") props.onVideoUrlsSubmitted?.(urls);
  };

  const handleDownloadUrls = () => {
    const urls = parseUrls();
    if (urls.length > 0) {
      submitUrls(urls);
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
    _setPrecheckUrlIndex(0);
    setShowFullItemList(false);
    _setUrlPrecheckState("checking");
    _precheckAbortRequested = false;

    const client = await getClientForRemote(remote);
    // each pasted url gets its own precheck job (the backend only ever
    // prechecks one url per job) - run them sequentially and merge the
    // results below into one combined response for the confirm screen.
    const results: PreCheckFetchResponse[] = [];
    const failedUrls: string[] = [];
    let itemsSoFar = 0;

    for (let i = 0; i < urls.length; i++) {
      if (_precheckAbortRequested) return;
      _setPrecheckUrlIndex(i + 1);
      const url = urls[i];

      try {
        const result = await client.music.createPrecheckFetchJob({ url });
        if (!result.success) {
          failedUrls.push(url);
          continue;
        }

        const jobId = result.data.id;
        _setPrecheckJobId(jobId);

        const poller = new JobPoller(remote, 3000);
        _activePoller = poller;
        const baseCount = itemsSoFar;
        const pollResult = await poller.waitForJob(jobId, 600_000, {
          onStage: (stage, message) => {
            if (stage === "precheck_progress" && message) {
              // parse "found N item(s)..." to show a running count
              const m = message.match(/(\d+)/);
              if (m) _setPrecheckLiveCount(baseCount + parseInt(m[1], 10));
            }
          },
        });
        _activePoller = null;
        if (_precheckAbortRequested) return;

        let parsed: PreCheckFetchResponse | null = null;
        if (pollResult.status === "completed") {
          const jobResp = await client.music.getJobStatus({ job_ids: [jobId] });
          const jobData = jobResp.success
            ? (jobResp.data as { jobs: Record<string, { result?: string | null }> })
            : null;
          const job = jobData?.jobs?.[jobId];
          if (job?.result) parsed = JSON.parse(job.result) as PreCheckFetchResponse;
        } else if (pollResult.status === "timeout") {
          // if it timed out while the modal is closed and then reopened,
          // we still want to recover the result - check job status once
          const snap = await client.music.getJobStatus({ job_ids: [jobId] });
          const snapData = snap.success
            ? (snap.data as { jobs: Record<string, { status?: string; result?: string | null }> })
            : null;
          const snapJob = snapData?.jobs?.[jobId];
          if (snapJob?.status === "Completed" && snapJob.result) {
            parsed = JSON.parse(snapJob.result) as PreCheckFetchResponse;
          }
        }

        if (parsed) {
          results.push(parsed);
          itemsSoFar += parsed.item_count;
          _setPrecheckLiveCount(itemsSoFar);
        } else {
          failedUrls.push(url);
        }
      } catch {
        failedUrls.push(url);
      }
    }

    _activePoller = null;
    _setPrecheckJobId(null);

    if (results.length === 0) {
      _setPrecheckError(
        urls.length === 1 ? "precheck failed" : `precheck failed for all ${urls.length} urls`
      );
      _setUrlPrecheckState("error");
      return;
    }

    // merge per-url responses into one combined preview - playlist_title/
    // platform only make sense to surface when every url agreed on them
    // (or there's just the one url, the common case).
    const merged: PreCheckFetchResponse = {
      item_count: results.reduce((n, r) => n + r.item_count, 0),
      playlist_title: results.length === 1 ? results[0].playlist_title : null,
      platform: results.every((r) => r.platform === results[0].platform)
        ? results[0].platform
        : null,
      total_duration_seconds: results.some((r) => r.total_duration_seconds != null)
        ? results.reduce((n, r) => n + (r.total_duration_seconds ?? 0), 0)
        : null,
      items: results.flatMap((r) => r.items ?? []),
      duplicate_count: results.reduce((n, r) => n + r.duplicate_count, 0),
    };

    _setPrecheckResult(merged);
    _setUrlPrecheckState("confirm");

    if (failedUrls.length > 0) {
      toast.warning(
        `couldn't preview ${failedUrls.length} of ${urls.length} url${urls.length !== 1 ? "s" : ""} - they'll still be downloaded if you continue`,
        { title: "partial precheck" }
      );
    }
  };

  const handlePrecheckConfirm = () => {
    const urls = precheckUrls();
    if (urls.length > 0) {
      submitUrls(urls);
      setUrlText("");
    }
    _setUrlPrecheckState("idle");
    _setPrecheckResult(null);
    _setPrecheckUrls([]);
    _setPrecheckJobId(null);
    _setPrecheckLiveCount(null);
    _setPrecheckUrlIndex(0);
  };

  const handlePrecheckCancel = async () => {
    // stop the sequential precheck loop between/mid url iterations, and
    // stop the local poller subscription immediately
    _precheckAbortRequested = true;
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
    _setPrecheckUrlIndex(0);
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

  // merge both domains' job stores into one list for display, tagged so
  // domain-specific bits (album link for music, warning for video) render
  // correctly without duplicating the whole list body per domain.
  const allJobs = createMemo<JobEntry[]>(() =>
    [
      ...(props.musicUploadJobs ?? []).map((job): JobEntry => ({ domain: "music", job })),
      ...(props.videoUploadJobs ?? []).map((job): JobEntry => ({ domain: "video", job })),
    ].sort((a, b) => a.job.createdAt - b.job.createdAt)
  );
  const hasJobs = createMemo(() => allJobs().length > 0);
  // jobs still transferring bytes to the remote. during this phase the
  // remote pulls the blob from this app (P2P) or the HTTP POST is in flight,
  // so the app must stay open and reachable until it finishes.
  const transferringJobs = createMemo(() => allJobs().filter((e) => e.job.status === "uploading"));
  // jobs whose bytes have reached the remote and are now being processed
  // server-side. the remote no longer needs this app, so it's safe to close.
  const processingJobs = createMemo(() => allJobs().filter((e) => e.job.status === "polling"));
  const failedJobs = createMemo(() => allJobs().filter((e) => e.job.status === "failed"));
  const completedJobs = createMemo(() => allJobs().filter((e) => e.job.status === "completed"));
  const timedOutJobs = createMemo(() => allJobs().filter((e) => e.job.status === "timeout"));

  // reviewableSessions (music only) cross-checks completed sessions against
  // pendingSessions (fetched only on modal open/refetchReviewKey), which
  // would otherwise be stale for a session that finishes while the modal is
  // already open - refetch whenever the completed-job count grows so a
  // freshly-finished session's real album count shows up promptly instead
  // of only on reopen.
  let lastCompletedJobCount = 0;
  createEffect(() => {
    const count = completedJobs().length;
    if (count > lastCompletedJobCount) {
      lastCompletedJobCount = count;
      void refetchPendingSessions();
      void refetchVideoPendingSessions();
    }
  });

  // completed sessions that have a sessionId - one review card per unique session.
  const reviewableSessions = createMemo(() => {
    const sessionMap = new Map<string, { jobCount: number; label?: string }>();
    for (const j of props.musicUploadJobs ?? []) {
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

  // same as reviewableSessions above, but for video groups instead of albums.
  const reviewableVideoSessions = createMemo(() => {
    const sessionMap = new Map<string, { jobCount: number; label?: string }>();
    for (const j of props.videoUploadJobs ?? []) {
      if (j.status === "completed" && j.sessionId) {
        const entry = sessionMap.get(j.sessionId);
        if (entry) {
          entry.jobCount++;
        } else {
          sessionMap.set(j.sessionId, { jobCount: 1, label: j.label });
        }
      }
    }
    const realCounts = new Map(
      (videoPendingSessions() ?? []).map((s) => [
        s.session_id,
        {
          groupCount: s.groups.length,
          videoCount: s.groups.reduce((n, g) => n + g.videos.length, 0),
        },
      ])
    );
    return [...sessionMap.entries()]
      .map(([sessionId, data]) => ({
        sessionId,
        ...data,
        groupCount: realCounts.get(sessionId)?.groupCount ?? 0,
        videoCount: realCounts.get(sessionId)?.videoCount ?? 0,
      }))
      .filter((s) => s.groupCount > 0);
  });
  // track which video sessions the user has dismissed from this modal session
  const [dismissedVideoSessions, setDismissedVideoSessions] = createSignal<Set<string>>(new Set());

  // auto-dismiss the video upload card when a review completes
  createEffect(() => {
    const sid = props.dismissedVideoReviewSessionId;
    if (sid) setDismissedVideoSessions((prev) => new Set([...prev, sid]));
  });

  // auto-dismiss the upload card when a review completes
  createEffect(() => {
    const sid = props.dismissedReviewSessionId;
    if (sid) setDismissedSessions((prev) => new Set([...prev, sid]));
  });

  // local import progress helpers - shared by both the music and video
  // progress sections below (each domain tracks its own signal upstream).
  const isLocalImporting = (p: LocalImportProgress | undefined) => p != null && p.phase !== "idle";
  const localProgressPercent = (p: LocalImportProgress | undefined) => {
    if (!p || p.total === 0) return 0;
    return Math.round((p.current / p.total) * 100);
  };
  const localPhaseLabel = (p: LocalImportProgress | undefined) => {
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

  // renders one domain's local-import progress (music or video) - both
  // props.localImportProgress and props.videoLocalImportProgress use this.
  const LocalImportSection = (sectionProps: { progress: LocalImportProgress | undefined }) => (
    <Show when={isLocalImporting(sectionProps.progress)}>
      <div class="border-t border-[var(--color-border-default)] px-4 py-3">
        <div class="flex items-center gap-2 mb-2">
          <Show
            when={
              sectionProps.progress?.phase !== "done" && sectionProps.progress?.phase !== "error"
            }
            fallback={
              <Show
                when={sectionProps.progress?.phase === "done"}
                fallback={
                  <div class="flex items-center gap-1.5">
                    <Icon name="close" size={14} color="var(--color-error)" />
                    <span class="body-xs text-red-400">
                      {localPhaseLabel(sectionProps.progress)}
                    </span>
                  </div>
                }
              >
                <div class="flex items-center gap-1.5">
                  <Icon name="check" size={14} color="var(--color-success)" />
                  <span class="body-xs text-[var(--color-text-secondary)]">
                    {localPhaseLabel(sectionProps.progress)}
                  </span>
                </div>
              </Show>
            }
          >
            <div class="flex items-center gap-1.5">
              <div class="w-2 h-2 rounded-full bg-[var(--color-accent-500)] animate-pulse" />
              <span class="body-xs text-[var(--color-text-secondary)]">
                {localPhaseLabel(sectionProps.progress)}
              </span>
            </div>
          </Show>
        </div>

        {/* progress bar */}
        <Show
          when={
            sectionProps.progress?.phase !== "done" &&
            sectionProps.progress?.phase !== "error" &&
            sectionProps.progress?.phase !== "processing"
          }
        >
          <div class="h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden mb-2">
            <div
              class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
              style={{ width: `${localProgressPercent(sectionProps.progress)}%` }}
            />
          </div>
        </Show>

        {/* processing phase gets indeterminate bar */}
        <Show when={sectionProps.progress?.phase === "processing"}>
          <div class="h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden mb-2">
            <div class="h-full w-1/3 bg-[var(--color-accent-500)] rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
          </div>
        </Show>

        {/* current file name */}
        <Show when={sectionProps.progress?.currentFile && sectionProps.progress?.phase !== "done"}>
          <p class="body-xs text-[var(--color-text-tertiary)] truncate">
            {sectionProps.progress?.currentFile}
          </p>
        </Show>

        <Show
          when={sectionProps.progress?.phase !== "done" && sectionProps.progress?.phase !== "error"}
        >
          <p class="body-xs text-[var(--color-text-tertiary)] mt-1">
            you can close this modal or add more files
          </p>
        </Show>
      </div>
    </Show>
  );

  // segmented control used both on the idle (no-precheck fallback) and
  // confirm screens to pick which domain(s) a url batch should fetch into -
  // music-only, video-only, or both (fetches the same url(s) twice, once
  // per domain).
  const DomainToggle = () => (
    <div class="flex justify-center gap-1 mb-2" role="group" aria-label="fetch as">
      <button
        type="button"
        class="px-3 py-1 text-xs rounded-l border border-[var(--color-border-default)] transition-colors"
        classList={{
          "bg-[var(--color-accent-500)] text-white border-[var(--color-accent-500)]":
            urlDomain() === "music",
          "text-[var(--color-text-secondary)]": urlDomain() !== "music",
        }}
        onClick={() => setUrlDomain("music")}
      >
        music
      </button>
      <button
        type="button"
        class="px-3 py-1 text-xs border-t border-b border-l-0 border-[var(--color-border-default)] transition-colors"
        classList={{
          "bg-[var(--color-accent-500)] text-white border-[var(--color-accent-500)]":
            urlDomain() === "video",
          "text-[var(--color-text-secondary)]": urlDomain() !== "video",
        }}
        onClick={() => setUrlDomain("video")}
      >
        video
      </button>
      <button
        type="button"
        class="px-3 py-1 text-xs rounded-r border border-l-0 border-[var(--color-border-default)] transition-colors"
        classList={{
          "bg-[var(--color-accent-500)] text-white border-[var(--color-accent-500)]":
            urlDomain() === "both",
          "text-[var(--color-text-secondary)]": urlDomain() !== "both",
        }}
        onClick={() => setUrlDomain("both")}
      >
        both
      </button>
    </div>
  );

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
                add media to {props.remoteName || getLocalLibraryName()}
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
                    badge={
                      (pendingSessions()?.reduce((n, s) => n + s.albums.length, 0) ?? 0) +
                        (videoPendingSessions()?.reduce((n, s) => n + s.groups.length, 0) ?? 0) ||
                      undefined
                    }
                  />
                </TabList>

                <div class="py-6">
                  <TabPanel id="files">
                    <div class="border-2 border-dashed border-[var(--color-border-default)] rounded-lg p-12 flex flex-col items-center justify-center text-center">
                      <div class="mb-4">
                        <Icon name="upload" size={48} color="var(--color-text-muted)" />
                      </div>
                      <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">add media</h3>
                      <p class="body-small text-[var(--color-text-secondary)] mb-2">
                        {props.useCharnelDialog
                          ? "select files or an entire folder"
                          : props.remoteName
                            ? `files will be uploaded to ${props.remoteName}`
                            : "drag audio or video files here or click to select"}
                      </p>
                      <p class="body-xs text-[var(--color-text-tertiary)] mb-4">
                        supports mp3, flac, wav, m4a, ogg, mp4, mkv, webm, mov, avi
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
                                  ? (r.items?.[0]?.title ?? "1 item")
                                  : `${r.item_count} items`}
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

                            {/* domain toggle - only shown when the remote supports
                                video url fetching. applies to the whole batch: a
                                fetch job's `domain` is one value for the entire
                                job (confirmed via FetchMediaParamsSchema), so
                                there's no way to honor a genuinely different
                                domain per previewed item without a backend
                                change - "both" works around this by submitting
                                the same url list twice, once per domain, rather
                                than trying to split by item. */}
                            <Show when={props.fetchVideoEnabled}>
                              <div>
                                <p class="body-xs text-[var(--color-text-tertiary)] text-center mb-1">
                                  download as
                                </p>
                                <DomainToggle />
                              </div>
                            </Show>

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
                              {precheckUrls().length > 1
                                ? `checking url ${precheckUrlIndex()} of ${precheckUrls().length}...`
                                : "checking url..."}
                            </p>
                          }
                        >
                          <p class="body-small text-[var(--color-text-secondary)]">
                            found {precheckLiveCount()} item{precheckLiveCount() !== 1 ? "s" : ""}
                            {precheckUrls().length > 1
                              ? ` (url ${precheckUrlIndex()} of ${precheckUrls().length})`
                              : ""}
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
                            paste media urls (one per line)
                          </p>
                        </div>

                        {/* when precheck is unavailable but video fetching is,
                            there's no confirm screen to host the domain toggle -
                            show it here instead so video urls are still reachable */}
                        <Show when={props.fetchVideoEnabled && !props.fetchPrecheckEnabled}>
                          <DomainToggle />
                        </Show>

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

                    {/* video review sessions - same layout as music above, but
                        grouped by detected series (group_key) instead of album_id. */}
                    <Show when={(videoPendingSessions() ?? []).length > 0}>
                      <div class="flex flex-col gap-3 mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                        <p class="body-xs text-[var(--color-text-muted)]">video</p>
                        <For each={videoPendingSessions() ?? []}>
                          {(session) => (
                            <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4">
                              <div class="flex items-start justify-between gap-3">
                                <div class="flex flex-col gap-1 min-w-0">
                                  <div class="flex items-center gap-2 flex-wrap">
                                    <p class="body-small font-medium text-[var(--color-text-primary)]">
                                      {session.groups.length} group
                                      {session.groups.length !== 1 ? "s" : ""}
                                      {" · "}
                                      {session.groups.reduce(
                                        (n, g) => n + g.pending_blob_count,
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
                                    <For each={session.groups.slice(0, 3)}>
                                      {(group) => (
                                        <span class="body-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] truncate max-w-[160px]">
                                          {group.series_title ??
                                            group.videos[0]?.title ??
                                            "untitled"}
                                        </span>
                                      )}
                                    </For>
                                    <Show when={session.groups.length > 3}>
                                      <span class="body-xs text-[var(--color-text-muted)]">
                                        +{session.groups.length - 3} more
                                      </span>
                                    </Show>
                                  </div>
                                </div>
                                <div class="flex flex-col items-end gap-6 shrink-0">
                                  <Button
                                    variant="primary"
                                    onClick={() => props.onReviewVideoSession?.(session.session_id)}
                                  >
                                    review
                                  </Button>
                                  <button
                                    onClick={() => void handleMarkVideoSessionReviewed(session)}
                                    disabled={markingVideoSessionReviewed() === session.session_id}
                                    class="px-2 py-1 text-xs rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border border-yellow-500/30 transition-colors disabled:opacity-50"
                                  >
                                    {markingVideoSessionReviewed() === session.session_id
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
              {/* local import progress sections - one per domain, each only
                  shows when that domain has an active/recent local import */}
              <LocalImportSection progress={props.localImportProgress} />
              <LocalImportSection progress={props.videoLocalImportProgress} />

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
                      switch tabs or add more media.
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
                    <For each={allJobs()}>
                      {(entry) => {
                        const job = entry.job;
                        const warning = entry.domain === "video" ? entry.job.warning : undefined;
                        return (
                          <div class="py-0.5">
                            <div class="flex items-center gap-2">
                              {/* domain indicator */}
                              <Icon
                                name={entry.domain === "video" ? "video" : "music"}
                                size={12}
                                color="var(--color-text-muted)"
                              />
                              {/* status indicator */}
                              <div class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                                {job.status === "uploading" || job.status === "polling" ? (
                                  <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                ) : job.status === "completed" && warning ? (
                                  <Icon
                                    name="recent"
                                    size={14}
                                    color="var(--color-warning, #f59e0b)"
                                  />
                                ) : job.status === "completed" ? (
                                  <Icon name="check" size={14} color="var(--color-success)" />
                                ) : job.status === "timeout" ? (
                                  <Icon
                                    name="recent"
                                    size={14}
                                    color="var(--color-warning, #f59e0b)"
                                  />
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
                                  "text-[var(--color-text-tertiary)]":
                                    job.status === "completed" && !warning,
                                  "text-amber-400":
                                    job.status === "timeout" ||
                                    (job.status === "completed" && !!warning),
                                  "text-red-400": job.status === "failed",
                                }}
                              >
                                {job.label}
                              </span>
                              {/* status text */}
                              <span
                                class="body-xs flex-shrink-0 text-[var(--color-text-tertiary)] max-w-[60%] truncate"
                                classList={{
                                  "cursor-pointer hover:underline": job.status === "failed",
                                }}
                                title={
                                  job.status === "failed"
                                    ? (job.errorFull ?? job.error ?? "failed") +
                                      (job.errorFull && job.errorFull !== job.error
                                        ? " (click for full text)"
                                        : "")
                                    : job.status === "completed" && warning
                                      ? warning
                                      : job.status === "polling" && job.stage
                                        ? job.stage
                                        : undefined
                                }
                                onClick={() => {
                                  if (job.status === "failed") toggleErrorExpanded(job.id);
                                }}
                              >
                                {job.status === "uploading"
                                  ? typeof job.progress === "number"
                                    ? `transferring... ${Math.round(job.progress * 100)}%`
                                    : "transferring..."
                                  : job.status === "polling"
                                    ? (job.stage ?? "processing...")
                                    : job.status === "completed"
                                      ? entry.domain === "music"
                                        ? ((job as UploadJob).resultSummary ??
                                          ((job as UploadJob).isDuplicate
                                            ? "already in your library"
                                            : "done"))
                                        : warning
                                          ? `done - ${warning}`
                                          : "done"
                                      : job.status === "timeout"
                                        ? "queued, check back later"
                                        : (job.error ?? "failed")}
                              </span>
                              {/* album link - music jobs only, shown whenever albumId is
                                  known, even for failed/duplicate jobs (the track is
                                  already in that album) */}
                              <Show when={entry.domain === "music" && entry.job.albumId}>
                                <a
                                  class="body-xs flex-shrink-0 text-[var(--color-link)] hover:underline"
                                  href={`#${routes.albumOn((entry.job as UploadJob).remoteId, (entry.job as UploadJob).albumId!)}`}
                                  title="view album"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const musicJob = entry.job as UploadJob;
                                    const target = routes.albumOn(
                                      musicJob.remoteId,
                                      musicJob.albumId!
                                    );
                                    debug("addMedia", "view album clicked:", {
                                      remoteId: musicJob.remoteId,
                                      albumId: musicJob.albumId,
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
                            {/* progress bar - shown while uploading with a known ratio */}
                            <Show
                              when={job.status === "uploading" && typeof job.progress === "number"}
                            >
                              <div class="h-1 bg-blue-400/20 rounded-full overflow-hidden mt-1 ml-6">
                                <div
                                  class="h-full bg-blue-400 rounded-full transition-all duration-200"
                                  style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }}
                                />
                              </div>
                            </Show>
                            <Show
                              when={job.status === "failed" && expandedErrorJobIds().has(job.id)}
                            >
                              <p class="body-xs text-red-400/80 pl-6 pr-1 whitespace-pre-wrap break-words">
                                {job.errorFull ?? job.error ?? "failed"}
                              </p>
                            </Show>
                          </div>
                        );
                      }}
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
              <For
                each={reviewableVideoSessions().filter(
                  (s) => !dismissedVideoSessions().has(s.sessionId)
                )}
              >
                {(session) => (
                  <div class="px-4 pb-2">
                    <ImportVideoPendingReviewCard
                      sessionLabel={session.label}
                      pendingCount={session.groupCount}
                      videoCount={session.videoCount}
                      onReview={() => {
                        props.onReviewVideoSession?.(session.sessionId);
                      }}
                      onDismiss={() => {
                        setDismissedVideoSessions((prev) => {
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
