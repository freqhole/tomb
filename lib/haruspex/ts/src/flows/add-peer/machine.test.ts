import { describe, expect, it } from "vitest";

import {
  COMPLETE_DISMISS_MS,
  DISMISS_TIMER_ID,
  initialContext,
  projectState,
  transition,
  type AddPeerContext,
} from "./machine.js";
import type { AddPeerEffect, AddPeerEvent, PendingRemote, PeerServerInfo } from "./types.js";

const NODE_ID = "a".repeat(64);

const INFO: PeerServerInfo = {
  name: "test peer",
  description: null,
  version: "1.0",
  requires_auth: true,
  knocking_enabled: false,
};

function pendingRecord(overrides: Partial<PendingRemote> = {}): PendingRemote {
  return {
    id: "pending-1",
    peer_addr: NODE_ID,
    transport: "wasm",
    stage: "knock_pending",
    server_name: "test peer",
    server_description: null,
    server_version: "1.0",
    server_image_data: null,
    server_image_type: null,
    knock_username: "ed",
    knock_message: "hi",
    error_message: null,
    ...overrides,
  };
}

/** run a sequence of events, returning the final ctx and the effects of
 *  the LAST event. */
function run(events: AddPeerEvent[], start?: AddPeerContext): {
  ctx: AddPeerContext;
  effects: AddPeerEffect[];
} {
  let ctx = start ?? initialContext();
  let effects: AddPeerEffect[] = [];
  for (const event of events) {
    const result = transition(ctx, event);
    ctx = result.ctx;
    effects = result.effects;
  }
  return { ctx, effects };
}

function effectTypes(effects: AddPeerEffect[]): string[] {
  return effects.map((e) => e.type);
}

describe("SUBMIT_URL classification", () => {
  it("rejects empty input with an error, no effects", () => {
    const { ctx, effects } = run([{ type: "SUBMIT_URL", input: "   " }]);
    expect(ctx.step).toBe("url");
    expect(ctx.error).toMatch(/please enter/);
    expect(effects).toEqual([]);
  });

  it("classifies a 64-hex node id as p2p and starts the duplicate check", () => {
    const { ctx, effects } = run([{ type: "SUBMIT_URL", input: NODE_ID }]);
    expect(ctx.step).toBe("testing");
    expect(ctx.peerAddr).toBe(NODE_ID);
    expect(ctx.url).toBe("");
    expect(effects).toEqual([
      { type: "CHECK_DUPLICATE", target: { type: "p2p", peerAddr: NODE_ID } },
    ]);
  });

  it("classifies a hostname as http, normalizing scheme + trailing slash", () => {
    const { ctx, effects } = run([{ type: "SUBMIT_URL", input: "music.example.com/" }]);
    expect(ctx.step).toBe("testing");
    expect(ctx.url).toBe("https://music.example.com");
    expect(ctx.peerAddr).toBeNull();
    expect(effectTypes(effects)).toEqual(["CHECK_DUPLICATE"]);
  });

  it("rejects an unparseable url in place", () => {
    const { ctx, effects } = run([{ type: "SUBMIT_URL", input: "http://" }]);
    expect(ctx.step).toBe("url");
    expect(ctx.error).toMatch(/valid url/);
    expect(effects).toEqual([]);
  });
});

describe("duplicate rejection", () => {
  it("returns to url/input with a specific error on a duplicate", () => {
    const { ctx, effects } = run([
      { type: "SUBMIT_URL", input: NODE_ID },
      { type: "DUPLICATE_RESULT", duplicateName: "my server" },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.subStep).toBe("input");
    expect(ctx.error).toContain('already added as "my server"');
    expect(effects).toEqual([]);
  });

  it("persists the pending record (stage testing) BEFORE probing", () => {
    const { effects } = run([
      { type: "SUBMIT_URL", input: NODE_ID },
      { type: "DUPLICATE_RESULT", duplicateName: null },
    ]);
    // order is load-bearing: persist, clear query param, then probe
    expect(effectTypes(effects)).toEqual([
      "UPSERT_PENDING",
      "CLEAR_QUERY_PARAM",
      "CHECK_CONNECTION",
    ]);
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.peerAddr).toBe(NODE_ID);
    expect(upsert.patch.stage).toBe("testing");
    expect(upsert.patch.error_message).toBeNull();
  });
});

