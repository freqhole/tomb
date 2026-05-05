import { createSignal, Show, onMount, onCleanup, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@solidjs/router";
import { resolvePath } from "../util/resolvePath";
import { listen } from "@tauri-apps/api/event";

// step flow: welcome → config → running → admin → music → done
type SetupStep = "welcome" | "config" | "running" | "admin" | "music" | "done";

interface DependencyCheckResult {
  ffmpeg_path: string | null;
  ffmpeg_installed: boolean;
  ffprobe_path: string | null;
  ffprobe_installed: boolean;
  ytdlp_path: string | null;
  ytdlp_installed: boolean;
  can_proceed: boolean;
}

interface SetupResult {
  success: boolean;
  config_path: string;
  data_dir: string;
  root_user_id: string | null;
  root_username: string | null;
  admin_user_id: string | null;
  admin_username: string | null;
  invite_code: string | null;
  errors: string[];
}

interface CreateAdminResult {
  success: boolean;
  user_id: string | null;
  username: string | null;
  error: string | null;
}

interface ScanResult {
  success: boolean;
  jobs_created: number;
  message: string;
}

interface MusicDir {
  path: string;
  tags: string[];
  scanned: boolean;
}

interface SetupStatus {
  needs_setup: boolean;
  config_exists: boolean;
  has_root_user: boolean;
  config_path: string | null;
  data_dir: string | null;
}

export default function SetupView() {
  const navigate = useNavigate();
  const [step, setStep] = createSignal<SetupStep>("welcome");
  // appDataDir is fixed - where config lives (system app data dir)
  const [appDataDir, setAppDataDir] = createSignal("");
  // dataDir is customizable - where database/cache/media live (defaults to appDataDir)
  const [dataDir, setDataDir] = createSignal("");
  // fetchMusicDir is where fetched/uploaded music filez are stored
  const [fetchMusicDir, setFetchMusicDir] = createSignal("");
  const [serverName, setServerName] = createSignal("my music server");
  const [serverImage, setServerImage] = createSignal<string | null>(null);
  const [username, setUsername] = createSignal("");
  // setup results
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  // music step state
  const [musicDirs, setMusicDirs] = createSignal<MusicDir[]>([]);
  const [scanning, setScanning] = createSignal(false);
  // advanced config toggle
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  // dependency check state
  const [depCheck, setDepCheck] = createSignal<DependencyCheckResult | null>(
    null,
  );
  const [depCheckLoading, setDepCheckLoading] = createSignal(true);
  // federation options
  const [federationEnabled, setFederationEnabled] = createSignal(false);
  const [knockingEnabled, setKnockingEnabled] = createSignal(true);
  // job progress state for done step
  const [jobProgress, setJobProgress] = createSignal<{
    directory: string;
    songsAdded: number;
    jobsPending: number;
    jobsTotal: number;
  } | null>(null);
  const [jobsComplete, setJobsComplete] = createSignal(false);
  // cleanup function for event listener
  let unlistenProgress: (() => void) | null = null;

  onMount(async () => {
    try {
      // check external dependencies (ffmpeg, yt-dlp)
      const deps = await invoke<DependencyCheckResult>("check_dependencies");
      setDepCheck(deps);
      setDepCheckLoading(false);

      // get default data directory (system app data dir)
      const dir = await invoke<string | null>("get_default_data_dir");
      setAppDataDir(dir || "");
      setDataDir(dir || ""); // default data dir to same location
      // default fetch music dir to data_dir/fetch
      if (dir) {
        setFetchMusicDir(`${dir}/fetch`);
      }

      // get os username for default
      const osUser = await invoke<string>("get_os_username");
      setUsername(osUser);

      // check if already set up
      const status = await invoke<SetupStatus>("check_setup_status");
      if (!status.needs_setup) {
        // setup is complete, redirect to logs
        navigate("/logs", { replace: true });
        return;
      }

      // listen for job progress events
      unlistenProgress = await listen<{
        type: string;
        data: {
          session_id: string;
          directory: string;
          songs_added: number;
          jobs_pending: number;
          jobs_total: number;
        };
      }>("freqhole:event", (event) => {
        if (event.payload.type === "job-progress") {
          setJobProgress({
            directory: event.payload.data.directory,
            songsAdded: event.payload.data.songs_added,
            jobsPending: event.payload.data.jobs_pending,
            jobsTotal: event.payload.data.jobs_total,
          });
        } else if (event.payload.type === "job-session-complete") {
          setJobsComplete(true);
        }
      });
    } catch (e) {
      console.error("init error:", e);
      setDepCheckLoading(false);
    }
  });

  onCleanup(() => {
    if (unlistenProgress) {
      unlistenProgress();
    }
  });

  async function browseDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose data directory",
        defaultPath: dataDir() || appDataDir() || undefined,
      });
      if (selected) {
        setDataDir(await resolvePath(selected as string));
      }
    } catch (e) {
      console.error("browse error:", e);
    }
  }

  async function browseFetchMusicDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose music storage directory",
        defaultPath: fetchMusicDir() || dataDir() || undefined,
      });
      if (selected) {
        setFetchMusicDir(await resolvePath(selected as string));
      }
    } catch (e) {
      console.error("browse fetch music dir error:", e);
    }
  }

  async function browseImage() {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "choose server icon image",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (selected) {
        setServerImage(await resolvePath(selected as string));
      }
    } catch (e) {
      console.error("browse image error:", e);
    }
  }

  // core setup - creates config, database, and root user (no admin)
  async function runSetup() {
    setLoading(true);
    setError("");
    setStep("running");

    try {
      const configPath = `${dataDir()}/freqhole-config.toml`;

      const result = await invoke<SetupResult>("run_setup_core", {
        configPath,
        dataDir: dataDir(),
        serverName: serverName(),
        serverPort: 8081,
        imagePath: serverImage(),
        fetchMusicDir: fetchMusicDir() || null,
        federationEnabled: federationEnabled(),
        knockingEnabled: knockingEnabled(),
      });

      if (result.success) {
        // core setup done, now go to admin user step
        setStep("admin");
      } else {
        const errorMsg = result.errors.join("; ") || "setup failed";
        throw new Error(errorMsg);
      }
    } catch (e) {
      setError(String(e));
      // go back to config step on error so user can retry
      setStep("config");
    } finally {
      setLoading(false);
    }
  }

  // create admin user
  async function createAdmin() {
    setLoading(true);
    setError("");

    try {
      const result = await invoke<CreateAdminResult>("create_admin_user", {
        username: username() || "admin",
      });

      if (result.success) {
        setStep("music");
      } else {
        throw new Error(result.error || "failed to create admin user");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addMusicDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose music directory",
      });
      if (selected) {
        const resolved = await resolvePath(selected as string);
        setMusicDirs([
          ...musicDirs(),
          { path: resolved, tags: [], scanned: false },
        ]);
      }
    } catch (e) {
      console.error("browse error:", e);
    }
  }

  function removeMusicDir(path: string) {
    setMusicDirs(musicDirs().filter((d) => d.path !== path));
  }

  function updateMusicDirTags(path: string, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    setMusicDirs(
      musicDirs().map((d) => (d.path === path ? { ...d, tags } : d)),
    );
  }

  function updateMusicDirPath(oldPath: string, newPath: string) {
    const trimmed = newPath.trim();
    if (!trimmed || trimmed === oldPath) return;
    setMusicDirs(
      musicDirs().map((d) =>
        d.path === oldPath ? { ...d, path: trimmed } : d,
      ),
    );
  }

  async function scanMusicDirs() {
    setScanning(true);
    setError("");

    try {
      for (const dir of musicDirs()) {
        if (!dir.scanned) {
          await invoke<ScanResult>("scan_directory", {
            path: dir.path,
            tags: dir.tags,
          });
          setMusicDirs(
            musicDirs().map((d) =>
              d.path === dir.path ? { ...d, scanned: true } : d,
            ),
          );
        }
      }
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }

  async function finishSetup() {
    try {
      // generate remote slug from server name (matches spume's remoteManager.ts generateSlug)
      const remoteSlug = serverName()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      // close wizard and open main window at /{remoteSlug}/songs route
      const configPath = `${dataDir()}/freqhole-config.toml`;
      await invoke("close_setup_wizard", {
        configPath,
        route: `/${remoteSlug}/songs`,
      });
    } catch (e) {
      console.error("finish error:", e);
    }
  }

  function skipMusicStep() {
    setStep("done");
  }

  return (
    <div class="view-content">
      {/* welcome */}
      <Show when={step() === "welcome"}>
        <div class="step">
          <h1>welcome to freqhole</h1>

          <p style={{ "margin-bottom": "1rem", color: "#a1a1aa" }}>
            this wizard will help you:
          </p>
          <ul class="list">
            <li>configure freqhole</li>
            <li>set up a new database</li>
            <li>create a local admin account</li>
            <li>import some music</li>
          </ul>

          {/* dependency check section */}
          <div
            style={{
              "margin-top": "1.5rem",
              padding: "1rem",
              background: "#27272a",
              "border-radius": "0.5rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.75rem 0",
                "font-size": "0.9rem",
                color: "#a1a1aa",
              }}
            >
              system requirements
            </h3>

            <Show when={depCheckLoading()}>
              <p style={{ color: "#71717a", "font-size": "0.875rem" }}>
                checking dependencies...
              </p>
            </Show>

            <Show when={!depCheckLoading() && depCheck()}>
              <div style={{ "font-size": "0.875rem" }}>
                {/* ffmpeg status */}
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "0.5rem",
                    "margin-bottom": "0.5rem",
                  }}
                >
                  <span
                    style={{
                      color: depCheck()!.ffmpeg_installed
                        ? "#4ade80"
                        : "#f87171",
                    }}
                  >
                    {depCheck()!.ffmpeg_installed ? "✓" : "✕"}
                  </span>
                  <span>ffmpeg</span>
                  <Show when={depCheck()!.ffmpeg_installed}>
                    <span style={{ color: "#71717a", "font-size": "0.75rem" }}>
                      ({depCheck()!.ffmpeg_path})
                    </span>
                  </Show>
                  <Show when={!depCheck()!.ffmpeg_installed}>
                    <span style={{ color: "#f87171" }}>(required)</span>
                  </Show>
                </div>

                {/* yt-dlp status */}
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      color: depCheck()!.ytdlp_installed
                        ? "#4ade80"
                        : "#fbbf24",
                    }}
                  >
                    {depCheck()!.ytdlp_installed ? "✓" : "○"}
                  </span>
                  <span>yt-dlp</span>
                  <Show when={depCheck()!.ytdlp_installed}>
                    <span style={{ color: "#71717a", "font-size": "0.75rem" }}>
                      ({depCheck()!.ytdlp_path})
                    </span>
                  </Show>
                  <Show when={!depCheck()!.ytdlp_installed}>
                    <span style={{ color: "#fbbf24" }}>(optional)</span>
                  </Show>
                </div>

                {/* info if ffmpeg missing */}
                <Show when={!depCheck()!.ffmpeg_installed}>
                  <div
                    style={{
                      "margin-top": "1rem",
                      padding: "0.75rem",
                      background: "#422006",
                      "border-radius": "0.375rem",
                      color: "#fef3c7",
                    }}
                  >
                    <strong>ffmpeg not found</strong>
                    <p
                      style={{
                        margin: "0.5rem 0 0 0",
                        "font-size": "0.8125rem",
                      }}
                    >
                      audio transcoding requires ffmpeg. on macOS:{" "}
                      <code>brew install ffmpeg</code>
                    </p>
                  </div>
                </Show>

                {/* info if yt-dlp missing */}
                <Show when={!depCheck()!.ytdlp_installed}>
                  <div
                    style={{
                      "margin-top": "1rem",
                      padding: "0.75rem",
                      background: "#422006",
                      "border-radius": "0.375rem",
                      color: "#fef3c7",
                    }}
                  >
                    <strong>yt-dlp not found</strong>
                    <p
                      style={{
                        margin: "0.5rem 0 0 0",
                        "font-size": "0.8125rem",
                      }}
                    >
                      URL downloading requires yt-dlp.{" "}
                      <a
                        href="https://github.com/yt-dlp/yt-dlp/wiki/Installation"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        see yt-dlp installation docs for more info.
                      </a>
                    </p>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          <div class="button-row">
            <button
              class="primary"
              onClick={() => setStep("config")}
              disabled={depCheckLoading()}
            >
              get started
            </button>
          </div>
        </div>
      </Show>

      {/* config */}
      <Show when={step() === "config"}>
        <div class="step">
          <h1>server configuration</h1>
          <p class="subtitle">configure your freqhole server.</p>

          <div class="form-group">
            <label for="server-name">server name</label>
            <input
              type="text"
              id="server-name"
              value={serverName()}
              onInput={(e) => setServerName(e.currentTarget.value)}
              placeholder="my music server"
            />
            <p class="hint">a friendly name for your server.</p>
          </div>

          <div class="form-group">
            <label for="server-image">server icon (optional)</label>
            <div class="input-with-button">
              <input
                type="text"
                id="server-image"
                value={serverImage() || ""}
                onInput={(e) => setServerImage(e.currentTarget.value || null)}
                placeholder="no icon selected"
                readOnly
              />
              <button type="button" class="browse-btn" onClick={browseImage}>
                browse
              </button>
              <Show when={serverImage()}>
                <button
                  type="button"
                  class="browse-btn"
                  onClick={() => setServerImage(null)}
                  title="clear"
                >
                  ✕
                </button>
              </Show>
            </div>
            <p class="hint">
              displayed in remote clients to identify your server.
            </p>
          </div>

          <div class="form-group">
            <label for="fetch-music-dir">fetched music storage directory</label>
            <div class="input-with-button">
              <input
                type="text"
                id="fetch-music-dir"
                value={fetchMusicDir()}
                onInput={(e) => setFetchMusicDir(e.currentTarget.value)}
                placeholder="/path/to/music"
              />
              <button
                type="button"
                class="browse-btn"
                onClick={browseFetchMusicDir}
              >
                browse
              </button>
            </div>
            <p class="hint">where fetched music filez are stored.</p>
          </div>

          {/* federation options */}
          <div class="form-group">
            <label class="checkbox-toggle">
              <input
                type="checkbox"
                checked={federationEnabled()}
                onChange={(e) => setFederationEnabled(e.currentTarget.checked)}
              />
              <span class="checkbox-box">
                <svg viewBox="0 0 14 14">
                  <polyline points="2.5 7 5.5 10 11.5 4" />
                </svg>
              </span>
              <span class="checkbox-content">
                <span class="checkbox-label">enable P2P federation</span>
                <span class="checkbox-hint">
                  connect with other freqhole servers over encrypted P2P
                  network.
                </span>
              </span>
            </label>
          </div>

          <Show when={federationEnabled()}>
            <div class="form-group" style={{ "margin-left": "1.5rem" }}>
              <label class="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={knockingEnabled()}
                  onChange={(e) => setKnockingEnabled(e.currentTarget.checked)}
                />
                <span class="checkbox-box">
                  <svg viewBox="0 0 14 14">
                    <polyline points="2.5 7 5.5 10 11.5 4" />
                  </svg>
                </span>
                <span class="checkbox-content">
                  <span class="checkbox-label">
                    allow unknown peers to knock
                  </span>
                  <span class="checkbox-hint">
                    let unknown users request access to your server. you can
                    approve/reject them later.
                  </span>
                </span>
              </label>
            </div>
          </Show>

          {/* advanced toggle */}
          <button
            type="button"
            class="advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced())}
          >
            {showAdvanced() ? "▼" : "▶"} advanced options
          </button>

          <Show when={showAdvanced()}>
            <div class="advanced-options">
              <div class="form-group">
                <label for="data-dir">data directory</label>
                <div class="input-with-button">
                  <input
                    type="text"
                    id="data-dir"
                    value={dataDir()}
                    onInput={(e) => setDataDir(e.currentTarget.value)}
                    placeholder="/path/to/freqhole/data"
                  />
                  <button type="button" class="browse-btn" onClick={browseDir}>
                    browse
                  </button>
                </div>
                <p class="hint">
                  where database, cache, config, and miscellaneous filez are
                  stored.
                </p>
              </div>
            </div>
          </Show>

          <div class="button-row">
            <button class="secondary" onClick={() => setStep("welcome")}>
              back
            </button>
            <button
              class="primary"
              onClick={runSetup}
              disabled={loading() || !dataDir() || !serverName()}
            >
              {loading() ? "setting up..." : "run setup"}
            </button>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </div>
      </Show>

      {/* running setup */}
      <Show when={step() === "running"}>
        <div class="step">
          <h1>setting up</h1>
          <p class="subtitle">initializing your freqhole instance...</p>

          <div class="loading">
            <div class="spinner" />
            <span>creating config and database...</span>
          </div>
        </div>
      </Show>

      {/* admin user */}
      <Show when={step() === "admin"}>
        <div class="step">
          <h1>create admin account</h1>
          <p class="subtitle">
            create an administrator account to manage your server.
          </p>

          <div class="form-group">
            <label for="username">admin username</label>
            <input
              type="text"
              id="username"
              placeholder="admin"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
            <p class="hint">
              choose a username for your admin account. this account will have
              full access to manage your server.
            </p>
          </div>

          <div class="button-row">
            <button class="primary" onClick={createAdmin} disabled={loading()}>
              {loading() ? "creating..." : "create admin"}
            </button>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </div>
      </Show>

      {/* music */}
      <Show when={step() === "music"}>
        <div class="step">
          <h1>add your music</h1>
          <p class="subtitle">
            optionally add directories to scan for music filez.
          </p>

          <div class="directory-list" style={{ margin: "1.5rem 0" }}>
            <Show when={musicDirs().length === 0}>
              <p class="empty">no directories added yet</p>
            </Show>
            <For each={musicDirs()}>
              {(dir) => (
                <div class="directory-item">
                  <div class="directory-info">
                    <input
                      type="text"
                      class="directory-path-input"
                      value={dir.path}
                      onBlur={(e) =>
                        updateMusicDirPath(dir.path, e.currentTarget.value)
                      }
                      disabled={dir.scanned}
                    />
                    <Show when={dir.scanned}>
                      <span class="directory-meta">queued for scan</span>
                    </Show>
                    <div class="tag-input-row">
                      <input
                        type="text"
                        class="tag-input"
                        placeholder="optional tags (comma-separated)"
                        value={dir.tags.join(", ")}
                        onBlur={(e) =>
                          updateMusicDirTags(dir.path, e.currentTarget.value)
                        }
                        disabled={dir.scanned}
                      />
                    </div>
                  </div>
                  <button
                    class="secondary small"
                    onClick={() => removeMusicDir(dir.path)}
                  >
                    remove
                  </button>
                </div>
              )}
            </For>
          </div>

          <div class="button-row">
            <button class="secondary" onClick={addMusicDir}>
              add directory
            </button>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>

          <div class="button-row" style={{ "margin-top": "2rem" }}>
            <button class="secondary" onClick={skipMusicStep}>
              skip for now
            </button>
            <button
              class="primary"
              onClick={scanMusicDirs}
              disabled={scanning() || musicDirs().length === 0}
            >
              {scanning() ? "scanning..." : "scan & continue"}
            </button>
          </div>
        </div>
      </Show>

      {/* done */}
      <Show when={step() === "done"}>
        <div class="step" style={{ "text-align": "center" }}>
          <div class="success-icon">✓</div>
          <h1>all set!</h1>
          <p class="subtitle">your freqhole server is ready to go.</p>

          {/* job progress display */}
          <Show when={jobProgress() && !jobsComplete()}>
            <div
              class="job-progress"
              style={{
                background: "rgba(236, 72, 153, 0.1)",
                border: "1px solid rgba(236, 72, 153, 0.3)",
                "border-radius": "8px",
                padding: "1rem",
                "margin-bottom": "1.5rem",
                "text-align": "left",
              }}
            >
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "0.5rem",
                  "margin-bottom": "0.5rem",
                }}
              >
                <span class="spinner" />
                <span style={{ color: "#ec4899", "font-weight": "500" }}>
                  importing music
                  <span class="dots-animation" />
                </span>
              </div>
              <div style={{ color: "#a1a1aa", "font-size": "0.875rem" }}>
                <Show when={jobProgress()?.directory}>
                  <div style={{ "margin-bottom": "0.25rem" }}>
                    {jobProgress()?.directory}
                  </div>
                </Show>
                <div>
                  {jobProgress()?.songsAdded} songs added •{" "}
                  {jobProgress()?.jobsPending} of {jobProgress()?.jobsTotal}{" "}
                  remaining
                </div>
              </div>
            </div>
          </Show>

          <Show when={jobsComplete()}>
            <div
              style={{
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                "border-radius": "8px",
                padding: "1rem",
                "margin-bottom": "1.5rem",
                color: "#22c55e",
              }}
            >
              import complete! {jobProgress()?.songsAdded} songs added.
            </div>
          </Show>

          <Show when={!jobProgress() && !jobsComplete()}>
            <p style={{ color: "#a1a1aa", "margin-bottom": "1.5rem" }}>
              the server will start automatically. you can control it from the
              menu bar icon.
            </p>
          </Show>

          <div class="button-row" style={{ "justify-content": "center" }}>
            <button class="primary" onClick={finishSetup}>
              launch freqhole
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
