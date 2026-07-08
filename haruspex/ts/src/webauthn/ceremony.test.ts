import { describe, expect, it, vi } from "vitest";

import {
  authenticate,
  loginWithPasskey,
  registerWithPasskey,
  whoami,
} from "./ceremony.js";
import type {
  AuthOutcome,
  ChallengeResponse,
  FinishRequest,
  LoginStartRequest,
  RegisterStartRequest,
  TransportResult,
  WebauthnTransport,
  WhoamiOutcome,
} from "./transport.js";
import type {
  AuthenticationChallenge,
  AuthenticationPublicKeyCredential,
  RegisterPublicKeyCredential,
  RegistrationChallenge,
} from "./types.js";

const REGISTRATION_CHALLENGE: RegistrationChallenge = {
  publicKey: {
    rp: { name: "freqhole" },
    user: { id: "AA", name: "alice", displayName: "Alice" },
    challenge: "AQ",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  },
};

const AUTHENTICATION_CHALLENGE: AuthenticationChallenge = {
  publicKey: { challenge: "AQ" },
};

const FAKE_CREDENTIAL = {
  id: "cred-id",
  rawId: new Uint8Array([1]).buffer,
  response: {},
} as unknown as PublicKeyCredential;

/** a scriptable stand-in for a real http/p2p webauthn transport. */
function fakeTransport(
  overrides: Partial<WebauthnTransport> = {},
): WebauthnTransport {
  return {
    registerStart: vi.fn(
      async (
        _req: RegisterStartRequest,
      ): Promise<TransportResult<ChallengeResponse<RegistrationChallenge>>> => ({
        success: true,
        data: { nonce: "nonce-1", challenge: REGISTRATION_CHALLENGE },
      }),
    ),
    registerFinish: vi.fn(
      async (
        _req: FinishRequest<RegisterPublicKeyCredential>,
      ): Promise<TransportResult<{ userId?: string; username?: string }>> => ({
        success: true,
        data: { userId: "user-1", username: "alice" },
      }),
    ),
    loginStart: vi.fn(
      async (
        _req: LoginStartRequest,
      ): Promise<TransportResult<ChallengeResponse<AuthenticationChallenge>>> => ({
        success: true,
        data: { nonce: "nonce-2", challenge: AUTHENTICATION_CHALLENGE },
      }),
    ),
    loginFinish: vi.fn(
      async (
        _req: FinishRequest<AuthenticationPublicKeyCredential>,
      ): Promise<TransportResult<{ userId?: string; username?: string }>> => ({
        success: true,
        data: { userId: "user-1", username: "alice" },
      }),
    ),
    whoami: vi.fn(
      async (): Promise<WhoamiOutcome> => ({ authenticated: false }),
    ),
    ...overrides,
  };
}

const deps = {
  origin: "https://example.test",
  createCredential: vi.fn(async () => FAKE_CREDENTIAL),
  getCredential: vi.fn(async () => FAKE_CREDENTIAL),
};

describe("registerWithPasskey", () => {
  it("runs start -> browser create -> finish and returns the outcome", async () => {
    const transport = fakeTransport();
    const createCredential = vi.fn(async () => FAKE_CREDENTIAL);

    const result = await registerWithPasskey(
      transport,
      { username: "alice", inviteCode: "invite-1" },
      { origin: deps.origin, createCredential },
    );

    expect(result).toEqual({
      success: true,
      userId: "user-1",
      username: "alice",
    });
    expect(transport.registerStart).toHaveBeenCalledWith({
      username: "alice",
      origin: deps.origin,
      inviteCode: "invite-1",
    });
    expect(createCredential).toHaveBeenCalledOnce();
    expect(transport.registerFinish).toHaveBeenCalledWith({
      nonce: "nonce-1",
      origin: deps.origin,
      credential: expect.objectContaining({ id: "cred-id" }),
    });
  });

  it("propagates a registerStart failure without calling the browser", async () => {
    const createCredential = vi.fn(async () => FAKE_CREDENTIAL);
    const transport = fakeTransport({
      registerStart: vi.fn(
        async (): Promise<
          TransportResult<ChallengeResponse<RegistrationChallenge>>
        > => ({
          success: false,
          error: "username taken",
        }),
      ),
    });

    const result = await registerWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, createCredential },
    );

    expect(result).toEqual({ success: false, error: "username taken" });
    expect(createCredential).not.toHaveBeenCalled();
  });

  it("fails when the browser returns no credential", async () => {
    const transport = fakeTransport();

    const result = await registerWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, createCredential: vi.fn(async () => null) },
    );

    expect(result).toEqual({
      success: false,
      error: "browser did not return a credential",
    });
    expect(transport.registerFinish).not.toHaveBeenCalled();
  });

  it("propagates a registerFinish failure", async () => {
    const transport = fakeTransport({
      registerFinish: vi.fn(
        async (): Promise<TransportResult<AuthOutcome>> => ({
          success: false,
          error: "invalid credential",
        }),
      ),
    });

    const result = await registerWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, createCredential: vi.fn(async () => FAKE_CREDENTIAL) },
    );

    expect(result).toEqual({ success: false, error: "invalid credential" });
  });

  it("turns a thrown error (e.g. the user cancelling the passkey prompt) into a failure result", async () => {
    const transport = fakeTransport();
    const createCredential = vi.fn(async () => {
      throw new DOMException("user cancelled", "NotAllowedError");
    });

    const result = await registerWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, createCredential },
    );

    expect(result).toEqual({ success: false, error: "user cancelled" });
  });
});

