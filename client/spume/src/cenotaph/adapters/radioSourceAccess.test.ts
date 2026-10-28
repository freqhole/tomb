// player-side radio tune classification + access request (see
// radioSourceAccess.ts) - everything networked is injected via `deps`, the
// module mocks below only keep the real wasm/midden import chain out.

import { describe, expect, it, vi } from "vitest";

const { SupersededError } = vi.hoisted(() => ({
  SupersededError: class RadioTuneSupersededError extends Error {},
}));

vi.mock("../../app/api/client", () => ({
  getClientForRemote: vi.fn(),
  isAuthError: vi.fn(),
  isCharnelAvailable: () => false,
  isNetworkError: vi.fn(),
}));
vi.mock("../../app/services/radio/radioService", () => ({
  RadioTuneSupersededError: SupersededError,
  tuneIntoRadio: vi.fn(),
}));

import { PlaybackCommandError } from "../control/playbackBackend";
import {
  requestSourceAccess,
  tuneRadioWithAccessCheck,
  type RadioSourceAccessDeps,
  type SourceAccessProbe,
} from "./radioSourceAccess";

function deps(overrides: Partial<RadioSourceAccessDeps> = {}): RadioSourceAccessDeps {
  return {
    tune: vi.fn(async () => {}),
    probe: vi.fn(async (): Promise<SourceAccessProbe> => "authorized"),
    sendKnock: vi.fn(async () => {}),
    ...overrides,
  };
}

async function reasonOf(p: Promise<unknown>): Promise<{ reason: string; detail?: string }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PlaybackCommandError);
    const err = e as PlaybackCommandError;
    return { reason: err.reason, detail: err.detail };
  }
  throw new Error("expected a rejection");
}

describe("tuneRadioWithAccessCheck", () => {
  it("passes a successful tune through without probing", async () => {
    const d = deps();
    await tuneRadioWithAccessCheck("peer-a", "station-1", d);
    expect(d.tune).toHaveBeenCalledWith("peer-a", "station-1");
    expect(d.probe).not.toHaveBeenCalled();
  });

  it("treats a superseded tune as success", async () => {
    const d = deps({
      tune: vi.fn(async () => {
        throw new SupersededError("radio tune superseded");
      }),
    });
    await expect(tuneRadioWithAccessCheck("peer-a", undefined, d)).resolves.toBeUndefined();
    expect(d.probe).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", "source_access_denied"],
    ["unreachable", "source_unreachable"],
    ["authorized", "tune_failed"],
  ] as const)("maps a %s probe after a failed tune to %s", async (probe, reason) => {
    const d = deps({
      tune: vi.fn(async () => {
        throw new Error("stream closed before hello");
      }),
      probe: vi.fn(async () => probe),
    });
    expect(await reasonOf(tuneRadioWithAccessCheck("peer-a", "s", d))).toEqual({
      reason,
      detail: "stream closed before hello",
    });
    expect(d.probe).toHaveBeenCalledWith("peer-a");
  });
});

describe("requestSourceAccess", () => {
  it("sends the knock under the given username and message", async () => {
    const d = deps();
    await requestSourceAccess("peer-a", "living room", "please", d);
    expect(d.sendKnock).toHaveBeenCalledWith("peer-a", "living room", "please");
  });

  it("surfaces a refused knock as request_access_failed with the remote's message", async () => {
    const d = deps({
      sendKnock: vi.fn(async () => {
        throw new Error("knocking is disabled");
      }),
    });
    expect(await reasonOf(requestSourceAccess("peer-a", "living room", undefined, d))).toEqual({
      reason: "request_access_failed",
      detail: "knocking is disabled",
    });
  });
});
