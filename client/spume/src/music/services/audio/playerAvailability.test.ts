import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, QueuedVideo } from "../../../app/services/storage/mediaItem";
import { mediaItemKey } from "../../../app/services/storage/mediaItem";
import type { Song } from "../storage/types";
import type { PlayerEventListener } from "./backend";

const mocks = vi.hoisted(() => ({
  state: { queue: [] as MediaItem[], current_item_key: null as string | null },
  load: vi.fn(),
  send: vi.fn(),
  stopRadio: vi.fn(),
  toast: vi.fn(),
  preCache: vi.fn(),
  getSong: vi.fn(),
  remote: false,
  persistQueue: vi.fn(),
  mirrorReplace: vi.fn(),
  mirrorAppend: vi.fn(),
  syncPlaylist: vi.fn(),
  queueLimit: 1000,
  playbackState: "stopped",
  resumeTracking: vi.fn(),
  resumeVideoTracking: vi.fn(),
  addHistory: vi.fn(),
  activePlayer: false,
  listeners: new Map<string, PlayerEventListener>(),
  setCurrentSong: vi.fn(),
  stopTracking: vi.fn(),
  stopVideoTracking: vi.fn(),
  stopSession: vi.fn(),
  mirrorClear: vi.fn(),
}));
vi.mock("./backends/htmlAudio", () => ({
  HtmlAudioBackend: class {
    kind = "html_audio";
    loadAndPlay = mocks.load;
    send = mocks.send;
    subscribe = (listener: PlayerEventListener) => {
      mocks.listeners.set("song", listener);
      return () => mocks.listeners.delete("song");
    };
    snapshot = () => ({ state: mocks.playbackState });
  },
}));
vi.mock("../../../video/services/videoBackend", () => ({
  VideoBackend: class {
    kind = "video";
    loadAndPlay = mocks.load;
    send = mocks.send;
    subscribe = (listener: PlayerEventListener) => {
      mocks.listeners.set("video", listener);
      return () => mocks.listeners.delete("video");
    };
    snapshot = () => ({ state: mocks.playbackState });
  },
}));
vi.mock("../../../video/services/videoWindowBackend", () => ({ VideoWindowBackend: class {} }));
vi.mock("./select", () => ({ selectBackend: (backend: unknown) => backend }));
vi.mock("./selectVideo", () => ({ selectVideoBackend: (backend: unknown) => backend }));
vi.mock("./androidMediaSession", () => ({}));
vi.mock("./mediaSessionBridge", () => ({
  installMediaSessionBridge: vi.fn(),
  registerMediaActions: vi.fn(),
  pushPositionStateNow: vi.fn(),
}));
vi.mock("./playbackOrchestrator", () => ({ installPlaybackOrchestrator: vi.fn() }));
vi.mock("./playerStateSync", () => ({ bindActiveBackend: vi.fn() }));
vi.mock("./mediaSessionArtwork", () => ({ getMediaSessionArtwork: vi.fn() }));
vi.mock("../queue/preCacheScheduler", () => ({ installPreCacheScheduler: vi.fn() }));
vi.mock("../queue/triggerPreCache", () => ({ triggerPreCache: mocks.preCache }));
vi.mock("../queue/serverSession", () => ({
  stopServerSession: mocks.stopSession,
  updateServerSessionItems: vi.fn(),
  createServerSession: vi.fn(),
  activeServerSessionId: () => null,
  activeSessionMatchesSource: () => false,
  reconnectServerSession: vi.fn(),
  createServerSessions: vi.fn(),
  resumeServerSession: vi.fn(),
}));
vi.mock("../queue/listenProgress", () => ({
  activeHistoryEntryId: () => null,
  stopTracking: mocks.stopTracking,
  startTracking: vi.fn(),
  resumeTracking: mocks.resumeTracking,
}));
vi.mock("../queue/queueHistory", () => ({
  updateHistoryEntrySongs: vi.fn(),
  addHistoryEntry: mocks.addHistory,
  unwrapSongs: (songs: Song[]) => songs.map((song) => ({ ...song })),
}));
vi.mock("../../../video/services/queue/videoQueueHistory", () => ({
  unwrapVideos: (videos: QueuedVideo[]) => videos.map((video) => ({ ...video })),
  addVideoHistoryEntry: vi.fn(),
  updateVideoHistoryServerSession: vi.fn(),
}));
vi.mock("../queue/queueProgress", () => ({
  clearQueueItemProgress: vi.fn(),
  clearAllQueueProgress: vi.fn(),
}));
vi.mock("../../../app/services/players/remoteQueueMirror", () => ({
  mirrorRemoveFromQueue: vi.fn(),
  mirrorAppendToQueue: mocks.mirrorAppend,
  mirrorReplaceQueue: mocks.mirrorReplace,
  mirrorClearQueue: mocks.mirrorClear,
  mirrorReorderQueue: vi.fn(),
  optimisticRemoteQueue: () => [],
  mirrorReplaceVideosToQueue: mocks.mirrorReplace,
}));
vi.mock("../../../app/services/players/activeTarget", () => ({
  isRemoteTargetActive: () => mocks.remote,
}));
vi.mock("../../../cenotaph/adapters/remoteModeSettings", () => ({
  isActivePlayer: () => mocks.activePlayer,
}));
vi.mock("../../../app/services/playbackCoordinator", () => ({
  registerStopMusic: vi.fn(),
  stopRadioForMusic: mocks.stopRadio,
}));
vi.mock("../../../app/services/storage/db", () => ({
  appState: () => mocks.state,
  setCurrentSong: mocks.setCurrentSong,
  setQueue: mocks.persistQueue,
  setQueueOpen: vi.fn(),
}));
vi.mock("../../data", () => ({ getDataSource: () => ({ getSongById: mocks.getSong }) }));
vi.mock("../../queries/favorites", () => ({ toggleSongFavoriteDirect: vi.fn() }));
vi.mock("../../../components/feedback/Toast", () => ({ toast: { error: mocks.toast } }));
vi.mock("../../../utils/logger", () => ({ debug: vi.fn(), warn: vi.fn() }));
vi.mock("../queue/purgeDepartedMedia", () => ({ initQueueDeparturePurge: vi.fn() }));
vi.mock("../../../app/services/media/queueDeparture", () => ({ registerQueueDeparture: vi.fn() }));
vi.mock("../../../video/services/queue/videoListenProgress", () => ({
  stopVideoTracking: mocks.stopVideoTracking,
  startVideoTracking: vi.fn(),
  resumeVideoTracking: mocks.resumeVideoTracking,
}));
vi.mock("../../../video/services/queue/videoServerProgressSync", () => ({
  startVideoRemoteSync: vi.fn(),
}));
vi.mock("../../../app/services/remotes/remoteManager", () => ({ getRemoteById: vi.fn() }));
vi.mock("../queue/queueLimit", () => ({
  getQueueSizeLimit: () => mocks.queueLimit,
  showQueueFullModal: vi.fn(),
}));
vi.mock("../queue/queueReplaceConfirm", () => ({ showReplaceQueueConfirm: vi.fn() }));
vi.mock("../sync", () => ({ syncPlaylistToLocalFromQueue: mocks.syncPlaylist }));
vi.mock("../../../app/services/radio/radioService", () => ({ leaveRadio: vi.fn() }));
vi.mock("../../../app/services/storage/currentRadioStation", () => ({
  clearCurrentRadioStation: vi.fn(),
}));

