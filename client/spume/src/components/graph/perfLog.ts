// throttled perf log aggregator for the graph view.
//
// turn on by setting `window.__GRAPH_PERF__ = true` in devtools.
// every `FLUSH_MS` the aggregated counters / timings are dumped to
// `console.info` as a single line + (optional) table so the console
// stays readable even while the graph is firing thousands of events
// per second.
//
// disabled by default — when the flag is off every helper is a noop
// fast path so leaving the calls in place has near-zero cost.

const FLUSH_MS = 2000;

type Bucket = {
  count: number;
  sum: number; // for timings (ms)
  min: number;
  max: number;
};

const counters = new Map<string, number>();
const timings = new Map<string, Bucket>();

// default-on for the duration of perf investigation. flip off with
// `window.__GRAPH_PERF__ = false` in devtools to silence.
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
export function gauge(name: string, v: number): void {
  if (!enabled()) return;
  gauges.set(name, v);
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastEnabled = false;

function flush() {
  if (counters.size === 0 && timings.size === 0 && gauges.size === 0) return;
  const out: Record<string, unknown> = {};
  for (const [k, v] of counters) out[k] = v;
  for (const [k, b] of timings) {
    out[`${k} (ms)`] = `n=${b.count} avg=${(b.sum / b.count).toFixed(2)} min=${b.min.toFixed(2)} max=${b.max.toFixed(2)}`;
  }
  for (const [k, v] of gauges) out[`${k} (gauge)`] = v;
  // eslint-disable-next-line no-console
  console.info("[graph-perf]", out);
  counters.clear();
  timings.clear();
  // intentionally keep gauges (they're a snapshot, not a delta)
}

function ensureTimer() {
  const on = enabled();
  if (on === lastEnabled) return;
  lastEnabled = on;
  if (on && !flushTimer) {
    flushTimer = setInterval(flush, FLUSH_MS);
    // eslint-disable-next-line no-console
    console.info(
      "[graph-perf] enabled. set window.__GRAPH_PERF__ = false to silence."
    );
  } else if (!on && flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
    counters.clear();
    timings.clear();
    gauges.clear();
  }
}

// auto-poll the flag every second so flipping it in devtools takes
// effect without a reload. cheap — one boolean read.
if (typeof window !== "undefined") {
  setInterval(ensureTimer, 1000);
  // also expose a manual flush for ad-hoc inspection
  (window as unknown as { __graphPerfFlush?: () => void }).__graphPerfFlush =
    flush;
}
