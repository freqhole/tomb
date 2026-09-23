// tests for WasmTransport.upload()'s iroh-blobs chunked path - added while
// replacing a whole-file `file.arrayBuffer()` buffer-then-import call with
// genuine chunked streaming into `start_import()`'s ImportSession (no
// base64 involved at any point here - a direct wasm-bindgen call, unlike
// the tauri-IPC chunked path in CharnelTransport.ts). covers: chunking
// across multiple `push()` calls, real per-chunk progress, TempTag release,
// and the fallback to `import_blob` for older node builds without
// `start_import`.

import { describe, expect, it, vi } from "vitest";
import { WasmTransport } from "./WasmTransport";
import type { MiddenNodeLike } from "./WasmTransport";

function fakeFile(sizeBytes: number, name = "song.mp3"): File {
  const bytes = new Uint8Array(sizeBytes).fill(7);
  return new File([bytes], name, { type: "audio/mpeg" });
}

function fakeApiResponse() {
  return {
    status: 200,
    body: JSON.stringify({ success: true, data: { job_id: "job-1" } }),
  };
}

describe("WasmTransport.upload() via iroh-blobs (chunked, no base64)", () => {
  it("streams a large file across multiple push() calls instead of one whole-buffer import_blob call", async () => {
    const pushed: number[] = [];
    const session = {
      push: vi.fn(async (chunk: Uint8Array) => {
        pushed.push(chunk.byteLength);
      }),
      finish: vi.fn(async () => "blake3hash"),
      abort: vi.fn(),
    };
    const node: Partial<MiddenNodeLike> = {
      node_id: () => "local-node",
      import_blob: vi.fn(async () => "should-not-be-used"),
      start_import: vi.fn(() => session),
      release_blob: vi.fn(),
      api_request: vi.fn(async () => fakeApiResponse()),
    };
    const transport = new WasmTransport(node as MiddenNodeLike, "peer-1");

    // 4MB chunk size -> a 9MB file should push 3 chunks (4, 4, 1 MB).
    const fileSize = 9 * 1024 * 1024;
    const formData = new FormData();
    formData.set("file", fakeFile(fileSize));

    const onProgress = vi.fn();
    await transport.upload("/api/upload/music", formData, onProgress);

    expect(node.import_blob).not.toHaveBeenCalled();
    expect(session.push).toHaveBeenCalledTimes(3);
    expect(pushed.reduce((a, b) => a + b, 0)).toBe(fileSize);
    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(node.release_blob).toHaveBeenCalledWith("blake3hash");

    // progress is real and monotonically increasing, ending at the full size.
    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock.calls.map((c) => c[0] as number);
    expect(calls[calls.length - 1]).toBe(fileSize);
    expect([...calls].sort((a, b) => a - b)).toEqual(calls);
  });

  it("falls back to a single import_blob call when start_import isn't available", async () => {
    const node: Partial<MiddenNodeLike> = {
      node_id: () => "local-node",
      import_blob: vi.fn(async () => "blake3hash"),
      release_blob: vi.fn(),
      api_request: vi.fn(async () => fakeApiResponse()),
    };
    const transport = new WasmTransport(node as MiddenNodeLike, "peer-1");

    const formData = new FormData();
    formData.set("file", fakeFile(1024));
    await transport.upload("/api/upload/music", formData);

    expect(node.import_blob).toHaveBeenCalledTimes(1);
  });

  it("aborts the import session and propagates the error if a push() fails", async () => {
    const session = {
      push: vi.fn(async () => {
        throw new Error("push failed");
      }),
      finish: vi.fn(async () => "should-not-be-called"),
      abort: vi.fn(),
    };
    const node: Partial<MiddenNodeLike> = {
      node_id: () => "local-node",
      import_blob: vi.fn(async () => "should-not-be-used"),
      start_import: vi.fn(() => session),
      release_blob: vi.fn(),
      api_request: vi.fn(async () => fakeApiResponse()),
    };
    const transport = new WasmTransport(node as MiddenNodeLike, "peer-1");

    const formData = new FormData();
    formData.set("file", fakeFile(1024));

    await expect(transport.upload("/api/upload/music", formData)).rejects.toThrow("upload failed");
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.finish).not.toHaveBeenCalled();
  });
});
