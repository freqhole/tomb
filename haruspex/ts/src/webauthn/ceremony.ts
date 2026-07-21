// transport-injected ceremony runners: the pure register/login logic that
// used to be duplicated per transport (http session cookies vs p2p nonces)
// now runs once against the WebauthnTransport interface.

import {
  prepareAuthenticationOptions,
  prepareRegistrationOptions,
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
} from "./codec.js";
import type {
  AuthOutcome,
  WebauthnTransport,
  WhoamiOutcome,
} from "./transport.js";

export type CeremonyResult =
  | ({ success: true } & AuthOutcome)
  | CeremonyFailure;

/**
 * a failed ceremony. `error` is always a human-readable message, matching
 * the shape callers already relied on. `name` and `cause` are populated
 * only when the failure came from a thrown value (e.g. the browser's own
 * `DOMException` from `navigator.credentials.create`/`.get`) rather than a
 * transport-reported failure (`start.error`/`finish.error`, which carry no
 * such name) - so callers can distinguish "user cancelled"
 * (`NotAllowedError`) from "passkeys not supported" (`NotSupportedError`)
 * from a plain transport error, instead of pattern-matching the message
 * string.
 */
export interface CeremonyFailure {
  success: false;
  error: string;
  /** the thrown value's `name`, if it has one (e.g. a `DOMException`'s
   *  `NotAllowedError`/`NotSupportedError`, or `Error`'s own `name`). */
  name?: string;
  /** the original thrown value, for callers that need more than `name`. */
  cause?: unknown;
}

/** builds a `CeremonyFailure` from a value thrown by a browser api call
 *  (`navigator.credentials.create`/`.get`), preserving its `name`/`message`
 *  when present instead of collapsing every failure into one string. */
function ceremonyFailureFromThrown(
  err: unknown,
  fallbackMessage: string,
): CeremonyFailure {
  if (err && typeof err === "object") {
    const record = err as { name?: unknown; message?: unknown };
    const name = typeof record.name === "string" ? record.name : undefined;
    const message =
      typeof record.message === "string" ? record.message : fallbackMessage;
    return { success: false, error: message, name, cause: err };
  }
  return { success: false, error: fallbackMessage, cause: err };
}

/** creates a new passkey credential; defaults to `navigator.credentials.create`. */
export type CreateCredentialFn = (
  options: CredentialCreationOptions,
) => Promise<PublicKeyCredential | null>;

/** asserts an existing passkey credential; defaults to `navigator.credentials.get`. */
export type GetCredentialFn = (
  options: CredentialRequestOptions,
) => Promise<PublicKeyCredential | null>;

export interface PasskeyCeremonyDeps {
  createCredential?: CreateCredentialFn;
  getCredential?: GetCredentialFn;
  /** the origin reported to the server; defaults to `window.location.origin`. */
  origin?: string;
}

function resolveOrigin(deps: PasskeyCeremonyDeps): string {
  if (deps.origin) return deps.origin;
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }
  throw new Error(
    "no origin available outside a browser context - pass deps.origin",
  );
}

function resolveCreateCredential(deps: PasskeyCeremonyDeps): CreateCredentialFn {
  if (deps.createCredential) return deps.createCredential;
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new Error("webauthn is not available in this environment");
  }
  return (options) =>
    navigator.credentials.create(options) as Promise<PublicKeyCredential | null>;
}

function resolveGetCredential(deps: PasskeyCeremonyDeps): GetCredentialFn {
  if (deps.getCredential) return deps.getCredential;
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new Error("webauthn is not available in this environment");
  }
  return (options) =>
    navigator.credentials.get(options) as Promise<PublicKeyCredential | null>;
}

export interface RegisterPasskeyArgs {
  username: string;
  /** required unless the caller already has an authenticated device link
   *  to the target identity. */
  inviteCode?: string;
}

/**
 * register a new passkey: start the ceremony, prompt the browser to create
 * a credential, then finish it.
 *
 * the p2p/http transport difference (nonce threading vs a session cookie)
 * lives entirely in the injected `transport` - this function's logic is the
 * same either way.
 */
export async function registerWithPasskey(
  transport: WebauthnTransport,
  args: RegisterPasskeyArgs,
  deps: PasskeyCeremonyDeps = {},
): Promise<CeremonyResult> {
  try {
    const origin = resolveOrigin(deps);
    const createCredential = resolveCreateCredential(deps);

    const start = await transport.registerStart({
      username: args.username,
      origin,
      inviteCode: args.inviteCode,
    });
    if (!start.success) return { success: false, error: start.error };

    const options = prepareRegistrationOptions(start.data.challenge);
    const credential = await createCredential(options);
    if (!credential) {
      return { success: false, error: "browser did not return a credential" };
    }

    const serialized = serializeRegistrationCredential(credential);
    const finish = await transport.registerFinish({
      nonce: start.data.nonce,
      origin,
      credential: serialized,
    });
    if (!finish.success) return { success: false, error: finish.error };

    return { success: true, ...finish.data };
  } catch (err) {
    return ceremonyFailureFromThrown(err, "registration failed");
  }
}

export interface LoginPasskeyArgs {
  /** omit for the discoverable-credential flow. */
  username?: string;
}

/**
 * authenticate with an existing passkey: start the ceremony, prompt the
 * browser for an assertion, then finish it.
 */
export async function loginWithPasskey(
  transport: WebauthnTransport,
  args: LoginPasskeyArgs = {},
  deps: PasskeyCeremonyDeps = {},
): Promise<CeremonyResult> {
  try {
    const origin = resolveOrigin(deps);
    const getCredential = resolveGetCredential(deps);

    const start = await transport.loginStart({
      username: args.username,
      origin,
    });
    if (!start.success) return { success: false, error: start.error };

    const options = prepareAuthenticationOptions(start.data.challenge);
    const credential = await getCredential(options);
    if (!credential) {
      return { success: false, error: "browser did not return a credential" };
    }

    const serialized = serializeAuthenticationCredential(credential);
    const finish = await transport.loginFinish({
      nonce: start.data.nonce,
      origin,
      credential: serialized,
    });
    if (!finish.success) return { success: false, error: finish.error };

    return { success: true, ...finish.data };
  } catch (err) {
    return ceremonyFailureFromThrown(err, "login failed");
  }
}

export interface AuthenticateArgs {
  username: string;
  inviteCode?: string;
  mode: "login" | "register";
}

/** unified login-or-register dispatch, driven by `args.mode`. */
export async function authenticate(
  transport: WebauthnTransport,
  args: AuthenticateArgs,
  deps: PasskeyCeremonyDeps = {},
): Promise<CeremonyResult> {
  if (args.mode === "register") {
    if (!args.inviteCode) {
      return {
        success: false,
        error: "invite code required for registration",
      };
    }
    return registerWithPasskey(
      transport,
      { username: args.username, inviteCode: args.inviteCode },
      deps,
    );
  }
  return loginWithPasskey(transport, { username: args.username }, deps);
}

/**
 * check whether the caller is already authenticated to a remote.
 *
 * unlike the register/login ceremonies above, this does not swallow
 * transport errors - callers need to distinguish "not authenticated"
 * (`{ authenticated: false }`) from "the transport itself isn't ready yet"
 * (a thrown error), so they can retry the latter instead of treating it as
 * a login prompt.
 */
export function whoami(transport: WebauthnTransport): Promise<WhoamiOutcome> {
  return transport.whoami();
}
