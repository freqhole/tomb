import {
  createSignal,
  onMount,
  Show,
  ParentProps,
  createContext,
  useContext,
} from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ServerStatus {
  running: boolean;
  pid: number | null;
  uptime_secs: number | null;
  config_path: string | null;
  server_url: string | null;
}

interface SetupStatus {
  needs_setup: boolean;
  config_exists: boolean;
  has_root_user: boolean;
  config_path: string | null;
  data_dir: string | null;
}

// context to share setup state across components
interface AppContextType {
  setupComplete: () => boolean;
  setSetupComplete: (value: boolean) => void;
}

const AppContext = createContext<AppContextType>();

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

function App(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [serverStatus, setServerStatus] = createSignal<ServerStatus | null>(
    null,
  );
  const [setupComplete, setSetupComplete] = createSignal(false);
  const [checkingSetup, setCheckingSetup] = createSignal(true);
  const [copied, setCopied] = createSignal(false);

  // determine if we're on an admin route (not setup)
  const isAdminRoute = () => {
    const path = location.pathname;
    return (
      path === "/logs" ||
      path === "/library" ||
      path === "/users" ||
      path === "/settings"
    );
  };

  onMount(async () => {
    console.log("[App] onMount, location.pathname:", location.pathname);
    console.log("[App] window.location:", window.location.href);
    console.log("[App] isAdminRoute:", isAdminRoute());

    // if we're on an admin route, don't block with spinner
    if (isAdminRoute()) {
      console.log("[App] admin route detected, skipping setup check spinner");
      setCheckingSetup(false);
    }

    // check setup status
    try {
      console.log("[App] calling get_default_data_dir...");
      const dir = await invoke<string | null>("get_default_data_dir");
      console.log("[App] get_default_data_dir returned:", dir);
      if (dir) {
        console.log("[App] calling check_setup_status...");
        const status = await invoke<SetupStatus>("check_setup_status", {
          appDataDir: dir,
        });
        console.log("[App] check_setup_status returned:", status);
        setSetupComplete(!status.needs_setup);

        // navigate based on setup status
        if (status.needs_setup) {
          // if setup is needed and we're not on setup page, go there
          if (location.pathname !== "/" && location.pathname !== "/setup") {
            navigate("/setup");
          }
        } else {
          // if setup is complete and we're on setup page, go to logs
          if (location.pathname === "/" || location.pathname === "/setup") {
            navigate("/logs", { replace: true });
          }
        }
      }
    } catch (e) {
      console.error("failed to check setup:", e);
    } finally {
      console.log("[App] setup check done, setting checkingSetup=false");
      setCheckingSetup(false);
    }

    // poll server status
    updateServerStatus();
    setInterval(updateServerStatus, 5000);
  });

  async function updateServerStatus() {
    try {
      const status = await invoke<ServerStatus>("server_status");
      setServerStatus(status);
    } catch (e) {
      console.error("failed to get status:", e);
    }
  }

  const isActive = (path: string) => {
    if (path === "/" || path === "/setup") {
      return location.pathname === "/" || location.pathname === "/setup";
    }
    return location.pathname === path;
  };

  // during initial setup, show centered layout without sidebar
  const isInSetupFlow = () => {
    return (
      !setupComplete() &&
      (location.pathname === "/" || location.pathname === "/setup")
    );
  };

  const contextValue: AppContextType = {
    setupComplete,
    setSetupComplete,
  };

  async function copyServerUrl() {
    const url = serverStatus()?.server_url;
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error("copy failed:", e);
      }
    }
  }

  // use Show components for proper SolidJS reactivity (if statements don't re-render)
  return (
    <AppContext.Provider value={contextValue}>
      <Show
        when={!checkingSetup()}
        fallback={
          <div class="loading-screen">
            <div class="spinner" />
          </div>
        }
      >
        <Show
          when={!isInSetupFlow()}
          fallback={
            <div class="setup-layout">
              <main class="setup-content">{props.children}</main>
            </div>
          }
        >
          {/* admin layout with sidebar */}
          <div class="wizard-layout">
            <nav class="sidebar">
              <div class="sidebar-header">
                <span class="logo">freqhole</span>
                <span class="logo-sub">wizard</span>
              </div>

              <div class="nav-links">
                <A
                  href="/library"
                  class={`nav-link ${isActive("/library") ? "active" : ""}`}
                >
                  library
                </A>
                <A
                  href="/users"
                  class={`nav-link ${isActive("/users") ? "active" : ""}`}
                >
                  user<span class="pinky">z</span>
                </A>
                <A
                  href="/settings"
                  class={`nav-link ${isActive("/settings") ? "active" : ""}`}
                >
                  setting<span class="pinky">z</span>
                </A>
                <A
                  href="/logs"
                  class={`nav-link ${isActive("/logs") ? "active" : ""}`}
                >
                  log<span class="pinky">z</span>
                </A>
              </div>

              <div class="sidebar-footer">
                <Show when={serverStatus()}>
                  {(status) => (
                    <div class="server-status">
                      <div>
                        <span
                          class={`status-dot ${status().running ? "running" : "stopped"}`}
                        />
                        <span class="status-text">
                          {status().running ? "running" : "stopped"}
                        </span>
                        <Show when={status().running && status().uptime_secs}>
                          <span class="uptime">
                            ({Math.floor(status().uptime_secs! / 60)}m uptime)
                          </span>
                        </Show>
                      </div>

                      <Show when={status().running && status().server_url}>
                        <div class="server-url-row">
                          <a
                            href={status().server_url!}
                            target="_blank"
                            class="server-url"
                          >
                            {status().server_url}
                          </a>
                          {/* <button
                            class="secondary small"
                            onClick={copyServerUrl}
                          >
                            {copied() ? "copied!" : "copy"}
                          </button> */}
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>

                <div class="section">
                  {/* #TODO: get version dynamically */}
                  <p class="version">version 0.1.0</p>
                </div>
              </div>
            </nav>

            <main class="main-content">{props.children}</main>
          </div>
        </Show>
      </Show>
    </AppContext.Provider>
  );
}

export default App;
