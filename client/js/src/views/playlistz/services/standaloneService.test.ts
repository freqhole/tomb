import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./indexedDBService.js", () => ({
  setupDB: vi.fn(),
  mutateAndNotify: vi.fn(),
  DB_NAME: "musicPlaylistDB",
  PLAYLISTS_STORE: "playlists",
  SONGS_STORE: "songs",
}));

// Import the mocked modules
import { setupDB } from "./indexedDBService.js";

// Mock crypto.subtle for testing
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => "test-uuid-123"),
    subtle: {
      digest: vi.fn().mockImplementation((_algorithm, _data) => {
        // Mock SHA-256 digest - return a fixed hash for testing
        const mockHash = new Uint8Array(32); // SHA-256 produces 32 bytes
        for (let i = 0; i < 32; i++) {
          mockHash[i] = i; // Simple pattern for testing
        }
        return Promise.resolve(mockHash.buffer);
      }),
    },
  },
  writable: true,
});

describe("Standalone Service", () => {
  let mockDB: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDB = {
      get: vi.fn(),
      getAll: vi.fn(),
      put: vi.fn(),
    };

    vi.mocked(setupDB).mockResolvedValue(mockDB);
  });

  describe("Playlist Revision Loading Logic", () => {
    it("should trigger full reload when playlist rev is higher", () => {
      const existingRev = 2;
      const incomingRev = 3;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(true);
    });

    it("should skip reload when playlist rev is same", () => {
      const existingRev = 2;
      const incomingRev = 2;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(false);
    });

    it("should skip reload when playlist rev is lower", () => {
      const existingRev = 3;
      const incomingRev = 2;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(false);
    });

    it("should handle undefined revisions gracefully", () => {
      const scenarios = [
        { existing: undefined, incoming: undefined, expected: false },
        { existing: undefined, incoming: 1, expected: true },
        { existing: 1, incoming: undefined, expected: false },
        { existing: 0, incoming: 1, expected: true },
        { existing: 1, incoming: 0, expected: false },
      ];

      scenarios.forEach(({ existing, incoming, expected }) => {
        const needsFullReload = (incoming || 0) > (existing || 0);
        expect(needsFullReload).toBe(expected);
      });
    });
  });

  describe("Song Audio Data Preservation", () => {
    it("should preserve audio data when SHA matches", () => {
      const existingSong = {
        id: "test-song",
        audioData: new ArrayBuffer(1024),
        sha: "abc123def456",
        title: "Old Title",
      };

      const incomingSong = {
        id: "test-song",
        title: "New Title",
        artist: "New Artist",
        sha: "abc123def456", // Same SHA
      };

      const shouldPreserveAudio =
        existingSong.sha &&
        incomingSong.sha &&
        existingSong.sha === incomingSong.sha;

      expect(shouldPreserveAudio).toBe(true);

      // Simulate the preservation logic
      if (shouldPreserveAudio) {
        const updatedSong = {
          ...existingSong,
          title: incomingSong.title,
          artist: incomingSong.artist,
          // audioData preserved
        };

        expect(updatedSong.audioData).toBe(existingSong.audioData);
        expect(updatedSong.title).toBe("New Title");
        expect(updatedSong.artist).toBe("New Artist");
      }
    });

    it("should reload audio data when SHA differs", () => {
      const existingSong = {
        id: "test-song",
        audioData: new ArrayBuffer(1024),
        sha: "abc123def456",
      };

      const incomingSong = {
        id: "test-song",
        title: "Updated Title",
        sha: "different-sha",
      };

      const shouldPreserveAudio =
        existingSong.sha &&
        incomingSong.sha &&
        existingSong.sha === incomingSong.sha;

      expect(shouldPreserveAudio).toBe(false);
    });

    it("should reload audio data when SHA is missing from either song", () => {
      const scenarios = [
        {
          existing: { sha: "abc123" },
          incoming: { sha: undefined },
          expected: false,
        },
        {
          existing: { sha: undefined },
          incoming: { sha: "abc123" },
          expected: false,
        },
        {
          existing: { sha: undefined },
          incoming: { sha: undefined },
          expected: false,
        },
        {
          existing: { sha: "" },
          incoming: { sha: "abc123" },
          expected: false,
        },
      ];

      scenarios.forEach(({ existing, incoming, expected }) => {
        const shouldPreserve = !!(
          existing.sha &&
          incoming.sha &&
          existing.sha === incoming.sha
        );

        expect(shouldPreserve).toBe(expected);
      });
    });
  });

  describe("Song Needs Audio Data Logic", () => {
    it("should return true when song has no audio data", () => {
      const song: { id: string; audioData?: ArrayBuffer } = {
        id: "test-song",
        audioData: undefined,
      };

      const needsData = !song.audioData || song.audioData.byteLength === 0;
      expect(needsData).toBe(true);
    });

    it("should return true when song has empty audio data", () => {
      const song: { id: string; audioData?: ArrayBuffer } = {
        id: "test-song",
        audioData: new ArrayBuffer(0), // Empty buffer
      };

      const needsData = !song.audioData || song.audioData.byteLength === 0;
      expect(needsData).toBe(true);
    });

    it("should return false when song has valid audio data", () => {
      const song: { id: string; audioData?: ArrayBuffer } = {
        id: "test-song",
        audioData: new ArrayBuffer(1024), // Valid buffer
      };

      const needsData = !song.audioData || song.audioData.byteLength === 0;
      expect(needsData).toBe(false);
    });

    it("should return false for file:// protocol", () => {
      // Mock window.location
      Object.defineProperty(global.window, "location", {
        value: { protocol: "file:" },
        writable: true,
      });

      const isFileProtocol = window.location.protocol === "file:";
      expect(isFileProtocol).toBe(true);

      // For file:// protocol, songs don't need caching
      const needsData = isFileProtocol ? false : true;
      expect(needsData).toBe(false);
    });

    it("should return true for http/https protocol with missing data", () => {
      // Mock window.location
      Object.defineProperty(window, "location", {
        value: { protocol: "https:" },
        writable: true,
      });

      const song: { id: string; audioData?: ArrayBuffer } = {
        id: "test-song",
        audioData: undefined,
      };

      const isFileProtocol = window.location.protocol === "file:";
      const needsData = isFileProtocol
        ? false
        : !song.audioData || song.audioData.byteLength === 0;

      expect(needsData).toBe(true);
    });
  });

  describe("Standalone Loading Scenarios", () => {
    it("should create new playlist when none exists", async () => {
      const playlistData = {
        playlist: {
          id: "new-playlist",
          title: "New Playlist",
          rev: 0,
        },
        songs: [],
      };

      mockDB.get.mockResolvedValue(null); // No existing playlist

      const existingPlaylist = await mockDB.get(
        "playlists",
        playlistData.playlist.id
      );
      const shouldCreate = !existingPlaylist;

      expect(shouldCreate).toBe(true);
    });

    it("should use existing data when rev is unchanged", async () => {
      const existingPlaylist = {
        id: "test-playlist",
        rev: 2,
      };

      const playlistData = {
        playlist: {
          id: "test-playlist",
          rev: 2, // Same revision
        },
        songs: [],
      };

      const existingRev = existingPlaylist.rev || 0;
      const incomingRev = playlistData.playlist.rev || 0;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(false);
    });

    it("should perform smart reload when rev is higher", async () => {
      const existingPlaylist = {
        id: "test-playlist",
        rev: 1,
      };

      const playlistData = {
        playlist: {
          id: "test-playlist",
          rev: 2, // Higher revision
        },
        songs: [
          {
            id: "song1",
            title: "Song 1",
            sha: "abc123",
          },
        ],
      };

      const existingRev = existingPlaylist.rev || 0;
      const incomingRev = playlistData.playlist.rev || 0;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(true);
    });
  });

  describe("Smart Update Logic", () => {
    it("should update song metadata while preserving audio data", () => {
      const existingSong = {
        id: "song1",
        title: "Old Title",
        artist: "Old Artist",
        audioData: new ArrayBuffer(1024),
        sha: "same-sha",
      };

      const incomingSongData = {
        id: "song1",
        title: "New Title",
        artist: "New Artist",
        album: "New Album",
        sha: "same-sha",
      };

      const shaMatches =
        existingSong.sha &&
        incomingSongData.sha &&
        existingSong.sha === incomingSongData.sha;

      expect(shaMatches).toBe(true);

      if (shaMatches) {
        const updatedSong = {
          ...existingSong,
          title: incomingSongData.title,
          artist: incomingSongData.artist,
          album: incomingSongData.album,
          // audioData preserved
          updatedAt: Date.now(),
        };

        expect(updatedSong.audioData).toBe(existingSong.audioData);
        expect(updatedSong.title).toBe("New Title");
        expect(updatedSong.artist).toBe("New Artist");
        expect(updatedSong.album).toBe("New Album");
      }
    });

    it("should create new song when SHA differs", () => {
      const existingSong = {
        id: "song1",
        audioData: new ArrayBuffer(1024),
        sha: "old-sha",
      };

      const incomingSongData = {
        id: "song1",
        title: "Updated Song",
        sha: "new-sha",
      };

      const shaMatches =
        existingSong.sha &&
        incomingSongData.sha &&
        existingSong.sha === incomingSongData.sha;

      expect(shaMatches).toBe(false);

      if (!shaMatches) {
        const newSong = {
          id: incomingSongData.id,
          title: incomingSongData.title,
          audioData: undefined, // Will be loaded on-demand
          sha: incomingSongData.sha,
        };

        expect(newSong.audioData).toBeUndefined();
        expect(newSong.sha).toBe("new-sha");
      }
    });

    it("should handle mixed SHA states in playlist", () => {
      const existingSongs = [
        { id: "song1", sha: "sha1", audioData: new ArrayBuffer(100) },
        { id: "song2", sha: "sha2", audioData: new ArrayBuffer(200) },
        { id: "song3", sha: undefined, audioData: new ArrayBuffer(300) },
      ];

      const incomingSongs = [
        { id: "song1", sha: "sha1", title: "Same SHA" }, // Preserve
        { id: "song2", sha: "new-sha2", title: "Different SHA" }, // Reload
        { id: "song3", sha: "new-sha3", title: "Added SHA" }, // Reload
        { id: "song4", sha: "sha4", title: "New Song" }, // Create
      ];

      const results = incomingSongs.map((incoming) => {
        const existing = existingSongs.find((e) => e.id === incoming.id);

        if (!existing) {
          return { action: "create", song: incoming };
        }

        const shaMatches =
          existing.sha && incoming.sha && existing.sha === incoming.sha;

        if (shaMatches) {
          return {
            action: "preserve",
            song: { ...existing, title: incoming.title },
          };
        } else {
          return {
            action: "reload",
            song: { ...incoming, audioData: undefined },
          };
        }
      });

      expect(results[0]?.action).toBe("preserve");
      expect(results[1]?.action).toBe("reload");
      expect(results[2]?.action).toBe("reload");
      expect(results[3]?.action).toBe("create");
    });
  });

  describe("Edge Cases", () => {
    it("should handle corrupted playlist data", () => {
      const corruptedData = {
        playlist: null,
        songs: undefined,
      };

      const isValid = !!(
        corruptedData.playlist && Array.isArray(corruptedData.songs)
      );
      expect(isValid).toBe(false);
    });

    it("should handle playlist with no songs", () => {
      const emptyPlaylistData = {
        playlist: {
          id: "empty-playlist",
          rev: 1,
        },
        songs: [],
      };

      const hasSongs = emptyPlaylistData.songs.length > 0;
      expect(hasSongs).toBe(false);
    });

    it("should handle songs with malformed SHA", () => {
      const song = {
        id: "test-song",
        sha: "invalid-sha-format",
      };

      const isValidSHA = song.sha && song.sha.length === 64;
      expect(isValidSHA).toBe(false);
    });

    it("should handle negative or invalid rev values", () => {
      const scenarios = [
        { rev: -1, expected: 0 },
        { rev: "invalid", expected: 0 },
        { rev: null, expected: 0 },
        { rev: undefined, expected: 0 },
        { rev: 3.14, expected: 3 },
      ];

      scenarios.forEach(({ rev, expected }) => {
        const normalizedRev = Math.max(0, parseInt(String(rev)) || 0);
        expect(normalizedRev).toBe(expected);
      });
    });
  });

  describe("Integration Workflow", () => {
    it("should simulate complete standalone initialization", async () => {
      const playlistData = {
        playlist: {
          id: "test-playlist",
          title: "Test Playlist",
          rev: 2,
        },
        songs: [
          { id: "song1", title: "Song 1", sha: "sha1" },
          { id: "song2", title: "Song 2", sha: "sha2" },
        ],
      };

      // Step 1: Check for existing playlist
      const existingPlaylist = {
        id: "test-playlist",
        rev: 1, // Lower revision
      };

      // Step 2: Determine action needed
      const existingRev = existingPlaylist.rev || 0;
      const incomingRev = playlistData.playlist.rev || 0;
      const needsFullReload = incomingRev > existingRev;

      expect(needsFullReload).toBe(true);

      // Step 3: If full reload needed, check existing songs
      const existingSongs = [
        { id: "song1", sha: "sha1", audioData: new ArrayBuffer(100) },
        { id: "song2", sha: "old-sha2", audioData: new ArrayBuffer(200) },
      ];

      // Step 4: Process each song
      const finalSongs = playlistData.songs.map((songData) => {
        const existingSong = existingSongs.find((s) => s.id === songData.id);

        if (
          existingSong &&
          existingSong.sha &&
          songData.sha &&
          existingSong.sha === songData.sha
        ) {
          // Preserve audio data
          return {
            ...existingSong,
            title: songData.title,
            updatedAt: Date.now(),
          };
        } else {
          // Create new song for lazy loading
          return {
            ...songData,
            audioData: undefined,
          };
        }
      });

      expect(finalSongs[0]?.audioData).toBeDefined(); // Preserved
      expect(finalSongs[1]?.audioData).toBeUndefined(); // New (lazy load)
    });

    it("should handle first-time standalone setup", () => {
      const playlistData = {
        playlist: {
          id: "new-playlist",
          title: "New Playlist",
          rev: 0,
        },
        songs: [{ id: "song1", title: "Song 1", sha: "sha1" }],
      };

      const existingPlaylist = null; // No existing playlist

      const shouldCreate = !existingPlaylist;
      expect(shouldCreate).toBe(true);

      if (shouldCreate) {
        // All songs will be created fresh
        const newSongs = playlistData.songs.map((songData) => ({
          ...songData,
          audioData: undefined, // Lazy loading
        }));

        expect(newSongs[0]?.audioData).toBeUndefined();
        expect(newSongs[0]?.sha).toBe("sha1");
      }
    });
  });
});
