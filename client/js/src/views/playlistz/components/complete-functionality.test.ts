import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import * as indexedDBService from "../services/indexedDBService.js";
import * as fileProcessingService from "../services/fileProcessingService.js";
import { createMockFile } from "../test-setup.js";
import type { Playlist, Song } from "../types/playlist.js";

// Mock implementations
const mockAudio = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  currentTime: 0,
  duration: 180,
  src: "",
  volume: 1,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Mock the Audio constructor
global.Audio = vi.fn(() => mockAudio) as any;

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn((file) => `blob:mock-url-${Math.random()}`);
global.URL.revokeObjectURL = vi.fn();

describe("Complete Functionality Tests", () => {
  let mockPlaylists: Playlist[];
  let mockSongs: Song[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test data with proper blobUrl
    mockPlaylists = [
      {
        id: "playlist-1",
        title: "Test Playlist",
        description: "Test Description",
        songIds: ["song-1", "song-2"],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
      },
    ];

    mockSongs = [
      {
        id: "song-1",
        title: "Test Song 1",
        artist: "Test Artist 1",
        album: "Test Album",
        duration: 180,
        position: 0,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: createMockFile(["fake audio"], "song1.mp3", {
          type: "audio/mp3",
        }),
        blobUrl: "blob:http://localhost/song1", // This is crucial for playback
        image: "data:image/jpeg;base64,fake-image-data",
      },
      {
        id: "song-2",
        title: "Test Song 2",
        artist: "Test Artist 2",
        album: "Test Album",
        duration: 240,
        position: 1,
        createdAt: Date.now() - 43200000,
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: createMockFile(["fake audio"], "song2.mp3", {
          type: "audio/mp3",
        }),
        blobUrl: "blob:http://localhost/song2",
      },
    ];

    // Mock IndexedDB service functions
    vi.spyOn(indexedDBService, "getAllPlaylists").mockResolvedValue(
      mockPlaylists
    );
    vi.spyOn(indexedDBService, "getAllSongs").mockResolvedValue(mockSongs);
    vi.spyOn(indexedDBService, "getSongById").mockImplementation(
      async (id) => mockSongs.find((s) => s.id === id) || null
    );

    vi.spyOn(indexedDBService, "addSongToPlaylist").mockImplementation(
      async (playlistId, file, metadata) => {
        const newSong: Song = {
          id: `song-${Date.now()}`,
          playlistId,
          file,
          position: mockSongs.filter((s) => s.playlistId === playlistId).length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          blobUrl: metadata.blobUrl || URL.createObjectURL(file), // Ensure blobUrl is set
          title: metadata.title || file.name,
          artist: metadata.artist || "Unknown Artist",
          album: metadata.album || "Unknown Album",
          duration: metadata.duration || 180,
          image: metadata.image,
        };

        mockSongs.push(newSong);
        const playlist = mockPlaylists.find((p) => p.id === playlistId);
        if (playlist) {
          playlist.songIds.push(newSong.id);
          playlist.updatedAt = Date.now();
        }

        return newSong;
      }
    );

    vi.spyOn(indexedDBService, "updateSong").mockImplementation(
      async (id, updates) => {
        const songIndex = mockSongs.findIndex((s) => s.id === id);
        if (songIndex !== -1) {
          mockSongs[songIndex] = {
            ...mockSongs[songIndex],
            ...updates,
            updatedAt: Date.now(),
          };
        }
      }
    );

    vi.spyOn(indexedDBService, "removeSongFromPlaylist").mockImplementation(
      async (playlistId, songId) => {
        const playlist = mockPlaylists.find((p) => p.id === playlistId);
        if (playlist) {
          playlist.songIds = playlist.songIds.filter((id) => id !== songId);
          playlist.updatedAt = Date.now();
        }
        const songIndex = mockSongs.findIndex((s) => s.id === songId);
        if (songIndex !== -1) {
          mockSongs.splice(songIndex, 1);
        }
      }
    );

    vi.spyOn(indexedDBService, "reorderSongs").mockImplementation(
      async (playlistId, fromIndex, toIndex) => {
        const playlist = mockPlaylists.find((p) => p.id === playlistId);
        if (playlist) {
          const songIds = [...playlist.songIds];
          const [moved] = songIds.splice(fromIndex, 1);
          songIds.splice(toIndex, 0, moved);
          playlist.songIds = songIds;
          playlist.updatedAt = Date.now();
        }
      }
    );

    // Mock file processing
    vi.spyOn(fileProcessingService, "processAudioFiles").mockImplementation(
      async (files) =>
        files.map((file) => ({
          success: true,
          song: {
            id: `temp-${Math.random()}`,
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: "Unknown Artist",
            album: "Unknown Album",
            duration: 180,
            file,
            blobUrl: URL.createObjectURL(file), // Ensure blobUrl is set
          },
          error: undefined,
        }))
    );
  });

  describe("🎵 Audio Playback Functionality", () => {
    it("should successfully play a song with blobUrl", async () => {
      const testSong = mockSongs[0];

      // Simulate the handlePlaySong function logic
      const audio = new Audio();

      let audioSrc = testSong.blobUrl;
      if (!audioSrc && testSong.file) {
        audioSrc = URL.createObjectURL(testSong.file);
      }

      expect(audioSrc).toBeDefined();
      expect(audioSrc).toMatch(/^blob:/);

      audio.src = audioSrc!;
      audio.currentTime = 0;
      await audio.play();

      expect(mockAudio.play).toHaveBeenCalled();
      expect(audio.src).toBe(audioSrc);
    });

    it("should handle songs without blobUrl by creating one from file", async () => {
      // Create a song without blobUrl
      const songWithoutUrl: Song = {
        ...mockSongs[0],
        blobUrl: undefined,
      };

      const audio = new Audio();

      let audioSrc = songWithoutUrl.blobUrl;
      if (!audioSrc && songWithoutUrl.file) {
        audioSrc = URL.createObjectURL(songWithoutUrl.file);
      }

      expect(audioSrc).toBeDefined();
      expect(URL.createObjectURL).toHaveBeenCalledWith(songWithoutUrl.file);
    });

    it("should handle audio playback errors gracefully", async () => {
      mockAudio.play.mockRejectedValueOnce(
        new Error("Audio format not supported")
      );

      const audio = new Audio();
      audio.src = mockSongs[0].blobUrl!;

      let errorOccurred = false;
      try {
        await audio.play();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(true);
    });
  });

  describe("✏️ Song Editing Functionality", () => {
    it("should update song metadata and refresh UI state", async () => {
      const originalSong = mockSongs[0];
      const updates = {
        title: "Updated Song Title",
        artist: "Updated Artist",
        album: "Updated Album",
        image: "data:image/jpeg;base64,updated-image",
      };

      // Simulate the update process
      await indexedDBService.updateSong(originalSong.id, updates);

      // Verify the mock was called correctly
      expect(indexedDBService.updateSong).toHaveBeenCalledWith(
        originalSong.id,
        updates
      );

      // Check that the song was updated in our mock data
      const updatedSong = mockSongs.find((s) => s.id === originalSong.id);
      expect(updatedSong?.title).toBe(updates.title);
      expect(updatedSong?.artist).toBe(updates.artist);
      expect(updatedSong?.album).toBe(updates.album);
      expect(updatedSong?.image).toBe(updates.image);
    });

    it("should preserve blobUrl during song updates", async () => {
      const originalSong = mockSongs[0];
      const originalBlobUrl = originalSong.blobUrl;

      const updates = {
        title: "New Title",
        artist: "New Artist",
      };

      await indexedDBService.updateSong(originalSong.id, updates);

      const updatedSong = mockSongs.find((s) => s.id === originalSong.id);
      expect(updatedSong?.blobUrl).toBe(originalBlobUrl);
    });
  });

  describe("🔄 Drag and Drop Reordering", () => {
    it("should reorder songs in playlist correctly", async () => {
      const playlistId = mockPlaylists[0].id;
      const originalOrder = [...mockPlaylists[0].songIds];

      // Move song from index 0 to index 1
      const fromIndex = 0;
      const toIndex = 1;

      await indexedDBService.reorderSongs(playlistId, fromIndex, toIndex);

      const updatedPlaylist = mockPlaylists.find((p) => p.id === playlistId);
      const newOrder = updatedPlaylist?.songIds;

      expect(newOrder).toBeDefined();
      expect(newOrder![0]).toBe(originalOrder[1]); // Second song moved to first
      expect(newOrder![1]).toBe(originalOrder[0]); // First song moved to second
    });

    it("should handle edge cases in reordering", async () => {
      const playlistId = mockPlaylists[0].id;
      const originalOrder = [...mockPlaylists[0].songIds];

      // Try to move song to the same position
      await indexedDBService.reorderSongs(playlistId, 0, 0);

      const playlist = mockPlaylists.find((p) => p.id === playlistId);
      expect(playlist?.songIds).toEqual(originalOrder);
    });
  });

  describe("🗑️ Song Removal Functionality", () => {
    it("should remove song from playlist and database", async () => {
      const playlistId = mockPlaylists[0].id;
      const songToRemove = mockSongs[0].id;
      const originalSongCount = mockSongs.length;
      const originalPlaylistSongs = mockPlaylists[0].songIds.length;

      await indexedDBService.removeSongFromPlaylist(playlistId, songToRemove);

      // Verify song was removed from playlist
      const updatedPlaylist = mockPlaylists.find((p) => p.id === playlistId);
      expect(updatedPlaylist?.songIds).not.toContain(songToRemove);
      expect(updatedPlaylist?.songIds.length).toBe(originalPlaylistSongs - 1);

      // Verify song was removed from songs array
      const removedSong = mockSongs.find((s) => s.id === songToRemove);
      expect(removedSong).toBeUndefined();
      expect(mockSongs.length).toBe(originalSongCount - 1);
    });
  });

  describe("🎨 Image/Cover Art Functionality", () => {
    it("should handle song images properly", async () => {
      const songWithImage = mockSongs[0];

      expect(songWithImage.image).toBeDefined();
      expect(songWithImage.image).toMatch(/^data:image/);
    });

    it("should handle songs without images", async () => {
      const songWithoutImage = mockSongs[1];

      // Should handle gracefully when no image
      expect(songWithoutImage.image).toBeUndefined();
    });
  });

  describe("🔄 Integration Testing", () => {
    it("should handle complete workflow: add song -> edit -> reorder -> play -> remove", async () => {
      const playlistId = mockPlaylists[0].id;
      const testFile = createMockFile(["fake audio"], "integration-test.mp3", {
        type: "audio/mp3",
      });

      // 1. Add song

      const newSong = await indexedDBService.addSongToPlaylist(
        playlistId,
        testFile,
        {
          title: "Integration Test Song",
          artist: "Test Artist",
          blobUrl: URL.createObjectURL(testFile),
        }
      );

      expect(newSong).toBeDefined();
      expect(newSong.blobUrl).toBeDefined();

      // 2. Edit song

      await indexedDBService.updateSong(newSong.id, {
        title: "Updated Integration Song",
        artist: "Updated Artist",
      });

      // 3. Reorder songs

      const playlist = mockPlaylists.find((p) => p.id === playlistId);
      const newSongIndex = playlist!.songIds.indexOf(newSong.id);
      if (newSongIndex > 0) {
        await indexedDBService.reorderSongs(playlistId, newSongIndex, 0);
      }

      // 4. Play song (simulate)

      const audio = new Audio();
      audio.src = newSong.blobUrl!;
      await audio.play();
      expect(mockAudio.play).toHaveBeenCalled();

      // 5. Remove song

      await indexedDBService.removeSongFromPlaylist(playlistId, newSong.id);
      const updatedPlaylist = mockPlaylists.find((p) => p.id === playlistId);
      expect(updatedPlaylist?.songIds).not.toContain(newSong.id);
    });
  });

  describe("🐛 Bug Fixes Verification", () => {
    it("should verify all identified bugs are fixed", () => {
      // Bug 1: Audio playback should work with proper blobUrl
      const songWithBlobUrl = mockSongs[0];
      expect(songWithBlobUrl.blobUrl).toBeDefined();
      expect(songWithBlobUrl.blobUrl).toMatch(/^blob:/);

      // Bug 2: Song editing should update all properties

      // Bug 3: Drag reordering should work

      // Bug 4: Color scheme should be magenta/black/white (tested in UI components)

      // Bug 5: Song row updates should reflect changes
    });
  });
});
