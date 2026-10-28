// controller-side "tune radio on whichever target is active" (see
// playerRadio.ts): local passthrough, the admin `peers_allow` bridge +
// single retry, and the denied -> "request access" toast -> player knock
// flow. every network/ui boundary is mocked; the real routing logic isn't.

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  target: { kind: "local" } as
    { kind: "local" } | { kind: "player"; node_id: string; username: string },
  tuneIntoRadio: vi.fn(),
  leaveRadio: vi.fn(),
  radioStatus: vi.fn(() => "idle"),
  remoteTuneRadio: vi.fn(),
  remoteRequestSourceAccess: vi.fn(),
  getRemoteByPeerAddr: vi.fn(),
  getTauriManagedRemote: vi.fn(),
  getLocalNodeIdAsync: vi.fn(),
  remoteDispatch: vi.fn(),
  localDispatch: vi.fn(),
  localAdminAvailable: true,
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("./activeTarget", () => ({ activeTarget: () => m.target }));
vi.mock("../radio/radioService", () => ({
  tuneIntoRadio: m.tuneIntoRadio,
  leaveRadio: m.leaveRadio,
  radioStatus: m.radioStatus,
}));
vi.mock("./remotePlaybackControl", () => ({
  remoteTuneRadio: m.remoteTuneRadio,
  remoteRequestSourceAccess: m.remoteRequestSourceAccess,
  remoteTrackPending: <T>(p: Promise<T>) => p,
}));
vi.mock("../remotes/remoteManager", () => ({
  getRemoteByPeerAddr: m.getRemoteByPeerAddr,
  getTauriManagedRemote: m.getTauriManagedRemote,
}));
vi.mock("../storage/schemas/remote", () => ({
  isP2PRemote: (r: { transport?: string }) => r?.transport === "p2p",
}));
vi.mock("../../api/client", () => ({ getLocalNodeIdAsync: m.getLocalNodeIdAsync }));
vi.mock("../../api/adminClient", () => ({
  adminClientFor: vi.fn(async () => ({ dispatchOrThrow: m.remoteDispatch })),
  getLocalAdminClient: () => (m.localAdminAvailable ? { dispatchOrThrow: m.localDispatch } : null),
}));
vi.mock("../../../components/feedback/Toast", () => ({ toast: m.toast }));
vi.mock("../../../utils/logger", () => ({ warn: vi.fn() }));

import { tuneRadio, tuneRadioOnPlayer } from "./playerRadio";

const PLAYER = { kind: "player" as const, node_id: "player-node", username: "living room" };
const ok = { type: "command_ack", ok: true };
const denied = { type: "command_ack", ok: false, reason: "source_access_denied" };

beforeEach(() => {
  vi.clearAllMocks();
  m.target = PLAYER;
  m.localAdminAvailable = true;
  m.radioStatus.mockReturnValue("idle");
  m.getRemoteByPeerAddr.mockResolvedValue({ name: "basement", transport: "p2p" });
  m.getTauriManagedRemote.mockResolvedValue({ name: "my desktop" });
  m.getLocalNodeIdAsync.mockResolvedValue("own-node");
  m.remoteDispatch.mockResolvedValue({});
  m.localDispatch.mockResolvedValue({});
});

describe("tuneRadio routing", () => {
  it("tunes locally when this device is the active target", async () => {
    m.target = { kind: "local" };
    await tuneRadio("peer-a", { stationId: "s1" });
    expect(m.tuneIntoRadio).toHaveBeenCalledWith("peer-a", { stationId: "s1" });
    expect(m.remoteTuneRadio).not.toHaveBeenCalled();
  });

  it("tells the active player to tune in, stopping local radio first", async () => {
    m.radioStatus.mockReturnValue("playing");
    m.remoteTuneRadio.mockResolvedValue(ok);
    await tuneRadio("peer-a", { stationId: "s1" });
    expect(m.leaveRadio).toHaveBeenCalled();
    expect(m.remoteTuneRadio).toHaveBeenCalledWith("peer-a", "s1");
    expect(m.tuneIntoRadio).not.toHaveBeenCalled();
    expect(m.toast.error).not.toHaveBeenCalled();
  });

  it("addresses a local station by this device's own node id", async () => {
    m.remoteTuneRadio.mockResolvedValue(ok);
    await tuneRadio("self", { stationId: "s1", isLocal: true });
    expect(m.remoteTuneRadio).toHaveBeenCalledWith("own-node", "s1");
  });
});

