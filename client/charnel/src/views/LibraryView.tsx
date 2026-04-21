import { createSignal, createEffect, on, onMount, For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
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

export default function LibraryView() {
  const admin = useAdminTransport();
  const [directories, setDirectories] = createSignal<ScannedDir[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [pendingPath, setPendingPath] = createSignal("");
  const [pendingTags, setPendingTags] = createSignal("");
  // remote-mode: user types the path manually; we validate before scan
  const [pendingPathEditable, setPendingPathEditable] = createSignal(false);
  const [pathValidating, setPathValidating] = createSignal(false);
  const [pathValidation, setPathValidation] =
    createSignal<ValidatePathResult | null>(null);
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal<string | null>(null);
  const [lastResult, setLastResult] = createSignal("");

  onMount(async () => {
    await loadDirectories();
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
      const dirs = admin.isRemote()
        ? await admin.dispatchOrThrow<ScannedDir[]>(
            "library_list_directories",
            {},
          )
        : await invoke<ScannedDir[]>("list_scanned_directories");
      setDirectories(dirs);
    } catch (e) {
      console.error("failed to load directories:", e);
    } finally {
      setLoading(false);
    }
  }

  async function browseDirectory() {
    if (admin.isRemote()) {
      // remote mode: open the modal with an editable path field; the user
      // types a server-side absolute path and we validate via
      // library_validate_path before scanning.
      setPendingPath("");
      setPendingTags("");
      setPendingPathEditable(true);
      setPathValidation(null);
      setShowAddModal(true);
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose music directory to scan",
      });
      if (selected) {
        setPendingPath(await resolvePath(selected as string));
        setPendingTags("");
        setPendingPathEditable(false);
        setPathValidation(null);
        setShowAddModal(true);
      }
    } catch (e) {
      console.error("browse error:", e);
    }
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

    // for remote, require a successful validation pass first
    if (admin.isRemote()) {
      const v = pathValidation();
      if (!v || !v.exists || !v.is_dir || !v.is_readable) {
        setLastResult("path is not a readable directory on the remote");
        return;
      }
    }

    const tags = pendingTags()
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
    setPathValidation(null);

    // scan the directory (which also records it in the database)
    await scanDirectory(path, tags);
  }

  function cancelAddDirectory() {
    setShowAddModal(false);
    setPendingPath("");
    setPendingTags("");
    setPathValidation(null);
  }

  async function removeDirectory(path: string) {
    try {
      if (admin.isRemote()) {
        await admin.dispatchOrThrow("library_remove_directory", { path });
      } else {
        await invoke("remove_scanned_directory", { path });
      }
      await loadDirectories();
    } catch (e) {
      console.error("failed to remove directory:", e);
    }
    setConfirmRemove(null);
  }

  async function scanDirectory(path: string, tags: string[]) {
    setScanning(path);
    setLastResult("");

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
      setLastResult(`error: ${e}`);
    } finally {
      setScanning(null);
    }
  }

  async function rescanAll() {
    setScanning("__all__");
    setLastResult("");

    try {
      const result = admin.isRemote()
        ? await admin.dispatchOrThrow<ScanResult>("library_rescan_all", {})
        : await invoke<ScanResult>("rescan_directories");
      setLastResult(result.message);
      // reload directories to show updated file count
      await loadDirectories();
    } catch (e) {
      setLastResult(`error: ${e}`);
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
            >
              {scanning() === "__all__" ? "rescanning..." : "rescan all"}
            </button>
          </Show>
        </div>

        <Show when={directories().length > 0}>
          <p class="hint">
            "scan" finds new files. "rescan all" also finds deleted files.
          </p>
        </Show>

        <Show when={lastResult()}>
          <p class="scan-progress">{lastResult()}</p>
        </Show>
      </div>

      {/* add directory modal */}
      <Show when={showAddModal()}>
        <div class="modal-overlay" onClick={cancelAddDirectory}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>add scan directory</h2>
            <div class="form-group">
              <label>path</label>
              <Show when={pendingPathEditable()}>
                <input
                  type="text"
                  value={pendingPath()}
                  placeholder="/absolute/path/on/remote"
                  onInput={(e) => {
                    setPendingPath(e.currentTarget.value);
                    setPathValidation(null);
                  }}
                  onBlur={validatePendingPath}
                />
                <p class="hint">
                  enter a path that exists on the remote server. press tab or
                  click "validate" to check.
                </p>
                <div class="button-row">
                  <button
                    class="secondary small"
                    onClick={validatePendingPath}
                    disabled={pathValidating() || !pendingPath().trim()}
                  >
                    {pathValidating() ? "validating..." : "validate"}
                  </button>
                </div>
                <Show when={pathValidation()}>
                  {(v) => {
                    const ok = () =>
                      v().exists && v().is_dir && v().is_readable;
                    return (
                      <p class={ok() ? "scan-progress" : "scan-progress error"}>
                        {ok()
                          ? "✓ readable directory"
                          : !v().exists
                            ? "path does not exist on remote"
                            : !v().is_dir
                              ? "path is not a directory"
                              : "path is not readable"}
                      </p>
                    );
                  }}
                </Show>
              </Show>
              <Show when={!pendingPathEditable()}>
                <input type="text" value={pendingPath()} readOnly />
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
                  pendingPathEditable() &&
                  (!pathValidation() ||
                    !pathValidation()!.exists ||
                    !pathValidation()!.is_dir ||
                    !pathValidation()!.is_readable)
                }
              >
                add & scan
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
