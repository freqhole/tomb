// throttled perf log aggregator for the graph view.
//
// enabled by default but engineered to be cheap and console-safe:
//   - emits a single compact `console.debug` line per window
//     (filterable; default chrome/safari console filters hide debug)
//   - skips emission entirely when nothing happened in the window
//   - keeps a small ring buffer on `window.__graphPerfHistory` so
//     you can pull recent windows back as objects from devtools
//     without re-enabling streaming output
//   - silence streaming output with `window.__GRAPH_PERF__ = false`
//     (counters still collect, snapshots still available)
//
// the previous pretty-printed `JSON.stringify(out, null, 2)` dumps
// were tens of KB per window and froze tauri's WKWebView inspector;
// the compact line is ~200 chars and uses `console.debug` so it
// stays out of the default console view.

const FLUSH_MS = 2000;
const HISTORY_MAX = 30;

type Bucket = {
  count: number;
  sum: number; // for timings (ms)
  min: number;
  max: number;
};

const counters = new Map<string, number>();
const timings = new Map<string, Bucket>();

// default-ON, but cheap: when on we still skip empty-window emits,
// use `console.debug` (filtered out of default view), and produce a
// single compact line. flip off with `window.__GRAPH_PERF__ = false`
// to silence streaming output entirely while preserving snapshot
// access via `window.__graphPerfHistory`.
if (
  typeof window !== "undefined" &&
  (window as unknown as { __GRAPH_PERF__?: boolean }).__GRAPH_PERF__ ===
    undefined
) {
  (window as unknown as { __GRAPH_PERF__?: boolean }).__GRAPH_PERF__ = true;
}

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as unknown as { __GRAPH_PERF__?: boolean })
    .__GRAPH_PERF__;
}

/** bump a counter (e.g. "img.cache.hit"). */
export function bump(name: string, n: number = 1): void {
  if (!enabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + n);
}

/** record a timing in ms (e.g. "draw.frame"). */
export function timing(name: string, ms: number): void {
  if (!enabled()) return;
  const b = timings.get(name);
  if (!b) {
    timings.set(name, { count: 1, sum: ms, min: ms, max: ms });
  } else {
    b.count += 1;
    b.sum += ms;
    if (ms < b.min) b.min = ms;
    if (ms > b.max) b.max = ms;
  }
}

