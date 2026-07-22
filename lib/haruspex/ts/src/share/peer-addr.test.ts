import { describe, expect, it } from "vitest";

import {
  extractNodeId,
  extractNodeIdStrict,
  isValidNodeId,
  parsePeerAddress,
} from "./peer-addr.js";

const NODE_ID = "ab".repeat(32);

describe("isValidNodeId", () => {
  it("accepts a 64-hex id (either case, surrounding whitespace ok)", () => {
    expect(isValidNodeId(NODE_ID)).toBe(true);
    expect(isValidNodeId(` ${NODE_ID.toUpperCase()} `)).toBe(true);
  });

  it("rejects wrong lengths and non-hex", () => {
    expect(isValidNodeId(NODE_ID.slice(1))).toBe(false);
    expect(isValidNodeId("z".repeat(64))).toBe(false);
    expect(isValidNodeId("")).toBe(false);
  });
});

describe("extractNodeId", () => {
  it("passes a bare id through", () => {
    expect(extractNodeId(NODE_ID)).toBe(NODE_ID);
  });

  it("reads node_id or id out of a json endpoint blob", () => {
    expect(extractNodeId(JSON.stringify({ node_id: NODE_ID, relay_url: "x" }))).toBe(NODE_ID);
    expect(extractNodeId(JSON.stringify({ id: NODE_ID }))).toBe(NODE_ID);
  });

  it("falls back to the raw value when unparseable", () => {
    expect(extractNodeId("not json")).toBe("not json");
    expect(extractNodeIdStrict("not json")).toBeNull();
    expect(extractNodeIdStrict(JSON.stringify({ id: NODE_ID }))).toBe(NODE_ID);
  });
});

describe("parsePeerAddress", () => {
  it("classifies a bare node id as p2p", () => {
    expect(parsePeerAddress(` ${NODE_ID} `)).toEqual({ type: "p2p", peerAddr: NODE_ID });
  });

  it("classifies a json endpoint blob as p2p, keeping the blob intact", () => {
    const blob = JSON.stringify({ id: NODE_ID, relay_url: "https://r.example" });
    expect(parsePeerAddress(blob)).toEqual({ type: "p2p", peerAddr: blob });
  });

  it("json without an id field falls through to http", () => {
    const result = parsePeerAddress('{"foo": 1}');
    expect(result?.type).toBe("http");
  });

  it("normalizes http input: default scheme + trailing slash trim", () => {
    expect(parsePeerAddress("music.example.com/")).toEqual({
      type: "http",
      url: "https://music.example.com",
    });
    expect(parsePeerAddress("music.example.com", "http")).toEqual({
      type: "http",
      url: "http://music.example.com",
    });
    expect(parsePeerAddress("https://music.example.com//")).toEqual({
      type: "http",
      url: "https://music.example.com",
    });
  });

  it("returns null for empty input", () => {
    expect(parsePeerAddress("   ")).toBeNull();
  });
});
