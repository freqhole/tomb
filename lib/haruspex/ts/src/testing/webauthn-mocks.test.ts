import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFakeWebauthnTransport,
  FAKE_CEREMONY_DEPS,
  resetFakeCeremonyDeps,
} from "./webauthn-mocks.js";

describe("createFakeWebauthnTransport", () => {
  it("defaults to successful outcomes for all methods", async () => {
    const transport = createFakeWebauthnTransport();
    const startResult = await transport.registerStart({ username: "alice", origin: "https://test" });
    expect(startResult.success).toBe(true);
    expect(transport.registerStart).toHaveBeenCalledOnce();
  });

  it("allows overriding individual methods", async () => {
    const transport = createFakeWebauthnTransport({
      registerStart: vi.fn(async () => ({
        success: false as const,
        error: "username taken",
      })),
    });
    const result = await transport.registerStart({ username: "alice", origin: "https://test" });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBe("username taken");
  });
});

describe("FAKE_CEREMONY_DEPS", () => {
  beforeEach(() => {
    resetFakeCeremonyDeps();
  });

  it("provides canned credential responses", async () => {
    if (!FAKE_CEREMONY_DEPS.createCredential) throw new Error("no createCredential");
    const cred = await FAKE_CEREMONY_DEPS.createCredential({} as any);
    expect(cred?.id).toBe("cred-id");
  });

  it("can be reset between tests", () => {
    if (!FAKE_CEREMONY_DEPS.createCredential) throw new Error("no createCredential");
    void FAKE_CEREMONY_DEPS.createCredential({} as any);
    expect(FAKE_CEREMONY_DEPS.createCredential).toHaveBeenCalledOnce();
    resetFakeCeremonyDeps();
    expect(FAKE_CEREMONY_DEPS.createCredential).not.toHaveBeenCalled();
  });
});
