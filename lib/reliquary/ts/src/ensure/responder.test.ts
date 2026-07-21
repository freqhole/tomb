// tests for the ensure-blob responder (server side)

import { describe, expect, it, vi } from "vitest";
import { createMockBiStream } from "../testing/index.js";
import { createEnsureBlobHandler, type EnsureBlobHandlerDeps } from "./responder.js";
import type { EnsureBlobRequest, EnsureBlobResponse } from "./types.js";

describe("ensure/responder", () => {
  function createMockDeps(overrides?: Partial<EnsureBlobHandlerDeps>): EnsureBlobHandlerDeps {
    return {
      hasBlob: vi.fn(async () => true),
      ...overrides,
    };
  }

  function encodeRequest(msg: EnsureBlobRequest): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(msg));
  }

  function decodeResponse(bytes: Uint8Array): EnsureBlobResponse {
    return JSON.parse(new TextDecoder().decode(bytes)) as EnsureBlobResponse;
  }

  describe("createEnsureBlobHandler", () => {
    it("returns a function", () => {
      const deps = createMockDeps();
      const handler = createEnsureBlobHandler(deps);
      expect(typeof handler).toBe("function");
    });

    it("handles a valid request when blob is available", async () => {
      const hasBlob = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer123", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 1,
        blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).toHaveBeenCalledWith(request.blake3_hash);
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(1);
      expect(response.available).toBe(true);
      expect(response.error).toBeUndefined();
    });

    it("handles a valid request when blob is not available", async () => {
      const hasBlob = vi.fn(async () => false);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer456", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 2,
        blake3_hash: "0000000000000000000000000000000000000000000000000000000000000001",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).toHaveBeenCalledWith(request.blake3_hash);
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(2);
      expect(response.available).toBe(false);
      expect(response.error).toBeUndefined();
    });

    it("rejects requests with invalid blake3 hash length", async () => {
      const hasBlob = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer789", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 3,
        blake3_hash: "tooshort",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).not.toHaveBeenCalled();
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(3);
      expect(response.available).toBe(false);
      expect(response.error).toContain("expected 64-char blake3 hex");
    });

    it("gates requests via allow callback when provided", async () => {
      const hasBlob = vi.fn(async () => true);
      const allow = vi.fn(async () => false);
      const deps = createMockDeps({ hasBlob, allow });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-denied", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 4,
        blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(allow).toHaveBeenCalledWith("peer-denied", request.blake3_hash);
      expect(hasBlob).not.toHaveBeenCalled();
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(4);
      expect(response.available).toBe(false);
      expect(response.error).toBe("not authorized");
    });

    it("allows requests when allow callback returns true", async () => {
      const hasBlob = vi.fn(async () => true);
      const allow = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob, allow });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-allowed", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 5,
        blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(allow).toHaveBeenCalledWith("peer-allowed", request.blake3_hash);
      expect(hasBlob).toHaveBeenCalledWith(request.blake3_hash);
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(5);
      expect(response.available).toBe(true);
    });

    it("handles hasBlob throwing an error", async () => {
      const hasBlob = vi.fn(async () => {
        throw new Error("database connection lost");
      });
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-error", "freqhole/1");
      const request: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 6,
        blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
      };

      handler(stream);
      stream.pushMessage(encodeRequest(request));

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).toHaveBeenCalled();
      expect(stream._written.length).toBe(1);

      const response = decodeResponse(stream._written[0]!);
      expect(response.type).toBe("ensure_blob_response");
      expect(response.id).toBe(6);
      expect(response.available).toBe(false);
      expect(response.error).toBe("hasBlob check failed");
    });

    it("handles malformed JSON gracefully", async () => {
      const hasBlob = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-badmsg", "freqhole/1");
      const malformed = new TextEncoder().encode("not json {{{");

      handler(stream);
      stream.pushMessage(malformed);

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).not.toHaveBeenCalled();
      expect(stream._closed).toBe(true);
    });

    it("ignores non-request message types", async () => {
      const hasBlob = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-wrongtype", "freqhole/1");
      const wrongType = new TextEncoder().encode(
        JSON.stringify({ type: "ensure_blob_response", id: 99, available: false })
      );

      handler(stream);
      stream.pushMessage(wrongType);

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).not.toHaveBeenCalled();
      expect(stream._closed).toBe(true);
    });

    it("handles streams without read_to_end support gracefully", async () => {
      const hasBlob = vi.fn(async () => true);
      const deps = createMockDeps({ hasBlob });
      const handler = createEnsureBlobHandler(deps);

      const stream = createMockBiStream("peer-noread", "freqhole/1");
      stream.read_to_end = undefined;

      handler(stream);

      await new Promise((r) => setTimeout(r, 50));

      expect(hasBlob).not.toHaveBeenCalled();
      expect(stream._closed).toBe(true);
    });
  });
});
