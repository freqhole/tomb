import { describe, expect, it } from "vitest";
import { AppendedChunkLog } from "./radioResumePoint";

const logWith = () => {
  const log = new AppendedChunkLog();
  log.record({ initSeq: 10, seq: 11, startS: 0, endS: 3 });
  log.record({ initSeq: 10, seq: 12, startS: 3, endS: 6 });
  log.record({ initSeq: 20, seq: 21, startS: 6, endS: 9 });
  return log;
};

describe("AppendedChunkLog", () => {
  it("finds the chunk playing at the current time with its offset", () => {
    expect(logWith().resumePointAt(4.25)).toEqual({ initSeq: 10, seq: 12, offsetMs: 1250 });
    expect(logWith().resumePointAt(6)).toEqual({ initSeq: 20, seq: 21, offsetMs: 0 });
  });

  it("returns null outside anything recorded", () => {
    expect(logWith().resumePointAt(42)).toBeNull();
    expect(logWith().resumePointAt(Number.NaN)).toBeNull();
    expect(new AppendedChunkLog().resumePointAt(1)).toBeNull();
  });

  it("forgets everything after a clear (rebuilt timeline)", () => {
    const log = logWith();
    log.clear();
    expect(log.size).toBe(0);
    expect(log.resumePointAt(1)).toBeNull();
  });

  it("ignores empty chunks and stays bounded", () => {
    const log = new AppendedChunkLog(2);
    log.record({ initSeq: 1, seq: 2, startS: 5, endS: 5 });
    expect(log.size).toBe(0);
    log.record({ initSeq: 1, seq: 2, startS: 0, endS: 3 });
    log.record({ initSeq: 1, seq: 3, startS: 3, endS: 6 });
    log.record({ initSeq: 1, seq: 4, startS: 6, endS: 9 });
    expect(log.size).toBe(2);
    expect(log.resumePointAt(1)).toBeNull();
    expect(log.resumePointAt(7)?.seq).toBe(4);
  });

  it("maps a resume point back onto a fresh timeline", () => {
    // after resuming, the same chunk lands somewhere else on the new
    // media element's timeline.
    const log = new AppendedChunkLog();
    log.record({ initSeq: 10, seq: 12, startS: 100, endS: 103 });
    expect(log.seekTargetFor({ initSeq: 10, seq: 12, offsetMs: 1500 })).toBe(101.5);
    expect(log.seekTargetFor({ initSeq: 10, seq: 12, offsetMs: 9000 })).toBe(103);
    expect(log.seekTargetFor({ initSeq: 11, seq: 12, offsetMs: 0 })).toBeNull();
  });

  it("estimates the track position from where its init landed", () => {
    const log = logWith();
    log.recordTrackStart(20, 6);
    expect(log.trackPositionAt(20, 8.5)).toBe(2.5);
    expect(log.trackPositionAt(10, 4)).toBe(0);
    log.clear();
    expect(log.trackPositionAt(20, 8.5)).toBe(0);
  });
});