describe("connection outcomes", () => {
  const toProbe: AddPeerEvent[] = [
    { type: "SUBMIT_URL", input: NODE_ID },
    { type: "DUPLICATE_RESULT", duplicateName: null },
  ];

  it("already_authed short-circuits to CREATE_REMOTE", () => {
    const { ctx, effects } = run([
      ...toProbe,
      { type: "CONNECTION_RESULT", outcome: { kind: "already_authed", serverInfo: INFO } },
    ]);
    expect(ctx.step).toBe("testing");
    expect(effects).toEqual([{ type: "CREATE_REMOTE", peerAddr: NODE_ID, url: "" }]);
  });

  it("needs_knock routes to url/knock_form and persists stage connected", () => {
    const { ctx, effects } = run([
      ...toProbe,
      {
        type: "CONNECTION_RESULT",
        outcome: { kind: "needs_knock", serverInfo: { ...INFO, knocking_enabled: true } },
      },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.subStep).toBe("knock_form");
    expect(ctx.serverInfo?.name).toBe("test peer");
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.patch.stage).toBe("connected");
    expect(upsert.patch.server_name).toBe("test peer");
  });

  it("needs_auth routes to auth and persists stage connected", () => {
    const { ctx, effects } = run([
      ...toProbe,
      { type: "CONNECTION_RESULT", outcome: { kind: "needs_auth", serverInfo: INFO } },
    ]);
    expect(ctx.step).toBe("auth");
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.patch.stage).toBe("connected");
  });

  it("failed persists stage failed with the error and returns to url/input", () => {
    const { ctx, effects } = run([
      ...toProbe,
      { type: "CONNECTION_RESULT", outcome: { kind: "failed", error: "peer offline" } },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.subStep).toBe("input");
    expect(ctx.error).toBe("peer offline");
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.patch.stage).toBe("failed");
    expect(upsert.patch.error_message).toBe("peer offline");
  });
});

describe("knock flow", () => {
  const toKnockForm: AddPeerEvent[] = [
    { type: "SUBMIT_URL", input: NODE_ID },
    { type: "DUPLICATE_RESULT", duplicateName: null },
    {
      type: "CONNECTION_RESULT",
      outcome: { kind: "needs_knock", serverInfo: { ...INFO, knocking_enabled: true } },
    },
  ];

  it("SUBMIT_KNOCK emits SEND_KNOCK with the form values", () => {
    const { effects } = run([
      ...toKnockForm,
      { type: "SUBMIT_KNOCK", username: "ed", message: "let me in" },
    ]);
    expect(effects).toEqual([
      { type: "SEND_KNOCK", peerAddr: NODE_ID, username: "ed", message: "let me in" },
    ]);
  });

  it("a successful knock persists stage knock_pending with username/message and enters knock_sent", () => {
    const { ctx, effects } = run([
      ...toKnockForm,
      { type: "SUBMIT_KNOCK", username: "ed", message: "let me in" },
      { type: "KNOCK_SENT_RESULT", ok: true },
    ]);
    expect(ctx.step).toBe("knock_sent");
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.patch.stage).toBe("knock_pending");
    expect(upsert.patch.knock_username).toBe("ed");
    expect(upsert.patch.knock_message).toBe("let me in");
  });

  it("a failed knock stays on the form with the error", () => {
    const { ctx, effects } = run([
      ...toKnockForm,
      { type: "SUBMIT_KNOCK", username: "ed", message: "hi" },
      { type: "KNOCK_SENT_RESULT", ok: false, error: "knock request failed" },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.subStep).toBe("knock_form");
    expect(ctx.error).toBe("knock request failed");
    expect(effects).toEqual([]);
  });

  it("USE_INVITE_CODE escapes the knock form to auth", () => {
    const { ctx } = run([...toKnockForm, { type: "USE_INVITE_CODE" }]);
    expect(ctx.step).toBe("auth");
  });
});

