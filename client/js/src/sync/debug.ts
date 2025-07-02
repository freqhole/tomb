//! Debug Logging Utility
//!
//! Centralized debug logging for the unified sync system.
//! All console output should go through this utility.

/**
 * Debug configuration
 */
interface DebugConfig {
  /** Enable/disable all debug output */
  enabled: boolean;
  /** Show timestamps in logs */
  timestamps: boolean;
  /** Log levels to include */
  levels: {
    info: boolean;
    warn: boolean;
    error: boolean;
    debug: boolean;
  };
}

/**
 * Default debug configuration (disabled by default)
 */
const DEFAULT_CONFIG: DebugConfig = {
  enabled: false,
  timestamps: true,
  levels: {
    info: true,
    warn: true,
    error: true,
    debug: false,
  },
};

/**
 * Current debug configuration
 */
let config: DebugConfig = { ...DEFAULT_CONFIG };

/**
 * Configure debug logging
 */
export function configureDebug(newConfig: Partial<DebugConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Enable debug logging
 */
export function enableDebug(): void {
  config.enabled = true;
}

/**
 * Disable debug logging
 */
export function disableDebug(): void {
  config.enabled = false;
}

/**
 * Get timestamp prefix if enabled
 */
function getTimestamp(): string {
  return config.timestamps ? `[${new Date().toLocaleTimeString()}] ` : "";
}

/**
 * Log info message
 */
export function debugInfo(message: string, ...args: any[]): void {
  if (config.enabled && config.levels.info) {
    console.log(`${getTimestamp()}${message}`, ...args);
  }
}

/**
 * Log warning message
 */
export function debugWarn(message: string, ...args: any[]): void {
  if (config.enabled && config.levels.warn) {
    console.warn(`${getTimestamp()}${message}`, ...args);
  }
}

/**
 * Log error message
 */
export function debugError(message: string, ...args: any[]): void {
  if (config.enabled && config.levels.error) {
    console.error(`${getTimestamp()}${message}`, ...args);
  }
}

/**
 * Log debug message
 */
export function debugLog(message: string, ...args: any[]): void {
  if (config.enabled && config.levels.debug) {
    console.log(`${getTimestamp()}🐛 ${message}`, ...args);
  }
}

/**
 * Always log (for important system messages)
 */
export function alwaysLog(message: string, ...args: any[]): void {
  console.log(`${getTimestamp()}${message}`, ...args);
}
