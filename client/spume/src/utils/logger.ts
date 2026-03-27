// simple debug logger with configurable log levels and tags

type LogLevel = "debug" | "info" | "warn" | "error";

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

// default config
const getConfig = (): LoggerConfig => {
  return (
    window.__LOGGER_CONFIG || {
      level: "debug",
      enabled: true,
    }
  );
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
 * to configure log level in browser console:
 * window.__LOGGER_CONFIG = { level: 'debug', enabled: true };
 */
export function log(level: LogLevel, tag: string, ...args: any[]): void {
  const config = getConfig();

  // check if logging is enabled
  if (!config.enabled) return;

  // check if this log level should be shown
  if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) return;

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
    ...args,
  );
}

// convenience functions for each level
export const debug = (tag: string, ...args: any[]) =>
  log("debug", tag, ...args);
export const info = (tag: string, ...args: any[]) => log("info", tag, ...args);
export const warn = (tag: string, ...args: any[]) => log("warn", tag, ...args);
export const error = (tag: string, ...args: any[]) =>
  log("error", tag, ...args);

// helper to enable/disable logging
export function setLogLevel(level: LogLevel): void {
  window.__LOGGER_CONFIG = {
    ...getConfig(),
    level,
  };
  console.log(`log level set to: ${level}`);
}

export function enableLogging(): void {
  window.__LOGGER_CONFIG = {
    ...getConfig(),
    enabled: true,
  };
  console.log("logging enabled");
}

export function disableLogging(): void {
  window.__LOGGER_CONFIG = {
    ...getConfig(),
    enabled: false,
  };
  console.log("logging disabled");
}
