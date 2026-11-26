import { beforeEach, expect, it, vi } from "vitest";
import type { Song } from "../../storage/types";
import { beginMediaLoad, cancelMediaLoads } from "../../../../app/services/media/loadGuard";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  setCurrentSong: vi.fn(),
  state: { current_item_key: "song", queue: [] as unknown[] },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../../../app/services/storage/db", () => ({
  appState: () => mocks.state,
  getSyncQueueToLocal: () => false,
  setCurrentSong: mocks.setCurrentSong,
}));
vi.mock("../../sync/syncSongToLocal", () => ({ syncSongToLocal: vi.fn() }));
vi.mock("../../download", () => ({
  addToLoadingSet: vi.fn(),
  removeFromLoadingSet: vi.fn(),
  updateLoadingProgress: vi.fn(),
  isSongOnDiskEphemeral: vi.fn(),
}));
vi.mock("../ephemeralFetch", () => ({ fetchEphemeralForSong: vi.fn() }));
vi.mock("../mediaSessionBridge", () => ({ clearExternalMediaSession: vi.fn() }));
vi.mock("../../../../utils/logger", () => ({ debug: vi.fn(), error: vi.fn() }));

import { LibmpvBackend } from "./libmpvBackend";

const song: Song = {
  id: "song", title: "song", sha256: "", artist_id: "artist", album_id: "album",
  track_number: 1, disc_number: 1, duration_seconds: 42, year: null, bpm: null,
  track_artist: null, lyrics: null, metadata: null, created_at: 0, updated_at: 0,
  artist_name: "artist", album_title: "album", album_added_at: 0,
  album_primary_genre_id: null, source_type: "remote", opfs_path: null,
  file_name: null, file_size: null, last_modified: null, mime_type: null,
  source_url: null, downloaded_at: null, remote_server_id: "remote",
  remote_song_id: "song", blake3: "hash", added_at: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.queue = [{ kind: "song", song }];
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "resolve_blob_path_by_blake3" ? { path: "/song.flac" } : undefined
  );
  mocks.setCurrentSong.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue(() => {});
});

it("does not start a resolved song after its load is cancelled during state persistence", async () => {
  let finishPersistence!: () => void;
  mocks.setCurrentSong.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishPersistence = resolve;
  }));
  const backend = new LibmpvBackend();
  const generation = beginMediaLoad("song");
  const loading = backend.loadAndPlay({ kind: "song", song }, { loadGeneration: generation });
  await vi.waitFor(() => expect(mocks.setCurrentSong).toHaveBeenCalled());
  cancelMediaLoads(["song"]);
  finishPersistence();
  await loading;
  expect(mocks.invoke).not.toHaveBeenCalledWith("player_send", expect.anything());
});

it("reloads a stopped song paused at the requested seek position", async () => {
  const backend = new LibmpvBackend();
  await backend.loadAndPlay({ kind: "song", song });
  await backend.send({ kind: "stop" });
  mocks.invoke.mockClear();
  await backend.send({ kind: "seek", ms: 5000 });
  expect(mocks.invoke).toHaveBeenCalledWith("player_send", {
    cmd: { kind: "load", paths: ["/song.flac"], start_ms: 5000, start_paused: true },
  });
});

it("reloads a completed song instead of seeking an idle player", async () => {
  const backend = new LibmpvBackend();
  backend.subscribe(() => {});
  await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());
  await backend.loadAndPlay({ kind: "song", song });
  const handler = mocks.listen.mock.calls[0][1] as (event: { payload: { kind: "ended" } }) => void;
  handler({ payload: { kind: "ended" } });
  mocks.invoke.mockClear();
  await backend.send({ kind: "seek", ms: 5000 });
  expect(mocks.invoke).toHaveBeenCalledWith("player_send", {
    cmd: { kind: "load", paths: ["/song.flac"], start_ms: 5000, start_paused: true },
  });
  await backend.dispose();
});
