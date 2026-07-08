import { describe, expect, it } from "vitest";

import {
  decodeShareToken,
  encodeShareToken,
  extractShareToken,
  shareFragment,
} from "./codec.js";
import type { DocSharePayload, EntitySharePayload, NodeSharePayload } from "./codec.js";

const NODE_ID = "ab".repeat(32);
const OTHER_NODE_ID = "cd".repeat(32);

describe("encodeShareToken / decodeShareToken (current wire)", () => {
  it("round-trips a node payload", () => {
    const payload: NodeSharePayload = { kind: "node", nodeId: NODE_ID, title: "my node" };
    const token = encodeShareToken(payload);
    expect(decodeShareToken(token)).toEqual(payload);
  });

  it("round-trips a doc payload with mode + title", () => {
    const payload: DocSharePayload = {
      kind: "doc",
      nodeId: NODE_ID,
      docId: "automerge:abc123",
      title: "shared playlist",
      mode: "knock",
    };
    const token = encodeShareToken(payload);
    expect(decodeShareToken(token)).toEqual(payload);
  });

  it("round-trips a doc payload with no optional fields", () => {
    const payload: DocSharePayload = { kind: "doc", nodeId: NODE_ID, docId: "automerge:xyz" };
    const token = encodeShareToken(payload);
    expect(decodeShareToken(token)).toEqual(payload);
  });

  it("round-trips an entity payload", () => {
    const payload: EntitySharePayload = {
      kind: "entity",
      source: { nodeId: NODE_ID, httpOrigin: "https://music.example.com" },
      entityKind: "album",
      entityId: "album-1",
      parentId: "artist-1",
      title: "a great album",
      artist: "someone",
      album: "a great album",
    };
    const token = encodeShareToken(payload);
    expect(decodeShareToken(token)).toEqual(payload);
  });

  it("round-trips unicode titles", () => {
    const payload: DocSharePayload = {
      kind: "doc",
      nodeId: NODE_ID,
      docId: "automerge:abc",
      title: "\u65e5\u672c\u8a9e \ud83c\udfb5",
    };
    const token = encodeShareToken(payload);
    expect(decodeShareToken(token)).toEqual(payload);
  });

  it("wraps the token in a #share/ fragment and decodes it back", () => {
    const payload: NodeSharePayload = { kind: "node", nodeId: NODE_ID };
    const fragment = shareFragment(payload);
    expect(fragment.startsWith("#share/")).toBe(true);
    expect(decodeShareToken(fragment)).toEqual(payload);
  });

  it("decodes a token embedded in a full url", () => {
    const payload: NodeSharePayload = { kind: "node", nodeId: NODE_ID };
    const token = encodeShareToken(payload);
    const url = `https://example.com/app/${shareFragment(payload)}`;
    expect(decodeShareToken(url)).toEqual(payload);
    expect(extractShareToken(url)).toBe(token);
  });
});

describe("decodeShareToken (legacy shapes)", () => {
  it("decodes the legacy versioned doc shape {v:1,n,d,t,m}", () => {
    const legacy = { v: 1, n: NODE_ID, d: "automerge:legacy", t: "old link", m: "public" };
    const token = btoa(JSON.stringify(legacy))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeShareToken(token)).toEqual({
      kind: "doc",
      nodeId: NODE_ID,
      docId: "automerge:legacy",
      title: "old link",
      mode: "public",
    });
  });

  it("decodes the bare, unversioned doc shape {n,d}", () => {
    const legacy = { n: NODE_ID, d: "automerge:bare" };
    const token = btoa(JSON.stringify(legacy));
    expect(decodeShareToken(token)).toEqual({
      kind: "doc",
      nodeId: NODE_ID,
      docId: "automerge:bare",
    });
  });

  it("decodes the legacy entity permalink shape {v:1,s:{n,h},k,i,...}", () => {
    const legacy = {
      v: 1,
      s: { n: NODE_ID, h: "https://spume.example.com" },
      k: "song",
      i: "song-1",
      p: "album-1",
      t: "a song",
      a: "an artist",
      al: "an album",
    };
    const json = JSON.stringify(legacy);
    let bin = "";
    for (const byte of new TextEncoder().encode(json)) bin += String.fromCharCode(byte);
    const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeShareToken(token)).toEqual({
      kind: "entity",
      source: { nodeId: NODE_ID, httpOrigin: "https://spume.example.com" },
      entityKind: "song",
      entityId: "song-1",
      parentId: "album-1",
      title: "a song",
      artist: "an artist",
      album: "an album",
    });
  });

  it("decodes a legacy token behind #share/ and share/ prefixes", () => {
    const legacy = { n: NODE_ID, d: OTHER_NODE_ID };
    const token = btoa(JSON.stringify(legacy));
    expect(decodeShareToken(`#share/${token}`)).toEqual({
      kind: "doc",
      nodeId: NODE_ID,
      docId: OTHER_NODE_ID,
    });
    expect(decodeShareToken(`share/${token}`)).toEqual({
      kind: "doc",
      nodeId: NODE_ID,
      docId: OTHER_NODE_ID,
    });
  });
});

describe("decodeShareToken (invalid input)", () => {
  it("returns null for empty input", () => {
    expect(decodeShareToken("")).toBeNull();
    expect(decodeShareToken("   ")).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    expect(decodeShareToken("not a token!!! ###")).toBeNull();
  });

  it("returns null for valid base64 that isn't json", () => {
    expect(decodeShareToken(btoa("just a string"))).toBeNull();
  });

  it("returns null for json that matches no known shape", () => {
    const token = btoa(JSON.stringify({ foo: "bar" }));
    expect(decodeShareToken(token)).toBeNull();
  });

  it("returns null for a wire payload with an unsupported version", () => {
    const token = btoa(JSON.stringify({ v: 99, k: "node", n: NODE_ID }));
    expect(decodeShareToken(token)).toBeNull();
  });
});
