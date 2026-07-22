// scriptable test doubles for webauthn ceremony flows: a fake transport
// whose responses a test can drive call-by-call, and fake browser deps
// (credential creation/retrieval) that return canned values without
// touching `navigator.credentials`.
//
// every method is a `vi.fn()` so consuming tests can assert on call
// counts/arguments or override a single call's behavior
// (`mockResolvedValueOnce`, `mockRejectedValueOnce`, ...) without
// replacing the whole double.

import { vi } from "vitest";

import type { PasskeyCeremonyDeps } from "../webauthn/ceremony.js";
import type {
  AuthOutcome,
  ChallengeResponse,
  FinishRequest,
  LoginStartRequest,
  RegisterStartRequest,
  TransportResult,
  WebauthnTransport,
  WhoamiOutcome,
} from "../webauthn/transport.js";
import type {
  AuthenticationChallenge,
  AuthenticationPublicKeyCredential,
  RegisterPublicKeyCredential,
  RegistrationChallenge,
} from "../webauthn/types.js";

/** a canned registration challenge for tests that don't care about the
 *  exact shape, just that a challenge flows through the ceremony. */
export const FAKE_REGISTRATION_CHALLENGE: RegistrationChallenge = {
  publicKey: {
    rp: { name: "freqhole" },
    user: { id: "AA", name: "alice", displayName: "Alice" },
    challenge: "AQ",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  },
};

/** a canned authentication challenge. */
export const FAKE_AUTHENTICATION_CHALLENGE: AuthenticationChallenge = {
  publicKey: { challenge: "AQ" },
};

/** a canned credential returned by `FAKE_CEREMONY_DEPS.createCredential` /
 *  `.getCredential` - enough structure to satisfy the ceremony's
 *  serialization logic without touching real browser APIs. */
export const FAKE_CREDENTIAL = {
  id: "cred-id",
  rawId: new Uint8Array([1]).buffer,
  response: {},
} as unknown as PublicKeyCredential;

/** a scriptable `WebauthnTransport` double. every method is a `vi.fn()`
 *  defaulting to successful outcomes; override per-call via
 *  `mockResolvedValueOnce` / `mockRejectedValueOnce` to simulate specific
 *  failure cases. */
export function createFakeWebauthnTransport(
  overrides: Partial<WebauthnTransport> = {},
): WebauthnTransport {
  return {
    registerStart: vi.fn(
      async (
        _req: RegisterStartRequest,
      ): Promise<TransportResult<ChallengeResponse<RegistrationChallenge>>> => ({
        success: true,
        data: { nonce: "nonce-1", challenge: FAKE_REGISTRATION_CHALLENGE },
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
        data: { nonce: "nonce-2", challenge: FAKE_AUTHENTICATION_CHALLENGE },
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

/** fake browser ceremony deps (credential creation/retrieval + origin) that
 *  return canned values without touching `navigator.credentials`. every
 *  method is a `vi.fn()` so tests can assert on calls or override
 *  behavior. */
export const FAKE_CEREMONY_DEPS = {
  origin: "https://example.test",
  createCredential: vi.fn(async () => FAKE_CREDENTIAL),
  getCredential: vi.fn(async () => FAKE_CREDENTIAL),
} as PasskeyCeremonyDeps;

/** resets all `vi.fn()` call counts/mocks on the fake ceremony deps to a
 *  clean state. call this in `beforeEach` / `afterEach` when reusing the
 *  same deps object across multiple tests. */
export function resetFakeCeremonyDeps(): void {
  if (typeof FAKE_CEREMONY_DEPS.createCredential === "function" && "mockClear" in FAKE_CEREMONY_DEPS.createCredential) {
    (FAKE_CEREMONY_DEPS.createCredential as ReturnType<typeof vi.fn>).mockClear();
  }
  if (typeof FAKE_CEREMONY_DEPS.getCredential === "function" && "mockClear" in FAKE_CEREMONY_DEPS.getCredential) {
    (FAKE_CEREMONY_DEPS.getCredential as ReturnType<typeof vi.fn>).mockClear();
  }
}
