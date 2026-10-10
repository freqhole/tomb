import { createSignal, createEffect, on, onMount, onCleanup, For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, Channel } from "@tauri-apps/api/core";
import { resolvePath, directoryDisplayName, isDocumentPortalPath } from "../util/resolvePath";
import { useAdminTransport } from "../admin/context";

interface ScannedDir {
  id: string;
  path: string;
  file_count: number;
  last_scanned_at: number;
  tags: string[];
}

interface ScanResult {
  success: boolean;
  jobs_created: number;
  message: string;
}

interface ValidatePathResult {
  path: string;
  exists: boolean;
  is_dir: boolean;
  is_readable: boolean;
}

interface MoveScanDirectoryResult {
  old_path: string;
  new_path: string;
  blobs_under_old: number;
  relocated_exact_path: number;
  relocated_parent: number;
  relocated_filename: number;
  ambiguous_skipped: number;
  new_files_unmatched: number;
  unmatched_old_blobs: number;
  unmatched_old_blobs_soft_deleted: number;
  fs_store_refresh_failures: number;
  dry_run: boolean;
}

// response payload from `maintenance_repair_library` (admin_dispatch) -
// backfills missing song waveforms / album thumbnails and cleans up
// directory-sourced images over-applied across unrelated albums.
interface RepairLibraryImagesResult {
  dry_run: boolean;
  scan_directory: string | null;
  songs_waveforms_backfilled: number;
  albums_thumbnails_backfilled: number;
  albums_thumbnails_removed_overapplied: number;
  albums_left_ambiguous: number;
  videos_waveforms_backfilled: number;
  videos_thumbnails_backfilled: number;
  errors: unknown[];
}

// mirrors grimoire's `RepairLibraryImagesPhase` (snake_case).
type RepairPhase = "waveforms" | "video_waveforms" | "video_thumbnails" | "directories";

// response payload from `maintenance_repair_library_step` - one resumable
// batch of the repair pass, so the wizard can show live progress between
// calls instead of blocking on a single round-trip for the whole library.
interface RepairLibraryStepResult {
  phase: RepairPhase;
  next_phase: RepairPhase;
  next_directory_offset: number;
  done: boolean;
  scan_directory: string | null;
  batch: RepairLibraryImagesResult;
}

const REPAIR_PHASE_LABELS: Record<RepairPhase, string> = {
  waveforms: "song waveforms",
  video_waveforms: "video waveforms",
  video_thumbnails: "video thumbnails",
  directories: "album art",
};

function emptyRepairTotals(): RepairLibraryImagesResult {
  return {
    dry_run: false,
    scan_directory: null,
    songs_waveforms_backfilled: 0,
    albums_thumbnails_backfilled: 0,
    albums_thumbnails_removed_overapplied: 0,
    albums_left_ambiguous: 0,
    videos_waveforms_backfilled: 0,
    videos_thumbnails_backfilled: 0,
    errors: [],
  };
}

// mirrors grimoire's `maintenance::ReorganizeLibraryResult` - final
// per-run totals. a run's batch jobs don't carry these counts over the
// wire themselves (`JobEvent::Completed` just means "no pending/running
// jobs left in this session"); `finalizeReorganizeRun` re-fetches every
// job in the session via `jobs_list` and sums each one's `result` blob.
interface ReorganizeLibraryTotals {
  songs_moved: number;
  songs_already_done: number;
  videos_moved: number;
  videos_already_done: number;
  tags_embedded: number;
  tags_skipped_unsupported_format: number;
  errors: unknown[];
}

function emptyReorganizeTotals(): ReorganizeLibraryTotals {
  return {
    songs_moved: 0,
    songs_already_done: 0,
    videos_moved: 0,
    videos_already_done: 0,
    tags_embedded: 0,
    tags_skipped_unsupported_format: 0,
    errors: [],
  };
}

// response payload from `maintenance_reorganize_library_plan` - dry
// preview (counts only, no writes/jobs).
interface ReorganizeLibraryPlanResult {
  target_directory: string;
  source_music_directory: string;
  source_video_directory: string;
  songs_candidate: number;
  videos_candidate: number;
}

// response payload from `maintenance_reorganize_library_enqueue`.
interface ReorganizeLibraryEnqueueResult {
  job_ids: string[];
  session_id: string;
  songs_queued: number;
  videos_queued: number;
  errors: unknown[];
}

// minimal shape of a `jobz` row as returned by `jobs_list` - only the
// fields `finalizeReorganizeRun` actually reads.
interface JobRow {
  id: string;
  status: string;
  result: string | null;
}

// progress payload mirrors JobEvent.Progress's top-level complete/total
// fields (see the job-events listener in onMount for why NOT details -
// details is only populated for a specific allowlist of job types that
// doesn't include repair-library's).
interface JobProgressPayload {
  session_id: string;
  directory?: string;
  jobs_pending: number;
  jobs_total: number;
  domain?: "music" | "video";
}

interface JobSessionCompletePayload {
  session_id: string;
  songs_added: number;
  albums_added: number;
  artists_added: number;
  domain?: "music" | "video";
}

