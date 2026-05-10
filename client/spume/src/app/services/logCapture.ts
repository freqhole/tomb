// process-wide log capture service.
//
// patches `console.{log,info,warn,error,debug}` once at boot and
// keeps a ring buffer of entries so the in-app /settings/logz view
// can show recent output to users on devices we can't remote-debug
// (iphone safari, locked-down android webview, etc.).
//
// also captures unhandledrejection and global window error events.
//
// install() is idempotent — safe to call multiple times.

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  // monotonically increasing id so reactive views can use it as a key.
  id: number;
  // wall-clock timestamp (ms since epoch) for display.
  ts: number;
  level: LogLevel;
  // pre-formatted single string. multi-arg console calls are joined
  // with a single space, errors get name + message + stack.
  message: string;
}

type Listener = (entries: ReadonlyArray<LogEntry>) => void;

// ring-buffer cap. tuned to "long enough to debug a session" without
// hogging memory if some background loop spams the console.
const RING_CAPACITY = 1000;

let installed = false;
let nextId = 1;
const buffer: LogEntry[] = [];
const listeners = new Set<Listener>();

// keep a handle on the originals so we can fall through and so
// uninstall() (used in tests) can restore them. also lets the patched
// versions still print to devtools normally.
let origLog: typeof console.log | null = null;
let origInfo: typeof console.info | null = null;
let origWarn: typeof console.warn | null = null;
let origError: typeof console.error | null = null;
let origDebug: typeof console.debug | null = null;

function formatOne(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) {
    const parts = [`${arg.name}: ${arg.message}`];
    if (arg.stack) parts.push(arg.stack);
    const cause = (arg as Error & { cause?: unknown }).cause;
    if (cause !== undefined) parts.push(`caused by: ${formatOne(cause)}`);
    return parts.join("\n");
  }
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      // circular refs etc. fall back to coerced string.
      return String(arg);
    }
  }
  return String(arg);
}

function formatArgs(args: unknown[]): string {
  return args.map(formatOne).join(" ");
}

function push(level: LogLevel, args: unknown[]): void {
  const entry: LogEntry = {
    id: nextId++,
    ts: Date.now(),
    level,
    message: formatArgs(args),
  };
  buffer.push(entry);
  if (buffer.length > RING_CAPACITY) {
    buffer.splice(0, buffer.length - RING_CAPACITY);
  }
  // notify listeners with a fresh snapshot so solid signals see a
  // new array reference.
  if (listeners.size > 0) {
    const snapshot = buffer.slice();
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch {
        // never let a misbehaving listener break the console.
      }
    }
  }
}

function onRejection(e: PromiseRejectionEvent): void {
  push("error", ["unhandled rejection:", e.reason]);
}

function onWindowError(e: ErrorEvent): void {
  push("error", ["window error:", e.error ?? e.message]);
}

export function install(): void {
  if (installed) return;
  installed = true;

  origLog = console.log.bind(console);
  origInfo = console.info.bind(console);
  origWarn = console.warn.bind(console);
  origError = console.error.bind(console);
  origDebug = console.debug.bind(console);

  console.log = (...args: unknown[]) => {
    push("log", args);
    origLog?.(...args);
  };
  console.info = (...args: unknown[]) => {
    push("info", args);
    origInfo?.(...args);
  };
  console.warn = (...args: unknown[]) => {
    push("warn", args);
    origWarn?.(...args);
  };
  console.error = (...args: unknown[]) => {
    push("error", args);
    origError?.(...args);
  };
  console.debug = (...args: unknown[]) => {
    push("debug", args);
    origDebug?.(...args);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onWindowError);
  }

  // self-document the buffer so any later snapshot is contextualised.
  push("info", [
    `logz: capture started | ua: ${
      typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
    } | url: ${typeof location !== "undefined" ? location.href : "unknown"}`,
  ]);
}

// returns a snapshot of current entries (oldest first).
export function snapshot(): ReadonlyArray<LogEntry> {
  return buffer.slice();
}

// subscribe to live updates. returns an unsubscribe function. the
// listener is invoked immediately with the current snapshot so
// reactive views can hydrate without a separate read.
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(buffer.slice());
  return () => {
    listeners.delete(fn);
  };
}

export function clear(): void {
  buffer.length = 0;
  if (listeners.size > 0) {
    const snap: ReadonlyArray<LogEntry> = [];
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore */
      }
    }
  }
}

// format helper used by the copy-to-clipboard button in the view.
export function formatForCopy(entries: ReadonlyArray<LogEntry>): string {
  return entries
    .map(
      (e) =>
        `[${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()}: ${e.message}`
    )
    .join("\n\n");
}
