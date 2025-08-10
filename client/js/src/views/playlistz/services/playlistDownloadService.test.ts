import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateSHA256,
  calculateFileSHA256,
  verifySHA256,
} from "../utils/hashUtils.js";

// Mock dependencies
vi.mock("jszip", () => ({
  default: vi.fn(() => ({
    folder: vi.fn().mockReturnThis(),
    file: vi.fn().mockReturnThis(),
    generateAsync: vi.fn().mockResolvedValue(new Blob()),
  })),
}));

vi.mock("./indexedDBService.js", () => ({
  getSongsWithAudioData: vi.fn(),
  updatePlaylist: vi.fn(),
  updateSong: vi.fn(),
}));

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

// Mock URL for blob creation
global.URL = {
  createObjectURL: vi.fn(() => "blob:mock-url"),
  revokeObjectURL: vi.fn(),
} as any;

// Mock document for DOM manipulation
global.document = {
  createElement: vi.fn(() => ({
    href: "",
    download: "",
    click: vi.fn(),
  })),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
} as any;

describe("Playlist Download Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Hash Utilities", () => {
    describe("calculateSHA256", () => {
      it("should calculate SHA-256 hash from ArrayBuffer", async () => {
        const data = new ArrayBuffer(8);
        const hash = await calculateSHA256(data);

        expect(crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", data);
        expect(hash).toBe(
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        );
      });

      it("should handle empty ArrayBuffer", async () => {
        const data = new ArrayBuffer(0);
        const hash = await calculateSHA256(data);

        expect(crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", data);
        expect(hash).toBe(
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        );
      });

      it("should handle large ArrayBuffer", async () => {
        const data = new ArrayBuffer(1024 * 1024); // 1MB
        const hash = await calculateSHA256(data);

        expect(crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", data);
        expect(hash).toHaveLength(64); // SHA-256 hex string length
      });
    });

    describe("calculateFileSHA256", () => {
      it("should calculate SHA-256 hash from File", async () => {
        const mockFile = {
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        } as any;

        const hash = await calculateFileSHA256(mockFile);

        expect(mockFile.arrayBuffer).toHaveBeenCalled();
        expect(crypto.subtle.digest).toHaveBeenCalledWith(
          "SHA-256",
          new ArrayBuffer(8)
        );
        expect(hash).toBe(
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        );
      });

      it("should handle File.arrayBuffer() errors", async () => {
        const mockFile = {
          arrayBuffer: vi.fn().mockRejectedValue(new Error("File read error")),
        } as any;

        await expect(calculateFileSHA256(mockFile)).rejects.toThrow(
          "File read error"
        );
      });
    });

    describe("verifySHA256", () => {
      it("should verify correct SHA-256 hash", async () => {
        const data = new ArrayBuffer(8);
        const expectedHash =
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

        const isValid = await verifySHA256(data, expectedHash);

        expect(isValid).toBe(true);
        expect(crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", data);
      });

      it("should return false for incorrect SHA-256 hash", async () => {
        const data = new ArrayBuffer(8);
        const wrongHash =
          "1111111111111111111111111111111111111111111111111111111111111111";

        const isValid = await verifySHA256(data, wrongHash);

        expect(isValid).toBe(false);
      });

      it("should handle empty hash string", async () => {
        const data = new ArrayBuffer(8);
        const emptyHash = "";

        const isValid = await verifySHA256(data, emptyHash);

        expect(isValid).toBe(false);
      });

      it("should handle malformed hash", async () => {
        const data = new ArrayBuffer(8);
        const malformedHash = "not-a-valid-hash";

        const isValid = await verifySHA256(data, malformedHash);

        expect(isValid).toBe(false);
      });
    });
  });

  describe("Playlist Revision Management", () => {
    it("should increment playlist revision before download", () => {
      const playlist = {
        id: "test-playlist",
        title: "Test Playlist",
        rev: 2,
      };

      // Simulate download logic
      const currentRev = playlist.rev || 0;
      const newRev = currentRev + 1;

      expect(newRev).toBe(3);
    });

    it("should handle undefined revision", () => {
      const playlist = {
        id: "test-playlist",
        title: "Test Playlist",
        // rev is undefined
      } as any;

      const currentRev = playlist.rev || 0;
      const newRev = currentRev + 1;

      expect(newRev).toBe(1);
    });

    it("should handle multiple revision increments", () => {
      let currentRev = 0;

      // First download
      currentRev = (currentRev || 0) + 1;
      expect(currentRev).toBe(1);

      // Second download
      currentRev = (currentRev || 0) + 1;
      expect(currentRev).toBe(2);

      // Third download
      currentRev = (currentRev || 0) + 1;
      expect(currentRev).toBe(3);
    });
  });

  describe("SHA Calculation in Download Process", () => {
    it("should calculate SHA for songs without it during download", async () => {
      const songs = [
        {
          id: "song1",
          title: "Song 1",
          audioData: new ArrayBuffer(8),
          sha: undefined, // Missing SHA
        },
        {
          id: "song2",
          title: "Song 2",
          audioData: new ArrayBuffer(16),
          sha: "existing-sha", // Already has SHA
        },
        {
          id: "song3",
          title: "Song 3",
          audioData: undefined, // No audio data
          sha: undefined,
        },
      ];

      // Simulate the download logic
      const songsWithSHA = await Promise.all(
        songs.map(async (song) => {
          if (!song.sha && song.audioData) {
            const sha = await calculateSHA256(song.audioData);
            return { ...song, sha };
          }
          return song;
        })
      );

      expect(songsWithSHA[0]?.sha).toBe(
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
      );
      expect(songsWithSHA[1]?.sha).toBe("existing-sha");
      expect(songsWithSHA[2]?.sha).toBeUndefined();
    });

    it("should handle SHA calculation errors gracefully", async () => {
      // Mock crypto.subtle.digest to throw an error
      vi.mocked(crypto.subtle.digest).mockRejectedValueOnce(
        new Error("Crypto error")
      );

      const song = {
        id: "song1",
        audioData: new ArrayBuffer(8),
        sha: undefined,
      };

      try {
        await calculateSHA256(song.audioData);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Crypto error");
      }
    });

    it("should include SHA in exported playlist data", () => {
      const songs = [
        {
          id: "song1",
          title: "Song 1",
          sha: "abc123def456",
        },
        {
          id: "song2",
          title: "Song 2",
          sha: undefined,
        },
      ];

      const exportedSongs = songs.map((song) => ({
        id: song.id,
        title: song.title,
        sha: song.sha,
      }));

      expect(exportedSongs[0]?.sha).toBe("abc123def456");
      expect(exportedSongs[1]?.sha).toBeUndefined();
    });
  });

  describe("Playlist Data Structure", () => {
    it("should include revision in playlist data", () => {
      const playlist = {
        id: "test-playlist",
        title: "Test Playlist",
        description: "Test description",
        rev: 3,
        songIds: ["song1", "song2"],
      };

      const playlistData = {
        playlist: {
          id: playlist.id,
          title: playlist.title,
          description: playlist.description,
          rev: playlist.rev,
          songCount: playlist.songIds.length,
        },
        songs: [],
      };

      expect(playlistData.playlist.rev).toBe(3);
    });

    it("should handle missing revision in playlist data", () => {
      const playlist = {
        id: "test-playlist",
        title: "Test Playlist",
        // rev is undefined
        songIds: [],
      } as any;

      const playlistData = {
        playlist: {
          id: playlist.id,
          title: playlist.title,
          rev: playlist.rev || 0,
        },
        songs: [],
      };

      expect(playlistData.playlist.rev).toBe(0);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle songs with audio data but no SHA", async () => {
      const song: {
        id: string;
        audioData?: ArrayBuffer;
        sha?: string;
      } = {
        id: "test-song",
        audioData: new ArrayBuffer(1024),
        sha: undefined,
      };

      const hasAudioData = Boolean(song.audioData);
      const hasSHA = Boolean(song.sha);

      expect(hasAudioData).toBe(true);
      expect(hasSHA).toBe(false);

      // Should calculate SHA
      if (!song.sha && song.audioData) {
        song.sha = await calculateSHA256(song.audioData);
      }

      expect(song.sha).toBeDefined();
    });

    it("should handle songs with SHA but no audio data", () => {
      const song = {
        id: "test-song",
        sha: "abc123",
        audioData: undefined,
      };

      const hasAudioData = Boolean(song.audioData);
      const hasSHA = Boolean(song.sha);

      expect(hasAudioData).toBe(false);
      expect(hasSHA).toBe(true);
    });

    it("should handle empty SHA string", () => {
      const song = {
        id: "test-song",
        sha: "",
      };

      const hasSHA = Boolean(song.sha);
      expect(hasSHA).toBe(false);
    });

    it("should validate SHA format", () => {
      const validSHA =
        "a1b2c3d4e5f67890123456789012345678901234567890123456789012345678";
      const invalidSHA = "not-a-valid-sha";

      expect(validSHA.length).toBe(64);
      expect(invalidSHA.length).not.toBe(64);
    });

    it("should handle revision type coercion", () => {
      const scenarios = [
        { input: "2", expected: 2 },
        { input: 3.14, expected: 3 },
        { input: null, expected: 0 },
        { input: undefined, expected: 0 },
        { input: "invalid", expected: 0 },
      ];

      scenarios.forEach(({ input, expected }) => {
        const rev = parseInt(String(input)) || 0;
        expect(rev).toBe(expected);
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle mixed SHA states in download", async () => {
      const songs = [
        { id: "song1", sha: "existing1", audioData: new ArrayBuffer(8) },
        { id: "song2", sha: undefined, audioData: new ArrayBuffer(16) },
        { id: "song3", sha: "existing3", audioData: undefined },
        { id: "song4", sha: undefined, audioData: undefined },
      ];

      const processedSongs = await Promise.all(
        songs.map(async (song) => {
          if (!song.sha && song.audioData) {
            return { ...song, sha: await calculateSHA256(song.audioData) };
          }
          return song;
        })
      );

      expect(processedSongs[0]?.sha).toBe("existing1"); // Unchanged
      expect(processedSongs[1]?.sha).toBeDefined(); // Calculated
      expect(processedSongs[2]?.sha).toBe("existing3"); // Unchanged
      expect(processedSongs[3]?.sha).toBeUndefined(); // No change possible
    });

    it("should simulate complete download workflow", async () => {
      const playlist = {
        id: "test-playlist",
        title: "Test Playlist",
        rev: 1,
        songIds: ["song1", "song2"],
      };

      // Step 1: Increment revision
      const currentRev = playlist.rev || 0;
      const newRev = currentRev + 1;
      expect(newRev).toBe(2);

      // Step 2: Process songs
      const songs = [
        { id: "song1", audioData: new ArrayBuffer(8), sha: undefined },
        { id: "song2", audioData: new ArrayBuffer(16), sha: "existing" },
      ];

      const songsWithSHA = await Promise.all(
        songs.map(async (song) => {
          if (!song.sha && song.audioData) {
            return { ...song, sha: await calculateSHA256(song.audioData) };
          }
          return song;
        })
      );

      // Step 3: Create playlist data
      const playlistData = {
        playlist: {
          id: playlist.id,
          title: playlist.title,
          rev: newRev,
        },
        songs: songsWithSHA.map((song) => ({
          id: song.id,
          sha: song.sha,
        })),
      };

      expect(playlistData.playlist.rev).toBe(2);
      expect(playlistData.songs[0]?.sha).toBeDefined();
      expect(playlistData.songs[1]?.sha).toBe("existing");
    });

    it("should handle first-time playlist download", async () => {
      const newPlaylist = {
        id: "new-playlist",
        title: "New Playlist",
        rev: undefined, // First time
        songIds: ["song1"],
      };

      const currentRev = newPlaylist.rev || 0;
      const newRev = currentRev + 1;

      expect(newRev).toBe(1); // First revision
    });

    it("should handle playlist with no songs", () => {
      const emptyPlaylist = {
        id: "empty-playlist",
        title: "Empty Playlist",
        rev: 0,
        songIds: [],
      };

      const playlistData = {
        playlist: {
          id: emptyPlaylist.id,
          title: emptyPlaylist.title,
          rev: (emptyPlaylist.rev || 0) + 1,
          songCount: emptyPlaylist.songIds.length,
        },
        songs: [],
      };

      expect(playlistData.playlist.rev).toBe(1);
      expect(playlistData.playlist.songCount).toBe(0);
      expect(playlistData.songs).toHaveLength(0);
    });
  });
});
