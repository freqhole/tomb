import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export default function LogsView() {
  const [logs, setLogs] = createSignal<string[]>([]);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  let logsInterval: number | undefined;

  onMount(() => {
    fetchLogs();
    startPolling();
  });

  onCleanup(() => {
    if (logsInterval) clearInterval(logsInterval);
  });

  function startPolling() {
    if (logsInterval) clearInterval(logsInterval);
    if (autoRefresh()) {
      logsInterval = window.setInterval(fetchLogs, 2000);
    }
  }

  function toggleAutoRefresh() {
    setAutoRefresh(!autoRefresh());
    startPolling();
  }

  async function fetchLogs() {
    try {
      const result = await invoke<string[]>("get_server_logs", {
        maxLines: 500,
      });
      // reverse so newest is at top
      setLogs([...result].reverse());
    } catch (e) {
      console.error("failed to fetch logs:", e);
    }
  }

  return (
    <div class="view-content logs-view">
      <div class="view-header">
        <h1 class="active">
          log<span class="pinky">z</span>
        </h1>
        <div class="header-actions">
          <label class="toggle-label">
            <input
              type="checkbox"
              checked={autoRefresh()}
              onChange={toggleAutoRefresh}
            />
            auto-refresh
          </label>
          <button class="secondary small" onClick={fetchLogs}>
            refresh
          </button>
        </div>
      </div>

      <div class="logs-container">
        <Show when={logs().length === 0}>
          <p class="empty">no logs yet - start the server to see output</p>
        </Show>
        <For each={logs()}>
          {(line) => (
            <div
              class={`log-line ${
                line.startsWith("[stderr]")
                  ? "stderr"
                  : line.startsWith("[stdout]")
                    ? "stdout"
                    : line.startsWith("[sidecar]")
                      ? "sidecar"
                      : ""
              }`}
            >
              {line}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
