import { describe, expect, it } from "vitest";

import {
  FrameReader,
  decodeFriendzMessage,
  decodeMessage,
  encodeFriendzMessageToJson,
  encodeMessage,
  frameMessage,
  friendzMessageType,
  type FriendzMessage,
} from "./codec.js";

const heartbeat: FriendzMessage = {
  kind: "core",
  message: { type: "heartbeat", v: 1, nodeId: "node-abc", username: "alice" },
};

const extension: FriendzMessage = {
  kind: "app-extension",
  messageType: "skein:canvas-invite",
  payload: { v: 1, type: "skein:canvas-invite", inviteId: "inv-1" },
};

describe("decodeFriendzMessage", () => {
  it("throws on a non-object value", () => {
    expect(() => decodeFriendzMessage("nope")).toThrow(/json object/);
    expect(() => decodeFriendzMessage(null)).toThrow();
    expect(() => decodeFriendzMessage([1, 2])).toThrow();
  });

  it("throws when 'type' is missing or not a string", () => {
    expect(() => decodeFriendzMessage({})).toThrow(/type/);
    expect(() => decodeFriendzMessage({ type: 5 })).toThrow();
  });

  it("throws on an unrecognized non-namespaced type", () => {
    expect(() => decodeFriendzMessage({ type: "not-a-real-type" })).toThrow(/unknown/);
  });

  it("routes a namespaced type to the app-extension passthrough", () => {
    const message = decodeFriendzMessage({ type: "skein:canvas-invite", foo: "bar" });
    expect(message).toEqual({
      kind: "app-extension",
      messageType: "skein:canvas-invite",
      payload: { type: "skein:canvas-invite", foo: "bar" },
    });
  });
});

describe("friendzMessageType", () => {
  it("returns the core message's type", () => {
    expect(friendzMessageType(heartbeat)).toBe("heartbeat");
  });

  it("returns the app-extension's messageType", () => {
    expect(friendzMessageType(extension)).toBe("skein:canvas-invite");
  });
});

describe("encodeFriendzMessageToJson", () => {
  it("flattens a core message back to its plain wire shape", () => {
    expect(encodeFriendzMessageToJson(heartbeat)).toEqual(heartbeat.message);
  });

  it("flattens an app-extension message back to its raw payload", () => {
    expect(encodeFriendzMessageToJson(extension)).toEqual(
      (extension as { payload: unknown }).payload,
    );
  });
});

describe("encodeMessage / decodeMessage", () => {
  it("round-trips a core message through utf-8 json bytes", () => {
    const bytes = encodeMessage(heartbeat);
    expect(decodeMessage(bytes)).toEqual(heartbeat);
  });

  it("round-trips an app-extension message through utf-8 json bytes", () => {
    const bytes = encodeMessage(extension);
    expect(decodeMessage(bytes)).toEqual(extension);
  });

  it("throws decodeMessage on non-json bytes", () => {
    const bytes = new TextEncoder().encode("not json at all {");
    expect(() => decodeMessage(bytes)).toThrow(/not valid json/);
  });
});

describe("frameMessage / FrameReader", () => {
  it("decodes a single complete frame delivered whole", () => {
    const reader = new FrameReader();
    const frame = frameMessage(heartbeat);
    expect(reader.push(frame)).toEqual([heartbeat]);
    expect(reader.pendingByteLength()).toBe(0);
  });

  it("decodes a frame split across multiple chunks", () => {
    const reader = new FrameReader();
    const frame = frameMessage(heartbeat);
    const mid = Math.floor(frame.byteLength / 2);

    expect(reader.push(frame.subarray(0, mid))).toEqual([]);
    expect(reader.pendingByteLength()).toBe(mid);
    expect(reader.push(frame.subarray(mid))).toEqual([heartbeat]);
  });

  it("decodes multiple frames delivered in one chunk", () => {
    const reader = new FrameReader();
    const a = frameMessage(heartbeat);
    const b = frameMessage(extension);
    const combined = new Uint8Array(a.byteLength + b.byteLength);
    combined.set(a, 0);
    combined.set(b, a.byteLength);

    expect(reader.push(combined)).toEqual([heartbeat, extension]);
  });

  it("waits for the length prefix itself to arrive before decoding anything", () => {
    const reader = new FrameReader();
    expect(reader.push(new Uint8Array([0, 0]))).toEqual([]);
    expect(reader.pendingByteLength()).toBe(2);
  });
});
