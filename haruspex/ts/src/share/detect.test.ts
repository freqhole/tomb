import { describe, expect, it } from "vitest";

import { detectShareInput } from "./detect.js";
import { encodeShareToken, shareFragment } from "./codec.js";
import type { DocSharePayload } from "./codec.js";

const NODE_ID = "ab".repeat(32);

describe("detectShareInput", () => {
  it("classifies a bare 64-hex node id", () => {
    expect(detectShareInput(NODE_ID)).toEqual({ kind: "node_id", nodeId: NODE_ID });
  });

  it("classifies a json endpoint blob as a node id", () => {
    const blob = JSON.stringify({ node_id: NODE_ID, relay_url: "https://relay.example" });
    expect(detectShareInput(blob)).toEqual({ kind: "node_id", nodeId: NODE_ID });
  });

  it("classifies a bare share token", () => {
    const payload: DocSharePayload = { kind: "doc", nodeId: NODE_ID, docId: "automerge:abc" };
    const token = encodeShareToken(payload);
    expect(detectShareInput(token)).toEqual({ kind: "share_token", token, payload });
  });

  it("classifies a url with the token in its fragment", () => {
    const payload: DocSharePayload = { kind: "doc", nodeId: NODE_ID, docId: "automerge:xyz" };
    const token = encodeShareToken(payload);
    const url = `https://example.com/app/${shareFragment(payload)}`;
    expect(detectShareInput(url)).toEqual({ kind: "share_token", token, payload });
  });

  it("classifies empty input as invalid", () => {
    expect(detectShareInput("")).toEqual({ kind: "invalid" });
    expect(detectShareInput("   ")).toEqual({ kind: "invalid" });
  });

  it("classifies garbage as invalid", () => {
    expect(detectShareInput("not a node id or a token")).toEqual({ kind: "invalid" });
  });
});
