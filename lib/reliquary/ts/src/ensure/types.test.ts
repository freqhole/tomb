// tests for the ensure-blob protocol message types

import { describe, expect, it } from "vitest";
import type { EnsureBlobRequest, EnsureBlobResponse, PeerMessage } from "./types.js";
import { DEFAULT_ENSURE_ALPN } from "./types.js";

describe("ensure/types", () => {
  describe("DEFAULT_ENSURE_ALPN", () => {
    it("exports the correct ALPN string", () => {
      expect(DEFAULT_ENSURE_ALPN).toBe("freqhole/1");
    });
  });

  describe("EnsureBlobRequest", () => {
    it("serializes with snake_case type tag", () => {
      const msg: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 42,
        blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
      };
      const json = JSON.stringify(msg);
      expect(json).toContain("ensure_blob_request");
      expect(json).toContain("blake3_hash");
    });

    it("roundtrips through JSON", () => {
      const original: EnsureBlobRequest = {
        type: "ensure_blob_request",
        id: 7,
        blake3_hash: "0000000000000000000000000000000000000000000000000000000000000001",
      };
      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as PeerMessage;
      expect(parsed.type).toBe("ensure_blob_request");
      expect((parsed as EnsureBlobRequest).id).toBe(7);
      expect((parsed as EnsureBlobRequest).blake3_hash).toBe(
        "0000000000000000000000000000000000000000000000000000000000000001"
      );
    });
  });

  describe("EnsureBlobResponse", () => {
    it("serializes with snake_case type tag", () => {
      const msg: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 42,
        available: true,
      };
      const json = JSON.stringify(msg);
      expect(json).toContain("ensure_blob_response");
    });

    it("roundtrips through JSON when available=true", () => {
      const original: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 10,
        available: true,
      };
      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as PeerMessage;
      expect(parsed.type).toBe("ensure_blob_response");
      expect((parsed as EnsureBlobResponse).id).toBe(10);
      expect((parsed as EnsureBlobResponse).available).toBe(true);
      expect((parsed as EnsureBlobResponse).error).toBeUndefined();
    });

    it("roundtrips through JSON when available=false with error", () => {
      const original: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 20,
        available: false,
        error: "not authorized",
      };
      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as PeerMessage;
      expect(parsed.type).toBe("ensure_blob_response");
      expect((parsed as EnsureBlobResponse).id).toBe(20);
      expect((parsed as EnsureBlobResponse).available).toBe(false);
      expect((parsed as EnsureBlobResponse).error).toBe("not authorized");
    });

    it("omits error field when undefined", () => {
      const msg: EnsureBlobResponse = {
        type: "ensure_blob_response",
        id: 5,
        available: true,
      };
      const json = JSON.stringify(msg);
      expect(json).not.toContain("error");
    });
  });
});
