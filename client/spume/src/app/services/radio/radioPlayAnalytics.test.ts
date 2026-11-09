import { describe, expect, it } from "vitest";
import { RadioPlayAnalytics, type RadioPlayObservation } from "./radioPlayAnalytics";

const observation: RadioPlayObservation = {
  stationKey: "station",
  initSeq: 1,
  entityId: "track",
  kind: "song",
  positionS: 0,
  durationS: 100,
  playing: true,
};

describe("radio play qualification", () => {
  it.each(["song", "video"] as const)("counts a %s only after >90% actual playback", (kind) => {
    const tracker = new RadioPlayAnalytics();
    for (let positionS = 0; positionS <= 90; positionS++) {
      expect(tracker.observe({ ...observation, kind, positionS }, positionS * 1000)).toBeNull();
    }
    expect(tracker.observe({ ...observation, kind, positionS: 91 }, 91_000)).toEqual({
      played_seconds: 91,
      duration_seconds: 100,
    });
    expect(tracker.observe({ ...observation, kind, positionS: 92 }, 92_000)).toBeNull();
  });

  it("does not credit a midstream join, skip, retune, or resumed position", () => {
    const tracker = new RadioPlayAnalytics();
    for (let positionS = 91; positionS <= 100; positionS++) {
      expect(tracker.observe({ ...observation, positionS })).toBeNull();
    }
    expect(tracker.observe({ ...observation, initSeq: 2, positionS: 99 })).toBeNull();
    expect(tracker.observe({ ...observation, stationKey: "other", positionS: 99 })).toBeNull();
    tracker.reset();
    expect(tracker.observe({ ...observation, positionS: 99 })).toBeNull();
  });

  it("keeps actual listening across a pause without counting the paused interval", () => {
    const tracker = new RadioPlayAnalytics();
    for (let positionS = 0; positionS <= 80; positionS++) {
      tracker.observe({ ...observation, positionS }, positionS * 1000);
    }
    tracker.pause(80_000);
    expect(tracker.observe({ ...observation, positionS: 81 }, 81_000)).toBeNull();
    for (let positionS = 82; positionS <= 91; positionS++) {
      expect(tracker.observe({ ...observation, positionS }, positionS * 1000)).toBeNull();
    }
    expect(tracker.observe({ ...observation, positionS: 92 }, 92_000)).not.toBeNull();
  });
});