/** record an instantaneous gauge — only the last value per window is kept. */
const gauges = new Map<string, number>();
let gaugesDirty = false;
export function gauge(name: string, v: number): void {
  if (!enabled()) return;
  gauges.set(name, v);
  gaugesDirty = true;
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastEnabled = false;

// rolling ring buffer of recent windows. always populated when
// streaming is on (cheap — just an array push + shift). available
// from devtools as `window.__graphPerfHistory` so you can pull the
// last N windows as structured objects without re-enabling noisy
// streaming.
const history: Array<Record<string, unknown>> = [];
if (typeof window !== "undefined") {
  (window as unknown as { __graphPerfHistory?: typeof history })
    .__graphPerfHistory = history;
}

function snapshot(): Record<string, unknown> | null {
  // don't emit windows when only stale gauges exist from a prior view.
  // this prevents perpetual `[graph-perf]` logs after graph teardown.
  if (counters.size === 0 && timings.size === 0 && !gaugesDirty)
    return null;
  const out: Record<string, unknown> = { t: Date.now() };
  for (const [k, v] of counters) out[k] = v;
  for (const [k, b] of timings) {
    out[k] = {
      n: b.count,
      avg: +(b.sum / b.count).toFixed(2),
      min: +b.min.toFixed(2),
      max: +b.max.toFixed(2),
    };
  }
  for (const [k, v] of gauges) out[`g:${k}`] = v;
  return out;
}

function flush() {
  const snap = snapshot();
  counters.clear();
  timings.clear();
  gaugesDirty = false;
  // intentionally keep gauges (they're a snapshot, not a delta)
  if (!snap) return;
  history.push(snap);
  if (history.length > HISTORY_MAX) history.shift();
  // compact one-line summary. console.debug is filtered out of the
  // default console view in chrome/safari/tauri so it doesn't crowd
  // application logs while remaining inspectable on demand. ~200
  // chars vs the ~2-3 KB pretty-printed JSON we used to emit.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(snap)) {
    if (k === "t") continue;
    if (typeof v === "object" && v !== null && "avg" in (v as object)) {
      const t = v as { n: number; avg: number; max: number };
      parts.push(`${k}=${t.avg}ms(n${t.n},max${t.max})`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  // eslint-disable-next-line no-console
  console.debug("[graph-perf]", parts.join(" "));
}

function ensureTimer() {
  const on = enabled();
  if (on === lastEnabled) return;
  lastEnabled = on;
  if (on && !flushTimer) {
    flushTimer = setInterval(flush, FLUSH_MS);
    // eslint-disable-next-line no-console
    console.debug(
      "[graph-perf] streaming on. silence: window.__GRAPH_PERF__=false. history: window.__graphPerfHistory"
    );
  } else if (!on && flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
    counters.clear();
    timings.clear();
    gauges.clear();
    gaugesDirty = false;
  }
}

// auto-poll the flag every second so flipping it in devtools takes
// effect without a reload. cheap — one boolean read.
if (typeof window !== "undefined") {
  setInterval(ensureTimer, 1000);
  // also expose a manual flush for ad-hoc inspection
  (window as unknown as { __graphPerfFlush?: () => void }).__graphPerfFlush =
    flush;
  // session benchmark summary. dumps aggregate stats across every
  // window currently in the ring buffer plus an "image-load profile"
  // bucketing img.load timings by quartile. handy for capturing
  // before/after numbers around a perf change without having to
  // hand-aggregate `__graphPerfHistory`.
  //
  // usage from devtools:
  //   window.__graphPerfReport()           // text summary
  //   window.__graphPerfReport({ raw: 1 }) // structured object
  (
    window as unknown as {
      __graphPerfReport?: (opts?: { raw?: boolean }) => unknown;
    }
  ).__graphPerfReport = (opts) => {
    const windows = history.length;
    if (windows === 0) return "[graph-perf] no history yet";
    // sum / max each counter and timing across windows.
    const cAgg = new Map<string, number>();
    const tAgg = new Map<string, { n: number; sum: number; max: number }>();
    const gLast = new Map<string, number>();
    for (const w of history) {
      for (const [k, v] of Object.entries(w)) {
        if (k === "t") continue;
        if (typeof v === "number") {
          cAgg.set(k, (cAgg.get(k) ?? 0) + v);
        } else if (k.startsWith("g:") && typeof (v as number) === "number") {
          gLast.set(k.slice(2), v as number);
        } else if (
          typeof v === "object" &&
          v !== null &&
          "avg" in (v as object)
        ) {
          const tw = v as { n: number; avg: number; max: number };
          const prev = tAgg.get(k) ?? { n: 0, sum: 0, max: 0 };
          prev.n += tw.n;
          prev.sum += tw.avg * tw.n;
          if (tw.max > prev.max) prev.max = tw.max;
          tAgg.set(k, prev);
        } else if (typeof v === "number") {
          gLast.set(k, v as number);
        }
      }
    }
    const report = {
      windows,
      spanMs:
        windows > 1
          ? (history[windows - 1].t as number) - (history[0].t as number)
          : 0,
      counters: Object.fromEntries(cAgg),
      timings: Object.fromEntries(
        Array.from(tAgg, ([k, t]) => [
          k,
          { n: t.n, avg: +(t.sum / t.n).toFixed(2), max: +t.max.toFixed(2) },
        ]),
      ),
      gauges: Object.fromEntries(gLast),
    };
    if (opts?.raw) return report;
    const lines = [
      `[graph-perf] report — ${windows} windows over ${(report.spanMs / 1000).toFixed(1)}s`,
      "counters:",
      ...Object.entries(report.counters)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([k, v]) => `  ${k}=${v}`),
      "timings:",
      ...Object.entries(report.timings).map(([k, t]) => {
        const tt = t as { n: number; avg: number; max: number };
        return `  ${k}  n=${tt.n} avg=${tt.avg}ms max=${tt.max}ms`;
      }),
      "gauges (latest):",
      ...Object.entries(report.gauges).map(([k, v]) => `  ${k}=${v}`),
    ];
    // eslint-disable-next-line no-console
    console.info(lines.join("\n"));
    return report;
  };
  // hard reset of history + counters — useful when capturing a clean
  // benchmark from a known starting point (e.g. "from now until I
  // call report").
  (window as unknown as { __graphPerfReset?: () => void }).__graphPerfReset =
    () => {
      history.length = 0;
      counters.clear();
      timings.clear();
      gauges.clear();
      gaugesDirty = false;
      // eslint-disable-next-line no-console
      console.info("[graph-perf] history + counters reset");
    };
}
