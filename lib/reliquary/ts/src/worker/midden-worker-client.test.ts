import { describe, expect, it, vi } from "vitest";
import { WorkerBiStream, WorkerImportSession } from "./midden-worker-client.js";
import type { MiddenWorkerApi, StreamInfo } from "./midden-worker-contract.js";

// `WorkerBiStream`/`WorkerImportSession` are the parts of the comlink
// facade that are meaningfully unit-testable without a real worker thread:
// pure message construction/parsing over a fake api object. spinning up an
// actual worker (`WorkerMiddenNode.create()`) isn't realistically
// testable in this environment and isn't covered here.

function makeFakeApi(overrides: Partial<MiddenWorkerApi> = {}): MiddenWorkerApi {
  return {
    init: vi.fn(),
    openBi: vi.fn(),
    accept: vi.fn(),
    streamReadMessage: vi.fn(async () => null),
    streamWriteMessage: vi.fn(async () => undefined),
    streamReadToEnd: vi.fn(async () => new Uint8Array()),
    streamWriteRawAndFinish: vi.fn(async () => undefined),
    streamClose: vi.fn(async () => undefined),
    importBlob: vi.fn(),
    importBlobAndExportBao: vi.fn(),
    importBao: vi.fn(),
    hasActiveBlob: vi.fn(),
    hasCompleteBlob: vi.fn(),
    releaseBlob: vi.fn(),
    restrictBlobToPeers: vi.fn(),
    clearBlobRestriction: vi.fn(),
    startImport: vi.fn(async () => 1),
    importPush: vi.fn(async () => undefined),
    importFinish: vi.fn(async () => "blake3-hex"),
    importAbort: vi.fn(async () => undefined),
    ensureBlob: vi.fn(),
    downloadVerifiedWithEnsure: vi.fn(),
    downloadVerifiedWithEnsureProgress: vi.fn(),
    downloadVerifiedById: vi.fn(),
    downloadVerifiedByIdProgress: vi.fn(),
    downloadVerifiedStreamingWithEnsure: vi.fn(),
    downloadCancel: vi.fn(),
    protectBlob: vi.fn(),
    unprotectBlob: vi.fn(),
    computeBlake3: vi.fn(),
    proxyRequest: vi.fn(),
    ...overrides,
  };
}

const STREAM_INFO: StreamInfo = { streamId: 7, peerNodeId: "peer-abc", alpn: "test/1" };

describe("WorkerBiStream", () => {
  it("exposes the stream's peer id and alpn synchronously", () => {
    const stream = new WorkerBiStream(makeFakeApi() as never, STREAM_INFO);
    expect(stream.peer_node_id()).toBe("peer-abc");
    expect(stream.alpn()).toBe("test/1");
  });

  it("read_message delegates to streamReadMessage with the stream id", async () => {
    const api = makeFakeApi({ streamReadMessage: vi.fn(async () => new Uint8Array([1, 2])) });
    const stream = new WorkerBiStream(api as never, STREAM_INFO);
    const result = await stream.read_message();
    expect(api.streamReadMessage).toHaveBeenCalledWith(7);
    expect(Array.from(result!)).toEqual([1, 2]);
  });

  it("write_message copies the buffer before sending (caller's buffer is untouched)", async () => {
    const api = makeFakeApi();
    const stream = new WorkerBiStream(api as never, STREAM_INFO);
    const original = new Uint8Array([5, 6, 7]);

    await stream.write_message(original);

    expect(api.streamWriteMessage).toHaveBeenCalledTimes(1);
    const [calledStreamId, sentBytes] = (api.streamWriteMessage as ReturnType<typeof vi.fn>).mock
      .calls[0] as [number, Uint8Array];
    expect(calledStreamId).toBe(7);
    expect(Array.from(sentBytes)).toEqual([5, 6, 7]);
    expect(sentBytes.buffer).not.toBe(original.buffer);
    expect(original).toEqual(new Uint8Array([5, 6, 7]));
  });

  it("read_to_end delegates with the stream id and max size", async () => {
    const api = makeFakeApi({ streamReadToEnd: vi.fn(async () => new Uint8Array([9])) });
    const stream = new WorkerBiStream(api as never, STREAM_INFO);
    await stream.read_to_end(4096);
    expect(api.streamReadToEnd).toHaveBeenCalledWith(7, 4096);
  });

  it("write_raw_and_finish copies the buffer before sending", async () => {
    const api = makeFakeApi();
    const stream = new WorkerBiStream(api as never, STREAM_INFO);
    const original = new Uint8Array([1, 1, 1]);

    await stream.write_raw_and_finish(original);

    const [calledStreamId, sentBytes] = (
      api.streamWriteRawAndFinish as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [number, Uint8Array];
    expect(calledStreamId).toBe(7);
    expect(sentBytes.buffer).not.toBe(original.buffer);
    expect(Array.from(sentBytes)).toEqual([1, 1, 1]);
  });

  it("close() is fire-and-forget and swallows a rejection", () => {
    const api = makeFakeApi({ streamClose: vi.fn(async () => Promise.reject(new Error("gone"))) });
    const stream = new WorkerBiStream(api as never, STREAM_INFO);
    expect(() => stream.close()).not.toThrow();
    expect(api.streamClose).toHaveBeenCalledWith(7);
  });
});

describe("WorkerImportSession", () => {
  it("resolves start_import lazily, then push()es against that session id", async () => {
    const api = makeFakeApi({ startImport: vi.fn(async () => 42) });
    const session = new WorkerImportSession(api as never);
    const original = new Uint8Array([3, 3, 3]);

    await session.push(original);

    expect(api.startImport).toHaveBeenCalledTimes(1);
    const [sessionId, sentBytes] = (api.importPush as ReturnType<typeof vi.fn>).mock.calls[0] as [
      number,
      Uint8Array,
    ];
    expect(sessionId).toBe(42);
    expect(sentBytes.buffer).not.toBe(original.buffer);
    expect(Array.from(sentBytes)).toEqual([3, 3, 3]);
  });

  it("finish() awaits the session id and returns the resulting hash", async () => {
    const api = makeFakeApi({
      startImport: vi.fn(async () => 5),
      importFinish: vi.fn(async () => "abc123"),
    });
    const session = new WorkerImportSession(api as never);
    const hash = await session.finish();
    expect(api.importFinish).toHaveBeenCalledWith(5);
    expect(hash).toBe("abc123");
  });

  it("abort() is fire-and-forget and swallows a rejection", async () => {
    const api = makeFakeApi({
      startImport: vi.fn(async () => 9),
      importAbort: vi.fn(async () => Promise.reject(new Error("already finished"))),
    });
    const session = new WorkerImportSession(api as never);
    expect(() => session.abort()).not.toThrow();
    // let the fire-and-forget promise chain settle before the test ends
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.importAbort).toHaveBeenCalledWith(9);
  });
});
