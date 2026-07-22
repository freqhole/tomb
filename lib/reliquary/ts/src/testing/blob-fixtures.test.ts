import { describe, expect, it } from "vitest";
import { DEFAULT_RANDOM_BLOB_SIZE, deterministicBytes, randomBlobBytes } from "./blob-fixtures.js";

describe("deterministicBytes", () => {
  it("is deterministic across two calls with the same seed", () => {
    const a = deterministicBytes(256, 42);
    const b = deterministicBytes(256, 42);
    expect(a).toEqual(b);
  });

  it("produces different content for different seeds", () => {
    const a = deterministicBytes(256, 1);
    const b = deterministicBytes(256, 2);
    expect(a).not.toEqual(b);
  });

  it("returns exactly the requested size", () => {
    expect(deterministicBytes(100).byteLength).toBe(100);
  });

  it("does not degenerate into long runs of the same byte", () => {
    const bytes = deterministicBytes(4096);
    let longestRun = 0;
    let currentRun = 1;
    for (let i = 1; i < bytes.length; i++) {
      if (bytes[i] === bytes[i - 1]) {
        currentRun++;
        longestRun = Math.max(longestRun, currentRun);
      } else {
        currentRun = 1;
      }
    }
    expect(longestRun).toBeLessThan(20);
  });
});

describe("randomBlobBytes", () => {
  it("defaults to DEFAULT_RANDOM_BLOB_SIZE (96 KiB)", () => {
    expect(DEFAULT_RANDOM_BLOB_SIZE).toBe(96 * 1024);
    expect(randomBlobBytes().byteLength).toBe(DEFAULT_RANDOM_BLOB_SIZE);
  });

  it("returns exactly the requested size", () => {
    expect(randomBlobBytes(128).byteLength).toBe(128);
  });

  it("produces different content across calls", () => {
    const a = randomBlobBytes(64);
    const b = randomBlobBytes(64);
    expect(a).not.toEqual(b);
  });
});
