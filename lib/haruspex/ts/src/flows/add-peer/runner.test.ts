import { describe, expect, it, vi } from "vitest";

import { createAddPeerFlow } from "./runner.js";
import type { AddPeerFlowDeps, PendingRemote, PeerServerInfo, SavedRemote } from "./types.js";

const NODE_ID = "c".repeat(64);

const INFO: PeerServerInfo = {
  name: "hub",
  version: "1.0",
  requires_auth: true,
  knocking_enabled: false,
};

/** in-memory deps: a pending-remote store + scriptable network answers. */
function makeDeps(overrides: Partial<AddPeerFlowDeps> = {}): {
  deps: AddPeerFlowDeps;
  pendingStore: Map<string, PendingRemote>;
  remotes: SavedRemote[];
  timers: Array<{ id: string; ms: number; fire: () => void }>;
} {
  const pendingStore = new Map<string, PendingRemote>();
  const remotes: SavedRemote[] = [];
  const timers: Array<{ id: string; ms: number; fire: () => void }> = [];
  let nextId = 1;

  const deps: AddPeerFlowDeps = {
    getAllRemotes: async () => [...remotes],
    getAllPendingRemotes: async () => [...pendingStore.values()],
    getPendingRemoteByPeerAddr: async (addr) =>
      [...pendingStore.values()].find((p) => p.peer_addr === addr) ?? null,
    createPendingRemote: async (record) => {
      const created = { ...record, id: `p${nextId++}` };
      pendingStore.set(created.id, created);
      return created;
    },
    updatePendingRemote: async (id, patch) => {
      const existing = pendingStore.get(id);
      if (existing) pendingStore.set(id, { ...existing, ...patch });
    },
    deletePendingRemote: async (id) => {
      pendingStore.delete(id);
    },
    deletePendingRemoteByPeerAddr: async (addr) => {
      for (const [id, p] of pendingStore) {
        if (p.peer_addr === addr) pendingStore.delete(id);
      }
    },
    createRemote: async (input) => {
      const remote: SavedRemote = {
        remote_id: `r${nextId++}`,
        name: "hub",
        base_url: input.base_url,
        peer_addr: input.peer_addr,
      };
      remotes.push(remote);
      return remote;
    },
    getServerInfo: async () => INFO,
    whoami: async () => false,
    sendKnock: async () => {},
    checkKnockStatus: async () => "pending",
    authenticateHttp: async () => {},
    redeemInvite: async () => {},
    registerWithPasskey: async () => {},
    loginWithPasskey: async () => {},
    transportFor: (target) => (target.type === "p2p" ? "wasm" : "http"),
    scheduleTimer: (id, ms, fire) => {
      timers.push({ id, ms, fire });
      return () => {};
    },
    ...overrides,
  };
  return { deps, pendingStore, remotes, timers };
}

