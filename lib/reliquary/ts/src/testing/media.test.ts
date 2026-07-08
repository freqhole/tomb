import { describe, expect, it } from "vitest";
import { makeWav } from "./media.js";

function readHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  return {
    riff: str(0, 4),
    wave: str(8, 4),
    fmt: str(12, 4),
    audioFormat: view.getUint16(20, true),
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    data: str(36, 4),
    dataSize: view.getUint32(40, true),
  };
}

describe("makeWav", () => {
  it("produces a valid mono 16-bit PCM WAV header", () => {
    const bytes = makeWav(1);
    const header = readHeader(bytes);
    expect(header.riff).toBe("RIFF");
    expect(header.wave).toBe("WAVE");
    expect(header.fmt).toBe("fmt ");
    expect(header.audioFormat).toBe(1); // PCM
    expect(header.numChannels).toBe(1); // mono
    expect(header.bitsPerSample).toBe(16);
    expect(header.data).toBe("data");
  });

  it("sizes the file for the requested duration and sample rate", () => {
    const bytes = makeWav(2, { sampleRate: 8000 });
    const header = readHeader(bytes);
    expect(header.sampleRate).toBe(8000);
    expect(header.dataSize).toBe(2 * 8000 * 2); // 2 bytes/sample
    expect(bytes.byteLength).toBe(44 + header.dataSize);
  });

  it("silent mode produces all-zero sample data", () => {
    const bytes = makeWav(1, { silent: true, sampleRate: 100 });
    const samples = bytes.subarray(44);
    expect(samples.every((b) => b === 0)).toBe(true);
  });

  it("non-silent mode produces a non-zero sine tone", () => {
    const bytes = makeWav(1, { freqHz: 440, sampleRate: 8000 });
    const samples = bytes.subarray(44);
    expect(samples.some((b) => b !== 0)).toBe(true);
  });
});
