import { describe, expect, it } from "vitest";
import {
  aheadOfPlayheadS,
  DEFAULT_UNDERRUN_POLICY,
  DeliveryRateTracker,
  hasRangeBeyondPlayhead,
  holdIsWaitingOnAGap,
  isBenignStalledEvent,
  targetLeadS,
  UnderrunRebufferPolicy,
} from "./radioUnderrunPolicy";

describe("aheadOfPlayheadS", () => {
  it("measures within the range holding the playhead", () => {
    expect(aheadOfPlayheadS([[0.43, 779.13]], 722.99)).toBeCloseTo(56.14, 2);
  });

  it("is zero at the live edge", () => {
    expect(aheadOfPlayheadS([[0.43, 827.13]], 827.13)).toBe(0);
  });

  it("ignores a later disjoint range", () => {
    expect(
      aheadOfPlayheadS(
        [
          [0, 10],
          [20, 40],
        ],
        9
      )
    ).toBe(1);
  });

  it("is zero when the playhead sits outside every range", () => {
    expect(aheadOfPlayheadS([[20, 40]], 5)).toBe(0);
  });
});

describe("hasRangeBeyondPlayhead", () => {
  it("is false when caught up to the only range", () => {
    expect(hasRangeBeyondPlayhead([[0, 30]], 30)).toBe(false);
  });

  it("is true when a later range exists past a gap", () => {
    expect(
      hasRangeBeyondPlayhead(
        [
          [0, 30],
          [32, 50],
        ],
        30
      )
    ).toBe(true);
  });
});

describe("holdIsWaitingOnAGap", () => {
  it("is false at the live edge with nothing beyond (a real underrun)", () => {
    expect(holdIsWaitingOnAGap([[0, 30]], 30)).toBe(false);
  });

  it("is true when the playhead is stranded outside every range", () => {
    expect(holdIsWaitingOnAGap([[40, 60]], 5)).toBe(true);
  });

  it("is true at a range edge with a later range past a gap", () => {
    expect(
      holdIsWaitingOnAGap(
        [
          [0, 30],
          [31, 50],
        ],
        30
      )
    ).toBe(true);
  });

  it("is false with nothing buffered at all", () => {
    expect(holdIsWaitingOnAGap([], 0)).toBe(false);
  });
});

describe("isBenignStalledEvent", () => {
  it("treats a network-idle `stalled` with a healthy buffer as benign", () => {
    // from the field log: stall #5 at aheadS=56.14, readyState=4
    expect(isBenignStalledEvent("stalled", 56.14, 4)).toBe(true);
  });

  it("counts a starved `stalled` as real", () => {
    expect(isBenignStalledEvent("stalled", 0, 2)).toBe(false);
  });

  it("always counts `waiting` as real", () => {
    expect(isBenignStalledEvent("waiting", 56, 4)).toBe(false);
  });

  it("counts a stall with unknown buffer state as real", () => {
    expect(isBenignStalledEvent("stalled", null, 4)).toBe(false);
  });
});

describe("targetLeadS", () => {
  it("starts at the base target for an isolated underrun", () => {
    expect(targetLeadS(1, null)).toBe(DEFAULT_UNDERRUN_POLICY.baseTargetS);
  });

  it("doubles per repeated underrun up to the ceiling", () => {
    expect(targetLeadS(2, null)).toBe(12);
    expect(targetLeadS(3, null)).toBe(24);
    expect(targetLeadS(4, null)).toBe(DEFAULT_UNDERRUN_POLICY.maxTargetS);
    expect(targetLeadS(10, null)).toBe(DEFAULT_UNDERRUN_POLICY.maxTargetS);
  });

  it("sizes the lead from a measured below-realtime delivery ratio", () => {
    // ~0.5x (the field log's episode 2): 60s * (1 - 0.5) = 30s
    expect(targetLeadS(1, 0.5)).toBe(30);
    // ~0.9x: 60s * 0.1 = 6s - no more than the base
    expect(targetLeadS(1, 0.9)).toBeCloseTo(6, 5);
  });

  it("ignores delivery at or above real time", () => {
    expect(targetLeadS(1, 1.4)).toBe(DEFAULT_UNDERRUN_POLICY.baseTargetS);
  });
});

