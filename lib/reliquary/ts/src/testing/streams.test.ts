import { describe, expect, it } from "vitest";
import { CollectingStream, decodeJsonMessage, encodeJsonMessage, makeServingStream } from "./streams.js";

describe("encodeJsonMessage / decodeJsonMessage", () => {
  it("round-trips a message", () => {
    const message = { type: "ping", n: 3 };
    expect(decodeJsonMessage(encodeJsonMessage(message))).toEqual(message);
  });
});

describe("CollectingStream", () => {
  it("decodes and records every write", async () => {
    const stream = new CollectingStream();
    await stream.write_message(encodeJsonMessage({ type: "hello" }));
    await stream.write_message(encodeJsonMessage({ type: "world" }));
    expect(stream.sent).toEqual([{ type: "hello" }, { type: "world" }]);
  });

  it("read_message always resolves null", async () => {
    const stream = new CollectingStream();
    await expect(stream.read_message()).resolves.toBeNull();
  });

  it("tracks closed state", () => {
    const stream = new CollectingStream();
    expect(stream.closed).toBe(false);
    stream.close();
    expect(stream.closed).toBe(true);
  });

  it("uses the given peer id/alpn, defaulting when omitted", () => {
    const withDefaults = new CollectingStream();
    expect(withDefaults.peer_node_id()).toBe("peer-a");
    expect(withDefaults.alpn()).toBe("reliquary/testing/1");

    const withOverrides = new CollectingStream({ peerId: "peer-q", alpn: "custom/1" });
    expect(withOverrides.peer_node_id()).toBe("peer-q");
    expect(withOverrides.alpn()).toBe("custom/1");
  });

  it("decodes writes with a caller-supplied codec", async () => {
    const stream = new CollectingStream<string>({ decode: (data) => new TextDecoder().decode(data) });
    await stream.write_message(new TextEncoder().encode("raw text"));
    expect(stream.sent).toEqual(["raw text"]);
  });
});

describe("makeServingStream", () => {
  const table = {
    "blob-1": { blake3: "blake3-1", size: 10, mime: "audio/wav" },
  };

  it("replies blob_ready for a known id", async () => {
    const stream = makeServingStream(table);
    await stream.write_message(encodeJsonMessage({ type: "blob_request", id: "blob-1" }));
    const reply = decodeJsonMessage(await stream.read_message() as Uint8Array);
    expect(reply).toEqual({ type: "blob_ready", id: "blob-1", blake3: "blake3-1", size: 10, mime: "audio/wav" });
  });

  it("replies blob_not_found for an unknown id", async () => {
    const stream = makeServingStream(table);
    await stream.write_message(encodeJsonMessage({ type: "blob_request", id: "missing" }));
    const reply = decodeJsonMessage(await stream.read_message() as Uint8Array);
    expect(reply).toEqual({ type: "error", code: "blob_not_found", id: "missing" });
  });

  it("read_message resolves null once every scripted reply has been read", async () => {
    const stream = makeServingStream(table);
    await stream.write_message(encodeJsonMessage({ type: "blob_request", id: "blob-1" }));
    await stream.read_message();
    await expect(stream.read_message()).resolves.toBeNull();
  });

  it("ignores writes that aren't blob requests", async () => {
    const stream = makeServingStream(table);
    await stream.write_message(encodeJsonMessage({ type: "something_else" }));
    await expect(stream.read_message()).resolves.toBeNull();
  });

  it("tracks closed state", () => {
    const stream = makeServingStream(table);
    expect(stream.closed).toBe(false);
    stream.close();
    expect(stream.closed).toBe(true);
  });

  it("supports a caller-supplied requestId/buildReply pair for a custom protocol", async () => {
    interface CustomMessage {
      kind: "get" | "got" | "miss";
      hash?: string;
      blake3?: string;
      size?: number;
    }

    const stream = makeServingStream<CustomMessage>(table, {
      requestId: (m) => (m.kind === "get" ? (m.hash ?? null) : null),
      buildReply: (id, entry) =>
        entry ? { kind: "got", hash: id, blake3: entry.blake3, size: entry.size } : { kind: "miss", hash: id },
    });

    await stream.write_message(encodeJsonMessage({ kind: "get", hash: "blob-1" }));
    const reply = decodeJsonMessage<CustomMessage>((await stream.read_message())!);
    expect(reply).toEqual({ kind: "got", hash: "blob-1", blake3: "blake3-1", size: 10 });
  });
});
