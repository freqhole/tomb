// conversion between the server's wire format (base64url strings) and the
// browser webauthn api's format (Uint8Array/ArrayBuffer), plus the
// serialization of a completed ceremony back into the wire format.

import {
  AuthenticationPublicKeyCredentialSchema,
  RegisterPublicKeyCredentialSchema,
  type AuthenticationChallenge,
  type AuthenticationPublicKeyCredential,
  type RegisterPublicKeyCredential,
  type RegistrationChallenge,
} from "./types.js";

/**
 * convert a base64url string to a Uint8Array.
 * handles both standard base64 and base64url encoding.
 */
export function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * convert a Uint8Array to a base64url string (no padding, `-` instead of
 * `+`, `_` instead of `/`).
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

/** convert an ArrayBuffer to a base64url string. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

/**
 * convert the server's registration challenge into browser-compatible
 * options for `navigator.credentials.create()`, converting base64url
 * fields to the raw bytes the browser api expects.
 */
export function prepareRegistrationOptions(
  challenge: RegistrationChallenge,
): CredentialCreationOptions {
  const { publicKey } = challenge;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64ToUint8Array(publicKey.challenge),
      user: {
        ...publicKey.user,
        id: base64ToUint8Array(publicKey.user.id),
      },
      excludeCredentials: publicKey.excludeCredentials?.map((cred) => ({
        ...cred,
        id: base64ToUint8Array(cred.id),
      })),
    },
  };
}

/**
 * convert the server's authentication challenge into browser-compatible
 * options for `navigator.credentials.get()`.
 */
export function prepareAuthenticationOptions(
  challenge: AuthenticationChallenge,
): CredentialRequestOptions {
  const { publicKey } = challenge;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64ToUint8Array(publicKey.challenge),
      allowCredentials: publicKey.allowCredentials?.map((cred) => ({
        ...cred,
        id: base64ToUint8Array(cred.id),
      })),
    },
  };
}

/**
 * convert a browser registration credential into the server-compatible
 * wire format for a `register_finish` call, validating the result against
 * the schema.
 */
export function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): RegisterPublicKeyCredential {
  const response = credential.response as AuthenticatorAttestationResponse;
  return RegisterPublicKeyCredentialSchema.parse({
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: "public-key",
    response: {
      attestationObject: arrayBufferToBase64(response.attestationObject),
      clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
    },
  });
}

/**
 * convert a browser authentication assertion into the server-compatible
 * wire format for a `login_finish` call, validating the result against the
 * schema.
 */
export function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): AuthenticationPublicKeyCredential {
  const response = credential.response as AuthenticatorAssertionResponse;
  return AuthenticationPublicKeyCredentialSchema.parse({
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: "public-key",
    response: {
      authenticatorData: arrayBufferToBase64(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
      signature: arrayBufferToBase64(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64(response.userHandle)
        : undefined,
    },
  });
}

/** check whether the webauthn create() api is available in this context. */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined" &&
    typeof navigator.credentials.create === "function"
  );
}
