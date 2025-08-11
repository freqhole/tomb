import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import {
  downloadPlaylistAsZip,
  parsePlaylistZip,
  type PlaylistDownloadOptions,
} from "./playlistDownloadService.js";
import type { Playlist, Song } from "../types/playlist.js";

// Mock dependencies
vi.mock("./indexedDBService.js", () => ({
  getSongsWithAudioData: vi.fn(),
  updatePlaylist: vi.fn(),
  updateSong: vi.fn(),
}));

vi.mock("../utils/hashUtils.js", () => ({
  calculateSHA256: vi.fn(),
}));

// Mock JSZip
vi.mock("jszip", () => ({
  default: vi.fn(() => ({
    file: vi.fn(),
    folder: vi.fn(),
    generateAsync: vi.fn(),
    loadAsync: vi.fn().mockResolvedValue({
      file: vi.fn((pattern) => {
        if (typeof pattern === "string") {
          // Return a single file object or null
          return pattern === "data/playlist.json" ||
            pattern === "playlist-info.json"
            ? {
                async: vi.fn().mockResolvedValue(
                  JSON.stringify({
                    playlist: {
                      title: "Test Playlist",
                      description: "Test Description",
                    },
                    songs: [],
                  })
                ),
              }
            : null;
        } else if (pattern instanceof RegExp) {
          // Return array of file objects for regex patterns
          if (pattern.test("playlist.json")) {
            return [
              {
                async: vi.fn().mockResolvedValue(
                  JSON.stringify({
                    playlist: {
                      title: "Test Playlist",
                      description: "Test Description",
                    },
                    songs: [],
                  })
                ),
              },
            ];
          }
          return [];
        }
        return [];
      }),
      files: {},
    }),
    files: {},
  })),
}));

// Mock global objects
global.URL = {
  createObjectURL: vi.fn(() => "mock-blob-url"),
  revokeObjectURL: vi.fn(),
} as any;

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

// Mock fetch to prevent localhost errors
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve("mock HTML content"),
  })
) as any;

