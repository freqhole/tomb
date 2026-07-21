// wire shapes for the webauthn passkey ceremony: the credential blobs the
// browser hands back from navigator.credentials.create()/get() (serialized
// to base64url strings for transport), and the server's challenge shapes fed
// into those calls. field names are camelCase, matching the friendz
// protocol's wire convention and the shapes webauthn-rs (the rust side's
// ceremony implementation) serializes.

import { z } from "zod";

export const AuthenticatorAttestationResponseSchema = z.object({
  attestationObject: z.string(),
  clientDataJSON: z.string(),
});

export const RegisterPublicKeyCredentialSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  response: AuthenticatorAttestationResponseSchema,
});

export const AuthenticatorAssertionResponseSchema = z.object({
  authenticatorData: z.string(),
  clientDataJSON: z.string(),
  signature: z.string(),
  userHandle: z.string().optional(),
});

export const AuthenticationPublicKeyCredentialSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  response: AuthenticatorAssertionResponseSchema,
});

export type RegisterPublicKeyCredential = z.infer<
  typeof RegisterPublicKeyCredentialSchema
>;
export type AuthenticationPublicKeyCredential = z.infer<
  typeof AuthenticationPublicKeyCredentialSchema
>;

/** a base64url-encoded credential descriptor, as sent by the server. */
export interface ServerCredentialDescriptor {
  id: string;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

/**
 * the server's registration challenge, ready to feed into
 * `prepareRegistrationOptions`. base64url fields (challenge, user.id,
 * excludeCredentials[].id) are still strings at this point - the browser
 * needs raw bytes, which prepareRegistrationOptions converts.
 */
export interface RegistrationChallenge {
  publicKey: {
    rp: { id?: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout?: number;
    excludeCredentials?: ServerCredentialDescriptor[];
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    attestation?: AttestationConveyancePreference;
  };
}

/**
 * the server's authentication challenge, ready to feed into
 * `prepareAuthenticationOptions`.
 */
export interface AuthenticationChallenge {
  publicKey: {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: ServerCredentialDescriptor[];
    userVerification?: UserVerificationRequirement;
  };
}
