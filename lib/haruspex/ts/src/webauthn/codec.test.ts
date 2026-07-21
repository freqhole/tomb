import { describe, expect, it } from "vitest";

import {
  arrayBufferToBase64,
  base64ToUint8Array,
  isWebAuthnAvailable,
  prepareAuthenticationOptions,
  prepareRegistrationOptions,
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
  uint8ArrayToBase64,
} from "./codec.js";
import type {
  AuthenticationChallenge,
  RegistrationChallenge,
} from "./types.js";

describe("base64url round-trip", () => {
  it("round-trips arbitrary bytes, including values that need + / and padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 62, 63, 64, 251, 252, 253, 254, 255]);
    const encoded = uint8ArrayToBase64(bytes);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64ToUint8Array(encoded)).toEqual(bytes);
  });

  it("arrayBufferToBase64 matches uint8ArrayToBase64 for the same bytes", () => {
    const bytes = new Uint8Array([10, 20, 30]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(uint8ArrayToBase64(bytes));
  });
});

describe("prepareRegistrationOptions", () => {
  it("converts base64url challenge/user-id/excludeCredentials to raw bytes", () => {
    const challengeBytes = new Uint8Array([1, 2, 3]);
    const userIdBytes = new Uint8Array([9, 9]);
    const excludeIdBytes = new Uint8Array([5]);

    const challenge: RegistrationChallenge = {
      publicKey: {
        rp: { name: "freqhole" },
        user: {
          id: uint8ArrayToBase64(userIdBytes),
          name: "alice",
          displayName: "Alice",
        },
        challenge: uint8ArrayToBase64(challengeBytes),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: [
          { id: uint8ArrayToBase64(excludeIdBytes), type: "public-key" },
        ],
      },
    };

    const options = prepareRegistrationOptions(challenge);
    const publicKey = options.publicKey!;

    expect(publicKey.challenge).toEqual(challengeBytes);
    expect((publicKey.user as unknown as { id: Uint8Array }).id).toEqual(
      userIdBytes,
    );
    expect(
      (publicKey.excludeCredentials as unknown as { id: Uint8Array }[])[0].id,
    ).toEqual(excludeIdBytes);
    expect(publicKey.rp).toEqual({ name: "freqhole" });
  });

  it("omits excludeCredentials when the server did not send any", () => {
    const challenge: RegistrationChallenge = {
      publicKey: {
        rp: { name: "freqhole" },
        user: { id: "AA", name: "alice", displayName: "Alice" },
        challenge: "AQ",
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      },
    };

    const options = prepareRegistrationOptions(challenge);
    expect(options.publicKey!.excludeCredentials).toBeUndefined();
  });
});

describe("prepareAuthenticationOptions", () => {
  it("converts base64url challenge/allowCredentials to raw bytes", () => {
    const challengeBytes = new Uint8Array([4, 5, 6]);
    const allowIdBytes = new Uint8Array([7]);

    const challenge: AuthenticationChallenge = {
      publicKey: {
        challenge: uint8ArrayToBase64(challengeBytes),
        allowCredentials: [
          { id: uint8ArrayToBase64(allowIdBytes), type: "public-key" },
        ],
      },
    };

    const options = prepareAuthenticationOptions(challenge);
    const publicKey = options.publicKey!;

    expect(publicKey.challenge).toEqual(challengeBytes);
    expect(
      (publicKey.allowCredentials as unknown as { id: Uint8Array }[])[0].id,
    ).toEqual(allowIdBytes);
  });
});

/** builds a fake PublicKeyCredential-shaped object for registration; only
 *  the fields serializeRegistrationCredential reads are present. */
function fakeRegistrationCredential(): PublicKeyCredential {
  return {
    id: "cred-id",
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      attestationObject: new Uint8Array([4, 5]).buffer,
      clientDataJSON: new Uint8Array([6, 7]).buffer,
    } as AuthenticatorAttestationResponse,
  } as unknown as PublicKeyCredential;
}

/** builds a fake PublicKeyCredential-shaped object for authentication. */
function fakeAuthenticationCredential(
  withUserHandle: boolean,
): PublicKeyCredential {
  return {
    id: "cred-id",
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      authenticatorData: new Uint8Array([8]).buffer,
      clientDataJSON: new Uint8Array([9]).buffer,
      signature: new Uint8Array([10]).buffer,
      userHandle: withUserHandle ? new Uint8Array([11]).buffer : null,
    } as AuthenticatorAssertionResponse,
  } as unknown as PublicKeyCredential;
}

describe("serializeRegistrationCredential", () => {
  it("serializes a credential into the server wire format", () => {
    const serialized = serializeRegistrationCredential(
      fakeRegistrationCredential(),
    );

    expect(serialized).toEqual({
      id: "cred-id",
      rawId: uint8ArrayToBase64(new Uint8Array([1, 2, 3])),
      type: "public-key",
      response: {
        attestationObject: uint8ArrayToBase64(new Uint8Array([4, 5])),
        clientDataJSON: uint8ArrayToBase64(new Uint8Array([6, 7])),
      },
    });
  });
});

describe("serializeAuthenticationCredential", () => {
  it("serializes a credential with a user handle", () => {
    const serialized = serializeAuthenticationCredential(
      fakeAuthenticationCredential(true),
    );

    expect(serialized.response.userHandle).toBe(
      uint8ArrayToBase64(new Uint8Array([11])),
    );
  });

  it("omits userHandle when the authenticator did not send one (discoverable flow)", () => {
    const serialized = serializeAuthenticationCredential(
      fakeAuthenticationCredential(false),
    );

    expect(serialized.response.userHandle).toBeUndefined();
  });
});

describe("isWebAuthnAvailable", () => {
  it("is false when navigator is absent (node/vitest environment)", () => {
    expect(isWebAuthnAvailable()).toBe(false);
  });
});
