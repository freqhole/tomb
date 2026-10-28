// pure decision logic for radio playback underruns, kept free of DOM/MSE
// state so it can be unit-tested directly. radioService's watchdog feeds it
// what it observes (buffered ranges, playhead, wall clock) and acts on the
// answers.
//
// the problem this solves: when the broadcaster delivers media slower than
// real time (e.g. an encode that can't keep up), the playhead catches the
// live edge and the browser resumes the instant each ~3s fragment lands -
// so playback turns into an endless "play 3s, stall 3s" stutter that never
// recovers. holding playback until a real lead has rebuffered trades that
// for fewer, longer pauses, and the lead grows if underruns keep repeating.

/** buffered ranges as plain `[start, end]` pairs (seconds). */
export type BufferedRange = readonly [number, number];

/** playhead within this distance of a range's end counts as "at the edge". */
export const LIVE_EDGE_EPSILON_S = 0.25;

/** the buffered range holding the playhead, if any. */
export function containingRange(
  ranges: readonly BufferedRange[],
  t: number
): BufferedRange | null {
  for (const range of ranges) {
    if (t >= range[0] - 0.05 && t <= range[1] + 0.05) return range;
  }
  return null;
}

/** seconds of media buffered ahead of the playhead, within the range that
 * actually contains it. 0 when the playhead isn't inside any range. */
export function aheadOfPlayheadS(ranges: readonly BufferedRange[], t: number): number {
  const range = containingRange(ranges, t);
  return range ? Math.max(0, range[1] - t) : 0;
}

/** true when a later, disjoint buffered range exists past the one holding
 * the playhead - a gap to jump, not an underrun to wait out. */
export function hasRangeBeyondPlayhead(ranges: readonly BufferedRange[], t: number): boolean {
  const ahead = aheadOfPlayheadS(ranges, t);
  const searchFrom = t + ahead;
  return ranges.some(([start]) => start > searchFrom + 0.1);
}

/** whether an active hold should be abandoned so the normal gap-recovery
 * path can act: the playhead is stranded outside every buffered range, or
 * sits at its range's edge with a later range waiting past a gap. waiting
 * for lead to build "ahead of the playhead" can never succeed there. */
export function holdIsWaitingOnAGap(ranges: readonly BufferedRange[], t: number): boolean {
  if (ranges.length === 0) return false;
  if (containingRange(ranges, t) === null) return true;
  return aheadOfPlayheadS(ranges, t) <= LIVE_EDGE_EPSILON_S && hasRangeBeyondPlayhead(ranges, t);
}

/** HTMLMediaElement.HAVE_FUTURE_DATA */
const HAVE_FUTURE_DATA = 3;

/** the html `stalled` event fires whenever the network has delivered
 * nothing for ~3s - which a paced live stream does routinely between
 * fragments, with plenty still buffered. only count it as a real stall
 * when playback is actually starved. */
export function isBenignStalledEvent(
  eventType: string,
  aheadS: number | null,
  readyState: number
): boolean {
  return (
    eventType === "stalled" && aheadS !== null && aheadS >= 1 && readyState >= HAVE_FUTURE_DATA
  );
}

export interface UnderrunPolicyConfig {
  /** lead to rebuffer to after an isolated underrun. */
  baseTargetS: number;
  /** ceiling on the escalated lead. */
  maxTargetS: number;
  /** underruns within this window escalate the target. */
  escalationWindowMs: number;
  /** when delivery is measurably below real time, rebuffer enough to play
   * roughly this long before the next underrun (see `targetLeadS`). */
  desiredRunS: number;
  /** safety valve: give up holding after this long and resume with
   * whatever is buffered (as long as there's at least `minResumeS`). */
  maxHoldMs: number;
  minResumeS: number;
}

export const DEFAULT_UNDERRUN_POLICY: UnderrunPolicyConfig = {
  baseTargetS: 6,
  maxTargetS: 30,
  escalationWindowMs: 3 * 60_000,
  desiredRunS: 60,
  maxHoldMs: 60_000,
  minResumeS: 1.5,
};

