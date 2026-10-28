// dispatcher routing for the radio source-access additions: the new
// `request_source_access` command, and a backend's classified
// `PlaybackCommandError` turning into a specific ack reason (+ detail)
// instead of the generic `invalid_command`.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./statusSubscribers", () => ({ broadcastStatus: vi.fn() }));

import { dispatchCommand } from "./dispatcher";
import { PlaybackCommandError, type PlaybackBackend } from "./playbackBackend";
import { broadcastStatus } from "./statusSubscribers";

const STATUS = { type: "status", state: "stopped" } as const;

function backend(overrides: Partial<PlaybackBackend> = {}): PlaybackBackend {
  return {
    startRadio: vi.fn(async () => {}),
    requestSourceAccess: vi.fn(async () => {}),
    currentStatus: vi.fn(() => STATUS),
    ...overrides,
  } as unknown as PlaybackBackend;
}

beforeEach(() => vi.clearAllMocks());

describe("dispatchCommand radio source access", () => {
  it("routes request_source_access to the backend", async () => {
    const b = backend();
    const ack = await dispatchCommand(
      b,
      null,
      JSON.stringify({
        type: "control",
        command: "request_source_access",
        peer_addr: "peer-a",
        username: "living room",
        message: "hi",
      })
    );
    expect(ack.ok).toBe(true);
    expect(b.requestSourceAccess).toHaveBeenCalledWith("peer-a", "living room", "hi");
  });

  it("acks a PlaybackCommandError with its reason, detail and status", async () => {
    const b = backend({
      startRadio: vi.fn(async () => {
        throw new PlaybackCommandError("source_access_denied", "stream closed");
      }),
    });
    const ack = await dispatchCommand(
      b,
      null,
      JSON.stringify({ type: "control", command: "tune_radio", peer_addr: "peer-a" })
    );
    expect(ack).toEqual({
      type: "command_ack",
      ok: false,
      reason: "source_access_denied",
      detail: "stream closed",
      status: STATUS,
    });
    expect(broadcastStatus).toHaveBeenCalledWith(STATUS);
  });

  it("still reports an unclassified throw as invalid_command", async () => {
    const b = backend({
      startRadio: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const ack = await dispatchCommand(
      b,
      null,
      JSON.stringify({ type: "control", command: "tune_radio", peer_addr: "peer-a" })
    );
    expect(ack).toEqual({ type: "command_ack", ok: false, reason: "invalid_command" });
  });
});
