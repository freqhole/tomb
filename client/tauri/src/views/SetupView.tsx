import { createSignal, Show, onMount, createMemo, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@solidjs/router";

type SetupStep = "welcome" | "config" | "init" | "user" | "music" | "done";

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

interface ConfigResult {
  success: boolean;
  path: string;
  error: string | null;
}

interface UserResult {
  success: boolean;
  user_id: string | null;
  username: string | null;
  api_key: string | null;
  error: string | null;
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
  const [configPath, setConfigPath] = createSignal("");
  const [serverName, setServerName] = createSignal("my music server");
  const [serverPort, setServerPort] = createSignal(8081);
  const [serverImage, setServerImage] = createSignal<string | null>(null);
  const [username, setUsername] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  // music step state
  const [musicDirs, setMusicDirs] = createSignal<MusicDir[]>([]);
  const [scanning, setScanning] = createSignal(false);
  // advanced config toggle
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  // auto-generate server ID from name
  const serverId = createMemo(() => nameToId(serverName()) || "freqhole");

  onMount(async () => {
    try {
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

  async function createConfig() {
    setLoading(true);
    setError("");

    try {
      // config always lives in the system app data dir
      const path = `${appDataDir()}/freqhole-config.toml`;
      setConfigPath(path);

      const result = await invoke<ConfigResult>("create_config", {
        outputPath: path,
        dataDir: dataDir(), // user-customizable data dir
        serverName: serverName(),
        serverId: serverId(),
        serverPort: serverPort(),
        imagePath: serverImage(),
      });

      if (result.success) {
        setStep("init");
        await initializeDatabase();
      } else {
        throw new Error(result.error || "failed to create config");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function initializeDatabase() {
    setLoading(true);
    setError("");

    try {
      await invoke("init_from_config", { configPath: configPath() });
      // brief delay for ux
      await new Promise((r) => setTimeout(r, 500));
      setStep("user");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    setLoading(true);
    setError("");

    try {
      const result = await invoke<UserResult>("create_root_user", {
        username: username() || "admin",
      });

      if (result.success && result.api_key) {
        setApiKey(result.api_key);
        setStep("music");
      } else {
        throw new Error(result.error || "failed to create user");
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
      await invoke("close_setup_wizard", {
        apiKey: apiKey(),
        configPath: configPath(),
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

          <div class="button-row">
            <button class="primary" onClick={() => setStep("config")}>
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

          <div class="button-row">
            <button class="secondary" onClick={() => setStep("welcome")}>
              back
            </button>
            <button
              class="primary"
              onClick={createConfig}
              disabled={loading() || !dataDir() || !serverName()}
            >
              {loading() ? "creating..." : "continue"}
            </button>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </div>
      </Show>

      {/* init */}
      <Show when={step() === "init"}>
        <div class="step">
          <h1>setting up</h1>
          <p class="subtitle">initializing your freqhole instance...</p>

          <div class="loading">
            <div class="spinner" />
            <span>creating database and running migrations...</span>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </div>
      </Show>

      {/* user */}
      <Show when={step() === "user"}>
        <div class="step">
          <h1>create admin account</h1>
          <p class="subtitle">set up your administrator account.</p>

          <div class="form-group">
            <label for="username">username</label>
            <input
              type="text"
              id="username"
              placeholder="admin"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
            <p class="hint">this will be your login name.</p>
          </div>

          <div class="button-row">
            <button class="primary" onClick={createUser} disabled={loading()}>
              {loading() ? "creating..." : "create account"}
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
