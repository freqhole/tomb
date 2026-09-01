// @vitest-environment jsdom
// tests for the video-window PlayerBackend adapter.
//
// the window owns decoding; this class only translates between spume's
// PlayerBackend surface and the window's IPC. the translation is the part worth
// pinning - a wrong mapping here shows up as a stuck playerbar rather than an
// obvious error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerEvent } from "@freqhole/api-client";

const sendVideoWindowCommand = vi.fn(async () => {});
const resolveLocalVideoPath = vi.fn(async (): Promise<string | null> => "/lib/v1.mp4");
let emitWindowEvent: (e: unknown) => void = () => {};

vi.mock("./videoWindowClient", () => ({
  sendVideoWindowCommand: (...a: unknown[]) => sendVideoWindowCommand(...(a as [])),
  onVideoWindowEvent: (fn: (e: unknown) => void) => {
    emitWindowEvent = fn;
    return () => {};
  },
}));
vi.mock("./localVideo", () => ({
  resolveLocalVideoPath: (...a: unknown[]) => resolveLocalVideoPath(...(a as [])),
}));

import { VideoWindowBackend } from "./videoWindowBackend";

function videoItem(over: Record<string, unknown> = {}) {
  return { kind: "video", video: { id: "v1", title: "a video", ...over } } as never;
}

let backend: VideoWindowBackend;
let events: PlayerEvent[];

beforeEach(() => {
  vi.clearAllMocks();
  resolveLocalVideoPath.mockResolvedValue("/lib/v1.mp4");
  backend = new VideoWindowBackend();
  events = [];
  backend.subscribe((e) => events.push(e));
});

describe("loadAndPlay", () => {
  it("opens the resolved filesystem path", async () => {
    await backend.loadAndPlay(videoItem());
    expect(sendVideoWindowCommand).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "load", path: "/lib/v1.mp4" })
    );
  });

  it("passes a resume position in seconds", async () => {
    await backend.loadAndPlay(videoItem(), { initialPosition: 90_000 });
    expect(sendVideoWindowCommand).toHaveBeenCalledWith(
      expect.objectContaining({ start_seconds: 90 })
    );
  });

  // gstreamer opens a real file; without one there is nothing to play
  it("throws no_local_path when the file cannot be resolved", async () => {
    resolveLocalVideoPath.mockResolvedValue(null);
    await expect(backend.loadAndPlay(videoItem())).rejects.toMatchObject({
      error_type: "no_local_path",
    });
  });

  it("refuses a song item", async () => {
    const song = { kind: "song", song: { sha256: "a" } } as never;
    await expect(backend.loadAndPlay(song)).rejects.toMatchObject({
      error_type: "unsupported_media_kind",
    });
  });

  it("reports loading before the window replies", async () => {
    await backend.loadAndPlay(videoItem());
    expect(events).toContainEqual({ kind: "state", state: "loading" });
  });
});

describe("command translation", () => {
  it("maps seek from ms to seconds", async () => {
    await backend.send({ kind: "seek", ms: 42_000 });
    expect(sendVideoWindowCommand).toHaveBeenCalledWith({ kind: "seek", seconds: 42 });
  });

  it("clamps volume", async () => {
    await backend.send({ kind: "set_volume", v: 5 });
    expect(sendVideoWindowCommand).toHaveBeenCalledWith({ kind: "set_volume", volume: 1 });
  });

  // there is no "stop" for a window - stopping means closing it
  it("maps stop onto closing the window", async () => {
    await backend.send({ kind: "stop" });
    expect(sendVideoWindowCommand).toHaveBeenCalledWith({ kind: "close" });
  });
});

describe("event translation", () => {
  it("reports duration before any position is known", () => {
    emitWindowEvent({ kind: "duration", seconds: 100 });
    expect(events).toContainEqual({ kind: "progress", ms: 0, total_ms: 100_000 });
  });

  it("carries duration through subsequent position updates", () => {
    emitWindowEvent({ kind: "duration", seconds: 100 });
    emitWindowEvent({ kind: "position", seconds: 12.5 });
    expect(events).toContainEqual({ kind: "progress", ms: 12_500, total_ms: 100_000 });
  });

  it("maps playing and paused onto player state", () => {
    emitWindowEvent({ kind: "playing" });
    expect(backend.snapshot().state).toBe("playing");
    emitWindowEvent({ kind: "paused" });
    expect(backend.snapshot().state).toBe("paused");
  });

  it("emits ended so the queue can advance", () => {
    emitWindowEvent({ kind: "ended" });
    expect(events).toContainEqual({ kind: "ended" });
  });

  // closing the window is a user action; the playerbar must not keep
  // showing a playing item afterwards
  it("treats a window close as stopping playback", () => {
    emitWindowEvent({ kind: "playing" });
    emitWindowEvent({ kind: "closed" });
    expect(backend.snapshot().state).toBe("stopped");
    expect(events).toContainEqual({ kind: "state", state: "stopped" });
  });

  it("surfaces a missing codec with a recognisable error_type", () => {
    emitWindowEvent({
      kind: "error",
      error_type: "missing_plugin",
      message: "no decoder for video/x-h264",
    });
    const err = events.find((e) => e.kind === "error");
    expect(err).toMatchObject({ detail: { error_type: "missing_plugin" } });
  });

  it("ignores fullscreen changes, which are window-local", () => {
    emitWindowEvent({ kind: "fullscreen", fullscreen: true });
    expect(events).toHaveLength(0);
  });
});

describe("dispose", () => {
  it("closes the window and stops emitting", async () => {
    await backend.dispose();
    expect(sendVideoWindowCommand).toHaveBeenCalledWith({ kind: "close" });
    emitWindowEvent({ kind: "playing" });
    expect(events).toHaveLength(0);
  });

  it("survives the window already being gone", async () => {
    sendVideoWindowCommand.mockRejectedValue(new Error("no window"));
    await expect(backend.dispose()).resolves.toBeUndefined();
  });
});