describe("knock-status re-check (RETRY_PENDING resume)", () => {
  const pending = pendingRecord();

  it("a knock-stage pending record triggers CHECK_KNOCK_STATUS", () => {
    const { ctx, effects } = run([{ type: "RETRY_PENDING", pending }]);
    expect(ctx.step).toBe("testing");
    expect(ctx.peerAddr).toBe(NODE_ID);
    expect(effects).toEqual([{ type: "CHECK_KNOCK_STATUS", pending }]);
  });

  it("a non-knock pending record re-runs the normal connection flow", () => {
    const { ctx, effects } = run([
      { type: "RETRY_PENDING", pending: pendingRecord({ stage: "failed" }) },
    ]);
    expect(ctx.step).toBe("testing");
    expect(effectTypes(effects)).toEqual(["CHECK_DUPLICATE"]);
  });

  it("accepted + authed deletes the pending record and creates the remote", () => {
    const { effects } = run([
      { type: "RETRY_PENDING", pending },
      { type: "KNOCK_STATUS_RESULT", outcome: { kind: "accepted_authed", serverInfo: INFO } },
    ]);
    expect(effects).toEqual([
      { type: "DELETE_PENDING", id: "pending-1" },
      { type: "CREATE_REMOTE", peerAddr: NODE_ID, url: "" },
    ]);
  });

  it("accepted + not authed deletes the pending record and routes to auth", () => {
    const { ctx, effects } = run([
      { type: "RETRY_PENDING", pending },
      { type: "KNOCK_STATUS_RESULT", outcome: { kind: "accepted_needs_auth", serverInfo: INFO } },
    ]);
    expect(ctx.step).toBe("auth");
    expect(effects).toEqual([{ type: "DELETE_PENDING", id: "pending-1" }]);
  });

  it("denied persists stage knock_rejected and returns to url/input with the error", () => {
    const { ctx, effects } = run([
      { type: "RETRY_PENDING", pending },
      { type: "KNOCK_STATUS_RESULT", outcome: { kind: "denied" } },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.error).toMatch(/rejected/);
    const upsert = effects[0] as Extract<AddPeerEffect, { type: "UPSERT_PENDING" }>;
    expect(upsert.patch.stage).toBe("knock_rejected");
  });

  it("still-pending returns to url/input with a status message, no effects", () => {
    const { ctx, effects } = run([
      { type: "RETRY_PENDING", pending },
      { type: "KNOCK_STATUS_RESULT", outcome: { kind: "pending" } },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.error).toMatch(/still pending/);
    expect(effects).toEqual([]);
  });
});

describe("auth step", () => {
  const toP2pAuth: AddPeerEvent[] = [
    { type: "SUBMIT_URL", input: NODE_ID },
    { type: "DUPLICATE_RESULT", duplicateName: null },
    { type: "CONNECTION_RESULT", outcome: { kind: "needs_auth", serverInfo: INFO } },
  ];
  const toHttpAuth: AddPeerEvent[] = [
    { type: "SUBMIT_URL", input: "https://music.example.com" },
    { type: "DUPLICATE_RESULT", duplicateName: null },
    { type: "CONNECTION_RESULT", outcome: { kind: "needs_auth", serverInfo: INFO } },
  ];

  it("p2p login is an explicit error", () => {
    const { ctx, effects } = run([
      ...toP2pAuth,
      { type: "SUBMIT_AUTH", mode: "login", username: "ed" },
    ]);
    expect(ctx.error).toMatch(/login not yet supported for p2p/);
    expect(effects).toEqual([]);
  });

  it("p2p register without an invite code is an error", () => {
    const { ctx, effects } = run([
      ...toP2pAuth,
      { type: "SUBMIT_AUTH", mode: "register", username: "ed" },
    ]);
    expect(ctx.error).toMatch(/invite code required/);
    expect(effects).toEqual([]);
  });

  it("p2p register with an invite code emits AUTH_REDEEM_INVITE", () => {
    const { effects } = run([
      ...toP2pAuth,
      { type: "SUBMIT_AUTH", mode: "register", username: "ed", inviteCode: "abc" },
    ]);
    expect(effects).toEqual([
      { type: "AUTH_REDEEM_INVITE", peerAddr: NODE_ID, username: "ed", inviteCode: "abc" },
    ]);
  });

  it("http auth emits AUTH_HTTP", () => {
    const { effects } = run([...toHttpAuth, { type: "SUBMIT_AUTH", mode: "login", username: "ed" }]);
    expect(effects).toEqual([
      {
        type: "AUTH_HTTP",
        url: "https://music.example.com",
        mode: "login",
        username: "ed",
        inviteCode: undefined,
      },
    ]);
  });

  it("p2p passkey register requires an invite code", () => {
    const { ctx } = run([...toP2pAuth, { type: "PASSKEY_AUTH", mode: "register", username: "ed" }]);
    expect(ctx.error).toMatch(/invite code is required/);
  });

  it("auth success emits CREATE_REMOTE; failure stays with the error", () => {
    const ok = run([
      ...toP2pAuth,
      { type: "SUBMIT_AUTH", mode: "register", username: "ed", inviteCode: "abc" },
      { type: "AUTH_RESULT", ok: true },
    ]);
    expect(ok.effects).toEqual([{ type: "CREATE_REMOTE", peerAddr: NODE_ID, url: "" }]);

    const fail = run([
      ...toP2pAuth,
      { type: "SUBMIT_AUTH", mode: "register", username: "ed", inviteCode: "abc" },
      { type: "AUTH_RESULT", ok: false, error: "bad invite" },
    ]);
    expect(fail.ctx.step).toBe("auth");
    expect(fail.ctx.error).toBe("bad invite");
  });
});

describe("completion", () => {
  const remote = { remote_id: "r1", name: "test peer", peer_addr: NODE_ID };
  const toCreate: AddPeerEvent[] = [
    { type: "SUBMIT_URL", input: NODE_ID },
    { type: "DUPLICATE_RESULT", duplicateName: null },
    { type: "CONNECTION_RESULT", outcome: { kind: "already_authed", serverInfo: INFO } },
  ];

  it("REMOTE_CREATED enters complete, deletes the pending record, and schedules the dismiss timer", () => {
    const { ctx, effects } = run([...toCreate, { type: "REMOTE_CREATED", ok: true, remote }]);
    expect(projectState(ctx)).toEqual({ step: "complete", remote });
    expect(effects).toEqual([
      { type: "DELETE_PENDING_BY_ADDR", peerAddr: NODE_ID },
      { type: "SCHEDULE_TIMER", id: DISMISS_TIMER_ID, ms: COMPLETE_DISMISS_MS },
    ]);
  });

  it("a duplicate-remote creation failure returns to url/input with the error", () => {
    const { ctx } = run([
      ...toCreate,
      { type: "REMOTE_CREATED", ok: false, error: "remote already exists" },
    ]);
    expect(ctx.step).toBe("url");
    expect(ctx.subStep).toBe("input");
    expect(ctx.error).toBe("remote already exists");
  });

  it("the dismiss timer resets the machine and fires close + success", () => {
    const { ctx, effects } = run([
      ...toCreate,
      { type: "REMOTE_CREATED", ok: true, remote },
      { type: "TIMER_FIRED", id: DISMISS_TIMER_ID },
    ]);
    expect(ctx.step).toBe("url");
    expect(effects).toEqual([{ type: "CALL_ON_CLOSE" }, { type: "CALL_ON_SUCCESS", remote }]);
  });
});

describe("COMPLETE_PEER_ADDR external push", () => {
  it("completes from mid-knock when the address matches the staged peer", () => {
    const { ctx, effects } = run([
      { type: "SUBMIT_URL", input: NODE_ID },
      { type: "DUPLICATE_RESULT", duplicateName: null },
      {
        type: "CONNECTION_RESULT",
        outcome: { kind: "needs_knock", serverInfo: { ...INFO, knocking_enabled: true } },
      },
      { type: "SUBMIT_KNOCK", username: "ed", message: "hi" },
      { type: "KNOCK_SENT_RESULT", ok: true },
      // now in knock_sent; the acceptance push arrives over p2p
      { type: "COMPLETE_PEER_ADDR", peerAddr: NODE_ID },
    ]);
    expect(ctx.step).toBe("testing");
    expect(effects).toEqual([{ type: "CREATE_REMOTE", peerAddr: NODE_ID, url: "" }]);
  });

  it("matches a loaded pending record even when nothing is staged", () => {
    const { ctx, effects } = run([
      { type: "MODAL_OPEN" },
      { type: "PENDING_LOADED", records: [pendingRecord()] },
      { type: "COMPLETE_PEER_ADDR", peerAddr: NODE_ID },
    ]);
    expect(ctx.step).toBe("testing");
    expect(effectTypes(effects)).toEqual(["CREATE_REMOTE"]);
  });

  it("ignores a non-matching address", () => {
    const { ctx, effects } = run([
      { type: "MODAL_OPEN" },
      { type: "COMPLETE_PEER_ADDR", peerAddr: "b".repeat(64) },
    ]);
    expect(ctx.step).toBe("url");
    expect(effects).toEqual([]);
  });
});

describe("back / cancel / lifecycle", () => {
  it("BACK from testing cancels the in-flight probe", () => {
    const { ctx, effects } = run([{ type: "SUBMIT_URL", input: NODE_ID }, { type: "BACK" }]);
    expect(ctx.step).toBe("url");
    expect(effects).toEqual([{ type: "CANCEL_IN_FLIGHT" }]);
  });

  it("BACK from auth returns to url/input without effects", () => {
    const { ctx, effects } = run([
      { type: "SUBMIT_URL", input: NODE_ID },
      { type: "DUPLICATE_RESULT", duplicateName: null },
      { type: "CONNECTION_RESULT", outcome: { kind: "needs_auth", serverInfo: INFO } },
      { type: "BACK" },
    ]);
    expect(ctx.step).toBe("url");
    expect(effects).toEqual([]);
  });

  it("MODAL_OPEN resets and loads pending remotes; MODAL_CLOSE cancels and closes", () => {
    const open = run([{ type: "MODAL_OPEN", initialInput: NODE_ID }]);
    expect(open.ctx.input).toBe(NODE_ID);
    expect(open.effects).toEqual([{ type: "LOAD_PENDING_REMOTES" }]);

    const close = run([{ type: "SUBMIT_URL", input: NODE_ID }, { type: "MODAL_CLOSE" }]);
    expect(close.ctx).toEqual(initialContext());
    expect(close.effects).toEqual([{ type: "CANCEL_IN_FLIGHT" }, { type: "CALL_ON_CLOSE" }]);
  });

  it("stale async results in the wrong step are ignored", () => {
    // a CONNECTION_RESULT arriving after BACK returned to url must not move the machine
    const { ctx, effects } = run([
      { type: "SUBMIT_URL", input: NODE_ID },
      { type: "BACK" },
      { type: "CONNECTION_RESULT", outcome: { kind: "needs_auth", serverInfo: INFO } },
    ]);
    expect(ctx.step).toBe("url");
    expect(effects).toEqual([]);
  });
});
