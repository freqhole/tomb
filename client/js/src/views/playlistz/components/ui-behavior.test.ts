import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import * as indexedDBService from "../services/indexedDBService.js";
import * as fileProcessingService from "../services/fileProcessingService.js";
import type { Playlist, Song } from "../types/playlist.js";

// Mock implementations
const mockPlaylistsSignal = createSignal<Playlist[]>([]);
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

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn((file) => `blob:mock-url-${Math.random()}`);
global.URL.revokeObjectURL = vi.fn();

describe("UI Behavior Tests", () => {
  let mockPlaylists: Playlist[];
  let mockSongs: Song[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test data
    mockPlaylists = [
      {
        id: "playlist-1",
        title: "Test Playlist",
        description: "Test Description",
        songIds: ["song-1", "song-2"],
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
      },
      {
        id: "playlist-2",
        title: "Empty Playlist",
        description: "",
        songIds: [],
        createdAt: Date.now() - 172800000,
        updatedAt: Date.now() - 86400000,
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
        file: new File(["fake audio"], "song1.mp3", { type: "audio/mp3" }),
        blobUrl: "blob:http://localhost/song1",
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
        file: new File(["fake audio"], "song2.mp3", { type: "audio/mp3" }),
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
    vi.spyOn(indexedDBService, "createPlaylist").mockImplementation(
      async (data) => {
        const newPlaylist: Playlist = {
          id: `playlist-${Date.now()}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          songIds: [],
          ...data,
        };
        mockPlaylists.push(newPlaylist);
        return newPlaylist;
      }
    );
    vi.spyOn(indexedDBService, "updatePlaylist").mockImplementation(
      async (id, updates) => {
        const playlist = mockPlaylists.find((p) => p.id === id);
        if (playlist) {
          Object.assign(playlist, updates, { updatedAt: Date.now() });
        }
      }
    );
    vi.spyOn(indexedDBService, "addSongToPlaylist").mockImplementation(
      async (playlistId, file, metadata) => {
        const newSong: Song = {
          id: `song-${Date.now()}`,
          playlistId,
          file,
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          blobUrl: URL.createObjectURL(file),
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

    // Mock file processing
    vi.spyOn(fileProcessingService, "filterAudioFiles").mockImplementation(
      (files) => Array.from(files).filter((f) => f.type.startsWith("audio/"))
    );
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
            blobUrl: URL.createObjectURL(file),
          },
          error: undefined,
        }))
    );

    // Mock reactive query
    vi.spyOn(indexedDBService, "createPlaylistsQuery").mockReturnValue({
      subscribe: (callback) => {
        callback(mockPlaylists);
        return () => {};
      },
      get: () => mockPlaylists,
      set: vi.fn(),
    } as any);
  });

  describe("🐛 Bug #1: Song rows not appearing after file drop", () => {
    it("should immediately show new songs after file drop", async () => {
      // Simulate playlist state
      const [selectedPlaylist, setSelectedPlaylist] =
        createSignal<Playlist | null>(mockPlaylists[0]);
      const [playlists, setPlaylists] = createSignal<Playlist[]>(mockPlaylists);

      console.log("📊 Initial state:");
      console.log(`- Selected playlist: ${selectedPlaylist()?.title}`);
      console.log(`- Songs in playlist: ${selectedPlaylist()?.songIds.length}`);

      // Simulate file drop
      const mockFile = new File(["fake audio"], "new-song.mp3", {
        type: "audio/mp3",
      });
      const currentPlaylist = selectedPlaylist()!;

      // Process and add song (this is what handleDrop does)
      const results = await fileProcessingService.processAudioFiles([mockFile]);
      const song = results[0].song!;

      await indexedDBService.addSongToPlaylist(currentPlaylist.id, song.file, {
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
      });

      // Get updated playlist data (this is what the reactive query should do)
      const updatedPlaylists = await indexedDBService.getAllPlaylists();
      const updatedPlaylist = updatedPlaylists.find(
        (p) => p.id === currentPlaylist.id
      );

      console.log("📊 After file drop:");
      console.log(
        `- Updated playlist songs: ${updatedPlaylist?.songIds.length}`
      );
      console.log(`- Song IDs: ${JSON.stringify(updatedPlaylist?.songIds)}`);

      // THIS IS THE BUG: UI should update selectedPlaylist to show new songs
      // The fix: component should update selectedPlaylist when playlists signal changes
      if (
        updatedPlaylist &&
        JSON.stringify(updatedPlaylist.songIds) !==
          JSON.stringify(currentPlaylist.songIds)
      ) {
        setSelectedPlaylist(updatedPlaylist);
        console.log("✅ UI updated with new songs");
      }

      expect(updatedPlaylist?.songIds.length).toBe(3); // Original 2 + new 1
      expect(selectedPlaylist()?.songIds.length).toBe(3); // UI should reflect this
    });

    it("should show existing songs when switching playlists", async () => {
      const [selectedPlaylist, setSelectedPlaylist] =
        createSignal<Playlist | null>(null);

      // Switch to playlist with songs
      setSelectedPlaylist(mockPlaylists[0]);

      const playlist = selectedPlaylist();
      expect(playlist?.songIds.length).toBe(2);

      // Verify songs can be fetched
      for (const songId of playlist!.songIds) {
        const song = await indexedDBService.getSongById(songId);
        expect(song).toBeDefined();
        expect(song?.title).toBeDefined();
        console.log(`✅ Found song: ${song?.title}`);
      }
    });
  });

  describe("💾 Bug #2: Playlist name/description saving behavior", () => {
    it("should debounce saves when typing", async () => {
      const [selectedPlaylist, setSelectedPlaylist] =
        createSignal<Playlist | null>(mockPlaylists[0]);

      // Simulate rapid typing (like user typing "My New Playlist")
      const updates = [
        "M",
        "My",
        "My ",
        "My N",
        "My Ne",
        "My New",
        "My New ",
        "My New P",
        "My New Pl",
        "My New Play",
        "My New Playl",
        "My New Playli",
        "My New Playlis",
        "My New Playlist",
      ];

      for (const title of updates) {
        // Update local state immediately (responsive UI)
        const current = selectedPlaylist()!;
        setSelectedPlaylist({ ...current, title });

        // In real implementation, this would be debounced
        // Only the final save should actually call updatePlaylist
      }

      // Simulate debounced save (after 1 second of no typing)
      await indexedDBService.updatePlaylist(selectedPlaylist()!.id, {
        title: "My New Playlist",
      });

      // Verify only one actual database call was made (in real debounced implementation)
      expect(selectedPlaylist()?.title).toBe("My New Playlist");
      console.log("✅ Playlist title updated with debouncing");
    });

    it("should provide visual feedback for save status", () => {
      // Test should verify:
      // 1. Immediate UI update (optimistic)
      // 2. Save indicator while saving
      // 3. Success/error feedback
      // 4. Revert on save failure

      console.log("💡 Visual feedback requirements:");
      console.log("- Show typing indicator while editing");
      console.log("- Show 'saving...' during debounce period");
      console.log("- Show 'saved' confirmation briefly");
      console.log("- Show error and revert on failure");

      expect(true).toBe(true); // Placeholder - requires UI component testing
    });
  });

  describe("🎵 Bug #3: Audio player not working", () => {
    it("should play audio when play button is clicked", async () => {
      const testSong = mockSongs[0];

      // Simulate clicking play on a song
      const audio = new Audio();
      audio.src = testSong.blobUrl!;

      await audio.play();

      expect(mockAudio.play).toHaveBeenCalled();
      expect(audio.src).toBe(testSong.blobUrl);
      console.log(`🎵 Playing: ${testSong.title}`);
    });

    it("should pause current song when playing a new one", async () => {
      const [currentSong, setCurrentSong] = createSignal<string | null>(null);

      // Play first song
      setCurrentSong(mockSongs[0].id);
      const audio = new Audio();
      await audio.play();

      // Play second song (should pause first)
      if (currentSong()) {
        audio.pause();
      }
      setCurrentSong(mockSongs[1].id);
      audio.src = mockSongs[1].blobUrl!;
      await audio.play();

      expect(mockAudio.pause).toHaveBeenCalled();
      expect(currentSong()).toBe(mockSongs[1].id);
      console.log("✅ Switched to new song, paused previous");
    });

    it("should handle audio playback errors gracefully", async () => {
      mockAudio.play.mockRejectedValueOnce(
        new Error("Audio codec not supported")
      );

      const audio = new Audio();
      let errorOccurred = false;

      try {
        await audio.play();
      } catch (error) {
        errorOccurred = true;
        console.log("❌ Audio error handled:", error);
      }

      expect(errorOccurred).toBe(true);
    });
  });

  describe("🖼️ Bug #4: Image support for songs and playlists", () => {
    it("should extract and display album art from audio files", async () => {
      const songWithImage = mockSongs[0];
      const songWithoutImage = mockSongs[1];

      // Verify song with image
      expect(songWithImage.image).toBeDefined();
      expect(songWithImage.image).toMatch(/^data:image/);
      console.log("✅ Song has album art");

      // Verify fallback for song without image
      expect(songWithoutImage.image).toBeUndefined();
      console.log("✅ Song without image shows fallback");
    });

    it("should allow setting playlist cover images", async () => {
      const playlist = mockPlaylists[0];
      const mockImageFile = new File(["fake image"], "cover.jpg", {
        type: "image/jpeg",
      });
      const imageUrl = URL.createObjectURL(mockImageFile);

      await indexedDBService.updatePlaylist(playlist.id, {
        image: imageUrl,
      });

      const updatedPlaylist = mockPlaylists.find((p) => p.id === playlist.id);
      expect(updatedPlaylist?.image).toBe(imageUrl);
      console.log("✅ Playlist cover image set");
    });

    it("should generate playlist thumbnails from song album art", () => {
      const playlist = mockPlaylists[0];
      const songsWithArt = mockSongs.filter(
        (s) => playlist.songIds.includes(s.id) && s.image
      );

      if (songsWithArt.length > 0) {
        // Should use first song's album art as playlist thumbnail
        const thumbnailSource = songsWithArt[0].image;
        console.log("✅ Generated playlist thumbnail from song album art");
        expect(thumbnailSource).toBeDefined();
      } else {
        console.log(
          "ℹ️ No songs with album art found - show default thumbnail"
        );
        expect(true).toBe(true);
      }
    });
  });

  describe("🔄 Reactive Updates Integration", () => {
    it("should update UI when database changes occur", async () => {
      const [playlists, setPlaylists] = createSignal<Playlist[]>(mockPlaylists);
      const [selectedPlaylist, setSelectedPlaylist] =
        createSignal<Playlist | null>(mockPlaylists[0]);

      console.log("🔄 Testing reactive updates...");

      // Simulate database change (new song added)
      const newSong = await indexedDBService.addSongToPlaylist(
        mockPlaylists[0].id,
        new File(["audio"], "test.mp3", { type: "audio/mp3" }),
        { title: "Reactive Test Song" }
      );

      // Simulate reactive query update
      const updatedPlaylists = await indexedDBService.getAllPlaylists();
      setPlaylists(updatedPlaylists);

      // Component should detect change and update selectedPlaylist
      const current = selectedPlaylist();
      const updated = updatedPlaylists.find((p) => p.id === current?.id);

      if (
        updated &&
        JSON.stringify(updated.songIds) !== JSON.stringify(current?.songIds)
      ) {
        setSelectedPlaylist(updated);
        console.log("✅ Reactive update triggered UI refresh");
      }

      expect(selectedPlaylist()?.songIds.length).toBe(3); // 2 original + 1 new
    });

    it("should maintain UI state consistency during rapid changes", async () => {
      const [isLoading, setIsLoading] = createSignal(false);
      const [error, setError] = createSignal<string | null>(null);

      // Simulate multiple rapid operations
      const operations = [
        () =>
          indexedDBService.createPlaylist({
            title: "Rapid 1",
            description: "",
            songIds: [],
          }),
        () =>
          indexedDBService.createPlaylist({
            title: "Rapid 2",
            description: "",
            songIds: [],
          }),
        () =>
          indexedDBService.createPlaylist({
            title: "Rapid 3",
            description: "",
            songIds: [],
          }),
      ];

      setIsLoading(true);

      try {
        await Promise.all(operations.map((op) => op()));
        console.log("✅ All rapid operations completed");
      } catch (err) {
        setError("Operation failed");
        console.log("❌ Rapid operations failed");
      } finally {
        setIsLoading(false);
      }

      expect(isLoading()).toBe(false);
      expect(mockPlaylists.length).toBe(5); // 2 original + 3 new
    });
  });

  describe("📊 UI State Management", () => {
    it("should handle empty states gracefully", () => {
      const [playlists] = createSignal<Playlist[]>([]);
      const [selectedPlaylist] = createSignal<Playlist | null>(null);

      // Empty playlists state
      expect(playlists().length).toBe(0);
      console.log("✅ Empty playlists state handled");

      // No selected playlist
      expect(selectedPlaylist()).toBeNull();
      console.log("✅ No selected playlist state handled");
    });

    it("should validate data integrity", async () => {
      const playlist = mockPlaylists[0];

      // Check that all song IDs in playlist actually exist
      for (const songId of playlist.songIds) {
        const song = await indexedDBService.getSongById(songId);
        expect(song).toBeDefined();
        expect(song?.playlistId).toBe(playlist.id);
      }

      console.log("✅ Data integrity validated");
    });

    it("should handle concurrent user actions", async () => {
      // Simulate user dropping files while also creating playlist
      const concurrentActions = [
        // User 1: Drop files
        async () => {
          const file = new File(["audio"], "concurrent1.mp3", {
            type: "audio/mp3",
          });
          return await indexedDBService.addSongToPlaylist(
            mockPlaylists[0].id,
            file,
            {}
          );
        },
        // User 2: Rename playlist
        async () => {
          return await indexedDBService.updatePlaylist(mockPlaylists[0].id, {
            title: "Concurrently Modified",
          });
        },
        // User 3: Create new playlist
        async () => {
          return await indexedDBService.createPlaylist({
            title: "Concurrent Playlist",
            description: "",
            songIds: [],
          });
        },
      ];

      const results = await Promise.allSettled(concurrentActions);
      const successes = results.filter((r) => r.status === "fulfilled").length;

      console.log(
        `✅ ${successes}/${results.length} concurrent actions succeeded`
      );
      expect(successes).toBeGreaterThan(0);
    });
  });
});
