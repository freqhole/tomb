// in-app log viewer. surfaces the process-wide ring buffer
// captured by app/services/logCapture so users on devices we can't
// remote-debug (iphone safari etc.) can copy console output and
// send it to support.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  type LogEntry,
  type LogLevel,
  clear as clearLogs,
  formatForCopy,
  subscribe,
} from "../../app/services/logCapture";
import { toast } from "../../components/feedback/Toast";
import { setWindowTitle } from "../../app/services/charnel";

const LEVELS: ReadonlyArray<LogLevel> = ["log", "info", "debug", "warn", "error"];

function levelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-red-400 font-semibold";
    case "warn":
      return "text-yellow-400 font-semibold";
    case "info":
      return "text-blue-300 font-semibold";
    case "debug":
      return "text-purple-300 font-semibold";
    case "log":
    default:
      return "text-[var(--color-text-muted)] font-semibold";
  }
}

export function LogzSettingsView() {
  const [entries, setEntries] = createSignal<ReadonlyArray<LogEntry>>([]);
  const [copied, setCopied] = createSignal(false);
  const [autoscroll, setAutoscroll] = createSignal(true);
  // per-level toggle so noisy `log`/`debug` can be hidden while
  // still keeping warn/error visible. all on by default.
  const [enabledLevels, setEnabledLevels] = createSignal<Set<LogLevel>>(new Set(LEVELS));

  let scrollRef: HTMLDivElement | undefined;

  onMount(() => {
    setWindowTitle("freqhole — logz");
    const unsubscribe = subscribe((next) => {
      setEntries(next);
      // defer to next frame so the dom has the new rows before we
      // measure scrollHeight.
      if (autoscroll() && scrollRef) {
        const el = scrollRef;
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
    onCleanup(unsubscribe);
  });

  const filtered = () => entries().filter((e) => enabledLevels().has(e.level));

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const handleCopy = async () => {
    const text = formatForCopy(filtered());
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("failed to copy logs");
    }
  };

  const handleClear = () => {
    clearLogs();
  };

  const counts = () => {
    const totals: Record<LogLevel, number> = {
      log: 0,
      info: 0,
      debug: 0,
      warn: 0,
      error: 0,
    };
    for (const e of entries()) totals[e.level]++;
    return totals;
  };

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">logz</h1>
        <p class="text-sm text-[var(--color-text-secondary)] mt-1">
          capture recent console output, unhandled promise rejectionz, and window errorz.
        </p>
      </div>

      <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            console ({filtered().length} / {entries().length})
          </h2>
          <div class="flex gap-2 flex-wrap">
            <label
              class="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer"
              title="auto-scroll to newest entry as logs arrive"
            >
              <input
                type="checkbox"
                checked={autoscroll()}
                onChange={(e) => setAutoscroll(e.currentTarget.checked)}
              />
              auto-scroll
            </label>
            <button
              class="px-3 py-1 text-xs font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleCopy}
              disabled={filtered().length === 0}
              title="copy visible log entries to clipboard"
            >
              {copied() ? "copied!" : "copy all"}
            </button>
            <button
              class="px-3 py-1 text-xs font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleClear}
              disabled={entries().length === 0}
              title="empty the log buffer"
            >
              clear
            </button>
          </div>
        </div>

        {/* level filter chips */}
        <div class="flex flex-wrap gap-2 mb-3">
          <For each={LEVELS}>
            {(level) => {
              const total = () => counts()[level];
              const on = () => enabledLevels().has(level);
              return (
                <button
                  class={`px-2 py-0.5 text-xs font-mono rounded border transition-colors ${
                    on()
                      ? "bg-[var(--color-bg-tertiary)] border-[var(--color-border-strong)] text-[var(--color-text-primary)]"
                      : "border-[var(--color-border-default)] text-[var(--color-text-muted)] opacity-60"
                  }`}
                  onClick={() => toggleLevel(level)}
                  title={on() ? `hide ${level} entries` : `show ${level} entries`}
                >
                  {level} ({total()})
                </button>
              );
            }}
          </For>
        </div>

        <Show
          when={filtered().length > 0}
          fallback={
            <div class="text-xs text-[var(--color-text-muted)] italic p-3">
              {entries().length === 0
                ? "no log entries yet"
                : "no entries match the current filters"}
            </div>
          }
        >
          <div
            ref={scrollRef}
            class="max-h-[60vh] overflow-y-auto bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded-lg p-3 space-y-2"
          >
            <For each={filtered()}>
              {(entry) => (
                <div class="font-mono text-xs">
                  <div class="flex gap-2 items-baseline">
                    <span class="text-[var(--color-text-muted)]">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    <span class={levelClass(entry.level)}>{entry.level}</span>
                  </div>
                  <pre class="whitespace-pre-wrap break-all text-[var(--color-text-primary)] mt-1">
                    {entry.message}
                  </pre>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
