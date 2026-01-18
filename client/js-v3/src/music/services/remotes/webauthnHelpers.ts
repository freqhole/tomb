// webauthn helper utilities for base64 conversion
// extracted from client/js/src/hooks/auth/index.ts

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
 * convert server's registration challenge response to browser-compatible format
 * converts base64-encoded fields to Uint8Array
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
 * converts base64-encoded fields to Uint8Array
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
 * convert browser credential to server-compatible format
 * converts ArrayBuffer fields to base64url strings
 */
export function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): any {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: uint8ArrayToBase64(
      new Uint8Array(credential.rawId, 0, credential.rawId.byteLength),
    ),
    type: credential.type,
    response: {
      attestationObject: uint8ArrayToBase64(
        new Uint8Array(
          response.attestationObject,
          0,
          response.attestationObject.byteLength,
        ),
      ),
      clientDataJSON: uint8ArrayToBase64(
        new Uint8Array(
          credential.response.clientDataJSON,
          0,
          credential.response.clientDataJSON.byteLength,
        ),
      ),
    },
  };
}

/**
 * convert browser assertion to server-compatible format
 * converts ArrayBuffer fields to base64url strings
 */
export function serializeAuthenticationCredential(
  credential: PublicKeyCredential,
): any {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: uint8ArrayToBase64(
      new Uint8Array(credential.rawId, 0, credential.rawId.byteLength),
    ),
    type: credential.type,
    response: {
      authenticatorData: uint8ArrayToBase64(
        new Uint8Array(
          response.authenticatorData,
          0,
          response.authenticatorData.byteLength,
        ),
      ),
      clientDataJSON: uint8ArrayToBase64(
        new Uint8Array(
          credential.response.clientDataJSON,
          0,
          credential.response.clientDataJSON.byteLength,
        ),
      ),
      signature: uint8ArrayToBase64(
        new Uint8Array(response.signature, 0, response.signature.byteLength),
      ),
      userHandle: response.userHandle
        ? uint8ArrayToBase64(
            new Uint8Array(
              response.userHandle,
              0,
              response.userHandle.byteLength,
            ),
          )
        : undefined,
    },
  };
}
