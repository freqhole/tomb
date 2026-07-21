import { describe, expect, it } from "vitest";

import {
  CoreMessageSchema,
  WireKnockScopeSchema,
  isCoreMessageType,
} from "./messages.js";

describe("CoreMessageSchema", () => {
  it("defaults a missing v to 1", () => {
    const parsed = CoreMessageSchema.parse({ type: "profile-request" });
    expect(parsed).toEqual({ type: "profile-request", v: 1 });
  });

  it("accepts an explicit v", () => {
    const parsed = CoreMessageSchema.parse({ type: "profile-request", v: 3 });
    expect(parsed.v).toBe(3);
  });

  it("rejects a type with no matching variant", () => {
    expect(() => CoreMessageSchema.parse({ type: "not-a-real-type" })).toThrow();
  });

  it("defaults missing array fields to []", () => {
    const parsed = CoreMessageSchema.parse({ type: "blob-seek" });
    expect(parsed).toMatchObject({ type: "blob-seek", needed: [] });
  });

  it("parses a full hello handshake with capabilities", () => {
    const parsed = CoreMessageSchema.parse({
      type: "hello",
      v: 1,
      nodeId: "node-abc123",
      username: "alice",
      capabilities: { browse: "knock" },
    });
    expect(parsed).toMatchObject({
      type: "hello",
      nodeId: "node-abc123",
      capabilities: { browse: "knock" },
    });
  });

  it("rejects hello with an invalid browse capability", () => {
    expect(() =>
      CoreMessageSchema.parse({
        type: "hello",
        nodeId: "node-abc123",
        capabilities: { browse: "sometimes" },
      }),
    ).toThrow();
  });
});

describe("WireKnockScopeSchema", () => {
  it("parses an account scope with an optional requestedUsername", () => {
    expect(WireKnockScopeSchema.parse({ kind: "account" })).toEqual({ kind: "account" });
    expect(
      WireKnockScopeSchema.parse({ kind: "account", requestedUsername: "bob" }),
    ).toEqual({ kind: "account", requestedUsername: "bob" });
  });

  it("parses a bare browse scope", () => {
    expect(WireKnockScopeSchema.parse({ kind: "browse" })).toEqual({ kind: "browse" });
  });

  it("parses a resource scope with a resourceId and optional requestedRole", () => {
    const parsed = WireKnockScopeSchema.parse({
      kind: "resource",
      resourceId: "doc-1",
      requestedRole: "member",
    });
    expect(parsed).toEqual({ kind: "resource", resourceId: "doc-1", requestedRole: "member" });
  });

  it("rejects an unknown scope kind", () => {
    expect(() => WireKnockScopeSchema.parse({ kind: "everyone" })).toThrow();
  });

  it("rejects an invalid role value", () => {
    expect(() =>
      WireKnockScopeSchema.parse({ kind: "resource", resourceId: "doc-1", requestedRole: "owner" }),
    ).toThrow();
  });
});

describe("isCoreMessageType", () => {
  it("is true for every core type", () => {
    expect(isCoreMessageType("hello")).toBe(true);
    expect(isCoreMessageType("knock-outcome")).toBe(true);
  });

  it("is false for a namespaced app-extension type", () => {
    expect(isCoreMessageType("skein:canvas-invite")).toBe(false);
  });

  it("is false for an unknown type", () => {
    expect(isCoreMessageType("not-a-real-type")).toBe(false);
  });
});
