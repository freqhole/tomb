// regression tests for the video domain's blake3 identity handling -
// companion to music's songIdentityKey/getSongBySha256 tests. videos
// never had a sha256 field; `blake3` is nullable and defaults to `null`
// (not `""`), which is what keeps the video domain from ever hitting the
// exact "every unhashed row collides" bug class songs had - these tests
// lock that assumption in so it doesn't quietly regress if the field's
// default ever changes.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeVideoDB, getVideoDB, STORE_VIDEOS } from "./init";
import { addLocalVideo, getLocalVideoById, getLocalVideos, getVideoByBlake3 } from "./videos";

function newVideoInput(overrides: Partial<Parameters<typeof addLocalVideo>[0]> = {}) {
  return {
    id: crypto.randomUUID(),
    title: "test video",
    opfs_path: "video/test.mp4",
    file_name: "test.mp4",
    file_size: 1234,
    mime_type: "video/mp4",
    blake3: null,
    ...overrides,
  };
}

describe("video blake3 identity", () => {
  beforeEach(() => {
    closeVideoDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeVideoDB();
  });

  it('getVideoByBlake3("") never returns an arbitrary row', async () => {
    await addLocalVideo(newVideoInput({ blake3: "a".repeat(64) }));
    await addLocalVideo(newVideoInput({ blake3: null }));

    await expect(getVideoByBlake3("")).resolves.toBeUndefined();
  });

  it("two locally-imported videos with no blake3 (null) coexist without colliding", async () => {
    const first = await addLocalVideo(newVideoInput({ title: "first", blake3: null }));
    const second = await addLocalVideo(newVideoInput({ title: "second", blake3: null }));

    expect(first.id).not.toBe(second.id);
    // neither is reachable by blake3 (both null - sparse index skips them),
    // each is still its own distinct row keyed by id.
    await expect(getVideoByBlake3("a".repeat(64))).resolves.toBeUndefined();
  });

  it("getVideoByBlake3 finds the right video when a real hash is set", async () => {
    const target = await addLocalVideo(newVideoInput({ blake3: "b".repeat(64) }));
    await addLocalVideo(newVideoInput({ blake3: null }));

    await expect(getVideoByBlake3("b".repeat(64))).resolves.toMatchObject({ id: target.id });
  });

  it.each(["legacy", "remote"] as const)(
    "local reads do not inherit %s source-host offline state",
    async (kind) => {
      const video = await addLocalVideo(newVideoInput({ blake3: "c".repeat(64) }));
      expect(video.is_offline).toBe(false);
      const stored = { ...video, is_offline: true };
      if (kind === "legacy") Reflect.deleteProperty(stored, "is_offline");
      const db = await getVideoDB();
      await db.put(STORE_VIDEOS, stored);
      await expect(getVideoByBlake3("c".repeat(64))).resolves.toMatchObject({ is_offline: false });
      await expect(getLocalVideoById(video.id)).resolves.toMatchObject({ is_offline: false });
      const result = await getLocalVideos();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].is_offline).toBe(false);
    }
  );
});
