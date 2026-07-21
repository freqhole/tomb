// lightweight logger with level + tag filtering.
// level order: trace < debug < info < warn < error
//
// configuration precedence (highest wins):
//   1. localStorage overrides (browser devtools, no rebuild needed):
//        localStorage.logLevel = "trace";
//        localStorage.logFilter = "automerge.repo,idb.docindex";
//        location.reload();
//   2. configureLogging({ level, filter }) - call this once at app startup.
//      this is the hook a consuming app uses to wire up its own build-time env
//      vars (e.g. `configureLogging({ level: import.meta.env.VITE_LOG_LEVEL })`
//      in a vite app) without this package hard-depending on any bundler's env
//      injection.
//   3. default: "warn", no tag filter.
//
// trace is off by default even when a lower level is configured - enable it
// explicitly when needed. it's useful for detailed call-by-call tracing of
// services without adding noise to normal debug output.
//
// tags use dotted namespaces, e.g. "p2p.transfer", "audio.player", "idb.service".
// filter prefix matching: "p2p" matches "p2p", "p2p.transfer", "p2p.knock", etc.
//
// usage:
//   import { log } from "@freqhole/reliquary/utils";
//   log.warn("share.panel", "could not build share link:", err);
//   log.debug("playlist.sync", "syncPlaylists #", syncId, "entries:", entries.length);
//   log.trace("automerge.repo", "findPlaylistDoc call #", n, docId);

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LoggingConfig {
  level?: LogLevel;
  /** tag prefixes to allow; an empty array (or omitting this) allows every tag. */
  filter?: string[];
}

const LEVEL_NUM: Record<LogLevel, number> = {
  trace: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_LEVEL: LogLevel = "warn";

let configuredLevel: LogLevel | undefined;
let configuredFilter: string[] | undefined;

/**
 * set the default log level and/or tag filter. intended to be called once at
 * app startup; localStorage overrides (if present) still take priority so
 * logging can be adjusted at runtime without a rebuild.
 */
export function configureLogging(config: LoggingConfig): void {
  if (config.level !== undefined) configuredLevel = config.level;
  if (config.filter !== undefined) configuredFilter = config.filter;
}

/** clear any configureLogging() overrides, restoring the built-in default. */
export function resetLoggingConfig(): void {
  configuredLevel = undefined;
  configuredFilter = undefined;
}

function readLocalStorage(key: string): string | null {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
    ? localStorage.getItem(key)
    : null;
}

function resolveLevel(): number {
  const override = readLocalStorage("logLevel") as LogLevel | null;
  const raw = override ?? configuredLevel ?? DEFAULT_LEVEL;
  return LEVEL_NUM[raw as LogLevel] ?? LEVEL_NUM.warn;
}

function resolveFilter(): string[] {
  const override = readLocalStorage("logFilter");
  if (override !== null) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return configuredFilter ?? [];
}

function allowed(tag: string): boolean {
  const filter = resolveFilter();
  if (filter.length === 0) return true;
  return filter.some((prefix) => tag === prefix || tag.startsWith(prefix + "."));
}

function emit(level: LogLevel, tag: string, msg: string, ...args: unknown[]): void {
  if (LEVEL_NUM[level] < resolveLevel()) return;
  if (!allowed(tag)) return;
  const prefix = `[${tag}]`;
  if (level === "error") console.error(prefix, msg, ...args);
  else if (level === "warn") console.warn(prefix, msg, ...args);
  // eslint-disable-next-line no-console -- this IS the logger implementation
  else console.log(prefix, msg, ...args);
}

export const log = {
  trace: (tag: string, msg: string, ...args: unknown[]): void => emit("trace", tag, msg, ...args),
  debug: (tag: string, msg: string, ...args: unknown[]): void => emit("debug", tag, msg, ...args),
  info: (tag: string, msg: string, ...args: unknown[]): void => emit("info", tag, msg, ...args),
  warn: (tag: string, msg: string, ...args: unknown[]): void => emit("warn", tag, msg, ...args),
  error: (tag: string, msg: string, ...args: unknown[]): void => emit("error", tag, msg, ...args),
};
