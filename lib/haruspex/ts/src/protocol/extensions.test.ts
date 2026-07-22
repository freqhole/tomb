import { describe, expect, it } from "vitest";

import { z } from "zod";

import {
  createAppExtensionRegistry,
  isAppExtensionType,
  type AppExtensionMessage,
} from "./extensions.js";

describe("isAppExtensionType", () => {
  it("is true for a namespaced type", () => {
    expect(isAppExtensionType("skein:canvas-invite")).toBe(true);
  });

  it("is false for a bare core-style type", () => {
    expect(isAppExtensionType("heartbeat")).toBe(false);
  });
});

describe("AppExtensionRegistry", () => {
  const canvasInviteSchema = z.object({
    v: z.literal(1),
    type: z.literal("skein:canvas-invite"),
    inviteId: z.string(),
    canvasDocId: z.string(),
    canvasTitle: z.string(),
    originNodeId: z.string(),
    originUsername: z.string(),
    role: z.string(),
    targets: z.array(z.string()),
    acked: z.array(z.string()),
  });

  const message: AppExtensionMessage = {
    messageType: "skein:canvas-invite",
    payload: {
      v: 1,
      type: "skein:canvas-invite",
      inviteId: "inv-1",
      canvasDocId: "doc-canvas-1",
      canvasTitle: "my canvas",
      originNodeId: "node-abc123",
      originUsername: "alice",
      role: "member",
      targets: ["node-def456"],
      acked: [],
    },
  };

  it("throws parse() for an unregistered message type", () => {
    const registry = createAppExtensionRegistry();
    expect(() => registry.parse(message)).toThrow(/no schema registered/);
    expect(registry.isRegistered("skein:canvas-invite")).toBe(false);
  });

  it("parses a registered message type against its schema", () => {
    const registry = createAppExtensionRegistry();
    registry.register("skein:canvas-invite", canvasInviteSchema);
    expect(registry.isRegistered("skein:canvas-invite")).toBe(true);

    const parsed = registry.parse<z.infer<typeof canvasInviteSchema>>(message);
    expect(parsed.inviteId).toBe("inv-1");
    expect(parsed.targets).toEqual(["node-def456"]);
  });

  it("throws when the payload doesn't match the registered schema", () => {
    const registry = createAppExtensionRegistry();
    registry.register("skein:canvas-invite", canvasInviteSchema);
    expect(() =>
      registry.parse({ messageType: "skein:canvas-invite", payload: { type: "skein:canvas-invite" } }),
    ).toThrow();
  });

  it("unregister() removes a schema", () => {
    const registry = createAppExtensionRegistry();
    registry.register("skein:canvas-invite", canvasInviteSchema);
    registry.unregister("skein:canvas-invite");
    expect(registry.isRegistered("skein:canvas-invite")).toBe(false);
    expect(() => registry.parse(message)).toThrow();
  });
});