describe("loginWithPasskey", () => {
  it("runs start -> browser get -> finish and returns the outcome", async () => {
    const transport = fakeTransport();
    const getCredential = vi.fn(async () => FAKE_CREDENTIAL);

    const result = await loginWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, getCredential },
    );

    expect(result).toEqual({
      success: true,
      userId: "user-1",
      username: "alice",
    });
    expect(transport.loginStart).toHaveBeenCalledWith({
      username: "alice",
      origin: deps.origin,
    });
    expect(transport.loginFinish).toHaveBeenCalledWith({
      nonce: "nonce-2",
      origin: deps.origin,
      credential: expect.objectContaining({ id: "cred-id" }),
    });
  });

  it("supports the discoverable flow (no username)", async () => {
    const transport = fakeTransport();

    await loginWithPasskey(
      transport,
      {},
      { origin: deps.origin, getCredential: vi.fn(async () => FAKE_CREDENTIAL) },
    );

    expect(transport.loginStart).toHaveBeenCalledWith({
      username: undefined,
      origin: deps.origin,
    });
  });

  it("fails when the browser returns no assertion", async () => {
    const transport = fakeTransport();

    const result = await loginWithPasskey(
      transport,
      { username: "alice" },
      { origin: deps.origin, getCredential: vi.fn(async () => null) },
    );

    expect(result).toEqual({
      success: false,
      error: "browser did not return a credential",
    });
  });
});

describe("authenticate", () => {
  it("dispatches to registerWithPasskey in register mode", async () => {
    const transport = fakeTransport();

    const result = await authenticate(
      transport,
      { username: "alice", inviteCode: "invite-1", mode: "register" },
      { origin: deps.origin, createCredential: vi.fn(async () => FAKE_CREDENTIAL) },
    );

    expect(result.success).toBe(true);
    expect(transport.registerStart).toHaveBeenCalled();
  });

  it("requires an invite code for register mode", async () => {
    const transport = fakeTransport();

    const result = await authenticate(transport, {
      username: "alice",
      mode: "register",
    });

    expect(result).toEqual({
      success: false,
      error: "invite code required for registration",
    });
    expect(transport.registerStart).not.toHaveBeenCalled();
  });

  it("dispatches to loginWithPasskey in login mode", async () => {
    const transport = fakeTransport();

    const result = await authenticate(
      transport,
      { username: "alice", mode: "login" },
      { origin: deps.origin, getCredential: vi.fn(async () => FAKE_CREDENTIAL) },
    );

    expect(result.success).toBe(true);
    expect(transport.loginStart).toHaveBeenCalled();
  });
});

describe("whoami", () => {
  it("passes the transport's outcome straight through", async () => {
    const transport = fakeTransport({
      whoami: vi.fn(async () => ({
        authenticated: true,
        userId: "user-1",
        username: "alice",
        role: "admin",
      })),
    });

    const result = await whoami(transport);

    expect(result).toEqual({
      authenticated: true,
      userId: "user-1",
      username: "alice",
      role: "admin",
    });
  });

  it("does not swallow a transport error - it propagates for the caller to retry", async () => {
    const transport = fakeTransport({
      whoami: vi.fn(async () => {
        throw new Error("p2p transport not warm yet");
      }),
    });

    await expect(whoami(transport)).rejects.toThrow(
      "p2p transport not warm yet",
    );
  });
});
