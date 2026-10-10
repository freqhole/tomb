// regression test for a real bug found during the sha256 re-sweep
// (docs/sha256-removal-plan.md): LocalMusicDataSource.searchSuggestions's
// song branch used raw `song.sha256` for `value`/`entity_id` (consumed by
// TopNavSearch.tsx's handlePlay -> playSong -> getSongById, and by
// checkFavorite) instead of `song.id`. local-only songs always have
// `sha256: ""` (never hashed - see fileProcessor.ts), so every local song's
// search suggestion collided on the same empty-string id: clicking "play"
// called getSongById("") (always "song not found"), and is_favorite always
// read as false regardless of actual favorite status. fixed to use
// `song.id`, matching every other suggestion_type (artist/album already
// use their real primary key) and matching getSongById's own expectation.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../services/storage/types";

const querySongsWithDetails = vi.fn(async (): Promise<Song[]> => []);
const checkFavorite = vi.fn(async (..._args: unknown[]) => false);
const getSongById = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined as Song | undefined;
});
const findExistingSongByContentHash = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined as Song | undefined;
});

vi.mock("../../services/storage/db", () => ({
  addAlbumTag: vi.fn(),
  checkFavorite: (...a: unknown[]) => checkFavorite(...a),
  countSongsByAlbum: vi.fn(),
  countSongsByArtist: vi.fn(),
  createTag: vi.fn(),
  deleteAlbum: vi.fn(),
  deleteAlbumCascade: vi.fn(),
  deleteArtist: vi.fn(),
  deleteArtistCascade: vi.fn(),
  deleteSongCascade: vi.fn(),
  deleteTag: vi.fn(),
  findExistingSongByContentHash: (...a: unknown[]) => findExistingSongByContentHash(...a),
  findTagByName: vi.fn(),
  getAlbumById: vi.fn(),
  getAlbumTags: vi.fn(),
  getAllTags: vi.fn(),
  getArtistById: vi.fn(),
  getOrCreateAlbum: vi.fn(),
  getOrCreateArtist: vi.fn(),
  getOrCreateGenre: vi.fn(),
  getRating: vi.fn(),
  getSongById: (...a: unknown[]) => getSongById(...a),
  getSongsByIds: vi.fn(),
  initMusicDB: vi.fn(),
  queryAlbums: vi.fn(async () => []),
  queryArtists: vi.fn(async () => []),
  queryGenres: vi.fn(),
  querySongsWithDetails: (...a: unknown[]) => querySongsWithDetails(...(a as [])),
  removeAlbumTag: vi.fn(),
  setFavorite: vi.fn(),
  setRating: vi.fn(),
  updateAlbum: vi.fn(),
  updateArtist: vi.fn(),
  updateSong: vi.fn(),
}));
vi.mock("../../../app/services/storage/db", () => ({ getLocalLibraryName: vi.fn() }));
vi.mock("../../services/storage/blobs", () => ({
  deleteBlob: vi.fn(),
  getBlobObjectURL: vi.fn(),
  storeBlob: vi.fn(),
}));
vi.mock("../../services/opfs/helpers", () => ({ deleteThumbnailFromOPFS: vi.fn() }));
vi.mock("../../../video/data", () => ({ getVideoDataSource: vi.fn() }));
vi.mock("../../services/storage/playlists", () => ({
  deletePlaylist: vi.fn(),
  reorderLocalPlaylistItems: vi.fn(),
  updatePlaylistSongs: vi.fn(),
}));

import { LocalMusicDataSource } from "./localSource";

function localSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "fallback-id",
    sha256: "", // local-only songs never compute sha256
    blake3: null,
    media_blob_id: "",
    title: "untitled",
    artist_id: "artist-1",
    album_id: "album-1",
    artist_name: "unknown artist",
    album_title: "unknown album",
    track_number: 0,
    disc_number: 1,
    duration_seconds: 0,
    source_type: "local",
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  } as Song;
}

describe("LocalMusicDataSource.searchSuggestions (song branch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives two different local-only songs (both sha256: \"\") distinct suggestion values via their ids", async () => {
    querySongsWithDetails.mockResolvedValueOnce([
      localSong({ id: "song-a", title: "alpha song" }),
      localSong({ id: "song-b", title: "alpha beta" }),
    ]);

    const ds = new LocalMusicDataSource();
    const result = await ds.searchSuggestions({ field: "songs", partial: "alpha" });

    const values = result.suggestions.map((s) => s.value);
    expect(values).toEqual(["song-a", "song-b"]);
    expect(new Set(values).size).toBe(2);
  });

  it("checks favorite status by song.id, not sha256 (previously always false for local songs)", async () => {
    querySongsWithDetails.mockResolvedValueOnce([localSong({ id: "song-a", title: "alpha song" })]);
    checkFavorite.mockImplementation(async (...args: unknown[]) => args[1] === "song-a");

    const ds = new LocalMusicDataSource();
    const result = await ds.searchSuggestions({ field: "songs", partial: "alpha" });

    expect(checkFavorite).toHaveBeenCalledWith("song", "song-a");
    expect(result.suggestions[0]?.is_favorite).toBe(true);
  });

  it("entity_id matches what getSongById-style lookups expect (song.id, usable to resolve the song)", async () => {
    querySongsWithDetails.mockResolvedValueOnce([localSong({ id: "song-a", title: "alpha song" })]);

    const ds = new LocalMusicDataSource();
    const result = await ds.searchSuggestions({ field: "songs", partial: "alpha" });

    expect(result.suggestions[0]?.entity_id).toBe("song-a");
  });
});

// regression test for session B's id/sha256 decoupling: `current_item_key`
// (what AppLayout.tsx/player.ts pass to getSongById on page-reload) prefers
// `song.sha256` over `.id` (songIdentityKey's design) - a synced song's
// real local `id` is now a generated uuid, not its sha256, so a plain
// primary-key lookup alone would miss it after a reload.
describe("LocalMusicDataSource.getSongById (content-hash fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to a content-hash lookup when a sha256-shaped key misses the primary-key lookup", async () => {
    getSongById.mockResolvedValueOnce(undefined);
    findExistingSongByContentHash.mockResolvedValueOnce(localSong({ id: "real-uuid" }));

    const ds = new LocalMusicDataSource();
    const result = await ds.getSongById("a".repeat(64));

    expect(findExistingSongByContentHash).toHaveBeenCalledWith({ sha256: "a".repeat(64) });
    expect(result?.id).toBe("real-uuid");
  });

  it("does not fall back when the primary-key lookup already succeeds", async () => {
    getSongById.mockResolvedValueOnce(localSong({ id: "song-a" }));

    const ds = new LocalMusicDataSource();
    const result = await ds.getSongById("song-a");

    expect(findExistingSongByContentHash).not.toHaveBeenCalled();
    expect(result?.id).toBe("song-a");
  });

  it("returns null when neither lookup finds a song", async () => {
    getSongById.mockResolvedValueOnce(undefined);
    findExistingSongByContentHash.mockResolvedValueOnce(undefined);

    const ds = new LocalMusicDataSource();
    const result = await ds.getSongById("nonexistent");

    expect(result).toBeNull();
  });
});

