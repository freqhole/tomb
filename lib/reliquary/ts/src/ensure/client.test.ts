// tests for the ensure-blob client

import { describe, expect, it, vi } from "vitest";
import { createMockBiStream } from "../testing/index.js";
import { ensureBlobOverAlpn, type EnsureCapableNode } from "./client.js";
import { DEFAULT_ENSURE_ALPN, type EnsureBlobResponse } from "./types.js";

describe("ensure/client", () => {
  function encodeResponse(msg: EnsureBlobResponse): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(msg));
  }

  function createMockNode(): EnsureCapableNode {
    const stream = createMockBiStream("remote-peer", "freqhole/1");
    return {
      open_bi: vi.fn(async () => stream),
    };
  }

  describe("ensureBlobOverAlpn", () => {
    it("dials the peer with the default ALPN when none provided", async () => {
      const node = createMockNode();
      const peerAddr = "peer123";
      const blake3Hash = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";

      const response: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 1,
        available: true,
      };

      const promise = ensureBlobOverAlpn(node, peerAddr, blake3Hash);

      await new Promise((r) => setTimeout(r, 10));
      const stream = (await node.open_bi("", "")) as ReturnType<typeof createMockBiStream>;
      stream.pushMessage(encodeResponse(response));

      const result = await promise;

      expect(node.open_bi).toHaveBeenCalledWith(peerAddr, DEFAULT_ENSURE_ALPN);
      expect(result).toBe(true);
    });

    it("dials the peer with a custom ALPN when provided", async () => {
      const node = createMockNode();
      const peerAddr = "peer456";
      const blake3Hash = "0000000000000000000000000000000000000000000000000000000000000001";
      const customAlpn = "custom/1";

      const response: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 1,
        available: false,
      };

      const promise = ensureBlobOverAlpn(node, peerAddr, blake3Hash, customAlpn);

      await new Promise((r) => setTimeout(r, 10));
      const stream = (await node.open_bi("", "")) as ReturnType<typeof createMockBiStream>;
      stream.pushMessage(encodeResponse(response));

      const result = await promise;

      expect(node.open_bi).toHaveBeenCalledWith(peerAddr, customAlpn);
      expect(result).toBe(false);
    });

    it("returns true when peer reports available=true", async () => {
      const node = createMockNode();
      const response: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 1,
        available: true,
      };

      const promise = ensureBlobOverAlpn(
        node,
        "peer789",
        "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
      );

      await new Promise((r) => setTimeout(r, 10));
      const stream = (await node.open_bi("", "")) as ReturnType<typeof createMockBiStream>;
      stream.pushMessage(encodeResponse(response));

      const result = await promise;
      expect(result).toBe(true);
    });

    it("returns false when peer reports available=false", async () => {
      const node = createMockNode();
      const response: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 1,
        available: false,
      };

      const promise = ensureBlobOverAlpn(
        node,
        "peer-unavail",
        "0000000000000000000000000000000000000000000000000000000000000002"
      );

      await new Promise((r) => setTimeout(r, 10));
      const stream = (await node.open_bi("", "")) as ReturnType<typeof createMockBiStream>;
      stream.pushMessage(encodeResponse(response));

      const result = await promise;
      expect(result).toBe(false);
    });

    it("returns false when peer reports an error", async () => {
      const node = createMockNode();
      const response: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 1,
        available: false,
        error: "not authorized",
      };

      const promise = ensureBlobOverAlpn(
        node,
        "peer-denied",
        "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
      );

      await new Promise((r) => setTimeout(r, 10));
      const stream = (await node.open_bi("", "")) as ReturnType<typeof createMockBiStream>;
      stream.pushMessage(encodeResponse(response));

      const result = await promise;
      expect(result).toBe(false);
    });

    it("throws when connection fails", async () => {
      const node: EnsureCapableNode = {
        open_bi: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      };

      await expect(
        ensureBlobOverAlpn(
          node,
          "peer-unreachable",
          "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        )
      ).rejects.toThrow("failed to connect to peer");
    });

    it("throws when stream does not support read_to_end", async () => {
      const stream = createMockBiStream("peer", "freqhole/1");
      stream.read_to_end = undefined;

      const node: EnsureCapableNode = {
        open_bi: vi.fn(async () => stream),
      };

      await expect(
        ensureBlobOverAlpn(
          node,
          "peer-noread",
          "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        )
      ).rejects.toThrow("stream does not support read_to_end");
    });

    it("throws when response is malformed JSON", async () => {
      const stream = createMockBiStream("peer-badresp", "freqhole/1");
      const node: EnsureCapableNode = {
        open_bi: vi.fn(async () => stream),
      };

      const promise = ensureBlobOverAlpn(
        node,
        "peer-badresp",
        "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
      );

      await new Promise((r) => setTimeout(r, 10));
      stream.pushMessage(new TextEncoder().encode("not json {{{"));

      await expect(promise).rejects.toThrow("failed to parse response");
    });

    it("throws when response has unexpected type", async () => {
      const stream = createMockBiStream("peer-wrongtype", "freqhole/1");
      const node: EnsureCapableNode = {
        open_bi: vi.fn(async () => stream),
      };

      const promise = ensureBlobOverAlpn(
        node,
        "peer-wrongtype",
        "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
      );

      await new Promise((r) => setTimeout(r, 10));
      const wrongType = { type: "ensure_blob_request", id: 99, blake3_hash: "test" };
      stream.pushMessage(new TextEncoder().encode(JSON.stringify(wrongType)));

      await expect(promise).rejects.toThrow("unexpected response type");
    });
  });
});
