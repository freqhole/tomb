import { describe, expect, it } from "vitest";
import { decodeShareString, encodeShareString, shareFragment } from "./share-string";

describe("encodeShareString", () => {
  it("produces a base64 string", () => {
    const result = encodeShareString("a".repeat(64), "doc-123");
    expect(result).toBeTruthy();
    // should be valid base64
    expect(() => atob(result)).not.toThrow();
  });

  it("round-trips with decodeShareString", () => {
    const nodeId = "a".repeat(64);
    const docId = "some-doc-id-abc";
    const encoded = encodeShareString(nodeId, docId);
    const decoded = decodeShareString(encoded);
    expect(decoded).toEqual({ nodeId, docId });
  });
});

describe("decodeShareString", () => {
  it("decodes a valid base64 share string", () => {
    const payload = btoa(JSON.stringify({ n: "b".repeat(64), d: "doc-456" }));
    const result = decodeShareString(payload);
    expect(result).toEqual({ nodeId: "b".repeat(64), docId: "doc-456" });
  });

  it("strips #share/ prefix", () => {
    const payload = btoa(JSON.stringify({ n: "c".repeat(64), d: "doc-789" }));
    const result = decodeShareString(`#share/${payload}`);
    expect(result).toEqual({ nodeId: "c".repeat(64), docId: "doc-789" });
  });

  it("strips share/ prefix without hash", () => {
    const payload = btoa(JSON.stringify({ n: "d".repeat(64), d: "doc-000" }));
    const result = decodeShareString(`share/${payload}`);
    expect(result).toEqual({ nodeId: "d".repeat(64), docId: "doc-000" });
  });

  it("returns null for invalid base64", () => {
    expect(decodeShareString("not-valid-base64!!!")).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    expect(decodeShareString(btoa("not json"))).toBeNull();
  });

  it("returns null for missing nodeId", () => {
    expect(decodeShareString(btoa(JSON.stringify({ d: "doc" })))).toBeNull();
  });

  it("returns null for missing docId", () => {
    expect(decodeShareString(btoa(JSON.stringify({ n: "node" })))).toBeNull();
  });

  it("returns null for empty nodeId", () => {
    expect(decodeShareString(btoa(JSON.stringify({ n: "", d: "doc" })))).toBeNull();
  });

  it("returns null for empty docId", () => {
    expect(decodeShareString(btoa(JSON.stringify({ n: "node", d: "" })))).toBeNull();
  });

  it("trims whitespace", () => {
    const payload = btoa(JSON.stringify({ n: "e".repeat(64), d: "doc-ws" }));
    const result = decodeShareString(`  ${payload}  `);
    expect(result).toEqual({ nodeId: "e".repeat(64), docId: "doc-ws" });
  });
});

describe("shareFragment", () => {
  it("returns a hash fragment with share/ prefix", () => {
    const result = shareFragment("f".repeat(64), "doc-frag");
    expect(result).toMatch(/^#share\//);
  });

  it("round-trips through decodeShareString", () => {
    const frag = shareFragment("f".repeat(64), "doc-frag");
    const decoded = decodeShareString(frag);
    expect(decoded).toEqual({ nodeId: "f".repeat(64), docId: "doc-frag" });
  });
});
