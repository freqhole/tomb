// regression tests for importMusicFiles's dedup decision logic - the
// exact path implicated in the reported "can't add more than one file,
// gets marked as duplicate" bug.
//
// a fresh local import leaves `NewSong.sha256` as `""` for every file (see
// fileProcessor.ts's processMusicFile doc comment - part of the ongoing
// sha256->blake3 deprecation). before getSongBySha256 guarded against an
// empty lookup key, a SECOND freshly-imported file in the same batch would
// either collide with the first via a unique `by_sha256` index
// (ConstraintError, silently treated as "duplicate") or - once the index
// was made non-unique - get matched as a duplicate of the first via
// getSongBySha256("") returning an arbitrary "" row. these tests exercise
// importMusicFiles end-to-end (with processMusicFiles/db/reliquary mocked)
// to lock in the fixed behavior and make the next sha256 chip-away step
// easy to verify against.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewSong } from "../services/storage/types";

const createSong = vi.fn(async (song: NewSong) => ({ ...song, id: `id-${song.file_name}` }));
const getSongBySha256 = vi.fn(async (sha256: string) =>
  sha256 ? savedSongs.find((s) => s.sha256 === sha256) : undefined
);
const getSongByBlake3 = vi.fn(async (blake3: string) =>
  savedSongs.find((s) => s.blake3 === blake3)
);
const processMusicFiles = vi.fn();
const hashBlake3Streaming = vi.fn();
const createLocalImportSession = vi.fn(async () => "session-1");
const recordLocalImportBlob = vi.fn(async () => {});

let savedSongs: Array<NewSong & { id: string }> = [];

vi.mock("../services/storage/db", () => ({
  createSong: (...a: unknown[]) => createSong(...(a as [NewSong])),
  getSongBySha256: (...a: unknown[]) => getSongBySha256(...(a as [string])),
  getSongByBlake3: (...a: unknown[]) => getSongByBlake3(...(a as [string])),
}));
vi.mock("../services/storage/db/importReview", () => ({
  createLocalImportSession: (...a: unknown[]) => createLocalImportSession(...(a as [])),
  recordLocalImportBlob: (...a: unknown[]) => recordLocalImportBlob(...(a as [])),
}));
vi.mock("./fileProcessor", () => ({
  processMusicFiles: (...a: unknown[]) => processMusicFiles(...a),
}));
vi.mock("@freqhole/reliquary/worker", () => ({
  hashBlake3Streaming: (...a: unknown[]) => hashBlake3Streaming(...(a as [File])),
}));

import { importMusicFiles } from "./localImport";

function newSong(overrides: Partial<NewSong> = {}): NewSong {
  return {
    sha256: "",
    blake3: null,
    title: "untitled",
    artist_id: "artist-1",
    album_id: "album-1",
    track_number: 1,
    disc_number: 1,
    duration_seconds: 180,
    year: null,
    bpm: null,
    track_artist: null,
    lyrics: null,
    metadata: null,
    created_at: 0,
    updated_at: 0,
    artist_name: "artist",
    album_title: "album",
    album_added_at: 0,
    album_primary_genre_id: null,
    source_type: "local",
    opfs_path: null,
    file_name: "song.mp3",
    file_size: null,
    last_modified: null,
    mime_type: null,
    source_url: null,
    downloaded_at: null,
    remote_server_id: null,
    remote_song_id: null,
    added_at: 0,
    ...overrides,
  };
}

function fakeFile(name: string): File {
  return new File(["fake bytes"], name, { type: "audio/mpeg" });
}

function fakeFileList(files: File[]): FileList {
  return files as unknown as FileList;
}

beforeEach(() => {
  vi.clearAllMocks();
  savedSongs = [];
  createSong.mockImplementation(async (song: NewSong) => {
    const saved = { ...song, id: `id-${song.file_name}` };
    savedSongs.push(saved);
    return saved;
  });
  getSongBySha256.mockImplementation(async (sha256: string) =>
    sha256 ? savedSongs.find((s) => s.sha256 === sha256) : undefined
  );
  getSongByBlake3.mockImplementation(async (blake3: string) =>
    savedSongs.find((s) => s.blake3 === blake3)
  );
  createLocalImportSession.mockResolvedValue("session-1");
  hashBlake3Streaming.mockImplementation(async (file: File) => `hash-${file.name}`);
});

describe("importMusicFiles dedup", () => {
  it('adds two DIFFERENT freshly-imported files (both sha256 "") instead of marking the second a duplicate', async () => {
    const files = [fakeFile("a.mp3"), fakeFile("b.mp3")];
    processMusicFiles.mockResolvedValue([
      newSong({ file_name: "a.mp3", sha256: "" }),
      newSong({ file_name: "b.mp3", sha256: "" }),
    ]);

    const result = await importMusicFiles(fakeFileList(files));

    expect(result.addedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(createSong).toHaveBeenCalledTimes(2);
  });

  it("skips a file whose blake3 already exists locally (phase-0 pre-check), before ever hashing sha256", async () => {
    savedSongs.push({
      ...newSong({ file_name: "existing.mp3" }),
      id: "id-existing",
      blake3: "dup-hash",
    });
    hashBlake3Streaming.mockResolvedValueOnce("dup-hash");
    processMusicFiles.mockResolvedValue([]);

    const result = await importMusicFiles(fakeFileList([fakeFile("new.mp3")]));

    expect(result.skippedCount).toBe(1);
    expect(result.addedCount).toBe(0);
    // never reached the metadata-processing phase for the skipped file
    expect(processMusicFiles).toHaveBeenCalledWith([], []);
  });

  it("still skips a real sha256 duplicate (legacy pre-blake3 song) via the safety-net check", async () => {
    savedSongs.push({
      ...newSong({ file_name: "legacy.mp3", sha256: "legacy-hash" }),
      id: "id-legacy",
    });
    hashBlake3Streaming.mockResolvedValue(null as unknown as string);
    processMusicFiles.mockResolvedValue([newSong({ file_name: "dup.mp3", sha256: "legacy-hash" })]);

    const result = await importMusicFiles(fakeFileList([fakeFile("dup.mp3")]));

    expect(result.skippedCount).toBe(1);
    expect(result.addedCount).toBe(0);
  });

  it("never lets an empty sha256 match another empty-sha256 song via the safety-net check", async () => {
    // an existing song with no real hash at all (sha256 "" already saved).
    savedSongs.push({ ...newSong({ file_name: "existing.mp3", sha256: "" }), id: "id-existing" });
    hashBlake3Streaming.mockResolvedValue(null as unknown as string);
    processMusicFiles.mockResolvedValue([newSong({ file_name: "new.mp3", sha256: "" })]);

    const result = await importMusicFiles(fakeFileList([fakeFile("new.mp3")]));

    expect(result.addedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });
});
