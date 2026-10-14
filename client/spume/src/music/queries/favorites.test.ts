// @vitest-environment jsdom
// regression tests for mirrorFavoriteToLocalSong - favoriting a song while
// browsing a remote should also favorite the local copy of the same
// content, matched by blake3 (the only reliable cross-remote song
// identifier - sha256 is deprecated), when one exists. covers both
// browser mode (local library = IndexedDB) and charnel mode (local
// library = the tauri-managed remote, reached like any other remote).
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

const getTauriManagedRemote = vi.fn(
  (..._args: unknown[]): Promise<{ remote_id: string } | null> => Promise.resolve(null)
);
vi.mock("../../app/services/remotes/remoteManager", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTauriManagedRemote: (...a: unknown[]) => getTauriManagedRemote(...a),
}));

const getSongByBlake3 = vi.fn(
  (..._args: unknown[]): Promise<{ id: string } | null> => Promise.resolve(null)
);
const tauriSetFavorite = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("../data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class {
    getSongByBlake3 = (...a: unknown[]) => getSongByBlake3(...a);
    setFavorite = (...a: unknown[]) => tauriSetFavorite(...a);
  },
}));

import { mirrorFavoriteToLocalSong } from "./favorites";

beforeEach(() => {
  isCharnelMode.mockReset().mockReturnValue(false);
  findExistingSongByContentHash.mockReset().mockResolvedValue(undefined);
  setFavorite.mockReset().mockResolvedValue(undefined);
  getTauriManagedRemote.mockReset().mockResolvedValue(null);
  getSongByBlake3.mockReset().mockResolvedValue(null);
  tauriSetFavorite.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mirrorFavoriteToLocalSong", () => {
  it("does nothing when there's no blake3 to match on", async () => {
    await mirrorFavoriteToLocalSong(undefined, true);
    expect(findExistingSongByContentHash).not.toHaveBeenCalled();
    expect(getTauriManagedRemote).not.toHaveBeenCalled();
  });

  describe("browser mode", () => {
    it("favorites the local copy when one exists for this blake3", async () => {
      findExistingSongByContentHash.mockResolvedValue({ id: "local-song-1" });
      await mirrorFavoriteToLocalSong("a".repeat(64), true);
      expect(findExistingSongByContentHash).toHaveBeenCalledWith({ blake3: "a".repeat(64) });
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

    it("never throws even if the local lookup fails", async () => {
      findExistingSongByContentHash.mockRejectedValue(new Error("idb boom"));
      await expect(mirrorFavoriteToLocalSong("d".repeat(64), false)).resolves.toBeUndefined();
    });
  });

  describe("charnel mode", () => {
    beforeEach(() => {
      isCharnelMode.mockReturnValue(true);
    });

    it("favorites the matching song on the tauri-managed remote", async () => {
      getTauriManagedRemote.mockResolvedValue({ remote_id: "local-library" });
      getSongByBlake3.mockResolvedValue({ id: "local-song-2" });
      await mirrorFavoriteToLocalSong("c".repeat(64), true);
      expect(getSongByBlake3).toHaveBeenCalledWith("c".repeat(64));
      expect(tauriSetFavorite).toHaveBeenCalledWith({
        targetType: "song",
        targetId: "local-song-2",
        isFavorite: true,
      });
    });

    it("does nothing when no tauri-managed remote is configured", async () => {
      getTauriManagedRemote.mockResolvedValue(null);
      await mirrorFavoriteToLocalSong("e".repeat(64), true);
      expect(getSongByBlake3).not.toHaveBeenCalled();
    });

    it("does nothing when no matching song is found on the local library", async () => {
      getTauriManagedRemote.mockResolvedValue({ remote_id: "local-library" });
      getSongByBlake3.mockResolvedValue(null);
      await mirrorFavoriteToLocalSong("f".repeat(64), true);
      expect(tauriSetFavorite).not.toHaveBeenCalled();
    });

    it("never throws even if the lookup fails", async () => {
      getTauriManagedRemote.mockRejectedValue(new Error("ipc boom"));
      await expect(mirrorFavoriteToLocalSong("g".repeat(64), false)).resolves.toBeUndefined();
    });
  });
});