import {
  playMediaItem,
  playNext,
  playPrevious,
  playSong,
  playVideo,
  play,
  togglePlayback,
} from "./player";
import {
  canGoNext,
  canGoPrevious,
  hasPlaybackEnded,
  resetPlaybackEnded,
  markPlaybackEnded,
} from "../queue/queueState";
import { addToQueue, clearQueue, playQueue, resumeHistoryEntry } from "../queue/queue";
import {
  playVideoQueue,
  resumeVideoHistoryEntry,
} from "../../../video/services/queue/playVideoQueue";

const song: Song = {
  id: "song",
  title: "song",
  sha256: "",
  artist_id: "artist",
  album_id: "album",
  track_number: 1,
  disc_number: 1,
  duration_seconds: 42,
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
  source_type: "remote",
  opfs_path: null,
  file_name: null,
  file_size: null,
  last_modified: null,
  mime_type: null,
  source_url: null,
  downloaded_at: null,
  remote_server_id: "remote",
  remote_song_id: "song",
  blake3: null,
  added_at: 0,
};
const video: QueuedVideo = {
  id: "video",
  title: "video",
  content_type: "movie",
  media_blob_id: "blob",
  created_at: 0,
  updated_at: 0,
  source_type: "remote",
  is_offline: false,
};
function item(id: string, offline = false, kind: "song" | "video" = "song"): MediaItem {
  return kind === "song"
    ? { kind, song: { ...song, id, is_offline: offline } }
    : { kind, video: { ...video, id, is_offline: offline } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.load.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
  mocks.remote = false;
  mocks.activePlayer = false;
  mocks.queueLimit = 1000;
  mocks.playbackState = "stopped";
  mocks.state.queue = [];
  mocks.state.current_item_key = null;
  resetPlaybackEnded();
  mocks.persistQueue.mockImplementation(async (items: MediaItem[]) => {
    mocks.state.queue = items;
  });
  mocks.setCurrentSong.mockImplementation(async (key: string | null) => {
    mocks.state.current_item_key = key;
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("shared player availability", () => {
  it.each(["song", "video"] as const)(
    "finishing a cenotaph %s queue clears persisted items and current item",
    async (kind) => {
      mocks.activePlayer = true;
      const current = item("last", false, kind);
      mocks.state.queue = [current];
      mocks.state.current_item_key = "last";
      await playMediaItem(current);
      const listener = mocks.listeners.get(kind);
      expect(listener).toBeDefined();
      listener?.({ kind: "ended" });
      await vi.waitFor(() => expect(mocks.state.queue).toEqual([]));
      expect(mocks.state.current_item_key).toBeNull();
      expect(mocks.stopTracking).toHaveBeenCalledWith(true);
      expect(mocks.stopTracking.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.persistQueue.mock.invocationCallOrder[0]
      );
      expect(mocks.stopVideoTracking).toHaveBeenCalledWith(true);
      expect(mocks.stopSession).toHaveBeenCalledWith("completed");
      expect(mocks.mirrorClear).not.toHaveBeenCalled();
      await play();
      expect(mocks.load).toHaveBeenCalledTimes(1);
    }
  );

  it("remote next at the end clears the player's whole queue, including offline rows", async () => {
    mocks.activePlayer = true;
    mocks.state.queue = [item("previous"), item("last"), item("offline", true)];
    mocks.state.current_item_key = "last";
    await playNext();
    expect(mocks.state.queue).toEqual([]);
    expect(mocks.state.current_item_key).toBeNull();
    expect(mocks.stopSession).toHaveBeenCalledWith("completed");
  });

  it("standalone completion preserves the queue for replay", async () => {
    mocks.state.queue = [item("last")];
    mocks.state.current_item_key = "last";
    await playNext();
    expect(mocks.state.queue).toEqual([item("last")]);
    expect(mocks.state.current_item_key).toBe("last");
    expect(mocks.persistQueue).not.toHaveBeenCalled();
  });

  it("mid-queue completion removes the finished song without clearing the next one", async () => {
    mocks.activePlayer = true;
    const first = item("first");
    const second = item("second");
    mocks.state.queue = [first, second];
    mocks.state.current_item_key = "first";
    await playMediaItem(first);
    mocks.load.mockImplementationOnce(async () => {
      mocks.state.current_item_key = "second";
    });
    mocks.listeners.get("song")?.({ kind: "ended" });
    await vi.waitFor(() => expect(mocks.state.queue).toEqual([second]));
    expect(mocks.state.current_item_key).toBe("second");
    expect(mocks.stopSession).not.toHaveBeenCalled();
    expect(mocks.stopTracking).not.toHaveBeenCalled();
  });

  it("clears a cenotaph queue when subsequent tracks exhaust the playback retry budget", async () => {
    mocks.activePlayer = true;
    mocks.state.queue = [item("current"), ...Array.from({ length: 6 }, (_, i) => item(`bad${i}`))];
    mocks.state.current_item_key = "current";
    mocks.load.mockRejectedValue(new Error("track unavailable"));
    const completion = playNext();
    await vi.runAllTimersAsync();
    await completion;
    expect(mocks.load).toHaveBeenCalledTimes(10);
    expect(mocks.state.queue).toEqual([]);
    expect(mocks.state.current_item_key).toBeNull();
  });

  // regression test: a user removing a flaky/slow item from the queue
  // while playNext() is sleeping between its two retry attempts must
  // stop that item from starting to play once the delay elapses - see
  // player.ts's `isStillQueued` doc comment for the full writeup of why
  // the load-guard generation counters alone don't cover this case.
  it("does not retry-play an item that left the queue during playNext's own retry delay", async () => {
    mocks.activePlayer = true;
    const next = item("next");
    mocks.state.queue = [item("current"), next];
    mocks.state.current_item_key = "current";
    // first attempt fails - and, as a side effect (mirrors the user
    // removing the item right around when the failure happens, well
    // before the retry's own NETWORK_RETRY_DELAY_MS delay elapses),
    // the item leaves the queue.
    mocks.load.mockImplementationOnce(async () => {
      mocks.state.queue = mocks.state.queue.filter(
        (i) => mediaItemKey(i) !== mediaItemKey(next)
      );
      throw new Error("track unavailable");
    });
    const completion = playNext();
    await vi.runAllTimersAsync();
    await completion;
    // exactly one attempt - the retry must have been skipped, not just
    // slow to arrive.
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.state.current_item_key).toBeNull();
  });

  // regression test for the sibling retry path - bindAutoAdvance's
  // one-shot network-element-error retry (a `video_element_error_network`/
  // `audio_element_error_network` event from the backend, not a thrown
  // rejection). same bug, same fix: the item is captured once when the
  // error fires, then replayed after NETWORK_RETRY_DELAY_MS - removing it
  // from the queue during that wait must cancel the retry, not just
  // delay it.
  it("does not retry-play an item that left the queue during the network-error retry delay", async () => {
    mocks.activePlayer = true;
    const current = item("flaky", false, "video");
    mocks.state.queue = [current];
    mocks.state.current_item_key = "flaky";
    await playMediaItem(current);
    expect(mocks.load).toHaveBeenCalledTimes(1);

    const listener = mocks.listeners.get("video");
    expect(listener).toBeDefined();
    listener?.({
      kind: "error",
      detail: {
        error_type: "video_element_error_network",
        title: "network error",
        detail: "network error",
      },
    });
    // the item leaves the queue AFTER the error fires (so it's correctly
    // captured for the retry) but BEFORE the retry's own delay elapses -
    // this is the actual race: removal happening during the wait, not
    // before the item was ever captured.
    mocks.state.queue = [];
    await vi.runAllTimersAsync();

    // still just the one (pre-error) load call - the retry must have
    // been skipped.
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("reports persistence failures during automatic completion", async () => {
    mocks.activePlayer = true;
    mocks.state.queue = [item("last")];
    mocks.state.current_item_key = "last";
    await playMediaItem(item("last"));
    mocks.persistQueue.mockRejectedValueOnce(new Error("write failed"));
    mocks.listeners.get("song")?.({ kind: "ended" });
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("could not finish updating the queue", {
        title: "playback error",
      })
    );
  });

  it("explicit queue clearing still mirrors the controller's stop and abandons the session", async () => {
    mocks.state.queue = [item("current")];
    mocks.state.current_item_key = "current";
    await clearQueue();
    expect(mocks.mirrorClear).toHaveBeenCalledOnce();
    expect(mocks.stopSession).toHaveBeenCalledWith("abandoned");
    expect(mocks.state.queue).toEqual([]);
    expect(mocks.state.current_item_key).toBeNull();
  });

  it("rejects direct song/video loads before radio takeover, backend loading or pre-cache", async () => {
    await expect(
      playSong({ ...song, is_offline: true }, { userInitiated: true })
    ).rejects.toMatchObject({ error_type: "media_offline" });
    await expect(
      playVideo({ ...video, is_offline: true }, { userInitiated: true })
    ).rejects.toMatchObject({ error_type: "media_offline" });
    await expect(playMediaItem(item("offline", true))).rejects.toMatchObject({
      error_type: "media_offline",
    });
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(mocks.stopRadio).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.preCache).not.toHaveBeenCalled();
  });

  it("guards songs resolved by id and permits unannotated older-peer songs", async () => {
    mocks.getSong.mockResolvedValue({ ...song, is_offline: true });
    await expect(playSong("song")).rejects.toMatchObject({ error_type: "media_offline" });
    await playSong(song);
    expect(mocks.load).toHaveBeenCalledWith({ kind: "song", song }, expect.anything());
  });

  it("skips more offline items than the failure budget without retries or queue mutation", async () => {
    mocks.state.queue = [
      item("current"),
      ...Array.from({ length: 12 }, (_, i) => item(`offline${i}`, true, i % 2 ? "song" : "video")),
      item("next", false, "video"),
    ];
    mocks.state.current_item_key = "current";
    const original = [...mocks.state.queue];
    expect(canGoNext()).toBe(true);
    await playNext();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load.mock.calls[0][0]).toEqual(item("next", false, "video"));
    expect(mocks.state.queue).toEqual(original);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("previous skips offline entries and control state excludes an offline-only tail", async () => {
    mocks.state.queue = [
      item("previous"),
      item("offline", true, "video"),
      item("current"),
      item("tail", true),
    ];
    mocks.state.current_item_key = "current";
    expect(canGoPrevious()).toBe(true);
    expect(canGoNext()).toBe(false);
    await playPrevious();
    expect(mocks.load.mock.calls[0][0]).toEqual(item("previous"));
    mocks.load.mockClear();
    await playNext();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(hasPlaybackEnded()).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith({ kind: "stop" });
    mocks.state.current_item_key = "offline";
    mocks.state.queue[0] = item("previous", true);
    expect(canGoPrevious()).toBe(false);
  });

  it("resuming an unloaded queue skips its offline head", async () => {
    mocks.state.queue = [item("offline", true), item("available")];
    await play();
    expect(mocks.load.mock.calls[0][0]).toEqual(item("available"));
  });

  it.each(["play", "toggle"])(
    "%s refuses to resume a now-offline loaded item without interrupting radio",
    async (action) => {
      mocks.playbackState = "paused";
      mocks.state.queue = [item("current", true)];
      mocks.state.current_item_key = "current";
      await expect(action === "play" ? play() : togglePlayback()).rejects.toMatchObject({
        error_type: "media_offline",
      });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.stopRadio).not.toHaveBeenCalled();
    }
  );

  it("restarts an ended queue at its first available item and permits reconnect", async () => {
    mocks.state.queue = [item("offline", true), item("available")];
    markPlaybackEnded();
    await play();
    expect(mocks.load.mock.calls[0][0]).toEqual(item("available"));
    mocks.state.queue[0] = item("offline", false);
    markPlaybackEnded();
    await play();
    expect(mocks.load.mock.calls[1][0]).toEqual(item("offline", false));
  });

  it("an all-offline persisted queue reports failure without radio takeover", async () => {
    mocks.state.queue = [item("offline", true)];
    await expect(play()).rejects.toMatchObject({ error_type: "media_offline" });
    expect(mocks.stopRadio).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("play all keeps mixed playlist order but starts at the first available item", async () => {
    const items = [item("offline", true), item("available", false, "video"), item("tail", true)];
    await playQueue(items, { source: { type: "playlist", label: "mixed playlist" } });
    expect(
      mocks.state.queue.map((entry) => (entry.kind === "song" ? entry.song.id : entry.video.id))
    ).toEqual(["offline", "available", "tail"]);
    expect(mocks.load.mock.calls[0][0]).toEqual(items[1]);
  });

  it("all-offline play and enqueue leave the existing queue and playback untouched", async () => {
    const existing = [item("current")];
    mocks.state.queue = existing;
    mocks.state.current_item_key = "current";
    const offline = [item("offline", true), item("video", true, "video")];
    await playQueue(offline, { source: { type: "playlist", label: "offline playlist" } });
    await addToQueue(offline, { startPlaying: true });
    expect(mocks.state.queue).toBe(existing);
    expect(mocks.persistQueue).not.toHaveBeenCalled();
    expect(mocks.mirrorReplace).not.toHaveBeenCalled();
    expect(mocks.mirrorAppend).not.toHaveBeenCalled();
    expect(mocks.syncPlaylist).not.toHaveBeenCalled();
    expect(mocks.stopRadio).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "session resume tracks the available item after skipping offline rows (capped: %s)",
    async (capped) => {
      mocks.queueLimit = capped ? 3 : 1000;
      mocks.addHistory.mockResolvedValueOnce("session-history");
      const items = [
        ...Array.from({ length: 8 }, (_, i) => item(`offline${i}`, true)),
        item("available"),
      ];
      await playQueue(items, {
        source: { type: "playlist", label: "session" },
        resumeProgress: {
          listened_seconds: 12,
          songs_completed: 0,
          current_song_index: 0,
          current_song_position: 12,
        },
      });
      const progress = {
        listened_seconds: 12,
        songs_completed: 0,
        current_song_index: capped ? 2 : 8,
        current_song_position: 0,
      };
      expect(mocks.load.mock.calls[0][0]).toMatchObject({ song: { id: "available" } });
      expect(mocks.addHistory).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        progress
      );
      expect(mocks.resumeTracking).toHaveBeenCalledWith("session-history", progress);
    }
  );

  it.each(["play", "add"])(
    "%s finds playable media before applying the queue cap",
    async (action) => {
      mocks.queueLimit = 3;
      const items = [
        ...Array.from({ length: 8 }, (_, i) => item(`offline${i}`, true)),
        item("available"),
      ];
      if (action === "play") await playQueue(items);
      else await addToQueue(items);
      expect(mocks.state.queue.length).toBeLessThanOrEqual(3);
      expect(mocks.load.mock.calls[0][0]).toEqual(item("available"));
    }
  );

  it("video play all preserves rows and leaves the current queue alone for all-offline input", async () => {
    const videos = [{ ...video, id: "offline", is_offline: true }, video];
    await playVideoQueue(videos);
    expect(mocks.state.queue).toHaveLength(2);
    expect(mocks.load.mock.calls[0][0]).toMatchObject({ video: { id: "video" } });
    const existing = mocks.state.queue;
    mocks.load.mockClear();
    mocks.persistQueue.mockClear();
    mocks.mirrorReplace.mockClear();
    await playVideoQueue([videos[0]]);
    expect(mocks.state.queue).toBe(existing);
    expect(mocks.persistQueue).not.toHaveBeenCalled();
    expect(mocks.mirrorReplace).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("history resumes skip offline rows without applying another item's saved position", async () => {
    const songs = [
      { ...song, is_offline: true },
      { ...song, id: "next" },
    ];
    await resumeHistoryEntry({
      id: "history",
      type: "playlist",
      label: "playlist",
      song_count: 2,
      songs,
      queued_at: 0,
      listened_seconds: 12,
      total_seconds: 100,
      songs_completed: 0,
      current_song_index: 0,
      current_song_position: 12,
    });
    expect(mocks.load.mock.calls[0][0]).toMatchObject({ song: { id: "next" } });
    expect(mocks.resumeTracking).toHaveBeenCalledWith(
      "history",
      expect.objectContaining({
        current_song_index: 1,
        current_song_position: 0,
      })
    );
    expect(vi.getTimerCount()).toBe(0);
    await resumeVideoHistoryEntry({
      id: "video-history",
      type: "video",
      label: "videos",
      video_count: 2,
      videos: [
        { ...video, is_offline: true },
        { ...video, id: "next-video" },
      ],
      queued_at: 0,
      watched_seconds: 12,
      total_seconds: 100,
      videos_completed: 0,
      current_video_index: 0,
      current_video_position: 12,
    });
    expect(mocks.load.mock.calls[1]).toEqual([
      expect.objectContaining({ video: expect.objectContaining({ id: "next-video" }) }),
      expect.objectContaining({ initialPosition: 0 }),
    ]);
    expect(mocks.resumeVideoTracking).toHaveBeenCalledWith(
      "video-history",
      expect.objectContaining({
        current_video_index: 1,
        current_video_position: 0,
      })
    );
  });
});