describe("createAddPeerFlow (bundled runner)", () => {
  it("drives submit -> probe -> auth for an unauthed peer, persisting the pending stages", async () => {
    const { deps, pendingStore } = makeDeps();
    const flow = createAddPeerFlow(deps);

    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });

    const state = flow.state();
    expect(state.step).toBe("auth");
    const records = [...pendingStore.values()];
    expect(records).toHaveLength(1);
    expect(records[0].stage).toBe("connected");
    expect(records[0].server_name).toBe("hub");
    expect(records[0].transport).toBe("wasm");
  });

  it("short-circuits to complete when whoami already succeeds, then dismisses via the timer", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { deps, pendingStore, timers } = makeDeps({
      whoami: async () => true,
      onSuccess,
      onClose,
    });
    const flow = createAddPeerFlow(deps);

    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });

    expect(flow.state().step).toBe("complete");
    // pending record was deleted after the remote was created
    expect(pendingStore.size).toBe(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1500);

    timers[0].fire();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ peer_addr: NODE_ID })
    );
    expect(flow.state().step).toBe("url");
  });

  it("rejects a duplicate before persisting anything", async () => {
    const { deps, pendingStore } = makeDeps({
      getAllRemotes: async () => [{ remote_id: "r0", name: "old hub", peer_addr: NODE_ID }],
    });
    const flow = createAddPeerFlow(deps);

    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });

    const state = flow.state();
    expect(state.step).toBe("url");
    expect(state.step === "url" && state.error).toContain('already added as "old hub"');
    expect(pendingStore.size).toBe(0);
  });

  it("marks the pending record failed with a mapped error when the probe throws", async () => {
    const { deps, pendingStore } = makeDeps({
      getServerInfo: async () => {
        throw new Error("connect timeout after 30s");
      },
    });
    const flow = createAddPeerFlow(deps);

    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });

    const state = flow.state();
    expect(state.step).toBe("url");
    expect(state.step === "url" && state.error).toMatch(/timed out/);
    const records = [...pendingStore.values()];
    expect(records[0].stage).toBe("failed");
    expect(records[0].error_message).toMatch(/timed out/);
  });

  it("routes an auth-rejected probe to the knock form when knocking is enabled", async () => {
    let calls = 0;
    const { deps } = makeDeps({
      getServerInfo: async () => {
        calls++;
        // first read rejects with a 403; the public re-read succeeds
        if (calls === 1) throw new Error("403 Forbidden");
        return { ...INFO, knocking_enabled: true };
      },
    });
    const flow = createAddPeerFlow(deps);

    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });

    const state = flow.state();
    expect(state.step).toBe("url");
    expect(state.step === "url" && state.subStep).toBe("knock_form");
    expect(state.step === "url" && state.error).toMatch(/request access/);
  });

  it("runs the knock flow end to end and resumes it to completion", async () => {
    let knockStatus: "accepted" | "rejected" | "pending" | null = "pending";
    const sendKnock = vi.fn(async () => {});
    const { deps, pendingStore } = makeDeps({
      getServerInfo: async () => ({ ...INFO, knocking_enabled: true }),
      sendKnock,
      checkKnockStatus: async () => knockStatus,
      whoami: async () => knockStatus === "accepted",
    });
    const flow = createAddPeerFlow(deps);

    // submit -> knock form (knocking enabled, not authed)
    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });
    expect(flow.state().step === "url" && (flow.state() as { subStep: string }).subStep).toBe(
      "knock_form"
    );

    // send the knock
    await flow.dispatch({ type: "SUBMIT_KNOCK", username: "ed", message: "hello" });
    expect(sendKnock).toHaveBeenCalledWith(NODE_ID, "ed", "hello");
    expect(flow.state().step).toBe("knock_sent");
    const pending = [...pendingStore.values()][0];
    expect(pending.stage).toBe("knock_pending");
    expect(pending.knock_username).toBe("ed");

    // later: the knock has been accepted; the user retries from the list
    knockStatus = "accepted";
    await flow.dispatch({ type: "MODAL_OPEN" });
    await flow.dispatch({ type: "RETRY_PENDING", pending });

    expect(flow.state().step).toBe("complete");
    expect(pendingStore.size).toBe(0);
  });

  it("discards a probe result that was cancelled by BACK", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps } = makeDeps({
      getServerInfo: async () => {
        await gate;
        return INFO;
      },
    });
    const flow = createAddPeerFlow(deps);

    const submitted = flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });
    // give the duplicate check a chance to finish and the probe to start
    await new Promise((r) => setTimeout(r, 0));
    await flow.dispatch({ type: "BACK" });
    release();
    await submitted;

    // the machine stayed in url/input; the late probe result was discarded
    expect(flow.state().step).toBe("url");
  });

  it("dispose cancels timers and ignores further events", async () => {
    const cancel = vi.fn(() => {});
    const { deps } = makeDeps({
      whoami: async () => true,
      scheduleTimer: (_id, _ms, _fire) => cancel,
    });
    const flow = createAddPeerFlow(deps);
    await flow.dispatch({ type: "SUBMIT_URL", input: NODE_ID });
    expect(flow.state().step).toBe("complete");

    flow.dispose();
    expect(cancel).toHaveBeenCalled();
    expect(flow.send({ type: "MODAL_OPEN" })).toEqual([]);
  });
});
