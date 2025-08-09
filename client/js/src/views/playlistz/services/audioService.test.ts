import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as audioService from "./audioService.js";
import type { Song, Playlist } from "../types/playlist.js";

// Mock HTML Audio API
const mockAudio = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  currentTime: 0,
  duration: 180,
  volume: 1,
  src: "",
  ended: false,
  paused: true,
  readyState: 4,
  networkState: 1,
  error: null,
  dispatchEvent: vi.fn(),
};

global.Audio = vi.fn(() => mockAudio) as any;

// Mock URL API
global.URL = {
  createObjectURL: vi.fn((file) => `blob:mock-url-${Math.random()}`),
  revokeObjectURL: vi.fn(),
} as any;

// Mock Navigator API
Object.defineProperty(global, "navigator", {
  value: {
    ...global.navigator,
    mediaSession: {
      setActionHandler: vi.fn(),
      metadata: null,
    },
  },
  writable: true,
});

// Mock document API
Object.defineProperty(global, "document", {
  value: {
    ...global.document,
    title: "Test Page",
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback) => callback(new Blob())),
    })),
  },
  writable: true,
});

// Mock crypto API for ID generation
Object.defineProperty(global, "crypto", {
  value: {
    ...global.crypto,
    randomUUID: vi.fn(() => `test-uuid-${Math.random()}`),
  },
  writable: true,
});

// Test data
const createMockSong = (overrides: Partial<Song> = {}): Song => ({
  id: crypto.randomUUID(),
  title: "Test Song",
  artist: "Test Artist",
  album: "Test Album",
  duration: 180,
  position: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  playlistId: "test-playlist",
  file: new File(["fake audio"], "test.mp3", { type: "audio/mp3" }),
  blobUrl: "blob:mock-url",
  ...overrides,
});

