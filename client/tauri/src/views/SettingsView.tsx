import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface ServerStatus {
  running: boolean;
  pid: number | null;
  uptime_secs: number | null;
  config_path: string | null;
  server_url: string | null;
}

export default function SettingsView() {
  const [serverStatus, setServerStatus] = createSignal<ServerStatus | null>(
    null,
  );
  const [configPath, setConfigPath] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  onMount(async () => {
    await loadStatus();
    await loadConfigPath();
  });

  async function loadStatus() {
    try {
      const status = await invoke<ServerStatus>("server_status");
      setServerStatus(status);
    } catch (e) {
      console.error("failed to load status:", e);
    }
  }

  async function loadConfigPath() {
    try {
      const path = await invoke<string>("get_config_path");
      setConfigPath(path);
    } catch (e) {
      console.error("failed to load config path:", e);
    }
  }

  async function openConfigDir() {
    try {
      await invoke("open_config_dir");
    } catch (e) {
      console.error("failed to open config dir:", e);
    }
  }

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

  return (
    <div class="view-content">
      <div class="view-header">
        <h1 class="active">
          setting<span class="pinky">z</span>
        </h1>
      </div>

      <div class="section">
        <h2>status</h2>
        <Show when={serverStatus()}>
          {(status) => (
            <div class="status-card">
              <div class="status-indicator">
                <span
                  class={`status-dot ${status().running ? "running" : "stopped"}`}
                />
                <span>{status().running ? "running" : "stopped"}</span>
                <Show when={status().running && status().uptime_secs}>
                  <span class="uptime">
                    ({Math.floor(status().uptime_secs! / 60)}m uptime)
                  </span>
                </Show>
              </div>
              <p class="section-desc">
                <Show when={status().running && status().server_url}>
                  <span class="server-url-row">
                    <a
                      href={status().server_url!}
                      target="_blank"
                      class="server-url"
                    >
                      {status().server_url}
                    </a>
                    <button class="secondary small" onClick={copyServerUrl}>
                      {copied() ? "copied!" : "copy"}
                    </button>
                  </span>
                </Show>
              </p>
            </div>
          )}
        </Show>
      </div>

      <div class="section">
        <h2>configuration</h2>
        <Show when={configPath()}>
          <p class="config-path">
            <strong>config file:</strong> {configPath()}
          </p>
          <button class="secondary" onClick={openConfigDir}>
            show in finder
          </button>
        </Show>
        <p class="section-desc">
          edit the config file directly for advanced options.
        </p>
      </div>
    </div>
  );
}
