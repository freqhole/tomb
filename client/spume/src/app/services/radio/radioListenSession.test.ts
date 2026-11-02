import { describe, expect, it, vi } from "vitest";
import { RadioListenSession } from "./radioListenSession";

function setup() {
  const music = {
    createPlaybackSession: vi.fn().mockResolvedValue({ success: true, data: { id: "session" } }),
    updatePlaybackSessionItems: vi.fn().mockResolvedValue({ success: true }),
    updatePlaybackSessionStatus: vi.fn().mockResolvedValue({ success: true }),
  };
  const session = new RadioListenSession("station", "station name", async () => ({ music }));
  return { session, music };
}

describe("radio listen session", () => {
  it("records songs and videos in order, not the station's upcoming queue", async () => {
    const { session, music } = setup();
    session.record({ entity_type: "song", entity_id: "song" }, "song-play", 100);
    expect(music.createPlaybackSession).not.toHaveBeenCalled();
    session.start();
    session.record({ entity_type: "song", entity_id: "song" }, "song-play", 100);
    session.record({ entity_type: "video", entity_id: "video" }, "video-play", 200);
    await session.end("completed");
    expect(music.createPlaybackSession).toHaveBeenCalledOnce();
    expect(music.createPlaybackSession).toHaveBeenCalledWith({
      session_type: "radio",
      entity_id: "station",
      label: "station name",
      items: [
        { entity_type: "song", entity_id: "song" },
        { entity_type: "video", entity_id: "video" },
      ],
      total_items: 2,
      total_duration_ms: 300,
    });
    expect(music.updatePlaybackSessionStatus).toHaveBeenCalledWith("session", "completed");
  });

  it("syncs later tracks before closing even when creation is in flight", async () => {
    const { session, music } = setup();
    let created!: (result: { success: true; data: { id: string } }) => void;
    music.createPlaybackSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          created = resolve;
        })
    );
    session.start({ entity_type: "song", entity_id: "first" }, 100);
    await vi.waitFor(() => expect(music.createPlaybackSession).toHaveBeenCalledOnce());
    session.start();
    session.record({ entity_type: "video", entity_id: "second" }, "second", 200);
    const ended = session.end("completed");
    created({ success: true, data: { id: "session" } });
    await ended;
    expect(music.updatePlaybackSessionItems).toHaveBeenCalledOnce();
    expect(music.updatePlaybackSessionItems).toHaveBeenCalledWith("session", {
      id: "session",
      label: "station name",
      items: [
        { entity_type: "song", entity_id: "first" },
        { entity_type: "video", entity_id: "second" },
      ],
      total_items: 2,
      total_duration_ms: 300,
    });
    expect(music.updatePlaybackSessionItems.mock.invocationCallOrder[0]).toBeLessThan(
      music.updatePlaybackSessionStatus.mock.invocationCallOrder[0]
    );
  });

  it("does not duplicate the initial now-playing track when history confirms it", async () => {
    const { session, music } = setup();
    const item = { entity_type: "song", entity_id: "first" } as const;
    session.start(item, 100);
    session.record(item, "confirmed", 100);
    await session.end("completed");
    expect(music.createPlaybackSession.mock.calls[0][0].total_items).toBe(1);
  });

  it("does not create sessions for playback that never starts", async () => {
    const { session, music } = setup();
    session.record({ entity_type: "song", entity_id: "unplayed" }, "unplayed");
    await session.end("abandoned");
    session.start();
    expect(music.createPlaybackSession).not.toHaveBeenCalled();
  });

  it("discards pre-playback metadata for tracks skipped before playback starts", async () => {
    const { session, music } = setup();
    session.record({ entity_type: "song", entity_id: "unplayed" }, "unplayed", 100);
    session.record({ entity_type: "song", entity_id: "heard" }, "heard", 200);
    session.start({ entity_type: "song", entity_id: "heard" }, 200);
    await session.end("completed");
    expect(music.createPlaybackSession.mock.calls[0][0].items).toEqual([
      { entity_type: "song", entity_id: "heard" },
    ]);
    expect(music.createPlaybackSession.mock.calls[0][0].total_duration_ms).toBe(200);
  });

  it("surfaces API errors and retries without losing played items", async () => {
    const { session, music } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      music.createPlaybackSession.mockResolvedValueOnce({ success: false, error: "unavailable" });
      session.start({ entity_type: "song", entity_id: "first" });
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      session.record({ entity_type: "video", entity_id: "second" }, "second");
      await session.end("completed");
      expect(music.createPlaybackSession).toHaveBeenCalledTimes(2);
      expect(music.createPlaybackSession.mock.calls[1][0].total_items).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });
});
