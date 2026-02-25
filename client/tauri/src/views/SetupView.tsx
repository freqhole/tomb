import { createSignal, Show, onMount, createMemo, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@solidjs/router";

// simplified step flow: welcome → config → running → music → done
type SetupStep = "welcome" | "config" | "running" | "music" | "done";

interface DependencyCheckResult {
  ffmpeg_path: string | null;
  ffmpeg_installed: boolean;
  ytdlp_path: string | null;
  ytdlp_installed: boolean;
  can_proceed: boolean;
}

interface SetupResult {
  success: boolean;
  config_path: string;
  data_dir: string;
  user_id: string | null;
  username: string | null;
  api_key: string | null;
  invite_code: string | null;
  errors: string[];
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

// transform server name to valid server ID (lowercase, a-z and hyphens only)
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // remove special chars
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

export default function SetupView() {
  const navigate = useNavigate();
  const [step, setStep] = createSignal<SetupStep>("welcome");
  // appDataDir is fixed - where config lives (system app data dir)
  const [appDataDir, setAppDataDir] = createSignal("");
  // dataDir is customizable - where database/cache/media live (defaults to appDataDir)
  const [dataDir, setDataDir] = createSignal("");
  const [serverName, setServerName] = createSignal("my music server");
  const [serverPort, setServerPort] = createSignal(8081);
  const [serverImage, setServerImage] = createSignal<string | null>(null);
  const [username, setUsername] = createSignal("");
  // setup results
  const [apiKey, setApiKey] = createSignal("");
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

  // auto-generate server ID from name
  const serverId = createMemo(() => nameToId(serverName()) || "freqhole");

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

      // get os username for default
      const osUser = await invoke<string>("get_os_username");
      setUsername(osUser);

      // check if already set up
      if (dir) {
        const status = await invoke<SetupStatus>("check_setup_status", {
          appDataDir: dir,
        });
        if (!status.needs_setup) {
          // setup is complete, redirect to logs
          navigate("/logs", { replace: true });
          return;
        }
      }
    } catch (e) {
      console.error("init error:", e);
      setDepCheckLoading(false);
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
        setDataDir(selected as string);
      }
    } catch (e) {
      console.error("browse error:", e);
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
        setServerImage(selected as string);
      }
    } catch (e) {
      console.error("browse image error:", e);
    }
  }

  // unified setup function that handles everything in one call
  async function runSetup() {
    setLoading(true);
    setError("");
    setStep("running");

    try {
      const configPath = `${appDataDir()}/freqhole-config.toml`;

      const result = await invoke<SetupResult>("run_full_setup", {
        configPath,
        dataDir: dataDir(),
        serverName: serverName(),
        serverPort: serverPort(),
        imagePath: serverImage(),
        username: username() || "admin",
      });

      if (result.success) {
        if (result.api_key) {
          setApiKey(result.api_key);
        }
        setStep("music");
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

  async function addMusicDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "choose music directory",
      });
      if (selected) {
        setMusicDirs([
          ...musicDirs(),
          { path: selected as string, tags: [], scanned: false },
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
      // close wizard and open main window with api key and port
      // server will be started by the Tauri command
      const configPath = `${appDataDir()}/freqhole-config.toml`;
      await invoke("close_setup_wizard", {
        apiKey: apiKey(),
        configPath,
        serverPort: serverPort(),
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

                {/* warning if ffmpeg missing */}
                <Show when={!depCheck()!.can_proceed}>
                  <div
                    style={{
                      "margin-top": "1rem",
                      padding: "0.75rem",
                      background: "#7f1d1d",
                      "border-radius": "0.375rem",
                      color: "#fecaca",
                    }}
                  >
                    <strong>ffmpeg is required</strong>
                    <p
                      style={{
                        margin: "0.5rem 0 0 0",
                        "font-size": "0.8125rem",
                      }}
                    >
                      install ffmpeg to continue. on macOS: brew install ffmpeg
                    </p>
                  </div>
                </Show>

                {/* info if yt-dlp missing */}
                <Show
                  when={depCheck()!.can_proceed && !depCheck()!.ytdlp_installed}
                >
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
                      URL downloading requires yt-dlp.
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
              disabled={depCheckLoading() || !depCheck()?.can_proceed}
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
                <label for="server-id">server ID</label>
                <input
                  type="text"
                  id="server-id"
                  value={serverId()}
                  readOnly
                  class="readonly"
                />
                <p class="hint">auto-generated from server name.</p>
              </div>

              <div class="form-group">
                <label for="server-port">server port</label>
                <input
                  type="number"
                  id="server-port"
                  value={serverPort()}
                  onInput={(e) =>
                    setServerPort(parseInt(e.currentTarget.value) || 8081)
                  }
                  min="1024"
                  max="65535"
                />
                <p class="hint">
                  port for the server to listen on (1024-65535)
                </p>
              </div>

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
                  where database, cache, and media files are stored.
                </p>
              </div>
            </div>
          </Show>

          <div class="form-group">
            <label for="username">admin username</label>
            <input
              type="text"
              id="username"
              placeholder="admin"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
            <p class="hint">username for the root administrator account.</p>
          </div>

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
            <span>creating config, database, and admin account...</span>
          </div>
        </div>
      </Show>

      {/* music */}
      <Show when={step() === "music"}>
        <div class="step">
          <h1>add your music</h1>
          <p class="subtitle">
            optionally add directories to scan for music files.
          </p>

          <div class="directory-list" style={{ margin: "1.5rem 0" }}>
            <Show when={musicDirs().length === 0}>
              <p class="empty">no directories added yet</p>
            </Show>
            <For each={musicDirs()}>
              {(dir) => (
                <div class="directory-item">
                  <div class="directory-info">
                    <span class="directory-path">{dir.path}</span>
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

          <p style={{ color: "#a1a1aa", "margin-bottom": "1.5rem" }}>
            the server will start automatically. you can control it from the
            menu bar icon.
          </p>

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