/** how much lead to rebuffer to. doubles per recent underrun (1st -> base,
 * 2nd -> 2x, ...), and when the measured delivery ratio `r` is below real
 * time, is at least enough to play `desiredRunS` before draining again: a
 * lead L lasts L / (1 - r) seconds while media arrives at r x real time. */
export function targetLeadS(
  recentUnderruns: number,
  deliveryRatio: number | null,
  cfg: UnderrunPolicyConfig = DEFAULT_UNDERRUN_POLICY
): number {
  const escalated = cfg.baseTargetS * 2 ** Math.max(0, recentUnderruns - 1);
  let target = escalated;
  if (deliveryRatio !== null && deliveryRatio < 1) {
    target = Math.max(target, cfg.desiredRunS * (1 - Math.max(0, deliveryRatio)));
  }
  return Math.min(cfg.maxTargetS, target);
}

export interface UnderrunHold {
  startedAtMs: number;
  targetS: number;
  underrunNumber: number;
}

export class UnderrunRebufferPolicy {
  private underrunTimes: number[] = [];
  private activeHold: UnderrunHold | null = null;

  constructor(private readonly cfg: UnderrunPolicyConfig = DEFAULT_UNDERRUN_POLICY) {}

  get hold(): UnderrunHold | null {
    return this.activeHold;
  }

  /** record an underrun at the live edge and start holding playback until
   * the returned hold's `targetS` of lead has rebuffered. */
  beginHold(nowMs: number, deliveryRatio: number | null): UnderrunHold {
    this.underrunTimes = this.underrunTimes.filter(
      (at) => nowMs - at < this.cfg.escalationWindowMs
    );
    this.underrunTimes.push(nowMs);
    const count = this.underrunTimes.length;
    this.activeHold = {
      startedAtMs: nowMs,
      targetS: targetLeadS(count, deliveryRatio, this.cfg),
      underrunNumber: count,
    };
    return this.activeHold;
  }

  /** whether a hold in progress should end now. */
  shouldResume(aheadS: number, nowMs: number): boolean {
    const hold = this.activeHold;
    if (!hold) return true;
    if (aheadS >= hold.targetS) return true;
    return nowMs - hold.startedAtMs >= this.cfg.maxHoldMs && aheadS >= this.cfg.minResumeS;
  }

  endHold(): void {
    this.activeHold = null;
  }

  /** forget everything - e.g. when the buffered timeline is torn down. */
  reset(): void {
    this.activeHold = null;
    this.underrunTimes = [];
  }
}

/** estimates how fast media is arriving relative to real time, from
 * periodic samples of the buffered end. the playhead doesn't matter here:
 * buffered-end growth over wall time is delivery, full stop. */
export class DeliveryRateTracker {
  private samples: { atMs: number; endS: number }[] = [];

  constructor(
    private readonly windowMs = 30_000,
    private readonly minSpanMs = 10_000
  ) {}

  record(nowMs: number, bufferedEndS: number): void {
    const last = this.samples[this.samples.length - 1];
    // the buffered timeline went backwards (a SourceBuffer rebuild) -
    // earlier samples no longer describe the same timeline.
    if (last && bufferedEndS < last.endS - 0.5) {
      this.samples = [];
    }
    this.samples.push({ atMs: nowMs, endS: bufferedEndS });
    while (this.samples.length > 2 && nowMs - this.samples[1].atMs >= this.windowMs) {
      this.samples.shift();
    }
  }

  /** media seconds delivered per wall second over the window, or null
   * until enough history exists to say. */
  ratio(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const spanMs = last.atMs - first.atMs;
    if (spanMs < this.minSpanMs) return null;
    return Math.max(0, last.endS - first.endS) / (spanMs / 1000);
  }

  reset(): void {
    this.samples = [];
  }
}
