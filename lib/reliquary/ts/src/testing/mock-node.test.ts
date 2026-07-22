import { describe, expect, it } from "vitest";
import { createMockBiStream, createMockMidden } from "./mock-node.js";

describe("createMockBiStream", () => {
  it("reports the peer id and alpn it was created with", () => {
    const stream = createMockBiStream("peer-x", "test-alpn/1");
    expect(stream.peer_node_id()).toBe("peer-x");
    expect(stream.alpn()).toBe("test-alpn/1");
  });

  it("defaults to the automerge sync alpn", () => {
    const stream = createMockBiStream("peer-x");
    expect(stream.alpn()).toBe("iroh/automerge-repo/1");
  });

  it("records every write in _written", async () => {
    const stream = createMockBiStream("peer-x");
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    await stream.write_message(a);
    await stream.write_message(b);
    expect(stream._written).toEqual([a, b]);
  });

  it("read_message resolves with a message pushed before the read starts", async () => {
    const stream = createMockBiStream("peer-x");
    const data = new Uint8Array([9, 9]);
    stream.pushMessage(data);
    await expect(stream.read_message()).resolves.toBe(data);
  });

  it("read_message resolves once a message is pushed after the read starts", async () => {
    const stream = createMockBiStream("peer-x");
    const pending = stream.read_message();
    const data = new Uint8Array([7]);
    stream.pushMessage(data);
    await expect(pending).resolves.toBe(data);
  });

  it("close() marks the stream closed and resolves any pending read with null", async () => {
    const stream = createMockBiStream("peer-x");
    const pending = stream.read_message();
    stream.close();
    expect(stream._closed).toBe(true);
    await expect(pending).resolves.toBeNull();
  });
});

describe("createMockMidden", () => {
  it("reports the node id it was created with, defaulting to a 64-char id", () => {
    const midden = createMockMidden("my-node");
    expect(midden.node_id()).toBe("my-node");
    expect(createMockMidden().node_id()).toHaveLength(64);
  });

  it("open_bi resolves with a mock stream addressed to the dialed peer", async () => {
    const midden = createMockMidden();
    const stream = await midden.open_bi("peer-y", "some-alpn");
    expect(stream.peer_node_id()).toBe("peer-y");
  });

  it("accept resolves with a stream pushed before the accept starts", async () => {
    const midden = createMockMidden();
    const incoming = createMockBiStream("peer-z");
    midden.pushIncoming(incoming);
    await expect(midden.accept()).resolves.toBe(incoming);
  });

  it("accept resolves once a stream is pushed after the accept starts", async () => {
    const midden = createMockMidden();
    const pending = midden.accept();
    const incoming = createMockBiStream("peer-z");
    midden.pushIncoming(incoming);
    await expect(pending).resolves.toBe(incoming);
  });
});