describe("UnderrunRebufferPolicy", () => {
  it("holds until the target lead is buffered", () => {
    const p = new UnderrunRebufferPolicy();
    const hold = p.beginHold(0, null);
    expect(hold.targetS).toBe(6);
    expect(p.shouldResume(0, 1000)).toBe(false);
    expect(p.shouldResume(5.9, 5000)).toBe(false);
    expect(p.shouldResume(6, 6000)).toBe(true);
  });

  it("escalates repeated underruns within the window and forgets old ones", () => {
    const p = new UnderrunRebufferPolicy();
    expect(p.beginHold(0, null).targetS).toBe(6);
    p.endHold();
    expect(p.beginHold(30_000, null).targetS).toBe(12);
    p.endHold();
    expect(p.beginHold(60_000, null).underrunNumber).toBe(3);
    p.endHold();
    // well past the escalation window since all of the above
    const later = 60_000 + DEFAULT_UNDERRUN_POLICY.escalationWindowMs + 1;
    const fresh = p.beginHold(later, null);
    expect(fresh.underrunNumber).toBe(1);
    expect(fresh.targetS).toBe(6);
  });

  it("gives up holding after the safety timeout once something is buffered", () => {
    const p = new UnderrunRebufferPolicy();
    p.beginHold(0, null);
    const max = DEFAULT_UNDERRUN_POLICY.maxHoldMs;
    expect(p.shouldResume(1, max)).toBe(false); // below minResumeS
    expect(p.shouldResume(2, max)).toBe(true);
  });

  it("does not hold when no hold is active", () => {
    expect(new UnderrunRebufferPolicy().shouldResume(0, 0)).toBe(true);
  });

  it("reset clears both the hold and the escalation history", () => {
    const p = new UnderrunRebufferPolicy();
    p.beginHold(0, null);
    p.beginHold(1000, null);
    p.reset();
    expect(p.hold).toBeNull();
    expect(p.beginHold(2000, null).underrunNumber).toBe(1);
  });
});

describe("DeliveryRateTracker", () => {
  it("has no opinion until enough history exists", () => {
    const d = new DeliveryRateTracker();
    d.record(0, 100);
    d.record(5_000, 103);
    expect(d.ratio()).toBeNull();
  });

  it("measures a below-realtime stream", () => {
    // field log: buffered end grew ~3s per ~6.3s of wall time
    const d = new DeliveryRateTracker();
    let end = 779;
    for (let ms = 0; ms <= 31_500; ms += 6_300) {
      d.record(ms, end);
      end += 3;
    }
    expect(d.ratio()!).toBeGreaterThan(0.4);
    expect(d.ratio()!).toBeLessThan(0.55);
  });

  it("measures a realtime stream as ~1x", () => {
    const d = new DeliveryRateTracker();
    for (let ms = 0; ms <= 30_000; ms += 500) {
      d.record(ms, 100 + Math.floor(ms / 3000) * 3);
    }
    expect(d.ratio()!).toBeCloseTo(1, 1);
  });

  it("only looks at the recent window", () => {
    const d = new DeliveryRateTracker(30_000, 10_000);
    // a fast burst long ago, then a slow trickle
    d.record(0, 0);
    d.record(1_000, 60);
    for (let ms = 31_000; ms <= 91_000; ms += 1_000) {
      d.record(ms, 60 + (ms - 31_000) / 2000);
    }
    expect(d.ratio()!).toBeCloseTo(0.5, 1);
  });

  it("restarts after the buffered timeline goes backwards", () => {
    const d = new DeliveryRateTracker();
    d.record(0, 500);
    d.record(20_000, 520);
    d.record(21_000, 3);
    expect(d.ratio()).toBeNull();
  });
});
