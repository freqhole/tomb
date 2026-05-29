import {
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolvePath } from "../util/resolvePath";
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

// progress payload mirrors GrimoireEvent::JobProgress emitted by the
// runner and forwarded through charnel's grimoire-event subscription
// (see client/charnel/src-tauri/src/lib.rs ~line 513).
interface JobProgressPayload {
  session_id: string;
  directory?: string;
  songs_added: number;
  jobs_pending: number;
  jobs_total: number;
}

interface JobSessionCompletePayload {
  session_id: string;
  songs_added: number;
  albums_added: number;
  artists_added: number;
}

type FreqholeEvent =
  | { type: "job-progress"; data: JobProgressPayload }
  | { type: "job-session-complete"; data: JobSessionCompletePayload }
  | { type: string; data: unknown };

export default function LibraryView() {
  const admin = useAdminTransport();
  const [directories, setDirectories] = createSignal<ScannedDir[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [pendingPath, setPendingPath] = createSignal("");
  const [pendingTags, setPendingTags] = createSignal("");
  const [pathValidating, setPathValidating] = createSignal(false);
  const [pathValidation, setPathValidation] =
    createSignal<ValidatePathResult | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal<string | null>(null);
  const [lastResult, setLastResult] = createSignal("");
  const [lastError, setLastError] = createSignal("");
  // live progress fed by grimoire JobProgress events forwarded through
  // charnel's grimoire event subscription (no polling required).
  const [scanProgress, setScanProgress] =
    createSignal<JobProgressPayload | null>(null);
  const [scanSummary, setScanSummary] =
    createSignal<JobSessionCompletePayload | null>(null);
  // move directory modal state
  const [showMoveModal, setShowMoveModal] = createSignal(false);
  const [moveOldPath, setMoveOldPath] = createSignal("");
  const [moveNewPath, setMoveNewPath] = createSignal("");
  const [moveNewPathValidation, setMoveNewPathValidation] =
    createSignal<ValidatePathResult | null>(null);
  const [moveNewPathValidating, setMoveNewPathValidating] = createSignal(false);
  const [movePreviewResult, setMovePreviewResult] =
    createSignal<MoveScanDirectoryResult | null>(null);
  const [moveInProgress, setMoveInProgress] = createSignal(false);
  const [moveError, setMoveError] = createSignal("");

  let unlistenScan: (() => void) | null = null;

  onMount(async () => {
    await loadDirectories();
    // listen for job progress / completion events emitted by grimoire and
    // forwarded by charnel as freqhole:event. these fire for any active
    // ProcessFile session, so they cover both new scans and rescans.
    try {
      unlistenScan = await listen<FreqholeEvent>("freqhole:event", (event) => {
        if (event.payload.type === "job-progress") {
          const data = event.payload.data as JobProgressPayload;
          setScanProgress(data);
          setScanSummary(null);
        } else if (event.payload.type === "job-session-complete") {
          const summary = event.payload.data as JobSessionCompletePayload;
          setScanSummary(summary);
          setScanProgress(null);
          // refresh directory file counts after scan completes
          void loadDirectories();
        }
      });
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
      const dirs = await admin.dispatchOrThrow<ScannedDir[]>(
        "library_list_directories",
        {},
      );
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
    // absolute unix path, home-relative, or windows drive letter
    return (
      trimmed.startsWith("/") ||
      trimmed.startsWith("~") ||
      /^[a-zA-Z]:[\\/]/.test(trimmed)
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
      const result = await admin.dispatchOrThrow<ValidatePathResult>(
        "library_validate_path",
        { path },
      );
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

    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
    setPathValidation(null);

    // scan the directory (which also records it in the database)
    await scanDirectory(resolvedPath, tags);
  }

  function cancelAddDirectory() {
    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
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
      const result = await admin.dispatchOrThrow<ValidatePathResult>(
        "library_validate_path",
        { path },
      );
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
        `moved directory: ${result.relocated_exact_path + result.relocated_parent + result.relocated_filename} files relocated`,
      );
    } catch (e) {
      setMoveError(`move failed: ${e}`);
      console.error("move failed:", e);
    } finally {
      setMoveInProgress(false);
    }
  }

  async function scanDirectory(path: string, tags: string[]) {
    setScanning(path);
    setLastResult("");
    setLastError("");
    setScanProgress(null);
    setScanSummary(null);

    // for local scans, validate the path first so a bad path produces a
    // clear error instead of a cryptic backend failure.
    if (!admin.isRemote()) {
      try {
        const v = await admin.dispatchOrThrow<ValidatePathResult>(
          "library_validate_path",
          { path },
        );
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
            recursive: true,
          })
        : await invoke<ScanResult>("scan_directory", { path, tags });
      setLastResult(result.message);
      // reload directories to show updated file count
      await loadDirectories();
    } catch (e) {
      setLastError(`scan failed: ${e}`);
    } finally {
      setScanning(null);
    }
  }

  async function rescanAll() {
    setScanning("__all__");
    setLastResult("");
    setLastError("");
    setScanProgress(null);
    setScanSummary(null);

    try {
      // local: invoke the tauri command so the polling task fires
      // scan-progress/scan-complete events for the spume webview.
      // remote: just dispatch — no spume side to notify.
      const result = admin.isRemote()
        ? await admin.dispatchOrThrow<ScanResult>("library_rescan_all", {})
        : await invoke<ScanResult>("rescan_directories");
      setLastResult(result.message);
      // reload directories to show updated file count
      await loadDirectories();
    } catch (e) {
      setLastError(`rescan failed: ${e}`);
    } finally {
      setScanning(null);
    }
  }

  return (
    <div class="view-content">
      <div class="view-header">
        <h1>music library</h1>
      </div>

      <div class="section">
        <p class="section-desc">
          add folders containing music. freqhole will scan each directory and
          import music.
        </p>

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
                    <span class="directory-path">{dir.path}</span>
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
                      <button
                        class="danger small"
                        onClick={() => removeDirectory(dir.path)}
                      >
                        confirm
                      </button>
                      <button
                        class="secondary small"
                        onClick={() => setConfirmRemove(null)}
                      >
                        cancel
                      </button>
                    </Show>
                    <Show when={confirmRemove() !== dir.path}>
                      <button
                        class="secondary small"
                        onClick={() => setConfirmRemove(dir.path)}
                      >
                        remove
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="button-row">
          <button class="secondary" onClick={browseDirectory}>
            add directory
          </button>
          <Show when={directories().length > 0}>
            <button
              class="secondary"
              onClick={rescanAll}
              disabled={scanning() !== null}
              title="re-scan every tracked directory: import new music, restore songs whose files came back, soft-delete songs whose files are gone, purge scan dirs that no longer exist"
            >
              {scanning() === "__all__" ? "repairing..." : "repair library"}
            </button>
          </Show>
        </div>

        <Show when={directories().length > 0}>
          <p class="hint">
            "scan" finds new files in one directory. "repair library" walks
            every tracked directory: imports new music, relocates moved files,
            restores songs whose files came back, and soft-deletes songs whose
            files are gone.
          </p>
        </Show>

        {/* live job progress (driven by grimoire events) */}
        <Show when={scanProgress()}>
          {(p) => {
            const total = () => p().jobs_total || 0;
            const done = () => Math.max(0, total() - (p().jobs_pending || 0));
            const pct = () =>
              total() > 0 ? Math.round((done() / total()) * 100) : 0;
            return (
              <div class="scan-progress-card">
                <div class="scan-progress-header">
                  <div class="spinner" />
                  <span>importing music...</span>
                  <span class="scan-progress-counts">
                    {done()} / {total()} jobs
                  </span>
                </div>
                <div class="scan-progress-bar">
                  <div
                    class="scan-progress-bar-fill"
                    style={{ width: `${pct()}%` }}
                  />
                </div>
                <Show when={p().directory}>
                  <div class="scan-progress-stats">{p().directory}</div>
                </Show>
                <div class="scan-progress-stats">
                  {p().songs_added} processed
                </div>
              </div>
            );
          }}
        </Show>

        {/* completion summary */}
        <Show when={!scanProgress() && scanSummary()}>
          {(s) => {
            const nothingNew = () =>
              s().songs_added === 0 &&
              s().albums_added === 0 &&
              s().artists_added === 0;
            return (
              <div class="scan-progress-card success">
                <Show when={nothingNew()}>scan complete</Show>
                <Show when={!nothingNew()}>
                  import complete: {s().songs_added} songs
                  <Show when={s().albums_added > 0}>
                    {" "}
                    · {s().albums_added} albums
                  </Show>
                  <Show when={s().artists_added > 0}>
                    {" "}
                    · {s().artists_added} artists
                  </Show>
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
                  enter a path that exists on the remote server. press tab or
                  click "validate" to check.
                </p>
              </Show>
              <Show when={!admin.isRemote()}>
                <p class="hint">
                  type a path (supports `~/...`) or click "browse..." to pick
                  one. press tab or "validate" to check.
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
              <label>tags (optional)</label>
              <input
                type="text"
                value={pendingTags()}
                onInput={(e) => setPendingTags(e.currentTarget.value)}
                placeholder="rock, jazz, 90s"
              />
              <p class="hint">
                comma-separated tags to apply to all songs from this directory
              </p>
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
                    : !isPathPlausible(pendingPath())
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
              update the path for files that were moved on disk. matches files
              by name and size (no rehashing required).
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
              <p class="hint">
                enter the path where the music files are now located
              </p>
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
                        <strong>{totalRelocated()}</strong> files will be
                        relocated
                      </p>
                      <Show when={result().relocated_exact_path > 0}>
                        <p>
                          · {result().relocated_exact_path} exact path matches
                        </p>
                      </Show>
                      <Show when={result().relocated_parent > 0}>
                        <p>
                          · {result().relocated_parent} parent+filename matches
                        </p>
                      </Show>
                      <Show when={result().relocated_filename > 0}>
                        <p>
                          · {result().relocated_filename} filename-only matches
                        </p>
                      </Show>
                      <Show when={result().ambiguous_skipped > 0}>
                        <p class="scan-progress error">
                          · {result().ambiguous_skipped} ambiguous files skipped
                        </p>
                      </Show>
                      <Show when={result().new_files_unmatched > 0}>
                        <p>
                          · {result().new_files_unmatched} new files unmatched
                        </p>
                      </Show>
                      <Show when={result().unmatched_old_blobs > 0}>
                        <p>
                          · {result().unmatched_old_blobs} old files unmatched
                          <Show
                            when={result().unmatched_old_blobs_soft_deleted > 0}
                          >
                            {" "}
                            ({result().unmatched_old_blobs_soft_deleted} will be
                            soft-deleted)
                          </Show>
                        </p>
                      </Show>
                      <Show when={result().fs_store_refresh_failures > 0}>
                        <p class="scan-progress error">
                          · {result().fs_store_refresh_failures} blob store
                          refresh failures
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
              <button
                class="secondary"
                onClick={closeMoveModal}
                disabled={moveInProgress()}
              >
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
