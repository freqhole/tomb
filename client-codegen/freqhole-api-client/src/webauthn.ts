// webauthn helper utilities for base64/arraybuffer conversion
// these handle the conversion between server format (base64url strings)
// and browser webauthn api format (Uint8Array/ArrayBuffer)

import { z } from "zod";

// zod schemas for webauthn credential types (server format with camelCase)
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

// types derived from schemas
export type RegisterPublicKeyCredential = z.infer<
  typeof RegisterPublicKeyCredentialSchema
>;
export type AuthenticationPublicKeyCredential = z.infer<
  typeof AuthenticationPublicKeyCredentialSchema
>;

/**
 * convert base64url string to Uint8Array
 * handles both standard base64 and base64url encoding
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // convert base64url to standard base64
  const standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * convert Uint8Array to base64url string
 * uses base64url encoding (no padding, - instead of +, _ instead of /)
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binaryString = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * convert ArrayBuffer to base64url string
 * convenience wrapper around uint8ArrayToBase64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

/**
 * convert server's registration challenge response to browser-compatible format
 * converts base64-encoded fields to Uint8Array for navigator.credentials.create()
 */
export function prepareRegistrationOptions(
  serverResponse: any,
): CredentialCreationOptions {
  return {
    publicKey: {
      ...serverResponse.publicKey,
      challenge: base64ToUint8Array(serverResponse.publicKey.challenge),
      user: {
        ...serverResponse.publicKey.user,
        id: base64ToUint8Array(serverResponse.publicKey.user.id),
      },
      excludeCredentials: serverResponse.publicKey.excludeCredentials?.map(
        (cred: any) => ({
          ...cred,
          id: base64ToUint8Array(cred.id),
        }),
      ),
    },
  };
}

/**
 * convert server's login challenge response to browser-compatible format
 * converts base64-encoded fields to Uint8Array for navigator.credentials.get()
 */
export function prepareAuthenticationOptions(
  serverResponse: any,
): CredentialRequestOptions {
  return {
    publicKey: {
      ...serverResponse.publicKey,
      challenge: base64ToUint8Array(serverResponse.publicKey.challenge),
      allowCredentials: serverResponse.publicKey.allowCredentials?.map(
        (cred: any) => ({
          ...cred,
          id: base64ToUint8Array(cred.id),
        }),
      ),
    },
  };
}

/**
 * convert browser registration credential to server-compatible format
 * converts ArrayBuffer fields to base64url strings for register_finish endpoint
 */
export function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): RegisterPublicKeyCredential {
  const response = credential.response as AuthenticatorAttestationResponse;
  const serialized = {
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: "public-key" as const,
    response: {
      attestationObject: arrayBufferToBase64(response.attestationObject),
      clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
    },
  };

  // validate with schema
  return RegisterPublicKeyCredentialSchema.parse(serialized);
}

/**
 * convert browser authentication assertion to server-compatible format
 * converts ArrayBuffer fields to base64url strings for login_finish endpoint
 */
export function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): AuthenticationPublicKeyCredential {
  const response = credential.response as AuthenticatorAssertionResponse;
  const serialized = {
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: "public-key" as const,
    response: {
      authenticatorData: arrayBufferToBase64(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
      signature: arrayBufferToBase64(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64(response.userHandle)
        : undefined,
    },
  };

  // validate with schema
  return AuthenticationPublicKeyCredentialSchema.parse(serialized);
}

/**
 * high-level helper: perform complete registration flow
 * calls register_start, prompts user for credential, calls register_finish
 */
export async function registerWithPasskey(
  registerStartFn: () => Promise<any>,
  registerFinishFn: (credential: any) => Promise<any>,
): Promise<any> {
  // get challenge from server
  const challengeResponse = await registerStartFn();

  // prepare options for browser
  const options = prepareRegistrationOptions(challengeResponse);

  // prompt user to create credential
  const credential = (await navigator.credentials.create(
    options,
  )) as PublicKeyCredential;

  if (!credential) {
    throw new Error("failed to create credential");
  }

  // serialize and send to server
  const serialized = serializeRegistrationCredential(credential);
  return await registerFinishFn(serialized);
}

/**
 * high-level helper: perform complete login flow
 * calls login_start, prompts user for assertion, calls login_finish
 */
export async function loginWithPasskey(
  loginStartFn: () => Promise<any>,
  loginFinishFn: (assertion: any) => Promise<any>,
): Promise<any> {
  // get challenge from server
  const challengeResponse = await loginStartFn();

  // prepare options for browser
  const options = prepareAuthenticationOptions(challengeResponse);

  // prompt user to authenticate
  const assertion = (await navigator.credentials.get(
    options,
  )) as PublicKeyCredential;

  if (!assertion) {
    throw new Error("failed to get assertion");
  }

  // serialize and send to server
  const serialized = serializeAuthenticationCredential(assertion);
  return await loginFinishFn(serialized);
}
