import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface LogEntry {
  line: string;
  timestamp: string | null;
  level: string | null;
}

export default function LogsView() {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [copied, setCopied] = createSignal(false);
  const [clearedAt, setClearedAt] = createSignal<number | null>(null);
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
      const result = await invoke<LogEntry[]>("read_logs", {
        maxLines: 500,
      });

      // continuation lines inherit the preceding entry's timestamp so old
      // multiline output does not return on the next refresh after clearing.
      const cleared = clearedAt();
      let entryTime: number | null = null;
      const filtered = result.filter((entry) => {
        if (entry.timestamp) {
          const parsed = Date.parse(entry.timestamp);
          entryTime = Number.isNaN(parsed) ? null : parsed;
        }
        return cleared === null || (entryTime !== null && entryTime > cleared);
      });

      // reverse so newest is at top
      setLogs([...filtered].reverse());
    } catch (e) {
      console.error("failed to fetch logs:", e);
    }
  }

  function clearLogs() {
    setClearedAt(Date.now());
    setLogs([]);
  }

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(
        logs()
          .map((entry) => entry.line)
          .join("\n"),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("failed to copy logs:", error);
    }
  }

  function getLevelClass(level: string | null): string {
    switch (level?.toUpperCase()) {
      case "ERROR":
        return "error";
      case "WARN":
        return "warn";
      case "DEBUG":
      case "TRACE":
        return "debug";
      default:
        return "";
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
            <input type="checkbox" checked={autoRefresh()} onChange={toggleAutoRefresh} />
            auto-refresh
          </label>
          <button class="secondary small" onClick={fetchLogs}>
            refresh
          </button>
          <button class="secondary small" onClick={copyLogs} disabled={logs().length === 0}>
            {copied() ? "copied!" : "copy all"}
          </button>
          <button class="secondary small" onClick={clearLogs}>
            clear
          </button>
        </div>
      </div>

      <div class="logs-container">
        <Show when={logs().length === 0}>
          <p class="empty">no logs yet - waiting for activity</p>
        </Show>
        <For each={logs()}>
          {(entry) => <div class={`log-line ${getLevelClass(entry.level)}`}>{entry.line}</div>}
        </For>
      </div>
    </div>
  );
}
