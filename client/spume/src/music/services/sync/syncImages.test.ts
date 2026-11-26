import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@freqhole/api-client";

const mocks = vi.hoisted(() => ({
  blobMetadata: vi.fn(),
  getBlob: vi.fn(),
  importBlob: vi.fn(),
}));
vi.mock("@freqhole/api-client", () => ({
  FreqholeClient: class {
    music = { blobMetadata: mocks.blobMetadata };
  },
}));
vi.mock("../../../app/api/client", () => ({
  getMiddenNode: async () => ({ import_blob: mocks.importBlob }),
}));
vi.mock("../storage/blobs", () => ({ getBlob: mocks.getBlob }));

import { inlineImagesForSync, toInlinableImages } from "./syncImages";

const transport = {} as Transport;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("image sync references", () => {
  it("uses remote metadata without transferring image bytes", async () => {
    mocks.blobMetadata.mockResolvedValue({
      success: true,
      data: { blake3: "hash", mime: "image/png" },
    });
    const images = toInlinableImages([
      { remote_blob_id: "blob", is_primary: true, blob_type: "original" },
    ]);
    expect(await inlineImagesForSync(images, transport, new Map(), "artist")).toEqual([
      { blake3: "hash", mime_type: "image/png", is_primary: true, blob_type: "original" },
    ]);
    expect(mocks.importBlob).not.toHaveBeenCalled();
  });

  it("stages browser-library images on the source node and reuses the staged hash", async () => {
    mocks.getBlob.mockResolvedValue(new Blob(["art"], { type: "image/png" }));
    mocks.importBlob.mockResolvedValue("staged-hash");
    const images = toInlinableImages([
      { local_blob_id: "local", remote_blob_id: "other-peer", is_primary: true },
    ]);
    const cache = new Map();
    const expected = [
      { blake3: "staged-hash", mime_type: "image/png", is_primary: true, blob_type: "original" },
    ];
    expect(await inlineImagesForSync(images, transport, cache, "artist", true)).toEqual(expected);
    expect(await inlineImagesForSync(images, transport, cache, "artist", true)).toEqual(expected);
    expect(mocks.importBlob).toHaveBeenCalledOnce();
    expect(mocks.blobMetadata).not.toHaveBeenCalled();
  });

  it("does not claim a remote blob belongs to the browser source", async () => {
    const images = toInlinableImages([{ remote_blob_id: "other-peer" }]);
    expect(await inlineImagesForSync(images, transport, new Map(), "artist", true)).toEqual([]);
    expect(mocks.blobMetadata).not.toHaveBeenCalled();
  });
});