export default function LibraryView() {
  const admin = useAdminTransport();
  const [directories, setDirectories] = createSignal<ScannedDir[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [pendingPath, setPendingPath] = createSignal("");
  const [pendingTags, setPendingTags] = createSignal("");
  const [pendingDomain, setPendingDomain] = createSignal<"music" | "video" | "both">("both");
  const [pathValidating, setPathValidating] = createSignal(false);
  const [pathValidation, setPathValidation] = createSignal<ValidatePathResult | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal<string | null>(null);
  const [lastResult, setLastResult] = createSignal("");
  const [lastError, setLastError] = createSignal("");
  // live progress fed by grimoire JobProgress events forwarded through
  // charnel's grimoire event subscription (no polling required).
  const [scanProgress, setScanProgress] = createSignal<JobProgressPayload | null>(null);
  const [scanSummary, setScanSummary] = createSignal<JobSessionCompletePayload | null>(null);
  // most recent `JobEvent::Stage` message for the active repair-library
  // session - real, live detail (which directory is being scanned, which
  // phase/batch is running, running totals so far) straight from the
  // job processors themselves, not a canned description (see
  // rescan_processor.rs / repair_library_images_processor.rs's own
  // `job_events::emit(JobEvent::Stage {...})` call sites).
  const [scanStageMessage, setScanStageMessage] = createSignal<string | null>(null);
  // the job session id for the CURRENTLY running "run repair library"
  // flow (see rescanAll) - without this, the job-events listener below
  // has no way to tell this run's own progress apart from any other
  // job session's events sharing the same event shape (confirmed real
  // 2026-10-09: an unrelated session's progress/completed event could
  // silently reset or "freeze" this view's progress card).
  const [activeLibrarySession, setActiveLibrarySession] = createSignal<string | null>(null);
  // true until onMount's `repair_library_active_session` check resolves
  // - the "run repair library" button stays disabled for this one brief
  // window so a user can't start a second, overlapping run before we've
  // actually confirmed whether one is already in flight (confirmed real
  // 2026-10-09: checking late in onMount left a window where this was
  // clickable before an already-running session had been found).
  const [checkingActiveSession, setCheckingActiveSession] = createSignal(!admin.isRemote());
  // move directory modal state
  const [showMoveModal, setShowMoveModal] = createSignal(false);
  const [moveOldPath, setMoveOldPath] = createSignal("");
  const [moveNewPath, setMoveNewPath] = createSignal("");
  const [moveNewPathValidation, setMoveNewPathValidation] = createSignal<ValidatePathResult | null>(
    null,
  );
  const [moveNewPathValidating, setMoveNewPathValidating] = createSignal(false);
  const [movePreviewResult, setMovePreviewResult] = createSignal<MoveScanDirectoryResult | null>(
    null,
  );
  const [moveInProgress, setMoveInProgress] = createSignal(false);
  const [moveError, setMoveError] = createSignal("");

  // repair-library sub-job checklist - waveforms/embedded-art/video-
  // thumbnails are purely additive and default on; directory-sourced art
  // defaults OFF since a folder image can get applied to the wrong
  // album when a directory holds multiple albums (see
  // `repairRemoveOverapplied`'s own cleanup for that case) - removing
  // over-applied images is also destructive (deletes existing
  // album-image associations) so it defaults off too. the checklist
  // itself is hidden behind an accordion toggle until the user actually
  // wants to run a repair.
  const [showRepairOptions, setShowRepairOptions] = createSignal(false);
  const [repairWaveforms, setRepairWaveforms] = createSignal(true);
  const [repairDirectoryArt, setRepairDirectoryArt] = createSignal(false);
  const [repairEmbeddedArt, setRepairEmbeddedArt] = createSignal(true);
  const [repairRemoveOverapplied, setRepairRemoveOverapplied] = createSignal(false);
  const [repairVideoThumbnails, setRepairVideoThumbnails] = createSignal(true);
  const anyRepairOptionChecked = () =>
    repairWaveforms() ||
    repairDirectoryArt() ||
    repairEmbeddedArt() ||
    repairRemoveOverapplied() ||
    repairVideoThumbnails();
  // live progress through the step-by-step repair loop below - cleared
  // once the run finishes (success or error) so the final summary message
  // takes over instead of a stale "repairing..." panel.
  const [repairProgress, setRepairProgress] = createSignal<{
    phase: RepairPhase;
    totals: RepairLibraryImagesResult;
  } | null>(null);

  // reorganize-library - its own section (not a repair-checklist item):
  // moves fetched music/video into a user-chosen target directory. has
  // its own distinct input (a directory, not just toggles) so it gets a
  // separate accordion below "run repair library" rather than another
  // checkbox.
  const [showReorganizeOptions, setShowReorganizeOptions] = createSignal(false);
  const [reorganizeTargetDir, setReorganizeTargetDir] = createSignal("");
  const [reorganizeDomain, setReorganizeDomain] = createSignal<"both" | "music" | "video">("both");
  const [reorganizeEmbedTags, setReorganizeEmbedTags] = createSignal(true);
  // resolved config defaults - fetched once on mount, shown in the hint
  // text so the user knows what "default source dirs" actually means
  // without having to go check the config file.
  const [reorganizeSourceMusicDir, setReorganizeSourceMusicDir] = createSignal("");
  const [reorganizeSourceVideoDir, setReorganizeSourceVideoDir] = createSignal("");
  const [reorganizePreview, setReorganizePreview] =
    createSignal<ReorganizeLibraryPlanResult | null>(null);
  const [reorganizePreviewing, setReorganizePreviewing] = createSignal(false);
  const [reorganizeRunning, setReorganizeRunning] = createSignal(false);
  // the enqueue call fans out into many independent batch jobs sharing
  // one `session_id` - tracked here so the job-events listener below
  // knows which incoming Progress/Completed events belong to this run
  // (and not an unrelated directory scan happening at the same time).
  const [reorganizeSessionId, setReorganizeSessionId] = createSignal<string | null>(null);
  const [reorganizeProgress, setReorganizeProgress] = createSignal<{
    complete: number;
    total: number;
  } | null>(null);
  const [reorganizeSummary, setReorganizeSummary] = createSignal<ReorganizeLibraryTotals | null>(
    null,
  );
  const [reorganizeError, setReorganizeError] = createSignal("");

  // data cleanup / backfill checklist - separate from the repair-library
  // checklist above (that one chains off a directory rescan; these are
  // standalone admin_dispatch commands with no rescan involved). only
  // the non-destructive, additive tasks default on.
  const [maintCleanupOrphanedData, setMaintCleanupOrphanedData] = createSignal(true);
  const [maintBackfillThumbnails, setMaintBackfillThumbnails] = createSignal(true);
  const [maintBackfillBlake3, setMaintBackfillBlake3] = createSignal(false);
  const [maintCleanupOrphanedBlobs, setMaintCleanupOrphanedBlobs] = createSignal(false);
  const [maintCleanupContentlessBlobs, setMaintCleanupContentlessBlobs] = createSignal(false);
  const [maintHardDeleteOldRecords, setMaintHardDeleteOldRecords] = createSignal(false);
  const [maintHardDeleteOldVideos, setMaintHardDeleteOldVideos] = createSignal(false);
  const anyMaintenanceTaskChecked = () =>
    maintCleanupOrphanedData() ||
    maintBackfillThumbnails() ||
    maintBackfillBlake3() ||
    maintCleanupOrphanedBlobs() ||
    maintCleanupContentlessBlobs() ||
    maintHardDeleteOldRecords() ||
    maintHardDeleteOldVideos();
  const [maintenanceRunning, setMaintenanceRunning] = createSignal(false);
  const [maintenanceResults, setMaintenanceResults] = createSignal<string[]>([]);
  const [maintenanceError, setMaintenanceError] = createSignal("");
  // live per-step progress for a backend-orchestrated `maintenance_run`
  // (local only - see runMaintenanceTasks) - mirrors scanProgress's
  // purpose for the repair-library flow.
  const [maintenanceProgress, setMaintenanceProgress] = createSignal<{
    completed_steps: number;
    total_steps: number;
    current_step: string | null;
  } | null>(null);

  // dry-run "would this find anything?" preview per checklist item, so
  // the user can tell whether a task is worth running without actually
  // running it. cached for MAINTENANCE_PREVIEW_TTL_MS to avoid re-querying
  // every time the accordion is toggled; `refreshMaintenancePreviews(true)`
  // bypasses the cache for the manual "recheck" link.
  const [maintenancePreviews, setMaintenancePreviews] = createSignal<
    Record<string, { text: string; fetchedAt: number }>
  >({});
  const [maintenancePreviewsLoading, setMaintenancePreviewsLoading] = createSignal(false);

  let unlistenScan: (() => void) | null = null;

  onMount(async () => {
    // check for (and, if found, resume) any in-flight background runs
    // FIRST, before any other startup work, and in PARALLEL with each
    // other (not sequentially) - both are single, cheap in-memory
    // status reads, and the orchestration tasks themselves run on the
    // app's own async runtime, independent of any webview, so closing
    // the wizard window or navigating to another view and back must not
    // lose track of either (confirmed real 2026-10-09: this used to
    // show a stuck/empty progress card after doing either). doing this
    // first, in parallel, also shrinks the window where either "run"
    // button is clickable before we actually know one is already
    // running, and avoids the two checks queuing up behind each other.
    if (!admin.isRemote()) {
      await Promise.all([
        (async () => {
          try {
            const activeSessionId = await invoke<string | null>("repair_library_active_session");
            if (activeSessionId) {
              setScanning("__all__");
              setLastResult("");
              setLastError("");
              void pollRepairLibraryUntilDone(activeSessionId);
            }
          } catch (e) {
            console.error("failed to check for an in-flight repair-library run:", e);
          } finally {
            setCheckingActiveSession(false);
          }
        })(),
        (async () => {
          try {
            const activeSessionId = await invoke<string | null>("maintenance_active_session");
            if (activeSessionId) {
              setMaintenanceRunning(true);
              setMaintenanceError("");
              setMaintenanceResults([]);
              void pollMaintenanceUntilDone(activeSessionId);
            }
          } catch (e) {
            console.error("failed to check for an in-flight maintenance run:", e);
          }
        })(),
      ]);
    } else {
      setCheckingActiveSession(false);
    }

    await loadDirectories();
    try {
      const dirs = await admin.dispatchOrThrow<{
        source_music_directory: string;
        source_video_directory: string;
      }>("maintenance_reorganize_library_source_dirs", {});
      setReorganizeSourceMusicDir(dirs.source_music_directory);
      setReorganizeSourceVideoDir(dirs.source_video_directory);
    } catch (e) {
      console.error("failed to resolve default fetch source dirs:", e);
    }
    // subscribe to job lifecycle events via the typed broker channel.
    // these fire for any active ProcessFile session, covering new scans and rescans.
    try {
      const channel = new Channel<{
        kind: string;
        evt?: unknown;
        reason?: unknown;
      }>();
      channel.onmessage = (frame) => {
        if (frame.kind !== "event") return;
        const evt = frame.evt as
          | {
              kind?: string;
              session_id?: string;
              complete?: number;
              total?: number;
              message?: string;
              details?: Record<string, unknown>;
            }
          | undefined;
        if (!evt) return;
        // reorganize-library runs share one session_id across every
        // batch job - route events for the currently-active run here
        // instead of falling through to the scan-progress handling
        // below, which only understands the ProcessDirectory shape.
        const activeReorganizeSession = reorganizeSessionId();
        if (activeReorganizeSession && evt.session_id === activeReorganizeSession) {
          if (evt.kind === "progress") {
            setReorganizeProgress({ complete: evt.complete ?? 0, total: evt.total ?? 0 });
          } else if (evt.kind === "completed") {
            void finalizeReorganizeRun(activeReorganizeSession);
          }
          return;
        }
        const activeSession = activeLibrarySession();
        if (!activeSession || evt.session_id !== activeSession) {
          // no active "run repair library" flow this view started, or
          // this event belongs to some other job session entirely
          // (enrichment, a fetch, another tab's scan, ...) - ignore it
          // rather than letting it stomp scanProgress/scanSummary with
          // an unrelated session's (zeroed-out) counts.
          return;
        }
        if (evt.kind === "progress") {
          const d = (evt.details ?? {}) as {
            directory?: string;
            domain?: "music" | "video";
          };
          // `evt.complete`/`evt.total` are the generic, always-populated
          // session-level job counts grimoire's runner emits for every
          // job type (see runner.rs) - `evt.details` (songs_added,
          // jobs_pending, jobs_total) is only ever filled in for a
          // specific allowlist of "badge progress" job types
          // (ImportMusic, ProcessFile, FetchMedia, ...) that does NOT
          // include RescanDirectories/RepairLibraryImages, so reading
          // from `details` here always saw an empty object and rendered
          // a permanently-stuck "0 / 0 jobs" - confirmed real
          // 2026-10-09. each repair-library batch is one job, so this
          // now shows real, live "N / M jobs" (batches) progress.
          const total = evt.total ?? 0;
          const complete = evt.complete ?? 0;
          setScanProgress({
            session_id: evt.session_id ?? "",
            directory: d.directory,
            jobs_pending: Math.max(0, total - complete),
            jobs_total: total,
            domain: d.domain,
          });
        } else if (evt.kind === "stage" && evt.message) {
          // real, live detail straight from the job processor (current
          // directory/phase/batch, running totals) - see
          // rescan_processor.rs / repair_library_images_processor.rs's
          // `JobEvent::Stage` emit sites.
          setScanStageMessage(evt.message);
        }
        // deliberately ignore "completed" here: grimoire's generic
        // session-level Completed event fires the instant the SCAN
        // phase's jobs hit zero pending/running - BEFORE the
        // repair-images batch chain is even enqueued (see
        // run_repair_library_session's doc comment) - so treating it as
        // "done" here previously rendered "scan complete" and reloaded
        // (still mid-run) directories while image repair was still
        // actively running underneath. rescanAll()'s own
        // repair_library_run_status poll is the sole source of truth
        // for when the whole flow is actually finished.
      };
      const jobEventsSessionId = await invoke<string>("jobs_events_subscribe", {
        filter: null,
        events: channel,
        targetPeer: null,
      });
      unlistenScan = () => {
        void invoke("jobs_events_unsubscribe", {
          sessionId: jobEventsSessionId,
        });
      };
    } catch (e) {
      console.error("failed to listen for job events:", e);
    }
  });

  onCleanup(() => {
    if (unlistenScan) unlistenScan();
  });

  // retarget when admin scope changes
  createEffect(
    on(
      () => admin.current(),
      () => {
        setLastResult("");
        setConfirmRemove(null);
        loadDirectories();
      },
      { defer: true },
    ),
  );

  async function loadDirectories() {
    setLoading(true);
    try {
      const dirs = await admin.dispatchOrThrow<ScannedDir[]>("library_list_directories", {});
      setDirectories(dirs);
    } catch (e) {
      console.error("failed to load directories:", e);
    } finally {
      setLoading(false);
    }
  }

  async function browseDirectory() {
    // open the add-directory section with an editable text input;
    // the user can either type a path or click "browse..." inside
    // the modal (local mode only) to fill it from the os file picker.
    // they must press "confirm" to actually submit.
    setPendingPath("");
    setPendingTags("");
    setPendingDomain("both");
    setPathValidation(null);
    setShowAddModal(true);
  }

  async function browseAndFillPath() {
    // local-only: open the os file picker and write the selected path into
    // the text input. does NOT auto-submit; the user still has to press
    // "confirm" in the modal.
    if (admin.isRemote()) {
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose music directory to scan",
      });
      if (selected) {
        const resolved = await resolvePath(selected as string);
        setPendingPath(resolved);
        setPathValidation(null);
      }
    } catch (e) {
      console.error("browse error:", e);
    }
  }

  // basic non-empty + plausible filesystem-path sanity check (used for
  // local-mode confirm; remote mode still requires the server-side
  // library_validate_path round-trip).
  function isPathPlausible(p: string): boolean {
    const trimmed = p.trim();
    if (!trimmed) return false;
    // absolute unix path, home-relative, windows drive letter (optionally
    // with the "\\?\" extended-length prefix that std::fs::canonicalize
    // always adds on windows - see resolve_path/canonical_path_string), or
    // a plain UNC share path (\\server\share)
    return (
      trimmed.startsWith("/") ||
      trimmed.startsWith("~") ||
      /^(\\\\\?\\)?[a-zA-Z]:[\\/]/.test(trimmed) ||
      /^\\\\[^\\]+\\[^\\]+/.test(trimmed)
    );
  }

  async function validatePendingPath() {
    const path = pendingPath().trim();
    if (!path) {
      setPathValidation(null);
      return;
    }
    setPathValidating(true);
    try {
      const result = await admin.dispatchOrThrow<ValidatePathResult>("library_validate_path", {
        path,
      });
      setPathValidation(result);
    } catch (e) {
      setPathValidation({
        path,
        exists: false,
        is_dir: false,
        is_readable: false,
      });
      console.error("path validation failed:", e);
    } finally {
      setPathValidating(false);
    }
  }

  async function confirmAddDirectory() {
    const path = pendingPath().trim();
    if (!path) return;

    // always validate against the active transport (local or remote)
    // before closing the modal so the user can fix typos in place.
    // re-use any fresh validation result for the same path; otherwise
    // perform a round-trip now.
    let v = pathValidation();
    if (!v || v.path !== path) {
      await validatePendingPath();
      v = pathValidation();
    }
    if (!v || !v.exists || !v.is_dir || !v.is_readable) {
      // leave the modal open so the user can edit the path. inline
      // status is already shown by the pathValidation() block.
      return;
    }

    // use the resolved/expanded path returned by the validator
    // (tilde expansion happens server-side).
    const resolvedPath = v.path || path;

    const tags = pendingTags()
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const domain = pendingDomain();

    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
    setPendingDomain("both");
    setPathValidation(null);

    // scan the directory (which also records it in the database)
    await scanDirectory(resolvedPath, tags, domain);
  }

  function cancelAddDirectory() {
    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
    setPendingDomain("both");
    setPathValidation(null);
  }

  async function removeDirectory(path: string) {
    try {
      await admin.dispatchOrThrow("library_remove_directory", { path });
      await loadDirectories();
    } catch (e) {
      console.error("failed to remove directory:", e);
    }
    setConfirmRemove(null);
  }

  function openMoveModal(oldPath: string) {
    setMoveOldPath(oldPath);
    setMoveNewPath("");
    setMoveNewPathValidation(null);
    setMovePreviewResult(null);
    setMoveError("");
    setShowMoveModal(true);
  }

  function closeMoveModal() {
    setShowMoveModal(false);
    setMoveOldPath("");
    setMoveNewPath("");
    setMoveNewPathValidation(null);
    setMovePreviewResult(null);
    setMoveError("");
  }

  async function validateMoveNewPath() {
    const path = moveNewPath().trim();
    if (!path) {
      setMoveNewPathValidation(null);
      return;
    }
    setMoveNewPathValidating(true);
    try {
      const result = await admin.dispatchOrThrow<ValidatePathResult>("library_validate_path", {
        path,
      });
      setMoveNewPathValidation(result);
    } catch (e) {
      setMoveNewPathValidation({
        path,
        exists: false,
        is_dir: false,
        is_readable: false,
      });
      console.error("path validation failed:", e);
    } finally {
      setMoveNewPathValidating(false);
    }
  }

  async function previewMove() {
    const oldPath = moveOldPath();
    const newPath = moveNewPath().trim();
    if (!oldPath || !newPath) return;

    // validate new path first
    let v = moveNewPathValidation();
    if (!v || v.path !== newPath) {
      await validateMoveNewPath();
      v = moveNewPathValidation();
    }
    if (!v || !v.exists || !v.is_dir || !v.is_readable) {
      return;
    }

    setMoveInProgress(true);
    setMoveError("");
    setMovePreviewResult(null);
    try {
      const result = await admin.dispatchOrThrow<MoveScanDirectoryResult>(
        "library_move_directory",
        {
          old_path: oldPath,
          new_path: v.path || newPath,
          dry_run: true,
        },
      );
      setMovePreviewResult(result);
    } catch (e) {
      setMoveError(`preview failed: ${e}`);
      console.error("move preview failed:", e);
    } finally {
      setMoveInProgress(false);
    }
  }

  async function confirmMove() {
    const oldPath = moveOldPath();
    const newPath = moveNewPath().trim();
    if (!oldPath || !newPath) return;

    const v = moveNewPathValidation();
    if (!v || !v.exists || !v.is_dir || !v.is_readable) {
      return;
    }

    setMoveInProgress(true);
    setMoveError("");
    try {
      const result = await admin.dispatchOrThrow<MoveScanDirectoryResult>(
        "library_move_directory",
        {
          old_path: oldPath,
          new_path: v.path || newPath,
          dry_run: false,
        },
      );
      await loadDirectories();
      closeMoveModal();
      setLastResult(
        `moved directory: ${
          result.relocated_exact_path + result.relocated_parent + result.relocated_filename
        } files relocated`,
      );
    } catch (e) {
      setMoveError(`move failed: ${e}`);
      console.error("move failed:", e);
    } finally {
      setMoveInProgress(false);
    }
  }

  async function scanDirectory(path: string, tags: string[], domain?: "music" | "video" | "both") {
    setScanning(path);
    setLastResult("");
    setLastError("");
    setScanProgress(null);
    setScanStageMessage(null);
    setScanSummary(null);

    // for local scans, validate the path first so a bad path produces a
    // clear error instead of a cryptic backend failure.
    if (!admin.isRemote()) {
      try {
        const v = await admin.dispatchOrThrow<ValidatePathResult>("library_validate_path", {
          path,
        });
        if (!v.exists || !v.is_dir || !v.is_readable) {
          setLastError(
            !v.exists
              ? `path does not exist: ${path}`
              : !v.is_dir
                ? `path is not a directory: ${path}`
                : `path is not readable: ${path}`,
          );
          setScanning(null);
          return;
        }
      } catch (e) {
        // validation dispatcher unavailable (eg. older server) - fall
        // through and let the scan attempt surface its own error.
        console.warn("path validation skipped:", e);
      }
    }

    try {
      const result = admin.isRemote()
        ? await admin.dispatchOrThrow<ScanResult>("library_scan", {
            path,
            tags,
            domain,
            recursive: true,
          })
        : await invoke<ScanResult>("scan_directory", { path, tags, domain });
      setLastResult(result.message);
      // reload directories to show updated file count
      await loadDirectories();
    } catch (e) {
      setLastError(`scan failed: ${e}`);
    } finally {
      setScanning(null);
    }
  }

  // drives `maintenance_repair_library_step` one batch at a time instead
  // of a single `maintenance_repair_library` call that blocks until the
  // WHOLE library is done - updates `repairProgress` after every batch so
  // the wizard can show live counts instead of a static "repairing..."
  // label for however long the full pass takes.
  async function runRepairLibrarySteps(): Promise<RepairLibraryImagesResult> {
    const totals = emptyRepairTotals();
    let phase: RepairPhase = "waveforms";
    let directoryOffset = 0;
    for (;;) {
      const step: RepairLibraryStepResult = await admin.dispatchOrThrow<RepairLibraryStepResult>(
        "maintenance_repair_library_step",
        {
          dry_run: false,
          backfill_waveforms: repairWaveforms(),
          backfill_embedded_art: repairEmbeddedArt(),
          backfill_directory_art: repairDirectoryArt(),
          remove_overapplied: repairRemoveOverapplied(),
          backfill_video_thumbnails: repairVideoThumbnails(),
          phase,
          directory_offset: directoryOffset,
        },
      );
      const b = step.batch;
      totals.songs_waveforms_backfilled += b.songs_waveforms_backfilled;
      totals.albums_thumbnails_backfilled += b.albums_thumbnails_backfilled;
      totals.albums_thumbnails_removed_overapplied += b.albums_thumbnails_removed_overapplied;
      totals.albums_left_ambiguous += b.albums_left_ambiguous;
      totals.videos_waveforms_backfilled += b.videos_waveforms_backfilled;
      totals.videos_thumbnails_backfilled += b.videos_thumbnails_backfilled;
      totals.errors.push(...b.errors);
      setRepairProgress({ phase: step.phase, totals: { ...totals, errors: [...totals.errors] } });
      if (step.done) break;
      phase = step.next_phase;
      directoryOffset = step.next_directory_offset;
    }
    return totals;
  }

  // shared by both a freshly-started run (rescanAll) and a resumed one
  // (onMount, when `repair_library_active_session` finds one still in
  // flight after the wizard window was closed/reopened or this view was
  // navigated away from and back to) - polls the lightweight in-memory
  // status map (no DB query) rather than trusting the generic job-events
  // "completed" signal for this session, which fires once the SCAN
  // half's jobs happen to hit zero pending/running - a race with (and
  // indistinguishable from) the real, final completion a few seconds
  // later once the repair-images chain is also done - see
  // repair_library_run_status's doc comment.
  async function pollRepairLibraryUntilDone(sessionId: string) {
    setActiveLibrarySession(sessionId);
    try {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await invoke<{ done: boolean; message: string | null }>(
          "repair_library_run_status",
          { sessionId },
        );
        if (status.done) {
          setLastResult(status.message ?? "repair library complete");
          break;
        }
      }
      await loadDirectories();
      await refreshMaintenancePreviews(true);
    } catch (e) {
      setLastError(`rescan failed: ${e}`);
    } finally {
      setActiveLibrarySession(null);
      setScanProgress(null);
      setScanStageMessage(null);
      setScanSummary(null);
      setRepairProgress(null);
      setScanning(null);
    }
  }

  async function rescanAll() {
    setScanning("__all__");
    setLastResult("");
    setLastError("");
    setScanProgress(null);
    setScanSummary(null);
    setRepairProgress(null);

    if (admin.isRemote()) {
      // remote: no local job-events/spume bridge to chain into - keep
      // the existing two-step dispatch (scan, then step through
      // repair).
      try {
        const result = await admin.dispatchOrThrow<ScanResult>("library_rescan_all", {});
        const repair = await runRepairLibrarySteps();
        setLastResult(
          `${result.message} — image repair: backfilled ${repair.songs_waveforms_backfilled} song waveform(s), ` +
            `${repair.albums_thumbnails_backfilled} album thumbnail(s), ${repair.videos_waveforms_backfilled} video waveform(s), ` +
            `${repair.videos_thumbnails_backfilled} video thumbnail(s); removed ${repair.albums_thumbnails_removed_overapplied} ` +
            `over-applied image(s)${repair.errors.length > 0 ? ` (${repair.errors.length} error(s))` : ""}`,
        );
        await loadDirectories();
        await refreshMaintenancePreviews(true);
      } catch (e) {
        setLastError(`rescan failed: ${e}`);
      } finally {
        setRepairProgress(null);
        setScanning(null);
      }
      return;
    }

    // local: one job session drives scan + the full RepairLibraryImages
    // batch chain, so this view's progress card and spume's toast both
    // only report "done" once EVERYTHING has actually finished - see
    // commands::repair_library_run's doc comment (replaces the old
    // rescan_directories + client-driven maintenance_repair_library_step
    // polling loop, which could only ever track the scan half, and whose
    // "scan complete" toast/card fired while image repair was still
    // quietly running underneath - confirmed real 2026-10-09).
    try {
      const result = await invoke<{
        success: boolean;
        session_id: string | null;
        message: string;
      }>("repair_library_run", {
        dryRun: false,
        backfillWaveforms: repairWaveforms(),
        backfillEmbeddedArt: repairEmbeddedArt(),
        backfillDirectoryArt: repairDirectoryArt(),
        removeOverapplied: repairRemoveOverapplied(),
        backfillVideoThumbnails: repairVideoThumbnails(),
      });
      if (!result.success || !result.session_id) {
        setLastError(result.message);
        setScanning(null);
        return;
      }
      await pollRepairLibraryUntilDone(result.session_id);
    } catch (e) {
      setLastError(`rescan failed: ${e}`);
      setActiveLibrarySession(null);
      setScanProgress(null);
      setScanStageMessage(null);
      setScanSummary(null);
      setRepairProgress(null);
      setScanning(null);
    }
  }

  async function browseReorganizeTargetDir() {
    // local-only: open the os file picker and write the selected path
    // into the text input. remote mode must type/paste a path that
    // exists on the remote server (same constraint as "add directory").
    if (admin.isRemote()) {
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose library target directory",
      });
      if (selected) {
        const resolved = await resolvePath(selected as string);
        setReorganizeTargetDir(resolved);
        setReorganizePreview(null);
      }
    } catch (e) {
      console.error("browse error:", e);
    }
  }

  function directoriesOverlap(a: string, b: string): boolean {
    const normA = a.replace(/\/+$/, "");
    const normB = b.replace(/\/+$/, "");
    if (!normA || !normB) return false;
    return normA === normB || normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`);
  }

  // mirrors grimoire's `maintenance::validate_target_directory`: the
  // reorganize job only moves files INTO the target from OUTSIDE it, so
  // a target that's the same as (or nested with) a fetch source
  // directory would silently find zero candidates forever - catch it
  // client-side too so the user gets immediate feedback instead of a
  // confusing "nothing to reorganize" after clicking preview/run.
  function reorganizeTargetOverlap(): string | null {
    const target = reorganizeTargetDir().trim();
    if (!target) return null;
    const domain = reorganizeDomain();
    if (
      domain !== "video" &&
      reorganizeSourceMusicDir() &&
      directoriesOverlap(target, reorganizeSourceMusicDir())
    ) {
      return `overlaps the music fetch source directory (${reorganizeSourceMusicDir()}) - pick a separate target.`;
    }
    if (
      domain !== "music" &&
      reorganizeSourceVideoDir() &&
      directoriesOverlap(target, reorganizeSourceVideoDir())
    ) {
      return `overlaps the video fetch source directory (${reorganizeSourceVideoDir()}) - pick a separate target.`;
    }
    return null;
  }

  async function previewReorganize() {
    const target = reorganizeTargetDir().trim();
    if (!target) return;
    const overlap = reorganizeTargetOverlap();
    if (overlap) {
      setReorganizeError(`invalid target directory: ${overlap}`);
      return;
    }
    setReorganizePreviewing(true);
    setReorganizeError("");
    try {
      const result = await admin.dispatchOrThrow<ReorganizeLibraryPlanResult>(
        "maintenance_reorganize_library_plan",
        { target_directory: target, domain: reorganizeDomain() },
      );
      setReorganizePreview(result);
    } catch (e) {
      setReorganizeError(`preview failed: ${e}`);
      console.error("reorganize preview failed:", e);
    } finally {
      setReorganizePreviewing(false);
    }
  }

  // once the whole run's session settles (every batch job terminal),
  // re-fetch every job in the session and sum each one's `result` blob -
  // `JobEvent::Completed` itself carries no business-level counts, just
  // "the session has no pending/running jobs left" (see
  // `jobs::runner`'s generic per-session rollup).
  async function finalizeReorganizeRun(sessionId: string) {
    const totals = emptyReorganizeTotals();
    try {
      const jobs = await admin.dispatchOrThrow<JobRow[]>("jobs_list", {
        session_id: sessionId,
        limit: 500,
      });
      for (const job of jobs) {
        if (!job.result) continue;
        try {
          const parsed = JSON.parse(job.result) as { totals?: ReorganizeLibraryTotals };
          const t = parsed.totals;
          if (!t) continue;
          totals.songs_moved += t.songs_moved;
          totals.songs_already_done += t.songs_already_done;
          totals.videos_moved += t.videos_moved;
          totals.videos_already_done += t.videos_already_done;
          totals.tags_embedded += t.tags_embedded;
          totals.tags_skipped_unsupported_format += t.tags_skipped_unsupported_format;
          totals.errors.push(...(t.errors ?? []));
        } catch (e) {
          console.error("failed to parse reorganize job result:", e);
        }
      }
    } catch (e) {
      console.error("failed to fetch reorganize job results:", e);
    }
    setReorganizeSummary(totals);
    setReorganizeProgress(null);
    setReorganizeRunning(false);
    setReorganizeSessionId(null);
    setReorganizePreview(null);
    await loadDirectories();
  }

  async function runReorganize() {
    const target = reorganizeTargetDir().trim();
    if (!target) return;
    const overlap = reorganizeTargetOverlap();
    if (overlap) {
      setReorganizeError(`invalid target directory: ${overlap}`);
      return;
    }
    setReorganizeRunning(true);
    setReorganizeError("");
    setReorganizeSummary(null);
    setReorganizeProgress({ complete: 0, total: 0 });
    try {
      const result = await admin.dispatchOrThrow<ReorganizeLibraryEnqueueResult>(
        "maintenance_reorganize_library_enqueue",
        {
          target_directory: target,
          domain: reorganizeDomain(),
          embed_tags: reorganizeEmbedTags(),
        },
      );
      if (result.job_ids.length === 0) {
        // nothing to move - finish immediately, no session to track.
        setReorganizeRunning(false);
        setReorganizeProgress(null);
        setReorganizeSummary(emptyReorganizeTotals());
        setReorganizePreview(null);
        return;
      }
      // the job-events listener (see onMount) picks up Progress/Completed
      // for this session_id and calls finalizeReorganizeRun when done.
      setReorganizeSessionId(result.session_id);
    } catch (e) {
      setReorganizeError(`reorganize failed: ${e}`);
      console.error("reorganize enqueue failed:", e);
      setReorganizeRunning(false);
      setReorganizeProgress(null);
    }
  }

  // runs every checked data-cleanup/backfill task in sequence, collecting
  // each admin_dispatch command's own human-readable `message` rather than
  // re-deriving a summary from each one's differently-shaped `data` -
  // a failure in one task doesn't stop the rest from running.
  // shared by both a freshly-started maintenance run (runMaintenanceTasks)
  // and a resumed one (onMount, when `maintenance_active_session` finds
  // one still in flight) - mirrors pollRepairLibraryUntilDone's purpose.
  async function pollMaintenanceUntilDone(sessionId: string) {
    try {
      for (;;) {
        const status = await invoke<{
          done: boolean;
          total_steps: number;
          completed_steps: number;
          current_step: string | null;
          results: { command: string; success: boolean; message: string }[];
        }>("maintenance_run_status", { sessionId });
        setMaintenanceProgress({
          completed_steps: status.completed_steps,
          total_steps: status.total_steps,
          current_step: status.current_step,
        });
        if (status.done) {
          setMaintenanceResults(
            status.results.map((r) => (r.success ? r.message : `failed: ${r.message}`)),
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await loadDirectories();
      await refreshMaintenancePreviews(true);
    } catch (e) {
      setMaintenanceError(`maintenance tasks failed: ${e}`);
    } finally {
      setMaintenanceProgress(null);
      setMaintenanceRunning(false);
    }
  }

  async function runMaintenanceTasks() {
    setMaintenanceRunning(true);
    setMaintenanceError("");
    setMaintenanceResults([]);
    setMaintenanceProgress(null);

    if (admin.isRemote()) {
      // remote: no local backend task to orchestrate this against - keep
      // the client-driven loop (same shape as before, just can't survive
      // a window close/view navigation - see commands::maintenance_run's
      // doc comment for why the local path now can).
      const results: string[] = [];

      async function run(command: string, args: unknown = {}) {
        try {
          const resp = await admin.dispatch(command, args);
          results.push(resp.success ? resp.message : `failed: ${resp.message}`);
        } catch (e) {
          results.push(`failed: ${e}`);
        }
      }

      try {
        if (maintCleanupOrphanedData()) {
          for (const command of [
            "maintenance_cleanup_orphaned_tags",
            "maintenance_cleanup_orphaned_genres",
            "maintenance_cleanup_orphaned_artists",
            "maintenance_cleanup_orphaned_albums",
            "maintenance_cleanup_orphaned_video_series",
            "maintenance_cleanup_orphaned_taxons",
          ]) {
            await run(command);
          }
        }
        if (maintBackfillThumbnails()) {
          await run("maintenance_backfill_thumbnails");
        }
        if (maintBackfillBlake3()) {
          await run("maintenance_backfill_blake3");
        }
        if (maintCleanupOrphanedBlobs()) {
          await run("maintenance_cleanup_orphaned_blobs");
        }
        if (maintCleanupContentlessBlobs()) {
          await run("maintenance_cleanup_contentless_blobs");
        }
        if (maintHardDeleteOldRecords()) {
          await run("maintenance_hard_delete_old_records");
        }
        if (maintHardDeleteOldVideos()) {
          await run("maintenance_hard_delete_old_videos");
        }
        setMaintenanceResults(results);
        await loadDirectories();
        await refreshMaintenancePreviews(true);
      } catch (e) {
        setMaintenanceError(`maintenance tasks failed: ${e}`);
      } finally {
        setMaintenanceRunning(false);
      }
      return;
    }

    // local: backend-orchestrated so it survives the wizard window
    // closing or navigating to another view and back - see
    // commands::maintenance_run's doc comment.
    try {
      const result = await invoke<{
        success: boolean;
        session_id: string | null;
        message: string;
      }>("maintenance_run", {
        cleanupOrphanedData: maintCleanupOrphanedData(),
        backfillThumbnails: maintBackfillThumbnails(),
        backfillBlake3: maintBackfillBlake3(),
        cleanupOrphanedBlobs: maintCleanupOrphanedBlobs(),
        cleanupContentlessBlobs: maintCleanupContentlessBlobs(),
        hardDeleteOldRecords: maintHardDeleteOldRecords(),
        hardDeleteOldVideos: maintHardDeleteOldVideos(),
      });
      if (!result.success || !result.session_id) {
        setMaintenanceError(result.message);
        setMaintenanceRunning(false);
        return;
      }
      await pollMaintenanceUntilDone(result.session_id);
    } catch (e) {
      setMaintenanceError(`maintenance tasks failed: ${e}`);
      setMaintenanceRunning(false);
    }
  }

  const MAINTENANCE_PREVIEW_TTL_MS = 3 * 60 * 1000;
  const MAINTENANCE_PREVIEW_KEYS = [
    "orphaned_data",
    "thumbnails",
    "blake3",
    "orphaned_blobs",
    "contentless_blobs",
    "hard_delete_records",
    "hard_delete_videos",
    "repair_waveforms",
    "repair_art",
    "repair_remove_overapplied",
    "repair_video_thumbnails",
  ] as const;
  type MaintenancePreviewKey = (typeof MAINTENANCE_PREVIEW_KEYS)[number];

  function previewPath(obj: unknown, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        obj,
      );
  }

  // dry-runs `command` and pulls a numeric field (dotted path for nested
  // fields like "summary.total_records_deleted") out of its response -
  // never throws, a failed probe just reads as "0 found" rather than
  // blocking the rest of the batch.
  async function dryRunCount(command: string, field: string, args: unknown = { dry_run: true }) {
    try {
      const resp = await admin.dispatch<Record<string, unknown>>(command, args);
      if (!resp.success) return 0;
      const n = previewPath(resp.data, field);
      return typeof n === "number" ? n : 0;
    } catch {
      return 0;
    }
  }

  // each group is one (or a few related) admin_dispatch round-trip(s);
  // groups run concurrently but each writes its own key(s) into
  // `maintenancePreviews` the moment IT resolves, rather than waiting on
  // every other group - so counts appear incrementally instead of all
  // popping in at once after the slowest probe finishes.
  const MAINTENANCE_PREVIEW_GROUPS: {
    keys: MaintenancePreviewKey[];
    run: () => Promise<Partial<Record<MaintenancePreviewKey, string>>>;
  }[] = [
    {
      keys: ["orphaned_data"],
      run: async () => {
        const counts = await Promise.all([
          dryRunCount("maintenance_cleanup_orphaned_tags", "tags_found"),
          dryRunCount("maintenance_cleanup_orphaned_genres", "genres_found"),
          dryRunCount("maintenance_cleanup_orphaned_artists", "artists_found"),
          dryRunCount("maintenance_cleanup_orphaned_albums", "albums_found"),
          dryRunCount("maintenance_cleanup_orphaned_video_series", "series_found"),
          dryRunCount("maintenance_cleanup_orphaned_taxons", "taxons_found"),
        ]);
        const total = counts.reduce((a, b) => a + b, 0);
        return {
          orphaned_data: total === 0 ? "nothing to clean up" : `${total} record(s) found`,
        };
      },
    },
    {
      keys: ["thumbnails"],
      run: async () => {
        const n = await dryRunCount("maintenance_backfill_thumbnails", "blobs_needing_thumbnails");
        return { thumbnails: n === 0 ? "up to date" : `${n} image(s) need thumbnails` };
      },
    },
    {
      keys: ["blake3"],
      run: async () => {
        const n = await dryRunCount("blobz_blake3_status", "needing_backfill", {});
        return { blake3: n === 0 ? "up to date" : `${n} blob(s) missing a hash` };
      },
    },
    {
      keys: ["orphaned_blobs"],
      run: async () => {
        const resp = await admin.dispatch<{
          orphaned_blobs_found?: number;
          bytes_freed_mib?: string;
        }>("maintenance_cleanup_orphaned_blobs", { dry_run: true });
        const n = resp.success ? (resp.data?.orphaned_blobs_found ?? 0) : 0;
        const mib = resp.data?.bytes_freed_mib;
        return {
          orphaned_blobs:
            n === 0 ? "nothing to purge" : `${n} blob(s)${mib ? ` (~${mib} MiB)` : ""}`,
        };
      },
    },
    {
      keys: ["contentless_blobs"],
      run: async () => {
        const n = await dryRunCount("maintenance_cleanup_contentless_blobs", "blobs_found");
        return { contentless_blobs: n === 0 ? "nothing stuck" : `${n} stuck blob(s)` };
      },
    },
    {
      keys: ["hard_delete_records"],
      run: async () => {
        const n = await dryRunCount(
          "maintenance_hard_delete_old_records",
          "summary.total_records_deleted",
        );
        return {
          hard_delete_records: n === 0 ? "nothing past retention" : `${n} record(s) past retention`,
        };
      },
    },
    {
      keys: ["hard_delete_videos"],
      run: async () => {
        const n = await dryRunCount(
          "maintenance_hard_delete_old_videos",
          "summary.total_records_deleted",
        );
        return {
          hard_delete_videos: n === 0 ? "nothing past retention" : `${n} video(s) past retention`,
        };
      },
    },
    {
      // one dry-run covers every repair sub-job's count at once (the
      // backend returns them all in a single `RepairLibraryImagesResult`)
      // - forcing every toggle on for the probe itself (never written,
      // dry_run always wins) so even an unchecked sub-job still gets a
      // preview count.
      keys: [
        "repair_waveforms",
        "repair_art",
        "repair_remove_overapplied",
        "repair_video_thumbnails",
      ],
      run: async () => {
        const resp = await admin.dispatch<RepairLibraryImagesResult>("maintenance_repair_library", {
          dry_run: true,
          backfill_waveforms: true,
          backfill_embedded_art: true,
          backfill_directory_art: true,
          remove_overapplied: true,
          backfill_video_thumbnails: true,
        });
        if (!resp.success || !resp.data) {
          return {
            repair_waveforms: "unknown",
            repair_art: "unknown",
            repair_remove_overapplied: "unknown",
            repair_video_thumbnails: "unknown",
          };
        }
        const d = resp.data;
        const waveforms = d.songs_waveforms_backfilled + d.videos_waveforms_backfilled;
        return {
          repair_waveforms: waveforms === 0 ? "up to date" : `${waveforms} waveform(s) missing`,
          // shared by both the embedded-art and directory-art checkboxes -
          // the backend doesn't track which source would fill a given gap.
          repair_art:
            d.albums_thumbnails_backfilled === 0
              ? "up to date"
              : `${d.albums_thumbnails_backfilled} album(s) missing art`,
          repair_remove_overapplied:
            d.albums_thumbnails_removed_overapplied === 0
              ? "none found"
              : `${d.albums_thumbnails_removed_overapplied} over-applied image(s)`,
          repair_video_thumbnails:
            d.videos_thumbnails_backfilled === 0
              ? "up to date"
              : `${d.videos_thumbnails_backfilled} video(s) missing posters`,
        };
      },
    },
  ];

  async function runPreviewGroup(group: (typeof MAINTENANCE_PREVIEW_GROUPS)[number]) {
    const now = Date.now();
    let results: Partial<Record<MaintenancePreviewKey, string>>;
    try {
      results = await group.run();
    } catch (e) {
      console.error("maintenance preview probe failed:", group.keys, e);
      results = Object.fromEntries(group.keys.map((k) => [k, "unknown"]));
    }
    setMaintenancePreviews((prev) => {
      const next = { ...prev };
      for (const key of group.keys) {
        next[key] = { text: results[key] ?? "unknown", fetchedAt: now };
      }
      return next;
    });
  }

  async function refreshMaintenancePreviews(force = false) {
    const now = Date.now();
    const cached = maintenancePreviews();
    const staleGroups = MAINTENANCE_PREVIEW_GROUPS.filter(
      (g) =>
        force ||
        g.keys.some((k) => !cached[k] || now - cached[k].fetchedAt >= MAINTENANCE_PREVIEW_TTL_MS),
    );
    if (staleGroups.length === 0 || maintenancePreviewsLoading()) return;

    setMaintenancePreviewsLoading(true);
    try {
      // each group updates the cache (and thus the UI) as soon as it
      // resolves - no single gate waiting on the slowest probe.
      await Promise.all(staleGroups.map(runPreviewGroup));
    } finally {
      setMaintenancePreviewsLoading(false);
    }
  }

  function maintenancePreviewText(key: MaintenancePreviewKey): string {
    if (maintenancePreviewsLoading() && !maintenancePreviews()[key]) return "checking...";
    return maintenancePreviews()[key]?.text ?? "";
  }

  return (
    <div class="view-content">
      <div class="view-header">
        <h1>music library</h1>
      </div>

      <div class="section">
        <Show when={loading()}>
          <div class="loading">
            <div class="spinner" />
            <span>loading...</span>
          </div>
        </Show>

        <Show when={!loading()}>
          <div class="directory-list">
            <Show when={directories().length === 0}>
              <p class="empty">no directories added yet</p>
            </Show>
            <For each={directories()}>
              {(dir) => (
                <div class="directory-item">
                  <div class="directory-info">
                    <span class="directory-name">{directoryDisplayName(dir.path)}</span>
                    <span class="directory-path" title={dir.path}>
                      {dir.path}
                      <Show when={isDocumentPortalPath(dir.path)}>
                        <span class="directory-path-hint"> (sandbox folder access)</span>
                      </Show>
                    </span>
                    <span class="directory-meta">
                      {dir.file_count} files
                      <Show when={dir.tags.length > 0}>
                        <span class="directory-tags">
                          {dir.tags.map((tag) => `#${tag}`).join(" ")}
                        </span>
                      </Show>
                    </span>
                  </div>
                  <div class="directory-actions">
                    <button
                      class="secondary small"
                      onClick={() => scanDirectory(dir.path, [])}
                      disabled={scanning() !== null}
                    >
                      {scanning() === dir.path ? "scanning..." : "scan"}
                    </button>
                    <button
                      class="secondary small"
                      onClick={() => openMoveModal(dir.path)}
                      disabled={scanning() !== null}
                    >
                      edit path
                    </button>
                    <Show when={confirmRemove() === dir.path}>
                      <button class="danger small" onClick={() => removeDirectory(dir.path)}>
                        confirm
                      </button>
                      <button class="secondary small" onClick={() => setConfirmRemove(null)}>
                        cancel
                      </button>
                    </Show>
                    <Show when={confirmRemove() !== dir.path}>
                      <button class="secondary small" onClick={() => setConfirmRemove(dir.path)}>
                        remove
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          <Show when={directories().length > 0}>
            <p class="hint">"scan" finds new files in one directory.</p>
          </Show>
        </Show>

        <div class="button-row">
          <button class="secondary" onClick={browseDirectory}>
            add directory
          </button>
        </div>

        <details
          class="flyout"
          open={showRepairOptions()}
          onToggle={(e) => {
            setShowRepairOptions(e.currentTarget.open);
            if (e.currentTarget.open) void refreshMaintenancePreviews();
          }}
        >
          <summary>maintenance</summary>
          <div>
            <div class="form-group repair-checklist">
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={repairWaveforms()}
                  onChange={(e) => setRepairWaveforms(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">
                    generate missing waveform images (songs + videos)
                  </span>
                  <Show when={maintenancePreviewText("repair_waveforms")}>
                    <span class="checkbox-count">{maintenancePreviewText("repair_waveforms")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={repairDirectoryArt()}
                  onChange={(e) => setRepairDirectoryArt(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">apply missing album art from directory images</span>
                  <Show when={maintenancePreviewText("repair_art")}>
                    <span class="checkbox-count">{maintenancePreviewText("repair_art")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={repairEmbeddedArt()}
                  onChange={(e) => setRepairEmbeddedArt(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">
                    apply missing album art from embedded file tags
                  </span>
                  <Show when={maintenancePreviewText("repair_art")}>
                    <span class="checkbox-count">{maintenancePreviewText("repair_art")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={repairRemoveOverapplied()}
                  onChange={(e) => setRepairRemoveOverapplied(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">remove over-applied/duplicate directory art</span>
                  <span class="checkbox-hint">
                    destructive: deletes thumbnails already shared across too many unrelated albums
                    in the same directory. off by default.
                  </span>
                  <Show when={maintenancePreviewText("repair_remove_overapplied")}>
                    <span class="checkbox-count">
                      {maintenancePreviewText("repair_remove_overapplied")}
                    </span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={repairVideoThumbnails()}
                  onChange={(e) => setRepairVideoThumbnails(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">generate missing video thumbnail images</span>
                  <Show when={maintenancePreviewText("repair_video_thumbnails")}>
                    <span class="checkbox-count">
                      {maintenancePreviewText("repair_video_thumbnails")}
                    </span>
                  </Show>
                </span>
              </label>
            </div>

            <div class="button-row">
              <button
                class="secondary"
                onClick={rescanAll}
                disabled={
                  checkingActiveSession() || scanning() !== null || !anyRepairOptionChecked()
                }
                title="re-scan every tracked directory (import new music, restore songs whose files came back, soft-delete songs whose files are gone, purge scan dirs that no longer exist), then run the checked repair sub-jobs above"
              >
                {checkingActiveSession()
                  ? "checking..."
                  : scanning() === "__all__"
                    ? "repairing..."
                    : "run repair library"}
              </button>
            </div>

            {/* live progress through the batch-by-batch repair loop - updates
                  after every round-trip so a large library doesn't look stuck
                  behind a single long-blocking call with no feedback. */}
            <Show when={repairProgress()}>
              {(p) => (
                <div class="scan-progress-card">
                  <div class="scan-progress-header">
                    <div class="spinner" />
                    <span>repairing... ({REPAIR_PHASE_LABELS[p().phase]})</span>
                  </div>
                  <div class="scan-progress-stats">
                    {p().totals.songs_waveforms_backfilled} song waveform(s) ·{" "}
                    {p().totals.videos_waveforms_backfilled} video waveform(s) ·{" "}
                    {p().totals.videos_thumbnails_backfilled} video thumbnail(s) ·{" "}
                    {p().totals.albums_thumbnails_backfilled} album thumbnail(s)
                    <Show when={p().totals.albums_thumbnails_removed_overapplied > 0}>
                      {" "}
                      · {p().totals.albums_thumbnails_removed_overapplied} over-applied image(s)
                      removed
                    </Show>
                    <Show when={p().totals.errors.length > 0}>
                      {" "}
                      · {p().totals.errors.length} error(s) so far
                    </Show>
                  </div>
                </div>
              )}
            </Show>

            <p class="hint">
              "repair library" walks every tracked directory: imports new music, relocates moved
              files, restores songs whose files came back, and soft-deletes songs whose files are
              gone - then runs whichever of the checked repair sub-jobs above.
            </p>

            <hr class="section-divider" />

            <div class="form-group repair-checklist">
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintCleanupOrphanedData()}
                  onChange={(e) => setMaintCleanupOrphanedData(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">clean up orphaned data</span>
                  <span class="checkbox-hint">
                    deletes tags, genres, artists, albums, video series, and taxons with zero
                    remaining references.
                  </span>
                  <Show when={maintenancePreviewText("orphaned_data")}>
                    <span class="checkbox-count">{maintenancePreviewText("orphaned_data")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintBackfillThumbnails()}
                  onChange={(e) => setMaintBackfillThumbnails(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">generate missing image thumbnails</span>
                  <Show when={maintenancePreviewText("thumbnails")}>
                    <span class="checkbox-count">{maintenancePreviewText("thumbnails")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintBackfillBlake3()}
                  onChange={(e) => setMaintBackfillBlake3(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">backfill content hashes (blake3)</span>
                  <span class="checkbox-hint">
                    off by default; can take a while on a large library.
                  </span>
                  <Show when={maintenancePreviewText("blake3")}>
                    <span class="checkbox-count">{maintenancePreviewText("blake3")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintCleanupOrphanedBlobs()}
                  onChange={(e) => setMaintCleanupOrphanedBlobs(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">purge long-soft-deleted orphaned blobs</span>
                  <span class="checkbox-hint">
                    destructive: permanently removes files/rows soft-deleted 30+ days ago. off by
                    default.
                  </span>
                  <Show when={maintenancePreviewText("orphaned_blobs")}>
                    <span class="checkbox-count">{maintenancePreviewText("orphaned_blobs")}</span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintCleanupContentlessBlobs()}
                  onChange={(e) => setMaintCleanupContentlessBlobs(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">clean up stuck/contentless blob records</span>
                  <span class="checkbox-hint">
                    blobs with no retrievable content anywhere (permanently stuck). off by default.
                  </span>
                  <Show when={maintenancePreviewText("contentless_blobs")}>
                    <span class="checkbox-count">
                      {maintenancePreviewText("contentless_blobs")}
                    </span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintHardDeleteOldRecords()}
                  onChange={(e) => setMaintHardDeleteOldRecords(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">
                    permanently purge old soft-deleted songs/albums/etc
                  </span>
                  <span class="checkbox-hint">
                    destructive: hard-deletes records soft-deleted 30+ days ago. off by default.
                  </span>
                  <Show when={maintenancePreviewText("hard_delete_records")}>
                    <span class="checkbox-count">
                      {maintenancePreviewText("hard_delete_records")}
                    </span>
                  </Show>
                </span>
              </label>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={maintHardDeleteOldVideos()}
                  onChange={(e) => setMaintHardDeleteOldVideos(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">permanently purge old soft-deleted videos</span>
                  <span class="checkbox-hint">
                    destructive: hard-deletes video rows soft-deleted 30+ days ago. off by default.
                  </span>
                  <Show when={maintenancePreviewText("hard_delete_videos")}>
                    <span class="checkbox-count">
                      {maintenancePreviewText("hard_delete_videos")}
                    </span>
                  </Show>
                </span>
              </label>
            </div>

            <div class="button-row">
              <button
                class="secondary"
                onClick={runMaintenanceTasks}
                disabled={maintenanceRunning() || !anyMaintenanceTaskChecked()}
              >
                {maintenanceRunning() ? "running..." : "run maintenance tasks"}
              </button>
              <button
                class="secondary small"
                onClick={() => refreshMaintenancePreviews(true)}
                disabled={maintenanceRunning() || maintenancePreviewsLoading()}
                title="re-check how much each task above would affect, bypassing the cached counts"
              >
                {maintenancePreviewsLoading() ? "checking..." : "recheck counts"}
              </button>
            </div>

            <Show when={maintenanceResults().length > 0}>
              <div class="scan-progress-card success">
                <For each={maintenanceResults()}>{(line) => <div>{line}</div>}</For>
              </div>
            </Show>

            <Show when={maintenanceError()}>
              <p class="scan-progress error">{maintenanceError()}</p>
            </Show>
          </div>
        </details>

        {/* reorganize-library - its own section (not a repair-checklist
              item) since it needs a target directory, not just toggles. */}
        <details
          class="flyout flyout--accent"
          open={showReorganizeOptions()}
          onToggle={(e) => setShowReorganizeOptions(e.currentTarget.open)}
        >
          <summary>reorganize library files</summary>
          <div>
            <div class="form-group">
              <label>target directory</label>
              <input
                type="text"
                value={reorganizeTargetDir()}
                placeholder={
                  admin.isRemote()
                    ? "/absolute/path/on/remote"
                    : "/absolute/path/to/library or ~/Music"
                }
                onInput={(e) => {
                  setReorganizeTargetDir(e.currentTarget.value);
                  setReorganizePreview(null);
                }}
                disabled={reorganizeRunning()}
              />
              <p class="hint">
                fetched music + video are moved into a readable Artist/Album (or Series/Movie)
                folder. source directories default to the configured fetch output dirs.
                <Show when={reorganizeSourceMusicDir() || reorganizeSourceVideoDir()}>
                  <br />
                  music: {reorganizeSourceMusicDir() || "(not set)"}
                  <br />
                  video: {reorganizeSourceVideoDir() || "(not set)"}
                </Show>
              </p>
              <Show when={reorganizeTargetOverlap()}>
                <p class="scan-progress error">{reorganizeTargetOverlap()}</p>
              </Show>
              <div class="button-row">
                <Show when={!admin.isRemote()}>
                  <button
                    class="secondary small"
                    onClick={browseReorganizeTargetDir}
                    disabled={reorganizeRunning()}
                  >
                    browse...
                  </button>
                </Show>
                <button
                  class="secondary small"
                  onClick={previewReorganize}
                  disabled={
                    reorganizeRunning() ||
                    reorganizePreviewing() ||
                    !reorganizeTargetDir().trim() ||
                    !!reorganizeTargetOverlap()
                  }
                >
                  {reorganizePreviewing() ? "checking..." : "preview"}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>media type</label>
              <div class="radio-toggle-group">
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="reorganize-domain"
                    checked={reorganizeDomain() === "both"}
                    onChange={() => {
                      setReorganizeDomain("both");
                      setReorganizePreview(null);
                    }}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">both</span>
                </label>
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="reorganize-domain"
                    checked={reorganizeDomain() === "music"}
                    onChange={() => {
                      setReorganizeDomain("music");
                      setReorganizePreview(null);
                    }}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">music</span>
                </label>
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="reorganize-domain"
                    checked={reorganizeDomain() === "video"}
                    onChange={() => {
                      setReorganizeDomain("video");
                      setReorganizePreview(null);
                    }}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">video</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={reorganizeEmbedTags()}
                  onChange={(e) => setReorganizeEmbedTags(e.currentTarget.checked)}
                  disabled={reorganizeDomain() === "video"}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">
                    embed id3/vorbis tags + cover art into moved song files
                  </span>
                  <span class="checkbox-hint">
                    songs only; skipped for file formats that don't support embedded metadata.
                  </span>
                </span>
              </label>
            </div>

            <Show when={reorganizePreview()}>
              {(p) => (
                <p class="hint">
                  {p().songs_candidate} song(s) and {p().videos_candidate} video(s) would move to{" "}
                  {p().target_directory}.
                </p>
              )}
            </Show>

            <div class="button-row">
              <button
                class="secondary"
                onClick={runReorganize}
                disabled={
                  reorganizeRunning() ||
                  !reorganizeTargetDir().trim() ||
                  !!reorganizeTargetOverlap()
                }
              >
                {reorganizeRunning() ? "reorganizing..." : "run reorganize"}
              </button>
            </div>

            {/* live progress - updates from the shared session_id's
                  Progress events as each independent batch job finishes. */}
            <Show when={reorganizeProgress()}>
              {(p) => (
                <div class="scan-progress-card">
                  <div class="scan-progress-header">
                    <div class="spinner" />
                    <span>reorganizing...</span>
                    <Show when={p().total > 0}>
                      <span class="scan-progress-counts">
                        {p().complete} / {p().total} batches
                      </span>
                    </Show>
                  </div>
                  <Show when={p().total > 0}>
                    <div class="scan-progress-bar">
                      <div
                        class="scan-progress-bar-fill"
                        style={{ width: `${Math.round((p().complete / p().total) * 100)}%` }}
                      />
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            <Show when={!reorganizeProgress() && reorganizeSummary()}>
              {(s) => (
                <div class="scan-progress-card success">
                  moved {s().songs_moved} song(s), {s().videos_moved} video(s)
                  <Show when={s().tags_embedded > 0}> · {s().tags_embedded} tag(s) embedded</Show>
                  <Show when={s().songs_already_done + s().videos_already_done > 0}>
                    {" "}
                    · {s().songs_already_done + s().videos_already_done} already in place
                  </Show>
                  <Show when={s().errors.length > 0}> · {s().errors.length} error(s)</Show>
                </div>
              )}
            </Show>

            <Show when={reorganizeError()}>
              <p class="scan-progress error">{reorganizeError()}</p>
            </Show>
          </div>
        </details>

        {/* live job progress (driven by grimoire events / status polling) -
            stacked in one fixed-to-the-window container so repair-library
            and maintenance-tasks progress can't overlap if both happen to
            be running at once. */}
        <Show when={scanProgress() || maintenanceProgress()}>
          <div class="sticky-progress-stack">
            <Show when={scanProgress()}>
              {(p) => {
                const total = () => p().jobs_total || 0;
                const done = () => Math.max(0, total() - (p().jobs_pending || 0));
                const pct = () => (total() > 0 ? Math.round((done() / total()) * 100) : 0);
                // job 1 of this session is always the RescanDirectories
                // scan; every job after that is a RepairLibraryImages
                // batch - no per-phase label comes through the event
                // itself (see the job-events listener's doc comment),
                // but this is enough to tell the two apart without any
                // new backend plumbing.
                const phaseLabel = () =>
                  done() < 1 ? "scanning for new files..." : "backfilling missing images...";
                return (
                  <div class="scan-progress-card scan-progress-card--sticky">
                    <div class="scan-progress-header">
                      <div class="spinner" />
                      <span>{phaseLabel()}</span>
                      <span class="scan-progress-counts">
                        {done()} / {total()} jobs
                      </span>
                    </div>
                    <div class="scan-progress-bar">
                      <div class="scan-progress-bar-fill" style={{ width: `${pct()}%` }} />
                    </div>
                    <div class="scan-progress-stats">
                      {scanStageMessage() ??
                        "starting up - waiting for the first batch to report in..."}
                    </div>
                  </div>
                );
              }}
            </Show>

            <Show when={maintenanceProgress()}>
              {(p) => {
                const pct = () =>
                  p().total_steps > 0
                    ? Math.round((p().completed_steps / p().total_steps) * 100)
                    : 0;
                return (
                  <div class="scan-progress-card scan-progress-card--sticky">
                    <div class="scan-progress-header">
                      <div class="spinner" />
                      <span>running maintenance tasks...</span>
                      <span class="scan-progress-counts">
                        {p().completed_steps} / {p().total_steps} steps
                      </span>
                    </div>
                    <div class="scan-progress-bar">
                      <div class="scan-progress-bar-fill" style={{ width: `${pct()}%` }} />
                    </div>
                    <Show when={p().current_step}>
                      <div class="scan-progress-stats">running: {p().current_step}</div>
                    </Show>
                  </div>
                );
              }}
            </Show>
          </div>
        </Show>

        {/* completion summary */}
        <Show when={!scanProgress() && scanSummary()}>
          {(s) => {
            const nothingNew = () =>
              s().songs_added === 0 && s().albums_added === 0 && s().artists_added === 0;
            const noun = () => (s().domain === "video" ? "videos" : "songs");
            return (
              <div class="scan-progress-card success">
                <Show when={nothingNew()}>scan complete</Show>
                <Show when={!nothingNew()}>
                  import complete: {s().songs_added} {noun()}
                  <Show when={s().albums_added > 0}> · {s().albums_added} albums</Show>
                  <Show when={s().artists_added > 0}> · {s().artists_added} artists</Show>
                </Show>
              </div>
            );
          }}
        </Show>

        <Show when={lastResult()}>
          <p class="scan-progress">{lastResult()}</p>
        </Show>

        <Show when={lastError()}>
          <p class="scan-progress error">{lastError()}</p>
        </Show>
      </div>

      {/* add directory modal */}
      <Show when={showAddModal()}>
        <div class="modal-overlay" onClick={cancelAddDirectory}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>add scan directory</h2>
            <div class="form-group">
              <label>path</label>
              {/* always show an editable text input. local mode also
                  exposes a "browse..." button that fills the input via
                  the os file picker; user still has to press confirm.
                  remote mode exposes a "validate" button + onBlur
                  validation against the server. */}
              <input
                type="text"
                value={pendingPath()}
                placeholder={
                  admin.isRemote()
                    ? "/absolute/path/on/remote"
                    : "/absolute/path/to/music or ~/Music"
                }
                onInput={(e) => {
                  setPendingPath(e.currentTarget.value);
                  setPathValidation(null);
                }}
                onBlur={validatePendingPath}
              />
              <Show when={admin.isRemote()}>
                <p class="hint">
                  enter a path that exists on the remote server. press tab or click "validate" to
                  check.
                </p>
              </Show>
              <Show when={!admin.isRemote()}>
                <p class="hint">
                  type a path (supports `~/...`) or click "browse..." to pick one. press tab or
                  "validate" to check.
                </p>
              </Show>
              <div class="button-row">
                <button
                  class="secondary small"
                  onClick={validatePendingPath}
                  disabled={pathValidating() || !pendingPath().trim()}
                >
                  {pathValidating() ? "validating..." : "validate"}
                </button>
                <Show when={!admin.isRemote()}>
                  <button class="secondary small" onClick={browseAndFillPath}>
                    browse...
                  </button>
                </Show>
              </div>
              <Show when={pathValidation()}>
                {(v) => {
                  const ok = () => v().exists && v().is_dir && v().is_readable;
                  return (
                    <p class={ok() ? "scan-progress" : "scan-progress error"}>
                      {ok()
                        ? `✓ readable directory (${v().path})`
                        : !v().exists
                          ? `path does not exist: ${v().path}`
                          : !v().is_dir
                            ? "path is not a directory"
                            : "path is not readable"}
                    </p>
                  );
                }}
              </Show>
            </div>
            <div class="form-group">
              <label>media type</label>
              <div class="radio-toggle-group">
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="pending-domain"
                    checked={pendingDomain() === "music"}
                    onChange={() => setPendingDomain("music")}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">music</span>
                </label>
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="pending-domain"
                    checked={pendingDomain() === "video"}
                    onChange={() => setPendingDomain("video")}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">video</span>
                </label>
                <label class="radio-toggle">
                  <input
                    type="radio"
                    name="pending-domain"
                    checked={pendingDomain() === "both"}
                    onChange={() => setPendingDomain("both")}
                  />
                  <span class="radio-dot" />
                  <span class="radio-label">both</span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label>tags (optional)</label>
              <input
                type="text"
                value={pendingTags()}
                onInput={(e) => setPendingTags(e.currentTarget.value)}
                placeholder="rock, jazz, 90s"
              />
              <p class="hint">comma-separated tags to apply to all songs from this directory</p>
            </div>
            <div class="button-row">
              <button class="secondary" onClick={cancelAddDirectory}>
                cancel
              </button>
              <button
                class="primary"
                onClick={confirmAddDirectory}
                disabled={
                  admin.isRemote()
                    ? !pathValidation() ||
                      !pathValidation()!.exists ||
                      !pathValidation()!.is_dir ||
                      !pathValidation()!.is_readable
                    : // a successful server-side validation always unlocks this,
                      // even for path shapes isPathPlausible's regexes don't
                      // recognize (e.g. windows' "\\?\" extended-length prefix) -
                      // the heuristic only exists to light the button up before
                      // the user has pressed "validate".
                      !isPathPlausible(pendingPath()) &&
                      !(
                        pathValidation()?.exists &&
                        pathValidation()?.is_dir &&
                        pathValidation()?.is_readable
                      )
                }
              >
                add & scan
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* move directory modal */}
      <Show when={showMoveModal()}>
        <div class="modal-overlay" onClick={closeMoveModal}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>move scan directory</h2>
            <p class="section-desc">
              update the path for files that were moved on disk. matches files by name and size (no
              rehashing required).
            </p>

            <div class="form-group">
              <label>current path</label>
              <input type="text" value={moveOldPath()} disabled />
            </div>

            <div class="form-group">
              <label>new path</label>
              <input
                type="text"
                value={moveNewPath()}
                placeholder={
                  admin.isRemote()
                    ? "/new/absolute/path/on/remote"
                    : "/new/absolute/path or ~/NewMusicFolder"
                }
                onInput={(e) => {
                  setMoveNewPath(e.currentTarget.value);
                  setMoveNewPathValidation(null);
                  setMovePreviewResult(null);
                }}
                onBlur={validateMoveNewPath}
                disabled={moveInProgress()}
              />
              <p class="hint">enter the path where the music files are now located</p>
              <div class="button-row">
                <button
                  class="secondary small"
                  onClick={validateMoveNewPath}
                  disabled={moveNewPathValidating() || !moveNewPath().trim()}
                >
                  {moveNewPathValidating() ? "validating..." : "validate"}
                </button>
              </div>
              <Show when={moveNewPathValidation()}>
                {(v) => {
                  const ok = () => v().exists && v().is_dir && v().is_readable;
                  return (
                    <p class={ok() ? "scan-progress" : "scan-progress error"}>
                      {ok()
                        ? `✓ readable directory (${v().path})`
                        : !v().exists
                          ? `path does not exist: ${v().path}`
                          : !v().is_dir
                            ? "path is not a directory"
                            : "path is not readable"}
                    </p>
                  );
                }}
              </Show>
            </div>

            <Show when={movePreviewResult()}>
              {(result) => {
                const totalRelocated = () =>
                  result().relocated_exact_path +
                  result().relocated_parent +
                  result().relocated_filename;
                return (
                  <div class="scan-progress-card">
                    <div class="scan-progress-header">
                      <strong>preview results</strong>
                    </div>
                    <div class="scan-progress-stats">
                      <p>
                        <strong>{totalRelocated()}</strong> files will be relocated
                      </p>
                      <Show when={result().relocated_exact_path > 0}>
                        <p>· {result().relocated_exact_path} exact path matches</p>
                      </Show>
                      <Show when={result().relocated_parent > 0}>
                        <p>· {result().relocated_parent} parent+filename matches</p>
                      </Show>
                      <Show when={result().relocated_filename > 0}>
                        <p>· {result().relocated_filename} filename-only matches</p>
                      </Show>
                      <Show when={result().ambiguous_skipped > 0}>
                        <p class="scan-progress error">
                          · {result().ambiguous_skipped} ambiguous files skipped
                        </p>
                      </Show>
                      <Show when={result().new_files_unmatched > 0}>
                        <p>· {result().new_files_unmatched} new files unmatched</p>
                      </Show>
                      <Show when={result().unmatched_old_blobs > 0}>
                        <p>
                          · {result().unmatched_old_blobs} old files unmatched
                          <Show when={result().unmatched_old_blobs_soft_deleted > 0}>
                            {" "}
                            ({result().unmatched_old_blobs_soft_deleted} will be soft-deleted)
                          </Show>
                        </p>
                      </Show>
                      <Show when={result().fs_store_refresh_failures > 0}>
                        <p class="scan-progress error">
                          · {result().fs_store_refresh_failures} blob store refresh failures
                        </p>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Show>

            <Show when={moveError()}>
              <p class="scan-progress error">{moveError()}</p>
            </Show>

            <div class="button-row">
              <button class="secondary" onClick={closeMoveModal} disabled={moveInProgress()}>
                cancel
              </button>
              <button
                class="secondary"
                onClick={previewMove}
                disabled={
                  moveInProgress() ||
                  !moveNewPath().trim() ||
                  !moveNewPathValidation() ||
                  !moveNewPathValidation()!.exists ||
                  !moveNewPathValidation()!.is_dir ||
                  !moveNewPathValidation()!.is_readable
                }
              >
                {moveInProgress() ? "previewing..." : "preview"}
              </button>
              <button
                class="primary"
                onClick={confirmMove}
                disabled={
                  moveInProgress() ||
                  !moveNewPathValidation() ||
                  !moveNewPathValidation()!.exists ||
                  !moveNewPathValidation()!.is_dir ||
                  !moveNewPathValidation()!.is_readable
                }
              >
                {moveInProgress() ? "moving..." : "confirm move"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
