// @vitest-environment jsdom
// regression tests for mirrorFavoriteToLocalSong - favoriting a song while
// browsing a remote should also favorite the local copy of the same
// content, when one exists (browser mode only - see the function's own
// doc comment for why charnel mode is deliberately skipped).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isCharnelMode = vi.fn((..._args: unknown[]) => false);
vi.mock("../../app/services/charnel", () => ({
  isCharnelMode: (...a: unknown[]) => isCharnelMode(...a),
}));

const findExistingSongByContentHash = vi.fn(
  (..._args: unknown[]): Promise<{ id: string } | undefined> => Promise.resolve(undefined)
);
vi.mock("../services/storage/db/songs", () => ({
  findExistingSongByContentHash: (...a: unknown[]) => findExistingSongByContentHash(...a),
}));

const setFavorite = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("../data/local/localSource", () => ({
  localDataSource: { setFavorite: (...a: unknown[]) => setFavorite(...a) },
}));

import { mirrorFavoriteToLocalSong } from "./favorites";

beforeEach(() => {
  isCharnelMode.mockReset().mockReturnValue(false);
  findExistingSongByContentHash.mockReset().mockResolvedValue(undefined);
  setFavorite.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mirrorFavoriteToLocalSong", () => {
  it("favorites the local copy when one exists for this content hash", async () => {
    findExistingSongByContentHash.mockResolvedValue({ id: "local-song-1" });
    await mirrorFavoriteToLocalSong("a".repeat(64), true);
    expect(findExistingSongByContentHash).toHaveBeenCalledWith({ sha256: "a".repeat(64) });
    expect(setFavorite).toHaveBeenCalledWith({
      targetType: "song",
      targetId: "local-song-1",
      isFavorite: true,
    });
  });

  it("does nothing when no local copy exists", async () => {
    findExistingSongByContentHash.mockResolvedValue(undefined);
    await mirrorFavoriteToLocalSong("b".repeat(64), true);
    expect(setFavorite).not.toHaveBeenCalled();
  });

  it("skips entirely in charnel mode (no content-hash lookup available here)", async () => {
    isCharnelMode.mockReturnValue(true);
    await mirrorFavoriteToLocalSong("c".repeat(64), true);
    expect(findExistingSongByContentHash).not.toHaveBeenCalled();
    expect(setFavorite).not.toHaveBeenCalled();
  });

  it("never throws even if the local lookup fails", async () => {
    findExistingSongByContentHash.mockRejectedValue(new Error("idb boom"));
    await expect(mirrorFavoriteToLocalSong("d".repeat(64), false)).resolves.toBeUndefined();
  });
});