const createMockPlaylist = (overrides: Partial<Playlist> = {}): Playlist => ({
  id: "test-playlist",
  title: "Test Playlist",
  description: "Test Description",
  songIds: ["song-1", "song-2"],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe("Audio Service Tests", () => {
  let mockSong1: Song;
  let mockSong2: Song;
  let mockSong3: Song;
  let mockPlaylist: Playlist;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset audio mock state
    Object.assign(mockAudio, {
      currentTime: 0,
      duration: 180,
      volume: 1,
      src: "",
      ended: false,
      paused: true,
      readyState: 4,
      networkState: 1,
      error: null,
    });

    // Create test data
    mockSong1 = createMockSong({
      id: "song-1",
      title: "First Song",
      position: 0,
    });

    mockSong2 = createMockSong({
      id: "song-2",
      title: "Second Song",
      position: 1,
    });

    mockSong3 = createMockSong({
      id: "song-3",
      title: "Third Song",
      position: 2,
    });

    mockPlaylist = createMockPlaylist({
      songIds: ["song-1", "song-2", "song-3"],
    });
  });

  afterEach(() => {
    // Cleanup any active audio
    audioService.cleanup();
  });

  describe("Basic Audio Controls", () => {
    it("should initialize audio service", () => {
      const state = audioService.getAudioState();

      expect(state.currentSong).toBeNull();
      expect(state.currentPlaylist).toBeNull();
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
      expect(state.volume).toBe(1);
    });

    it("should play a song", async () => {
      await audioService.playSong(mockSong1);

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.isPlaying).toBe(true);
      expect(mockAudio.play).toHaveBeenCalled();
    });

    it("should pause playback", () => {
      audioService.pause();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it("should stop playback", () => {
      audioService.stop();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(state.currentSong).toBeNull();
      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it("should toggle playback when playing", async () => {
      // First play a song
      await audioService.playSong(mockSong1);

      // Then toggle (should pause)
      await audioService.togglePlayback();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it("should toggle playback when paused", async () => {
      // First play and then pause a song
      await audioService.playSong(mockSong1);
      audioService.pause();

      // Then toggle (should resume)
      await audioService.togglePlayback();

      expect(mockAudio.play).toHaveBeenCalledTimes(2); // Once for initial play, once for resume
    });

    it("should seek to specific time", () => {
      const seekTime = 30;
      audioService.seek(seekTime);

      expect(mockAudio.currentTime).toBe(seekTime);
    });

    it("should set volume", () => {
      const newVolume = 0.5;
      audioService.setAudioVolume(newVolume);

      const state = audioService.getAudioState();
      expect(state.volume).toBe(newVolume);
      expect(mockAudio.volume).toBe(newVolume);
    });

    it("should clamp volume to valid range", () => {
      audioService.setAudioVolume(-0.5);
      expect(audioService.getAudioState().volume).toBe(0);

      audioService.setAudioVolume(1.5);
      expect(audioService.getAudioState().volume).toBe(1);
    });
  });

  describe("Playlist Management", () => {
    it("should load playlist queue", async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);

      const state = audioService.getAudioState();
      expect(state.currentPlaylist).toEqual(mockPlaylist);
      expect(state.queue).toEqual(songs);
    });

    it("should play playlist from beginning", async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
      await audioService.playPlaylist(mockPlaylist);

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
      expect(state.isPlaying).toBe(true);
    });

    it("should get queue info", async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
      await audioService.playSong(mockSong2);

      const queueInfo = audioService.getQueueInfo();
      expect(queueInfo.currentIndex).toBe(1);
      expect(queueInfo.totalSongs).toBe(3);
      expect(queueInfo.hasNext).toBe(true);
      expect(queueInfo.hasPrevious).toBe(true);
    });

    it("should refresh playlist queue", async () => {
      const songs = [mockSong1, mockSong2];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);

      const updatedSongs = [mockSong1, mockSong2, mockSong3];
      await audioService.refreshPlaylistQueue(updatedSongs);

      const state = audioService.getAudioState();
      expect(state.queue).toEqual(updatedSongs);
    });
  });

  describe("Navigation Controls", () => {
    beforeEach(async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
    });

    it("should play next song", async () => {
      await audioService.playSong(mockSong1);
      await audioService.playNext();

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong2);
      expect(state.currentIndex).toBe(1);
    });

    it("should play previous song", async () => {
      await audioService.playSong(mockSong2);
      await audioService.playPrevious();

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle next at end of queue", async () => {
      await audioService.playSong(mockSong3);
      await audioService.playNext();

      const state = audioService.getAudioState();
      // Should stop playback when reaching end
      expect(state.isPlaying).toBe(false);
    });

    it("should handle previous at beginning of queue", async () => {
      await audioService.playSong(mockSong1);
      await audioService.playPrevious();

      const state = audioService.getAudioState();
      // Should stay at first song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should play song by queue index", async () => {
      await audioService.playQueueIndex(1);

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong2);
      expect(state.currentIndex).toBe(1);
      expect(state.isPlaying).toBe(true);
    });

    it("should handle invalid queue index", async () => {
      await audioService.playQueueIndex(99);

      const state = audioService.getAudioState();
      expect(state.currentSong).toBeNull();
    });
  });

  describe("Repeat Modes", () => {
    beforeEach(async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
    });

    it("should cycle through repeat modes", () => {
      let state = audioService.getAudioState();
      expect(state.repeatMode).toBe("none");

      audioService.toggleRepeatMode();
      state = audioService.getAudioState();
      expect(state.repeatMode).toBe("one");

      audioService.toggleRepeatMode();
      state = audioService.getAudioState();
      expect(state.repeatMode).toBe("all");

      audioService.toggleRepeatMode();
      state = audioService.getAudioState();
      expect(state.repeatMode).toBe("none");
    });

    it("should set specific repeat mode", () => {
      audioService.setRepeatModeValue("all");

      const state = audioService.getAudioState();
      expect(state.repeatMode).toBe("all");
    });

    it("should handle repeat one mode on song end", async () => {
      audioService.setRepeatModeValue("one");
      await audioService.playSong(mockSong1);

      // Simulate song ending
      mockAudio.ended = true;
      await audioService.handleSongEnded();

      const state = audioService.getAudioState();
      // Should replay the same song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle repeat all mode at end of queue", async () => {
      audioService.setRepeatModeValue("all");
      await audioService.playSong(mockSong3); // Last song

      // Simulate song ending
      mockAudio.ended = true;
      await audioService.handleSongEnded();

      const state = audioService.getAudioState();
      // Should loop back to first song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle none repeat mode at end of queue", async () => {
      audioService.setRepeatModeValue("none");
      await audioService.playSong(mockSong3); // Last song

      // Simulate song ending
      mockAudio.ended = true;
      await audioService.handleSongEnded();

      const state = audioService.getAudioState();
      // Should stop playback
      expect(state.isPlaying).toBe(false);
    });
  });

  describe("Song Selection", () => {
    beforeEach(async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
    });

    it("should select song without playing", () => {
      audioService.selectSong(mockSong2.id);

      const state = audioService.getAudioState();
      expect(state.selectedSongId).toBe(mockSong2.id);
      expect(state.isPlaying).toBe(false);
    });

    it("should clear selection with null", () => {
      audioService.selectSong(mockSong1.id);
      audioService.selectSong(null);

      const state = audioService.getAudioState();
      expect(state.selectedSongId).toBeNull();
    });
  });

  describe("Progress Tracking", () => {
    it("should get song download progress", () => {
      const progress = audioService.getSongDownloadProgress("song-1");
      expect(typeof progress).toBe("number");
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it("should check if song is caching", () => {
      const isCaching = audioService.isSongCaching("song-1");
      expect(typeof isCaching).toBe("boolean");
    });
  });

  describe("Utility Functions", () => {
    it("should format time correctly", () => {
      const formatTime = audioService.formatTime;

      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(30)).toBe("0:30");
      expect(formatTime(60)).toBe("1:00");
      expect(formatTime(90)).toBe("1:30");
      expect(formatTime(3600)).toBe("60:00");
      expect(formatTime(3661)).toBe("61:01");
    });

    it("should handle invalid time values", () => {
      const formatTime = audioService.formatTime;

      expect(formatTime(NaN)).toBe("0:00");
      expect(formatTime(-10)).toBe("0:00");
      expect(formatTime(Infinity)).toBe("0:00");
    });
  });

  describe("Error Handling", () => {
    it("should handle audio play errors", async () => {
      mockAudio.play.mockRejectedValueOnce(new Error("Audio play failed"));

      await audioService.playSong(mockSong1);

      // Should handle error gracefully
      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
    });

    it("should handle missing audio file", async () => {
      const songWithoutFile = {
        ...mockSong1,
        file: undefined,
        blobUrl: undefined,
      };

      await audioService.playSong(songWithoutFile);

      // Should handle gracefully when no audio source
      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(songWithoutFile);
    });

    it("should handle audio load errors", async () => {
      mockAudio.error = { code: 4, message: "Media not supported" };

      await audioService.playSong(mockSong1);

      // Should handle load errors gracefully
      expect(mockAudio.load).toHaveBeenCalled();
    });
  });

  describe("Media Session Integration", () => {
    it("should update page title when playing", async () => {
      await audioService.playSong(mockSong1);

      // Should update document title
      expect(document.title).toContain(mockSong1.title);
      expect(document.title).toContain(mockSong1.artist);
    });

    it("should set media session metadata", async () => {
      await audioService.playSong(mockSong1);

      // Should set media session metadata
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();
    });

    it("should handle media session without artwork", async () => {
      const songWithoutArt = { ...mockSong1, imageData: undefined };
      await audioService.playSong(songWithoutArt);

      // Should still work without artwork
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();
    });
  });

  describe("Audio Element Management", () => {
    it("should create audio URL from file", async () => {
      await audioService.playSong(mockSong1);

      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockSong1.file);
    });

    it("should use existing blob URL when available", async () => {
      await audioService.playSong(mockSong1);

      expect(mockAudio.src).toBe(mockSong1.blobUrl);
    });

    it("should cleanup audio resources", () => {
      audioService.cleanup();

      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe("Preloading", () => {
    beforeEach(async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
    });

    it("should trigger preload near end of song", async () => {
      await audioService.playSong(mockSong1);

      // Simulate being near end of song (trigger preload threshold)
      mockAudio.currentTime = 170; // 10 seconds from end of 180s song
      mockAudio.duration = 180;

      // Trigger time update
      const timeUpdateCallback = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "timeupdate"
      )?.[1];

      if (timeUpdateCallback) {
        timeUpdateCallback();
      }

      // Should start preloading next song
      const state = audioService.getAudioState();
      expect(state.preloadingSongId).toBe(mockSong2.id);
    });
  });

  describe("Event Handling", () => {
    it("should handle time updates", async () => {
      await audioService.playSong(mockSong1);

      // Simulate time update
      mockAudio.currentTime = 30;
      const timeUpdateCallback = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "timeupdate"
      )?.[1];

      if (timeUpdateCallback) {
        timeUpdateCallback();
      }

      const state = audioService.getAudioState();
      expect(state.currentTime).toBe(30);
    });

    it("should handle duration change", async () => {
      await audioService.playSong(mockSong1);

      // Simulate duration loaded
      mockAudio.duration = 240;
      const durationChangeCallback = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "durationchange"
      )?.[1];

      if (durationChangeCallback) {
        durationChangeCallback();
      }

      const state = audioService.getAudioState();
      expect(state.duration).toBe(240);
    });

    it("should handle ended event", async () => {
      const songs = [mockSong1, mockSong2];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);
      await audioService.playSong(mockSong1);

      // Simulate song ended
      mockAudio.ended = true;
      const endedCallback = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "ended"
      )?.[1];

      if (endedCallback) {
        await endedCallback();
      }

      const state = audioService.getAudioState();
      // Should advance to next song
      expect(state.currentSong).toEqual(mockSong2);
    });
  });

  describe("State Management", () => {
    it("should maintain consistent state across operations", async () => {
      const songs = [mockSong1, mockSong2, mockSong3];
      await audioService.loadPlaylistQueue(mockPlaylist, songs);

      // Play first song
      await audioService.playSong(mockSong1);
      let state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
      expect(state.isPlaying).toBe(true);

      // Select different song
      audioService.selectSong(mockSong3.id);
      state = audioService.getAudioState();
      expect(state.selectedSongId).toBe(mockSong3.id);
      expect(state.currentSong).toEqual(mockSong1); // Should still be playing song 1

      // Play selected song
      await audioService.playSong(mockSong3);
      state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong3);
      expect(state.currentIndex).toBe(2);
    });

    it("should reset state on cleanup", () => {
      audioService.cleanup();

      const state = audioService.getAudioState();
      expect(state.currentSong).toBeNull();
      expect(state.currentPlaylist).toBeNull();
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
    });
  });
});
