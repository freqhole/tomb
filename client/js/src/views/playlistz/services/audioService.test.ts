import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as audioService from "./audioService.js";
import type { Song, Playlist } from "../types/playlist.js";
import { mockManager } from "../test-setup.js";
import * as indexedDBService from "./indexedDBService.js";

// Helper to get the current mocked Audio instance
const getMockAudio = () => {
  const audioInstances = (global.Audio as any).mock.results;
  return (
    audioInstances[audioInstances.length - 1]?.value || (global.Audio as any)()
  );
};

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
  mimeType: "audio/mp3",
  originalFilename: "test.mp3",
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
    mockManager.resetAllMocks();
    mockManager.resetGlobalAPIs();

    // Reset audio mock state
    const audio = getMockAudio();
    Object.assign(audio, {
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

    // Mock IndexedDB service
    vi.spyOn(indexedDBService, "getAllSongs").mockResolvedValue([
      mockSong1,
      mockSong2,
      mockSong3,
    ]);
    vi.spyOn(indexedDBService, "loadSongAudioData").mockResolvedValue(null);
  });

  afterEach(() => {
    // Cleanup any active audio
    audioService.cleanup();
    // Clear selected song to ensure tests start fresh
    audioService.clearSelectedSong();
  });

  // Helper function to set up audio test state
  const setupAudioState = async (song: Song, playlist?: Playlist) => {
    audioService.selectSong(song.id);
    if (playlist) {
      await audioService.loadPlaylistQueue(playlist);
    }
    await audioService.playSong(song, playlist);
  };

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
      await setupAudioState(mockSong1);

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.isPlaying).toBe(true);
      expect(getMockAudio().play).toHaveBeenCalled();
    });

    it("should pause playback", async () => {
      // First start playback
      await setupAudioState(mockSong1);

      // Then pause
      audioService.pause();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(getMockAudio().pause).toHaveBeenCalled();
    });

    it("should stop playback", async () => {
      // First start playback
      await setupAudioState(mockSong1);

      audioService.stop();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(state.currentSong).toBeNull();
      expect(getMockAudio().pause).toHaveBeenCalled();
    });

    it("should toggle playback when playing", async () => {
      await setupAudioState(mockSong1);

      await audioService.togglePlayback();

      const state = audioService.getAudioState();
      expect(state.isPlaying).toBe(false);
      expect(getMockAudio().pause).toHaveBeenCalled();
    });

    it("should toggle playback when paused", async () => {
      // First play and then pause a song
      await audioService.playSong(mockSong1);
      const audio = getMockAudio();

      // Clear the call count from initial play
      audio.play.mockClear();

      audioService.pause();

      // Then toggle (should resume)
      await audioService.togglePlayback();

      expect(audio.play).toHaveBeenCalledTimes(1); // Should be called once for resume
    });

    it("should seek to specific time", async () => {
      await setupAudioState(mockSong1);

      const seekTime = 30;
      audioService.seek(seekTime);

      expect(getMockAudio().currentTime).toBe(seekTime);
    });

    it("should set volume", async () => {
      await setupAudioState(mockSong1);

      const newVolume = 0.5;
      audioService.setAudioVolume(newVolume);

      const state = audioService.getAudioState();
      expect(state.volume).toBe(newVolume);
      expect(getMockAudio().volume).toBe(newVolume);
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
      await audioService.loadPlaylistQueue(mockPlaylist);

      const state = audioService.getAudioState();
      expect(state.currentPlaylist).toEqual(mockPlaylist);
      expect(state.queue).toEqual(songs);
    });

    it("should play playlist from beginning", async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
      await audioService.playPlaylist(mockPlaylist);

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.isPlaying).toBe(true);
    });

    it("should get queue info", async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
      await audioService.playSong(mockSong2, mockPlaylist);

      const queueInfo = audioService.getQueueInfo();
      expect(queueInfo.currentIndex).toBe(1);
      expect(queueInfo.length).toBe(3);
      expect(queueInfo.hasNext).toBe(true);
      expect(queueInfo.hasPrevious).toBe(true);
    });

    it("should refresh playlist queue", async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);

      // Refresh should reload the queue from the database
      await audioService.refreshPlaylistQueue(mockPlaylist);

      const state = audioService.getAudioState();
      expect(state.queue).toBeDefined();
      expect(state.currentPlaylist).toEqual(mockPlaylist);
    });
  });

  describe("Navigation Controls", () => {
    beforeEach(async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
    });

    it("should play next song", async () => {
      await setupAudioState(mockSong1, mockPlaylist);
      await audioService.playNext();

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong2);
      expect(state.currentIndex).toBe(1);
    });

    it("should play previous song", async () => {
      await setupAudioState(mockSong2, mockPlaylist);
      await audioService.playPrevious();

      const state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle next at end of queue", async () => {
      await setupAudioState(mockSong3, mockPlaylist);
      await audioService.playNext();

      const state = audioService.getAudioState();
      // Should stop playback when reaching end
      expect(state.isPlaying).toBe(false);
    });

    it("should handle previous at beginning of queue", async () => {
      await setupAudioState(mockSong1, mockPlaylist);
      await audioService.playPrevious();

      const state = audioService.getAudioState();
      // Should stay at first song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should play song by queue index", async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
      const queue = audioService.getAudioState().queue;
      const targetSong = queue[1];
      if (targetSong) {
        audioService.selectSong(targetSong.id);
      }
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
      await audioService.loadPlaylistQueue(mockPlaylist);
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
      await setupAudioState(mockSong1, mockPlaylist);

      // Simulate song ending by triggering the ended event
      const audio = getMockAudio();
      audio.ended = true;

      // Manually trigger the ended event handlers
      const endedHandlers = audio.addEventListener.mock.calls
        .filter((call) => call[0] === "ended")
        .map((call) => call[1]);

      for (const handler of endedHandlers) {
        await handler();
      }

      const state = audioService.getAudioState();
      // Should replay the same song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle repeat all mode at end of queue", async () => {
      audioService.setRepeatModeValue("all");
      await setupAudioState(mockSong3, mockPlaylist); // Last song

      // Simulate song ending by triggering the ended event
      const audio = getMockAudio();
      audio.ended = true;

      // Manually trigger the ended event handlers
      const endedHandlers = audio.addEventListener.mock.calls
        .filter((call) => call[0] === "ended")
        .map((call) => call[1]);

      for (const handler of endedHandlers) {
        await handler();
      }

      const state = audioService.getAudioState();
      // Should loop back to first song
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
    });

    it("should handle none repeat mode at end of queue", async () => {
      audioService.setRepeatModeValue("none");
      await setupAudioState(mockSong3, mockPlaylist); // Last song

      // Simulate song ending by triggering the ended event
      const audio = getMockAudio();
      audio.ended = true;

      // Manually trigger the ended event handlers
      const endedHandlers = audio.addEventListener.mock.calls
        .filter((call) => call[0] === "ended")
        .map((call) => call[1]);

      for (const handler of endedHandlers) {
        await handler();
      }

      const state = audioService.getAudioState();
      // Should stop playback
      expect(state.isPlaying).toBe(false);
    });
  });

  describe("Song Selection", () => {
    beforeEach(async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
    });

    it("should select song without playing", () => {
      audioService.selectSong(mockSong2.id);

      const state = audioService.getAudioState();
      // selectedSongId is internal state - check if correct song is selected
      expect(state.currentSong?.id).toBe(mockSong2.id);
      expect(state.isPlaying).toBe(false);
    });

    it("should stop playback and clear current song", () => {
      audioService.selectSong(mockSong2.id);
      audioService.stop();

      const state = audioService.getAudioState();
      // stop() should clear the current song
      expect(state.currentSong).toBeNull();
      expect(state.isPlaying).toBe(false);
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
      getMockAudio().play.mockRejectedValueOnce(new Error("Audio play failed"));

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
      const audio = getMockAudio();
      audio.error = { code: 4, message: "Media load error" };

      // Mock the load method to trigger error event
      audio.load = vi.fn(() => {
        const errorHandlers = audio.addEventListener.mock.calls
          .filter((call) => call[0] === "error")
          .map((call) => call[1]);
        errorHandlers.forEach((handler) => handler());
      });

      await audioService.playSong(mockSong1);

      // Should handle load errors gracefully
      expect(audio.load).toHaveBeenCalled();
    });
  });

  describe("Media Session Integration", () => {
    it("should update page title when playing", async () => {
      await audioService.playSong(mockSong1);

      // Wait for media session to be updated (happens on loadedmetadata event)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should update document title
      expect(document.title).toContain(mockSong1.title);
      expect(document.title).toContain(mockSong1.artist);
    });

    it("should set media session metadata", async () => {
      await audioService.playSong(mockSong1);

      // Wait for media session to be updated (happens on loadedmetadata event)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should set media session metadata
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();
    });

    it("should handle media session without artwork", async () => {
      const songWithoutArt = { ...mockSong1, imageData: undefined };
      await audioService.playSong(songWithoutArt);

      // Wait for media session to be updated (happens on loadedmetadata event)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should still work without artwork
      expect(navigator.mediaSession.setActionHandler).toHaveBeenCalled();
    });
  });

  describe("Audio Element Management", () => {
    it("should create audio URL from file", async () => {
      const songWithoutBlobUrl = { ...mockSong1, blobUrl: undefined };
      await audioService.playSong(songWithoutBlobUrl);

      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockSong1.file);
    });

    it("should use existing blob URL when available", async () => {
      console.log("Test: mockSong1.blobUrl =", mockSong1.blobUrl);
      console.log(
        "Test: mockSong1.file =",
        mockSong1.file ? "exists" : "missing"
      );

      await audioService.playSong(mockSong1);

      const audio = getMockAudio();
      console.log("Test: audio.src after playSong =", audio.src);
      console.log("Test: expected =", mockSong1.blobUrl);

      expect(audio.src).toBe(mockSong1.blobUrl);
    });

    it("should cleanup audio resources", async () => {
      // First create some audio resources
      const songWithoutBlobUrl = { ...mockSong1, blobUrl: undefined };
      await audioService.playSong(songWithoutBlobUrl);

      audioService.cleanup();

      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe("Preloading", () => {
    beforeEach(async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
    });

    it("should trigger preload near end of song", async () => {
      await audioService.playSong(mockSong1);

      // Simulate being at 50% of song (trigger preload threshold)
      getMockAudio().currentTime = 90; // 50% of 180s song
      getMockAudio().duration = 180;

      // Trigger time update
      const timeUpdateCallback =
        getMockAudio().addEventListener.mock.calls.find(
          (call: any) => call[0] === "timeupdate"
        )?.[1];

      if (timeUpdateCallback) {
        timeUpdateCallback();
      }

      // Should not be in loading state (preload happens in background)
      const state = audioService.getAudioState();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("Event Handling", () => {
    it("should handle time updates", async () => {
      await audioService.playSong(mockSong1);

      // Simulate time update
      getMockAudio().currentTime = 30;
      const timeUpdateCallback =
        getMockAudio().addEventListener.mock.calls.find(
          (call: any) => call[0] === "timeupdate"
        )?.[1];

      if (timeUpdateCallback) {
        timeUpdateCallback();
      }

      const state = audioService.getAudioState();
      expect(state.currentTime).toBe(30);
    });

    it("should handle duration change", async () => {
      await audioService.playSong(mockSong1);

      // Simulate duration loaded through loadedmetadata event
      getMockAudio().duration = 240;
      const loadedMetadataCallback =
        getMockAudio().addEventListener.mock.calls.find(
          (call: any) => call[0] === "loadedmetadata"
        )?.[1];

      if (loadedMetadataCallback) {
        loadedMetadataCallback();
      }

      const state = audioService.getAudioState();
      expect(state.duration).toBe(240);
    });

    it("should handle ended event", async () => {
      await audioService.loadPlaylistQueue(mockPlaylist);
      await audioService.playSong(mockSong1);

      // Simulate song ended
      getMockAudio().ended = true;
      const endedCallback = getMockAudio().addEventListener.mock.calls.find(
        (call: any) => call[0] === "ended"
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
      await audioService.loadPlaylistQueue(mockPlaylist);

      // Play first song
      await audioService.playSong(mockSong1);
      let state = audioService.getAudioState();
      expect(state.currentSong).toEqual(mockSong1);
      expect(state.currentIndex).toBe(0);
      expect(state.isPlaying).toBe(true);

      // Select different song
      audioService.selectSong(mockSong3.id);
      state = audioService.getAudioState();
      // selectedSongId is internal state - check if correct song is selected
      expect(state.currentSong?.id).toBe(mockSong3.id);
      expect(state.isPlaying).toBe(false); // Should pause when selecting different song

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
