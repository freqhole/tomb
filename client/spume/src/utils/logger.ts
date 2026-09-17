// simple debug logger with configurable log levels and tags

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  level: LogLevel;
  enabled: boolean;
}

// global logger config - can be modified via browser console
declare global {
  interface Window {
    __LOGGER_CONFIG?: LoggerConfig;
  }
}

// persisted so a level set via setLogLevel()/enableLogging() survives a
// page/webview reload - a plain `window.__LOGGER_CONFIG = {...}` console
// assignment does NOT (it's an in-memory global, wiped on any reload),
// which made "turn on debug logging, then reproduce a bug that needs a
// reload/navigation to trigger" effectively impossible - the level would
// silently revert to the "error"-only default the instant the app
// reloaded, well before the interesting log lines would have fired.
const STORAGE_KEY = "freqhole:loggerConfig";

function readPersistedConfig(): LoggerConfig | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LoggerConfig>;
    return parsed.level && typeof parsed.enabled === "boolean" ? (parsed as LoggerConfig) : null;
  } catch {
    return null;
  }
}

function persistConfig(config: LoggerConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // storage full/unavailable (private browsing, etc.) - the in-memory
    // window override above still works for the rest of this session.
  }
}

// resolution order: an explicit `window.__LOGGER_CONFIG` (a live, one-off
// console tweak takes effect immediately, no reload needed) -> whatever
// was last persisted via setLogLevel()/enableLogging()/disableLogging()
// -> the hardcoded default.
const getConfig = (): LoggerConfig => {
  if (typeof window !== "undefined" && window.__LOGGER_CONFIG) return window.__LOGGER_CONFIG;
  return readPersistedConfig() ?? { level: "error", enabled: true };
};

// log level priorities
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// colors for different log levels (browser console)
const LOG_COLORS: Record<LogLevel, string> = {
  debug: "#6b7280", // gray
  info: "#3b82f6", // blue
  warn: "#f59e0b", // orange
  error: "#ef4444", // red
};

/**
 * main logging function with tag and level support
 *
 * @example
 * log('debug', 'cacheUpdates', 'updateSongInCache called:', { songId, sha256 });
 * log('error', 'favorites', 'mutation failed:', error);
 *
 * to configure log level in browser console (persists across reloads -
 * prefer this over directly assigning `window.__LOGGER_CONFIG`, which
 * only lasts until the next reload):
 * setLogLevel('debug'); // or: import { setLogLevel } from "./utils/logger"
 */
export function log(level: LogLevel, tag: string, ...args: any[]): void {
  const config = getConfig();

  // CENOTAPH_QUEUE_TRACE lines always print, regardless of level/enabled -
  // this specific tag was added expressly so this class of trace can
  // never again go silently missing behind a logger config that failed
  // to apply/persist/survive a reload (a real, repeated problem this
  // session - see docs/cenotaph-queue-ux-hardening-plan.md). every other
  // tag still respects the normal gate below.
  const isForcedTrace = args.some(
    (a) => typeof a === "string" && a.includes("CENOTAPH_QUEUE_TRACE")
  );

  if (!isForcedTrace) {
    // check if logging is enabled
    if (!config.enabled) return;

    // check if this log level should be shown
    if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) return;
  }

  // format timestamp
  const now = new Date();
  const timestamp = now.toISOString().split("T")[1].split(".")[0]; // HH:MM:SS

  // format tag with color
  const tagStyle = `color: ${LOG_COLORS[level]}; font-weight: bold;`;
  const resetStyle = "color: inherit; font-weight: normal;";

  // select console method
  const consoleMethod = console[level] || console.log;

  // output with styling
  consoleMethod(
    `%c[${timestamp}]%c %c[${tag}]%c`,
    "color: #9ca3af;",
    resetStyle,
    tagStyle,
    resetStyle,
    ...args
  );
}

// convenience functions for each level
export const debug = (tag: string, ...args: any[]) => log("debug", tag, ...args);
export const info = (tag: string, ...args: any[]) => log("info", tag, ...args);
export const warn = (tag: string, ...args: any[]) => log("warn", tag, ...args);
export const error = (tag: string, ...args: any[]) => log("error", tag, ...args);

// helper to enable/disable logging - persists to localStorage (see
// getConfig's doc comment) so the setting survives a reload, unlike a
// bare `window.__LOGGER_CONFIG = {...}` assignment.
export function setLogLevel(level: LogLevel): void {
  const next: LoggerConfig = { ...getConfig(), level };
  window.__LOGGER_CONFIG = next;
  persistConfig(next);
  console.log(`log level set to: ${level} (persisted, survives reload)`);
}

/** the currently effective gate level - for a settings UI to reflect/
 * control without needing devtools console access at all (e.g. iOS
 * Safari, which has no reachable in-page console for most users). */
export function getLogLevel(): LogLevel {
  return getConfig().level;
}

export function enableLogging(): void {
  const next: LoggerConfig = { ...getConfig(), enabled: true };
  window.__LOGGER_CONFIG = next;
  persistConfig(next);
  console.log("logging enabled (persisted, survives reload)");
}

export function disableLogging(): void {
  const next: LoggerConfig = { ...getConfig(), enabled: false };
  window.__LOGGER_CONFIG = next;
  persistConfig(next);
  console.log("logging disabled (persisted, survives reload)");
}
