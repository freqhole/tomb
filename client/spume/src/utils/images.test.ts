// tests for the artwork staleness check used by the sync paths.
//
// this decides whether a re-sync re-downloads artwork. too eager and every
// track sync re-fetches unchanged album art; too lazy and the local library
// never picks up artwork the remote added or replaced.

import { describe, expect, it } from "vitest";
import type { ImageMetadata } from "../music/services/storage/types";
import { imagesAreStale } from "./images";

function img(remoteBlobId: string | null): ImageMetadata {
  return { remote_blob_id: remoteBlobId } as unknown as ImageMetadata;
}

describe("imagesAreStale", () => {
  it("is stale when nothing is stored yet", () => {
    expect(imagesAreStale(undefined, ["a"])).toBe(true);
    expect(imagesAreStale([], ["a"])).toBe(true);
  });

  it("is not stale when the stored art matches the remote", () => {
    expect(imagesAreStale([img("a")], ["a"])).toBe(false);
  });

  // the whole point: an existing local copy is not a reason to stop syncing
  it("is stale when the remote replaced its art", () => {
    expect(imagesAreStale([img("a")], ["b"])).toBe(true);
  });

  it("is stale when the remote added another image", () => {
    expect(imagesAreStale([img("a")], ["a", "b"])).toBe(true);
  });

  it("is stale when the remote removed an image", () => {
    expect(imagesAreStale([img("a"), img("b")], ["a"])).toBe(true);
  });

  it("ignores ordering", () => {
    expect(imagesAreStale([img("b"), img("a")], ["a", "b"])).toBe(false);
  });

  it("is not stale when the remote has no art", () => {
    expect(imagesAreStale([], [])).toBe(false);
  });

  it("skips null and undefined remote ids", () => {
    expect(imagesAreStale([img("a")], ["a", null, undefined])).toBe(false);
  });

  // locally-imported art has no remote_blob_id; it must not be mistaken for
  // a match against a remote image
  it("does not count local-only images as matching remote art", () => {
    expect(imagesAreStale([img(null)], ["a"])).toBe(true);
  });
});