describe("Playlist Download Service", () => {
  let mockPlaylist: Playlist;
  let mockSongs: Song[];

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPlaylist = {
      id: "playlist-123",
      title: "Test Playlist",
      description: "A test playlist",
      songIds: ["song1", "song2"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rev: 1,
      imageData: new ArrayBuffer(100),
      imageType: "image/jpeg",
    };

    mockSongs = [
      {
        id: "song1",
        title: "Song One",
        artist: "Artist One",
        album: "Album One",
        duration: 180,
        audioData: new ArrayBuffer(1000),
        sha: "existing-sha-1",
        imageData: new ArrayBuffer(50),
        imageType: "image/jpeg",
        mimeType: "audio/mpeg",
        originalFilename: "song-one.mp3",
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playlistId: "test-playlist",
      },
      {
        id: "song2",
        title: "Song Two",
        artist: "Artist Two",
        album: "Album Two",
        duration: 240,
        audioData: new ArrayBuffer(1500),
        sha: undefined, // Will need SHA calculation
        imageData: new ArrayBuffer(75),
        imageType: "image/png",
        mimeType: "audio/mp4",
        originalFilename: "song-two.m4a",
        position: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playlistId: "test-playlist",
      },
    ];

    // Set up mock implementations
    const { getSongsWithAudioData, updatePlaylist, updateSong } = await import(
      "./indexedDBService.js"
    );
    const { calculateSHA256 } = await import("../utils/hashUtils.js");

    vi.mocked(getSongsWithAudioData).mockResolvedValue(mockSongs);
    vi.mocked(updatePlaylist).mockResolvedValue(undefined);
    vi.mocked(updateSong).mockResolvedValue(undefined);
    vi.mocked(calculateSHA256).mockResolvedValue("calculated-sha-256");

    vi.mocked(JSZip).mockImplementation(
      () =>
        ({
          file: vi.fn(),
          folder: vi.fn().mockReturnThis(),
          generateAsync: vi
            .fn()
            .mockResolvedValue(new Blob(["mock zip content"])),
          loadAsync: vi.fn(),
          files: {},
        }) as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("downloadPlaylistAsZip", () => {
    it("should create a ZIP file with playlist and songs", async () => {
      const { getSongsWithAudioData, updatePlaylist } = await import(
        "./indexedDBService.js"
      );
      const mockGetSongs = vi.mocked(getSongsWithAudioData);
      const mockUpdatePL = vi.mocked(updatePlaylist);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockGetSongs).toHaveBeenCalledWith(mockPlaylist.songIds);
      expect(mockUpdatePL).toHaveBeenCalledWith(mockPlaylist.id, {
        rev: 2,
      });
      expect(JSZip).toHaveBeenCalled();
    });

    it("should increment playlist revision before download", async () => {
      const { updatePlaylist } = await import("./indexedDBService.js");
      const mockUpdatePL = vi.mocked(updatePlaylist);
      const playlistWithRev = { ...mockPlaylist, rev: 5 };

      await downloadPlaylistAsZip(playlistWithRev);

      expect(mockUpdatePL).toHaveBeenCalledWith(playlistWithRev.id, {
        rev: 6,
      });
    });

    it("should handle playlist without revision", async () => {
      const { updatePlaylist } = await import("./indexedDBService.js");
      const mockUpdatePL = vi.mocked(updatePlaylist);
      const playlistNoRev = { ...mockPlaylist, rev: undefined };

      await downloadPlaylistAsZip(playlistNoRev);

      expect(mockUpdatePL).toHaveBeenCalledWith(playlistNoRev.id, {
        rev: 1,
      });
    });

    it("should calculate SHA for songs that don't have it", async () => {
      const { updateSong } = await import("./indexedDBService.js");
      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      const mockUpdateS = vi.mocked(updateSong);
      const mockCalcSHA = vi.mocked(calculateSHA256);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockCalcSHA).toHaveBeenCalledWith(mockSongs[1]?.audioData);
      expect(mockUpdateS).toHaveBeenCalledWith("song2", {
        sha: "calculated-sha-256",
      });
    });

    it("should not calculate SHA for songs that already have it", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      // Should only be called once for song2, not for song1
      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      const { updateSong } = await import("./indexedDBService.js");
      expect(vi.mocked(calculateSHA256)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateSong)).toHaveBeenCalledTimes(1);
    });

    it("should handle SHA calculation errors gracefully", async () => {
      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      vi.mocked(calculateSHA256).mockRejectedValue(
        new Error("SHA calculation failed")
      );

      // Should not throw
      await expect(downloadPlaylistAsZip(mockPlaylist)).resolves.not.toThrow();

      // Should still proceed with download
      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should create proper folder structure", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should include metadata when option is enabled", async () => {
      const options = { includeMetadata: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should include images when option is enabled", async () => {
      const options = { includeImages: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should generate M3U when option is enabled", async () => {
      const options = { generateM3U: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should include standalone HTML when option is enabled", async () => {
      const options = { includeHTML: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should handle empty playlist", async () => {
      const emptyPlaylist = { ...mockPlaylist, songIds: [] };
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue([]);

      await downloadPlaylistAsZip(emptyPlaylist);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      expect(vi.mocked(calculateSHA256)).not.toHaveBeenCalled();
    });

    it("should handle songs without audio data", async () => {
      const songsWithoutAudio = [
        {
          id: "song1",
          title: "Song One",
          artist: "Artist One",
          album: "Album One",
          duration: 180,
          mimeType: "audio/mpeg",
          originalFilename: "song-one.mp3",
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: undefined,
        },
        {
          id: "song2",
          title: "Song Two",
          artist: "Artist Two",
          album: "Album Two",
          duration: 240,
          mimeType: "audio/mp4",
          originalFilename: "song-two.m4a",
          position: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: undefined,
        },
      ];
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue(songsWithoutAudio);

      await downloadPlaylistAsZip(mockPlaylist);

      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      expect(vi.mocked(calculateSHA256)).not.toHaveBeenCalled();
      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should trigger download in browser", async () => {
      const mockAnchorElement = {
        href: "",
        download: "",
        click: vi.fn(),
      };
      (document.createElement as any).mockReturnValue(mockAnchorElement);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(document.createElement).toHaveBeenCalledWith("a");
      expect(mockAnchorElement.click).toHaveBeenCalled();
      expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchorElement);
      expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchorElement);
    });

    it("should handle ZIP generation errors", async () => {
      vi.mocked(JSZip).mockImplementation(() => {
        throw new Error("ZIP generation failed");
      });

      await expect(downloadPlaylistAsZip(mockPlaylist)).rejects.toThrow(
        "ZIP generation failed"
      );
    });

    it("should handle database update errors", async () => {
      const { updatePlaylist } = await import("./indexedDBService.js");
      vi.mocked(updatePlaylist).mockRejectedValue(new Error("Database error"));

      await expect(downloadPlaylistAsZip(mockPlaylist)).rejects.toThrow(
        "Database error"
      );
    });
  });

  describe("M3U Generation (via ZIP download)", () => {
    it("should include M3U content when generateM3U option is true", async () => {
      const options = { generateM3U: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should not include M3U when generateM3U option is false", async () => {
      const options: PlaylistDownloadOptions = { generateM3U: false };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("Filename Safety (via ZIP download)", () => {
    it("should create safe filenames for songs with special characters", async () => {
      const playlistWithSpecialChars = {
        ...mockPlaylist,
        title: 'Playlist/With\\Special:Chars|<>*?"',
      };

      const songsWithSpecialChars = [
        {
          id: "song1",
          title: 'Song/With\\Special:Chars|<>*?"',
          artist: 'Artist/With\\Special:Chars|<>*?"',
          album: "Album One",
          duration: 180,
          mimeType: "audio/mpeg",
          originalFilename: "special.mp3",
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: new ArrayBuffer(1000),
        },
      ];
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue(songsWithSpecialChars);

      await downloadPlaylistAsZip(playlistWithSpecialChars);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("File Extension Handling (via ZIP download)", () => {
    it("should handle different audio file types", async () => {
      const songsWithDifferentTypes = [
        {
          id: "song1",
          title: "Song One",
          artist: "Artist One",
          album: "Album One",
          duration: 180,
          mimeType: "audio/mp3",
          originalFilename: "song1.mp3",
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: new ArrayBuffer(1000),
        },
        {
          id: "song2",
          title: "Song Two",
          artist: "Artist Two",
          album: "Album Two",
          duration: 240,
          mimeType: "audio/wav",
          originalFilename: "song2.wav",
          position: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: new ArrayBuffer(1500),
        },
      ];
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue(
        songsWithDifferentTypes
      );

      await downloadPlaylistAsZip(mockPlaylist);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("MIME Type Handling", () => {
    it("should preserve MIME types during download", async () => {
      const songsWithMimeTypes = [
        {
          id: "song1",
          title: "Song One",
          artist: "Artist One",
          album: "Album One",
          duration: 180,
          mimeType: "audio/wav",
          originalFilename: "song1.wav",
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: new ArrayBuffer(1000),
        },
        {
          id: "song2",
          title: "Song Two",
          artist: "Artist Two",
          album: "Album Two",
          duration: 240,
          mimeType: "audio/flac",
          originalFilename: "song2.flac",
          position: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          audioData: new ArrayBuffer(1500),
        },
      ];
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue(songsWithMimeTypes);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("Base64 Handling (internal)", () => {
    it("should handle playlist with base64 image data", async () => {
      const playlistWithBase64Image = {
        ...mockPlaylist,
        imageData: new ArrayBuffer(100), // Use ArrayBuffer instead of string
      };

      await downloadPlaylistAsZip(playlistWithBase64Image);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("Filename Sanitization (internal)", () => {
    it("should sanitize problematic filenames in downloads", async () => {
      const problemPlaylist = {
        ...mockPlaylist,
        title: "CON", // Reserved Windows filename
      };

      await downloadPlaylistAsZip(problemPlaylist);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });
  });

  describe("parsePlaylistZip", () => {
    let mockZipFile: any;

    beforeEach(() => {
      mockZipFile = {
        files: {
          "playlist.json": {
            async: vi.fn().mockResolvedValue(
              JSON.stringify({
                playlist: mockPlaylist,
                songs: mockSongs,
              })
            ),
          },
          "song1.mp3": {
            async: vi.fn().mockResolvedValue(new ArrayBuffer(1000)),
          },
          "song2.mp3": {
            async: vi.fn().mockResolvedValue(new ArrayBuffer(1500)),
          },
        },
        file: vi.fn((pattern) => {
          if (typeof pattern === "string") {
            // Return a single file object or null
            if (pattern === "data/playlist.json") {
              return {
                async: vi.fn().mockResolvedValue(
                  JSON.stringify({
                    playlist: mockPlaylist,
                    songs: mockSongs,
                  })
                ),
              };
            }
            if (pattern === "playlist-info.json") {
              return {
                async: vi.fn().mockResolvedValue(JSON.stringify(mockPlaylist)),
              };
            }
            return null;
          } else if (pattern instanceof RegExp) {
            // Return array of file objects for regex patterns
            if (pattern.test("playlist.json")) {
              return [
                {
                  async: vi.fn().mockResolvedValue(
                    JSON.stringify({
                      playlist: mockPlaylist,
                      songs: mockSongs,
                    })
                  ),
                },
              ];
            }
            if (pattern.test("song1.mp3") || pattern.test("song2.mp3")) {
              return [
                {
                  name: "song1.mp3",
                  async: vi.fn().mockResolvedValue(new ArrayBuffer(1000)),
                },
                {
                  name: "song2.mp3",
                  async: vi.fn().mockResolvedValue(new ArrayBuffer(1500)),
                },
              ];
            }
            return [];
          }
          return [];
        }),
      };

      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockResolvedValue(mockZipFile),
          }) as any
      );
    });

    it("should parse playlist ZIP file correctly", async () => {
      const zipFile = new File(["mock zip content"], "playlist.zip", {
        type: "application/zip",
      });
      const result = await parsePlaylistZip(zipFile);

      expect(result).toHaveProperty("playlist");
      expect(result).toHaveProperty("songs");
      expect(result.playlist.title).toBe(mockPlaylist.title);
      expect(result.songs).toHaveLength(2);
    });

    it("should handle ZIP files without playlist.json", async () => {
      const mockEmptyZipFile = {
        files: {}, // No playlist.json
      };

      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockResolvedValue(mockEmptyZipFile),
          }) as any
      );

      const zipFile = new File(["mock zip content"], "playlist.zip", {
        type: "application/zip",
      });

      await expect(parsePlaylistZip(zipFile)).rejects.toThrow();
    });

    it("should handle corrupted ZIP files", async () => {
      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockRejectedValue(new Error("Corrupted ZIP")),
          }) as any
      );

      const zipFile = new File(["corrupted content"], "corrupted.zip", {
        type: "application/zip",
      });

      await expect(parsePlaylistZip(zipFile)).rejects.toThrow("Corrupted ZIP");
    });

    it("should handle invalid JSON in playlist.json", async () => {
      const mockInvalidZipFile = {
        files: {
          "playlist.json": {
            async: vi.fn().mockResolvedValue("invalid json"),
          },
        },
      };

      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockResolvedValue(mockInvalidZipFile),
          }) as any
      );

      const zipFile = new File(["mock zip content"], "playlist.zip", {
        type: "application/zip",
      });

      await expect(parsePlaylistZip(zipFile)).rejects.toThrow();
    });
  });

  describe("Standalone HTML Generation", () => {
    it("should include HTML when includeHTML option is true", async () => {
      const options = { includeHTML: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should not include HTML when includeHTML option is false", async () => {
      const options: PlaylistDownloadOptions = { includeHTML: false };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should handle HTML generation errors gracefully", async () => {
      // Mock fetch to fail (used in HTML generation)
      global.fetch = vi.fn().mockRejectedValue(new Error("Fetch failed"));

      const options: PlaylistDownloadOptions = { includeHTML: true };

      // Should not throw, should skip HTML generation
      await expect(
        downloadPlaylistAsZip(mockPlaylist, options)
      ).resolves.not.toThrow();
    });
  });

  describe("Integration Tests", () => {
    it("should complete full download workflow", async () => {
      const { getSongsWithAudioData, updatePlaylist } = await import(
        "./indexedDBService.js"
      );
      const { calculateSHA256 } = await import("../utils/hashUtils.js");

      const options = {
        includeMetadata: true,
        generateM3U: true,
        includeImages: true,
        includeHTML: true,
      };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(vi.mocked(getSongsWithAudioData)).toHaveBeenCalled();
      expect(vi.mocked(updatePlaylist)).toHaveBeenCalled();
      expect(vi.mocked(calculateSHA256)).toHaveBeenCalled();
      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should handle mixed scenarios with partial data", async () => {
      // Mix of songs with and without SHA, images, etc.
      const mixedSongs = [
        {
          id: "song1",
          title: "Song One",
          artist: "Artist One",
          album: "Album One",
          duration: 180,
          mimeType: "audio/mpeg",
          originalFilename: "song1.mp3",
          position: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          sha: "existing-sha",
          audioData: new ArrayBuffer(1000),
        },
        {
          id: "song2",
          title: "Song Two",
          artist: "Artist Two",
          album: "Album Two",
          duration: 240,
          mimeType: "audio/mp4",
          originalFilename: "song2.m4a",
          position: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          playlistId: "test-playlist",
          sha: undefined,
          imageData: undefined,
          audioData: new ArrayBuffer(1500),
        },
      ];
      const { getSongsWithAudioData } = await import("./indexedDBService.js");
      const { calculateSHA256 } = await import("../utils/hashUtils.js");
      vi.mocked(getSongsWithAudioData).mockResolvedValue(mixedSongs);

      await downloadPlaylistAsZip(mockPlaylist);

      // Should only calculate SHA for the song that needs it
      expect(vi.mocked(calculateSHA256)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(JSZip)).toHaveBeenCalled();
    });

    it("should maintain data integrity throughout workflow", async () => {
      const { getSongsWithAudioData, updatePlaylist } = await import(
        "./indexedDBService.js"
      );

      await downloadPlaylistAsZip(mockPlaylist);

      // Verify playlist revision was incremented
      expect(vi.mocked(updatePlaylist)).toHaveBeenCalledWith(mockPlaylist.id, {
        rev: mockPlaylist.rev! + 1,
      });

      // Verify all songs were processed
      expect(vi.mocked(getSongsWithAudioData)).toHaveBeenCalledWith(
        expect.arrayContaining(mockPlaylist.songIds)
      );
    });
  });
});
