import { describe, expect, it, vi } from "vitest";
import { RadioVideoProgress, type RadioVideoObservation } from "./radioVideoProgress";

function setup() {
  const upsert = vi.fn(async (_req: unknown) => ({ success: true, data: {} }));
  const client = { entities: { upsertPlaybackProgress: upsert } } as never;
  const tracker = new RadioVideoProgress();
  const observe = (o: Partial<RadioVideoObservation>, now: number) =>
    tracker.observe(
      {
        initSeq: 10,
        videoId: "ep1",
        durationS: 600,
        positionS: 0,
        playing: true,
        getClient: async () => client,
        sessionId: () => "radio-session",
        ...o,
      },
      now
    );
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { upsert, tracker, observe, settle };
}

describe("RadioVideoProgress", () => {
  it("syncs at most once a minute while playing", async () => {
    const { upsert, observe, settle } = setup();
    observe({ positionS: 1 }, 0);
    observe({ positionS: 30 }, 30_000);
    await settle();
    expect(upsert).not.toHaveBeenCalled();
    observe({ positionS: 61 }, 61_000);
    await settle();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: "ep1",
        position_seconds: 61,
        session_id: "radio-session",
      })
    );
  });

  it("reports a natural end as finished even when the listener joined mid-episode", async () => {
    const { upsert, tracker, observe, settle } = setup();
    observe({ positionS: 0 }, 0);
    observe({ positionS: 120 }, 1_000);
    tracker.markEnded(10);
    observe({ initSeq: 20, videoId: "ep2", positionS: 0 }, 2_000);
    await settle();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: "ep1", position_fraction: 1, position_seconds: 600 })
    );
  });

  it("keeps the furthest position when a skip or retune cuts an episode short", async () => {
    const { upsert, tracker, observe, settle } = setup();
    observe({ positionS: 200 }, 0);
    // a resync re-primes the same video under a new init_seq from zero.
    observe({ initSeq: 11, positionS: 0 }, 1_000);
    observe({ initSeq: 11, positionS: 5 }, 2_000);
    observe({ initSeq: 30, videoId: "ep2" }, 3_000);
    tracker.markEnded(11);
    await tracker.flush();
    await settle();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: "ep1", position_seconds: 200 })
    );
  });

  it("flushes when a switching banner or song replaces the video", async () => {
    const { upsert, observe, settle } = setup();
    observe({ positionS: 90 }, 0);
    observe({ videoId: null, positionS: 0 }, 1_000);
    await settle();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ position_seconds: 90 }));
  });
});
