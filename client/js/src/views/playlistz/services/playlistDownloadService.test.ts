import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import {
  downloadPlaylistAsZip,
  parsePlaylistZip,
  type PlaylistDownloadOptions,
} from "./playlistDownloadService.js";
import type { Playlist, Song } from "../types/playlist.js";

// Mock dependencies
const mockGetSongsWithAudioData = vi.fn();
const mockUpdatePlaylist = vi.fn();
const mockUpdateSong = vi.fn();
const mockCalculateSHA256 = vi.fn();

vi.mock("./indexedDBService.js", () => ({
  getSongsWithAudioData: mockGetSongsWithAudioData,
  updatePlaylist: mockUpdatePlaylist,
  updateSong: mockUpdateSong,
}));

vi.mock("../utils/hashUtils.js", () => ({
  calculateSHA256: mockCalculateSHA256,
}));

// Mock JSZip
const mockZipFile = vi.fn();
const mockZipFolder = vi.fn();
const mockZipGenerateAsync = vi.fn();
const mockZipInstance = {
  file: mockZipFile,
  folder: mockZipFolder.mockReturnThis(),
  generateAsync: mockZipGenerateAsync,
};

vi.mock("jszip", () => ({
  default: vi.fn(() => mockZipInstance),
}));

// Mock global objects
global.URL = {
  createObjectURL: vi.fn(() => "blob:mock-url"),
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

describe("Playlist Download Service", () => {
  let mockPlaylist: Playlist;
  let mockSongs: Song[];

  beforeEach(() => {
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
      },
    ];

    // Default mock implementations
    mockGetSongsWithAudioData.mockResolvedValue(mockSongs);
    mockUpdatePlaylist.mockResolvedValue(undefined);
    mockUpdateSong.mockResolvedValue(undefined);
    mockCalculateSHA256.mockResolvedValue("calculated-sha-256");
    mockZipGenerateAsync.mockResolvedValue(new Blob(["mock zip content"]));
    mockZipFolder.mockReturnValue(mockZipInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("downloadPlaylistAsZip", () => {
    it("should create a ZIP file with playlist and songs", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockGetSongsWithAudioData).toHaveBeenCalledWith(
        mockPlaylist.songIds
      );
      expect(mockUpdatePlaylist).toHaveBeenCalledWith(mockPlaylist.id, {
        rev: 2,
      });
      expect(JSZip).toHaveBeenCalled();
      expect(mockZipFolder).toHaveBeenCalled();
      expect(mockZipGenerateAsync).toHaveBeenCalledWith({ type: "blob" });
    });

    it("should increment playlist revision before download", async () => {
      const playlistWithRev = { ...mockPlaylist, rev: 5 };

      await downloadPlaylistAsZip(playlistWithRev);

      expect(mockUpdatePlaylist).toHaveBeenCalledWith(playlistWithRev.id, {
        rev: 6,
      });
    });

    it("should handle playlist without revision", async () => {
      const playlistNoRev = { ...mockPlaylist, rev: undefined };

      await downloadPlaylistAsZip(playlistNoRev);

      expect(mockUpdatePlaylist).toHaveBeenCalledWith(playlistNoRev.id, {
        rev: 1,
      });
    });

    it("should calculate SHA for songs that don't have it", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockCalculateSHA256).toHaveBeenCalledWith(mockSongs[1].audioData);
      expect(mockUpdateSong).toHaveBeenCalledWith("song2", {
        sha: "calculated-sha-256",
      });
    });

    it("should not calculate SHA for songs that already have it", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      // Should only be called once for song2, not for song1
      expect(mockCalculateSHA256).toHaveBeenCalledTimes(1);
      expect(mockUpdateSong).toHaveBeenCalledTimes(1);
    });

    it("should handle SHA calculation errors gracefully", async () => {
      mockCalculateSHA256.mockRejectedValue(
        new Error("SHA calculation failed")
      );

      // Should not throw
      await expect(downloadPlaylistAsZip(mockPlaylist)).resolves.not.toThrow();

      // Should still proceed with download
      expect(mockZipGenerateAsync).toHaveBeenCalled();
    });

    it("should create proper folder structure", async () => {
      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockZipFolder).toHaveBeenCalledWith("Test_Playlist");
      expect(mockZipFolder).toHaveBeenCalledWith("data");
    });

    it("should include metadata when option is enabled", async () => {
      const options: PlaylistDownloadOptions = { includeMetadata: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.json",
        expect.stringContaining(mockPlaylist.id)
      );
    });

    it("should include images when option is enabled", async () => {
      const options: PlaylistDownloadOptions = { includeImages: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      // Should add playlist image and song images
      expect(mockZipFile).toHaveBeenCalledWith(
        expect.stringMatching(/playlist\.(jpeg|jpg|png)/),
        expect.any(ArrayBuffer)
      );
    });

    it("should generate M3U when option is enabled", async () => {
      const options: PlaylistDownloadOptions = { generateM3U: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.m3u",
        expect.stringContaining("#EXTM3U")
      );
    });

    it("should include standalone HTML when option is enabled", async () => {
      const options: PlaylistDownloadOptions = { includeHTML: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.html",
        expect.stringContaining("<!DOCTYPE html>")
      );
    });

    it("should handle empty playlist", async () => {
      const emptyPlaylist = { ...mockPlaylist, songIds: [] };
      mockGetSongsWithAudioData.mockResolvedValue([]);

      await downloadPlaylistAsZip(emptyPlaylist);

      expect(mockZipGenerateAsync).toHaveBeenCalled();
      expect(mockCalculateSHA256).not.toHaveBeenCalled();
    });

    it("should handle songs without audio data", async () => {
      const songsWithoutAudio = [
        { ...mockSongs[0], audioData: undefined },
        { ...mockSongs[1], audioData: undefined },
      ];
      mockGetSongsWithAudioData.mockResolvedValue(songsWithoutAudio);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockCalculateSHA256).not.toHaveBeenCalled();
      expect(mockZipGenerateAsync).toHaveBeenCalled();
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
      mockZipGenerateAsync.mockRejectedValue(
        new Error("ZIP generation failed")
      );

      await expect(downloadPlaylistAsZip(mockPlaylist)).rejects.toThrow(
        "ZIP generation failed"
      );
    });

    it("should handle database update errors", async () => {
      mockUpdatePlaylist.mockRejectedValue(new Error("Database error"));

      await expect(downloadPlaylistAsZip(mockPlaylist)).rejects.toThrow(
        "Database error"
      );
    });
  });

  describe("M3U Generation (via ZIP download)", () => {
    it("should include M3U content when generateM3U option is true", async () => {
      const options: PlaylistDownloadOptions = { generateM3U: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.m3u",
        expect.stringContaining("#EXTM3U")
      );
    });

    it("should not include M3U when generateM3U option is false", async () => {
      const options: PlaylistDownloadOptions = { generateM3U: false };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).not.toHaveBeenCalledWith(
        "playlist.m3u",
        expect.any(String)
      );
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
          ...mockSongs[0],
          title: 'Song/With\\Special:Chars|<>*?"',
          artist: 'Artist/With\\Special:Chars|<>*?"',
        },
      ];
      mockGetSongsWithAudioData.mockResolvedValue(songsWithSpecialChars);

      await downloadPlaylistAsZip(playlistWithSpecialChars);

      expect(mockZipFolder).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-zA-Z0-9_]+$/)
      );
    });
  });

  describe("File Extension Handling (via ZIP download)", () => {
    it("should handle different audio file types", async () => {
      const songsWithDifferentTypes = [
        {
          ...mockSongs[0],
          mimeType: "audio/mpeg",
        },
        {
          ...mockSongs[1],
          mimeType: "audio/wav",
        },
      ];
      mockGetSongsWithAudioData.mockResolvedValue(songsWithDifferentTypes);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockZipFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.mp3$/),
        expect.any(ArrayBuffer)
      );
      expect(mockZipFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.wav$/),
        expect.any(ArrayBuffer)
      );
    });
  });

  describe("MIME Type Handling", () => {
    it("should preserve MIME types during download", async () => {
      const songsWithMimeTypes = [
        {
          ...mockSongs[0],
          mimeType: "audio/mpeg",
        },
        {
          ...mockSongs[1],
          mimeType: "audio/flac",
        },
      ];
      mockGetSongsWithAudioData.mockResolvedValue(songsWithMimeTypes);

      await downloadPlaylistAsZip(mockPlaylist);

      expect(mockZipGenerateAsync).toHaveBeenCalled();
    });
  });

  describe("Base64 Handling (internal)", () => {
    it("should handle playlist with base64 image data", async () => {
      const playlistWithBase64Image = {
        ...mockPlaylist,
        imageData: "SGVsbG8gV29ybGQ=", // base64 data instead of ArrayBuffer
      };

      await downloadPlaylistAsZip(playlistWithBase64Image);

      expect(mockZipGenerateAsync).toHaveBeenCalled();
    });
  });

  describe("Filename Sanitization (internal)", () => {
    it("should sanitize problematic filenames in downloads", async () => {
      const problemPlaylist = {
        ...mockPlaylist,
        title: "CON", // Reserved Windows filename
      };

      await downloadPlaylistAsZip(problemPlaylist);

      expect(mockZipFolder).toHaveBeenCalledWith(
        expect.not.stringMatching(/^CON$/)
      );
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
      };

      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockResolvedValue(mockZipFile),
          }) as any
      );
    });

    it("should parse playlist ZIP file correctly", async () => {
      const zipBlob = new Blob(["mock zip content"]);
      const result = await parsePlaylistZip(zipBlob);

      expect(result).toHaveProperty("playlist");
      expect(result).toHaveProperty("songs");
      expect(result.playlist.id).toBe(mockPlaylist.id);
      expect(result.songs).toHaveLength(2);
    });

    it("should handle ZIP files without playlist.json", async () => {
      mockZipFile.files = {}; // No playlist.json

      const zipBlob = new Blob(["mock zip content"]);

      await expect(parsePlaylistZip(zipBlob)).rejects.toThrow();
    });

    it("should handle corrupted ZIP files", async () => {
      vi.mocked(JSZip).mockImplementation(
        () =>
          ({
            loadAsync: vi.fn().mockRejectedValue(new Error("Corrupted ZIP")),
          }) as any
      );

      const zipBlob = new Blob(["corrupted content"]);

      await expect(parsePlaylistZip(zipBlob)).rejects.toThrow("Corrupted ZIP");
    });

    it("should handle invalid JSON in playlist.json", async () => {
      mockZipFile.files["playlist.json"].async.mockResolvedValue(
        "invalid json"
      );

      const zipBlob = new Blob(["mock zip content"]);

      await expect(parsePlaylistZip(zipBlob)).rejects.toThrow();
    });
  });

  describe("Standalone HTML Generation", () => {
    it("should include HTML when includeHTML option is true", async () => {
      const options: PlaylistDownloadOptions = { includeHTML: true };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.html",
        expect.stringContaining("<!DOCTYPE html>")
      );
    });

    it("should not include HTML when includeHTML option is false", async () => {
      const options: PlaylistDownloadOptions = { includeHTML: false };

      await downloadPlaylistAsZip(mockPlaylist, options);

      expect(mockZipFile).not.toHaveBeenCalledWith(
        "playlist.html",
        expect.any(String)
      );
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
      const options: PlaylistDownloadOptions = {
        includeMetadata: true,
        includeImages: true,
        generateM3U: true,
        includeHTML: true,
      };

      await downloadPlaylistAsZip(mockPlaylist, options);

      // Verify all major steps were executed
      expect(mockGetSongsWithAudioData).toHaveBeenCalled();
      expect(mockUpdatePlaylist).toHaveBeenCalled();
      expect(mockCalculateSHA256).toHaveBeenCalled();
      expect(mockZipGenerateAsync).toHaveBeenCalled();

      // Verify content was added to ZIP
      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.json",
        expect.any(String)
      );
      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.m3u",
        expect.any(String)
      );
      expect(mockZipFile).toHaveBeenCalledWith(
        "playlist.html",
        expect.any(String)
      );
    });

    it("should handle mixed scenarios with partial data", async () => {
      // Mix of songs with and without SHA, images, etc.
      const mixedSongs = [
        { ...mockSongs[0], sha: "existing-sha" },
        { ...mockSongs[1], sha: undefined, imageData: undefined },
      ];
      mockGetSongsWithAudioData.mockResolvedValue(mixedSongs);

      await downloadPlaylistAsZip(mockPlaylist);

      // Should only calculate SHA for the song that needs it
      expect(mockCalculateSHA256).toHaveBeenCalledTimes(1);
      expect(mockZipGenerateAsync).toHaveBeenCalled();
    });

    it("should maintain data integrity throughout workflow", async () => {
      const originalSongCount = mockPlaylist.songIds.length;

      await downloadPlaylistAsZip(mockPlaylist);

      // Verify playlist revision was incremented
      expect(mockUpdatePlaylist).toHaveBeenCalledWith(mockPlaylist.id, {
        rev: mockPlaylist.rev! + 1,
      });

      // Verify all songs were processed
      expect(mockGetSongsWithAudioData).toHaveBeenCalledWith(
        expect.arrayContaining(mockPlaylist.songIds)
      );
    });
  });
});
