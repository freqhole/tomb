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
import { VERSION } from "./version";
import { AdminTransportProvider } from "./admin/context";
import { AdminTargetPicker, AdminScopeBanner } from "./admin/AdminTargetPicker";
import "./App.css";

interface P2pStatus {
  status: string; // "stopped", "starting...", "online", "offline", "connecting..."
  federation_enabled: boolean;
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
  const [p2pStatus, setP2pStatus] = createSignal<P2pStatus | null>(null);
  const [setupComplete, setSetupComplete] = createSignal(false);
  const [checkingSetup, setCheckingSetup] = createSignal(true);

  // determine if we're on an admin route (not setup)
  const isAdminRoute = () => {
    const path = location.pathname;
    return (
      path === "/logs" ||
      path === "/library" ||
      path === "/users" ||
      path === "/settings" ||
      path === "/config" ||
      path === "/federation" ||
      path === "/radio"
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
      console.log("[App] calling check_setup_status...");
      const status = await invoke<SetupStatus>("check_setup_status");
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
    } catch (e) {
      console.error("failed to check setup:", e);
    } finally {
      console.log("[App] setup check done, setting checkingSetup=false");
      setCheckingSetup(false);
    }

    // poll P2P status
    updateP2pStatus();
    setInterval(updateP2pStatus, 3000);
  });

  async function updateP2pStatus() {
    try {
      const status = await invoke<P2pStatus>("p2p_get_status");
      setP2pStatus(status);
    } catch (e) {
      console.error("failed to get P2P status:", e);
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

  // use Show components for proper SolidJS reactivity (if statements don't re-render)
  return (
    <AppContext.Provider value={contextValue}>
      <AdminTransportProvider>
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

                <AdminTargetPicker />

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
                    href="/federation"
                    class={`nav-link ${
                      isActive("/federation") ? "active" : ""
                    }`}
                  >
                    federation
                  </A>
                  <A
                    href="/radio"
                    class={`nav-link ${isActive("/radio") ? "active" : ""}`}
                  >
                    radi<span class="pinky">o</span>
                  </A>
                  <A
                    href="/settings"
                    class={`nav-link ${isActive("/settings") ? "active" : ""}`}
                  >
                    setting<span class="pinky">z</span>
                  </A>
                  <A
                    href="/config"
                    class={`nav-link ${isActive("/config") ? "active" : ""}`}
                  >
                    confi<span class="pinky">g</span>
                  </A>
                  <A
                    href="/logs"
                    class={`nav-link ${isActive("/logs") ? "active" : ""}`}
                  >
                    log<span class="pinky">z</span>
                  </A>
                </div>

                <div class="sidebar-footer">
                  {/* P2P status - only show if federation enabled */}
                  <Show when={p2pStatus()?.federation_enabled}>
                    <div class="server-status">
                      <div class="p2p-status-row">
                        <span
                          class={`status-dot ${
                            p2pStatus()?.status === "online"
                              ? "running"
                              : p2pStatus()?.status === "connecting..." ||
                                p2pStatus()?.status === "starting..."
                              ? "connecting"
                              : "stopped"
                          }`}
                        />
                        <span class="status-text">
                          p2p {p2pStatus()?.status}
                        </span>
                      </div>
                    </div>
                  </Show>

                  <p class="version">version {VERSION}</p>
                </div>
              </nav>

              <main class="main-content">
                <AdminScopeBanner />
                {props.children}
              </main>
            </div>
          </Show>
        </Show>
      </AdminTransportProvider>
    </AppContext.Provider>
  );
}

export default App;
