import { describe, expect, it } from "vitest";
import { PlayCompletion } from "./playCompletion";

describe("play qualification", () => {
  it("requires strictly more than 90%, once per play", () => {
    const tracker = new PlayCompletion();
    for (let time = 0; time <= 90; time++) {
      expect(tracker.observe(time, 100, true, time * 1000)).toBe(false);
    }
    expect(tracker.observe(91, 100, true, 91_000)).toBe(true);
    expect(tracker.eventData(100)).toEqual({ played_seconds: 91, duration_seconds: 100 });
    expect(tracker.observe(92, 100, true, 92_000)).toBe(false);
  });

  it("does not turn a resume position, seeking, or paused time into playback", () => {
    const tracker = new PlayCompletion();
    expect(tracker.observe(91, 100, true, 0)).toBe(false);
    expect(tracker.observe(98, 100, true, 1000)).toBe(false);
    expect(tracker.observe(1, 100, false, 2000)).toBe(false);
    expect(tracker.observe(4, 100, true, 3000)).toBe(false);
    expect(tracker.playedSeconds).toBe(0);
    tracker.observe(5, 100, true, 4000);
    expect(tracker.playedSeconds).toBe(1);
  });

  it("ignores invalid durations and nonfinite positions", () => {
    const tracker = new PlayCompletion();
    expect(tracker.observe(Number.NaN, 0, true, 0)).toBe(false);
    expect(tracker.observe(1, Number.POSITIVE_INFINITY, true, 1000)).toBe(false);
    expect(tracker.observe(2, -1, true, 2000)).toBe(false);
    expect(tracker.playedSeconds).toBe(1);
  });

  it("caps repeated short seeks by actual elapsed time", () => {
    const tracker = new PlayCompletion();
    for (let position = 0; position <= 100; position += 2) {
      expect(tracker.observe(position, 100, true, position * 10)).toBe(false);
    }
    expect(tracker.playedSeconds).toBeCloseTo(1);
  });

  it("does not lose listening time when other signals rerun an effect at the same position", () => {
    const tracker = new PlayCompletion();
    tracker.observe(0, 100, true, 0);
    tracker.observe(0, 100, true, 900);
    tracker.observe(1, 100, true, 1000);
    expect(tracker.playedSeconds).toBe(1);
  });
});
