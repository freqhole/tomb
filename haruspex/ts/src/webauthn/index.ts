export type {
  RegisterPublicKeyCredential,
  AuthenticationPublicKeyCredential,
  ServerCredentialDescriptor,
  RegistrationChallenge,
  AuthenticationChallenge,
} from "./types.js";
export {
  AuthenticatorAttestationResponseSchema,
  RegisterPublicKeyCredentialSchema,
  AuthenticatorAssertionResponseSchema,
  AuthenticationPublicKeyCredentialSchema,
} from "./types.js";

export {
  arrayBufferToBase64,
  base64ToUint8Array,
  isWebAuthnAvailable,
  prepareAuthenticationOptions,
  prepareRegistrationOptions,
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
  uint8ArrayToBase64,
} from "./codec.js";

export type {
  AuthOutcome,
  ChallengeResponse,
  FinishRequest,
  LoginStartRequest,
  RegisterStartRequest,
  TransportFailure,
  TransportResult,
  TransportSuccess,
  WebauthnTransport,
  WhoamiOutcome,
} from "./transport.js";

export type {
  AuthenticateArgs,
  CeremonyFailure,
  CeremonyResult,
  CreateCredentialFn,
  GetCredentialFn,
  LoginPasskeyArgs,
  PasskeyCeremonyDeps,
  RegisterPasskeyArgs,
} from "./ceremony.js";
export {
  authenticate,
  loginWithPasskey,
  registerWithPasskey,
  whoami,
} from "./ceremony.js";
