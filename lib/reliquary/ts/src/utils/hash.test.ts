import { describe, expect, it } from "vitest";
import { sha256Hex, sha256HexOfBlob, verifySha256Hex } from "./hash.js";

// known-answer test vectors for sha-256
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function textToBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("sha256Hex", () => {
  it("hashes an empty buffer to the well-known sha-256 empty digest", async () => {
    const hash = await sha256Hex(new ArrayBuffer(0));
    expect(hash).toBe(EMPTY_HASH);
  });

  it("hashes 'abc' to its well-known sha-256 digest", async () => {
    const hash = await sha256Hex(textToBuffer("abc"));
    expect(hash).toBe(ABC_HASH);
  });

  it("accepts an ArrayBufferView (Uint8Array) as well as a raw ArrayBuffer", async () => {
    const bytes = new TextEncoder().encode("abc");
    const hash = await sha256Hex(bytes);
    expect(hash).toBe(ABC_HASH);
  });

  it("only hashes the view's byte range, not the whole underlying buffer", async () => {
    const backing = new Uint8Array(10);
    backing.set(new TextEncoder().encode("abc"), 2);
    const view = new Uint8Array(backing.buffer, 2, 3);
    const hash = await sha256Hex(view);
    expect(hash).toBe(ABC_HASH);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await sha256Hex(textToBuffer("hello"));
    const b = await sha256Hex(textToBuffer("world"));
    expect(a).not.toBe(b);
  });
});

describe("sha256HexOfBlob", () => {
  it("hashes a Blob's contents the same as its raw bytes", async () => {
    const blob = new Blob(["abc"]);
    const hash = await sha256HexOfBlob(blob);
    expect(hash).toBe(ABC_HASH);
  });
});

describe("verifySha256Hex", () => {
  it("returns true when the expected hash matches", async () => {
    const ok = await verifySha256Hex(textToBuffer("abc"), ABC_HASH);
    expect(ok).toBe(true);
  });

  it("returns false when the expected hash does not match", async () => {
    const ok = await verifySha256Hex(textToBuffer("abc"), EMPTY_HASH);
    expect(ok).toBe(false);
  });

  it("is case-insensitive when comparing the expected hash", async () => {
    const ok = await verifySha256Hex(textToBuffer("abc"), ABC_HASH.toUpperCase());
    expect(ok).toBe(true);
  });
});