describe("source access", () => {
  it("grants the player access as admin and retries once", async () => {
    m.remoteTuneRadio.mockResolvedValueOnce(denied).mockResolvedValueOnce(ok);
    await tuneRadio("peer-a", { stationId: "s1" });
    expect(m.remoteDispatch).toHaveBeenCalledWith("peers_allow", { node_id: "player-node" });
    expect(m.remoteTuneRadio).toHaveBeenCalledTimes(2);
    expect(m.toast.error).not.toHaveBeenCalled();
  });

  it("uses the local admin client for this device's own stations", async () => {
    m.remoteTuneRadio.mockResolvedValueOnce(denied).mockResolvedValueOnce(ok);
    await tuneRadio("self", { isLocal: true });
    expect(m.localDispatch).toHaveBeenCalledWith("peers_allow", { node_id: "player-node" });
    expect(m.remoteDispatch).not.toHaveBeenCalled();
    expect(m.remoteTuneRadio).toHaveBeenCalledTimes(2);
  });

  it("without admin rights, explains and offers a player access request", async () => {
    m.remoteDispatch.mockRejectedValue(new Error("forbidden"));
    m.remoteTuneRadio.mockResolvedValue(denied);
    await tuneRadio("peer-a", { stationId: "s1", stationName: "night shift" });

    expect(m.remoteTuneRadio).toHaveBeenCalledTimes(1);
    expect(m.toast.error).toHaveBeenCalledTimes(1);
    const [message, opts] = m.toast.error.mock.calls[0];
    expect(message).toContain("living room doesn't have access to basement");
    expect(opts.persistent).toBe(true);
    expect(opts.action.label).toBe("request access");

    m.remoteRequestSourceAccess.mockResolvedValue(ok);
    opts.action.onClick();
    await vi.waitFor(() => expect(m.toast.success).toHaveBeenCalled());
    expect(m.remoteRequestSourceAccess).toHaveBeenCalledWith(
      "peer-a",
      "living room",
      expect.stringContaining("night shift")
    );
  });

  it("does not retry when the bridge isn't possible (non-P2P remote)", async () => {
    m.getRemoteByPeerAddr.mockResolvedValue({ name: "web remote", transport: "http" });
    m.remoteTuneRadio.mockResolvedValue(denied);
    await tuneRadio("https://example.test", {});
    expect(m.remoteDispatch).not.toHaveBeenCalled();
    expect(m.remoteTuneRadio).toHaveBeenCalledTimes(1);
    expect(m.toast.error.mock.calls[0][0]).toContain("web remote");
  });

  it("reports a failed access request with the player's detail", async () => {
    m.remoteDispatch.mockRejectedValue(new Error("forbidden"));
    m.remoteTuneRadio.mockResolvedValue(denied);
    await tuneRadio("peer-a", {});
    m.remoteRequestSourceAccess.mockResolvedValue({
      type: "command_ack",
      ok: false,
      reason: "request_access_failed",
      detail: "knocking is disabled",
    });
    m.toast.error.mock.calls[0][1].action.onClick();
    await vi.waitFor(() => expect(m.toast.error).toHaveBeenCalledTimes(2));
    expect(m.toast.error.mock.calls[1][0]).toContain("knocking is disabled");
  });
});

describe("other failures", () => {
  it("toasts an unreachable source without offering an access request", async () => {
    m.remoteTuneRadio.mockResolvedValue({
      type: "command_ack",
      ok: false,
      reason: "source_unreachable",
    });
    await tuneRadio("peer-a", {});
    expect(m.toast.error).toHaveBeenCalledTimes(1);
    expect(m.toast.error.mock.calls[0][0]).toContain("couldn't reach basement");
    expect(m.toast.error.mock.calls[0][1].action).toBeUndefined();
  });

  it("reports an unreachable player as not reached (never rejects)", async () => {
    m.remoteTuneRadio.mockRejectedValue(new Error("dial failed"));
    await expect(tuneRadioOnPlayer(PLAYER, "peer-a", {})).resolves.toBe(false);
    expect(m.toast.error).toHaveBeenCalledWith("dial failed", expect.anything());
  });
});
