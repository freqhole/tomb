// the transport surface a webauthn ceremony runs against - an injected
// dependency so the same ceremony logic serves an http remote (ceremony
// state carried in a session cookie) and a p2p remote (ceremony state
// threaded through an explicit nonce) alike. concrete transports (http
// fetch, p2p client bindings) live with the consuming app.

import type {
  AuthenticationChallenge,
  AuthenticationPublicKeyCredential,
  RegisterPublicKeyCredential,
  RegistrationChallenge,
} from "./types.js";

export interface TransportSuccess<T> {
  success: true;
  data: T;
}

export interface TransportFailure {
  success: false;
  error: string;
}

export type TransportResult<T> = TransportSuccess<T> | TransportFailure;

export interface RegisterStartRequest {
  username: string;
  /** the caller's origin, forwarded so the server can derive its rp id. */
  origin: string;
  /** required unless the caller already has an authenticated device link
   *  to the target identity (adding a second passkey via node-based auth). */
  inviteCode?: string;
}

export interface LoginStartRequest {
  /** omit for the discoverable-credential flow (authenticator picks). */
  username?: string;
  origin: string;
}

/**
 * a start call's response: the challenge to feed the browser, plus a round
 * -trip token identifying it server-side. `nonce` is present for a p2p
 * remote and absent for an http remote, which instead carries the
 * challenge state in a session cookie.
 */
export interface ChallengeResponse<TChallenge> {
  nonce?: string;
  challenge: TChallenge;
}

export interface FinishRequest<TCredential> {
  nonce?: string;
  origin: string;
  credential: TCredential;
}

export interface AuthOutcome {
  userId?: string;
  username?: string;
  role?: string;
}

export interface WhoamiOutcome {
  authenticated: boolean;
  userId?: string;
  username?: string;
  role?: string;
}

/** the four ceremony calls plus a caller-identity check, bound to one remote. */
export interface WebauthnTransport {
  registerStart(
    req: RegisterStartRequest,
  ): Promise<TransportResult<ChallengeResponse<RegistrationChallenge>>>;
  registerFinish(
    req: FinishRequest<RegisterPublicKeyCredential>,
  ): Promise<TransportResult<AuthOutcome>>;
  loginStart(
    req: LoginStartRequest,
  ): Promise<TransportResult<ChallengeResponse<AuthenticationChallenge>>>;
  loginFinish(
    req: FinishRequest<AuthenticationPublicKeyCredential>,
  ): Promise<TransportResult<AuthOutcome>>;
  whoami(): Promise<WhoamiOutcome>;
}
