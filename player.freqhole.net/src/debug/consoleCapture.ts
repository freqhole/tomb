// captures every console.* call into a small in-memory ring buffer, exposed
// reactively, so devel mode's debug overlay (App.tsx + DebugOverlay.tsx) can
// show real console output on devices (tvs, embedded browsers) where devtools
// aren't reachable - per the explicit ask: "just dumping ALL console logs
// will help me debug on tvs or devices where i can [not] see web browser
// console logs easily". installed once at boot regardless of whether devel
// mode is on yet, so toggling it on later still shows this session's history
// instead of only future logs.
import { createSignal } from "solid-js";

export interface CapturedLogLine {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  at: number;
}

const MAX_LINES = 500;

const [lines, setLines] = createSignal<CapturedLogLine[]>([]);
export const capturedLogLines = lines;

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function capture(level: CapturedLogLine["level"], args: unknown[]): void {
  const text = args.map(formatArg).join(" ");
  setLines((prev) => {
    const next = [...prev, { level, text, at: Date.now() }];
    return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
  });
}

let installed = false;

/** monkey-patches console.log/info/warn/error/debug to also capture into
 * the ring buffer above, in addition to their normal behavior - idempotent,
 * safe to call more than once (e.g. from multiple onMount hooks). */
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      capture(level, args);
    };
  });
}

export function clearCapturedLogLines(): void {
  setLines([]);
}
