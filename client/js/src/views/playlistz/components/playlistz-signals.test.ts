import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";

// Mock IndexedDB Service
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false),
  },
};

vi.mock("idb", () => ({
  openDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// Mock services
vi.mock("../services/audioService.js", () => ({
  cleanup: vi.fn(),
}));

vi.mock("../utils/timeUtils.js", () => ({
  cleanupTimeUtils: vi.fn(),
}));

vi.mock("../services/fileProcessingService.js", () => ({
  filterAudioFiles: vi.fn((files) => Array.from(files)),
  processAudioFiles: vi.fn(async (files) =>
    files.map((file: File) => ({
      success: true,
      song: {
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "Test Artist",
        album: "Test Album",
        duration: 180,
        image: null,
        file,
      },
    }))
  ),
}));

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto.randomUUID
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(() => "test-uuid-123"),
  },
  writable: true,
});

import {
  setupDB,
  createPlaylistsQuery,
  addSongToPlaylist,
  createPlaylist,
} from "../services/indexedDBService.js";
import { usePlaylistsQuery } from "../hooks/usePlaylistsQuery.js";

describe("Playlistz Signal-Based Logic Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup successful transaction mocks
    mockDB.transaction.mockReturnValue({
      objectStore: vi.fn(() => ({
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        index: vi.fn(() => ({
          openCursor: vi.fn(() => Promise.resolve(null)),
        })),
      })),
      done: Promise.resolve(),
    });

    mockDB.getAll.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Playlist Signal Reactivity", () => {
    it("should create reactive playlist query signal", async () => {
      let dispose: any;
      let querySignal: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          querySignal = usePlaylistsQuery();

          // Initial value should be empty array
          expect(querySignal()).toEqual([]);
          resolve();
        });
      });

      dispose?.();
    });

    it("should update signal when playlists change", async () => {
      const mockPlaylists = [
        {
          id: "playlist-1",
          title: "Test Playlist",
          description: "Test",
          songIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Mock the service to return playlists
      mockDB.getAll.mockResolvedValue(mockPlaylists);

      let dispose: any;
      let querySignal: any;

      await new Promise<void>((resolve) => {
        createRoot(async (disposeRoot) => {
          dispose = disposeRoot;
          querySignal = createPlaylistsQuery();

          // Wait for async query to complete
          setTimeout(() => {
            const result = querySignal();
            expect(result).toEqual(mockPlaylists);
            resolve();
          }, 100);
        });
      });

      dispose?.();
    });
  });

  describe("Playlist Creation Logic", () => {
    it("should create playlist with proper structure", async () => {
      const mockPlaylist = {
        id: "test-uuid-123",
        title: "My New Playlist",
        description: "Created automatically",
        songIds: [],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      };

      const result = await createPlaylist({
        title: "My New Playlist",
        description: "Created automatically",
        songIds: [],
      });

      expect(result).toMatchObject(mockPlaylist);
    });

    it("should handle playlist creation errors gracefully", async () => {
      // Mock transaction failure
      mockDB.transaction.mockImplementation(() => {
        throw new Error("Database error");
      });

      await expect(
        createPlaylist({
          title: "Test",
          description: "",
          songIds: [],
        })
      ).rejects.toThrow("Database error");
    });
  });

  describe("File Processing Workflow", () => {
    it("should process audio files and add to playlist", async () => {
      const mockFile = new File(["audio data"], "test.mp3", {
        type: "audio/mpeg",
      });

      const mockPlaylist = {
        id: "playlist-1",
        title: "Test Playlist",
        description: "",
        songIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create playlist first
      const playlist = await createPlaylist(mockPlaylist);

      // Process file and add to playlist
      const { processAudioFiles } = await import("../services/fileProcessingService.js");
      const processedFiles = await processAudioFiles([mockFile]);

      expect(processedFiles).toHaveLength(1);
      expect(processedFiles[0].success).toBe(true);
      expect(processedFiles[0].song.title).toBe("test");

      // Add song to playlist
      await addSongToPlaylist(playlist.id, processedFiles[0].song);

      // Verify the song was added (mocked)
      expect(mockDB.transaction).toHaveBeenCalled();
    });

    it("should handle file processing errors", async () => {
      const { processAudioFiles } = await import("../services/fileProcessingService.js");

      // Mock processAudioFiles to return error
      vi.mocked(processAudioFiles).mockResolvedValue([
        {
          success: false,
          error: "Invalid file format",
          song: null as any,
        },
      ]);

      const mockFile = new File(["invalid data"], "test.txt", {
        type: "text/plain",
      });

      const result = await processAudioFiles([mockFile]);

      expect(result[0].success).toBe(false);
      expect(result[0].error).toBe("Invalid file format");
    });
  });

  describe("Signal Updates and Reactivity", () => {
    it("should track signal changes over time", async () => {
      let dispose: any;
      let signalValues: any[] = [];

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;

          // Create a signal that tracks playlist count
          const [count, setCount] = createSignal(0);

          // Track signal changes
          const untrack = createRoot(() => {
            // Effect to track changes
            const trackChanges = () => {
              signalValues.push(count());
            };

            trackChanges(); // Initial value

            return () => {};
          });

          // Simulate playlist additions
          setCount(1);
          setCount(2);
          setCount(0);

          setTimeout(() => {
            expect(signalValues).toEqual([0, 1, 2, 0]);
            resolve();
          }, 50);
        });
      });

      dispose?.();
    });

    it("should handle rapid signal updates efficiently", async () => {
      let dispose: any;
      let updateCount = 0;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;

          const [value, setValue] = createSignal(0);

          // Track how many times signal updates
          createRoot(() => {
            const track = () => {
              value(); // Access signal
              updateCount++;
            };

            track(); // Initial access

            return () => {};
          });

          // Rapid updates
          for (let i = 1; i <= 10; i++) {
            setValue(i);
          }

          setTimeout(() => {
            // Should have tracked initial + 10 updates = 11 total
            expect(updateCount).toBe(11);
            resolve();
          }, 50);
        });
      });

      dispose?.();
    });
  });

  describe("Error State Management", () => {
    it("should create error signal that auto-clears", async () => {
      let dispose: any;
      let errorStates: (string | null)[] = [];

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;

          const [error, setError] = createSignal<string | null>(null);

          // Track error state changes
          createRoot(() => {
            const track = () => {
              errorStates.push(error());
            };

            track(); // Initial state

            return () => {};
          });

          // Set error
          setError("Database connection failed");

          // Simulate auto-clear after timeout
          setTimeout(() => {
            setError(null);
          }, 100);

          setTimeout(() => {
            expect(errorStates).toEqual([
              null,
              "Database connection failed",
              null
            ]);
            resolve();
          }, 150);
        });
      });

      dispose?.();
    });
  });

  describe("Database Initialization", () => {
    it("should initialize database successfully", async () => {
      const result = await setupDB();
      expect(result).toBeUndefined(); // setupDB returns void on success
    });

    it("should handle database initialization failure", async () => {
      const { openDB } = await import("idb");
      vi.mocked(openDB).mockRejectedValue(new Error("IndexedDB not available"));

      await expect(setupDB()).rejects.toThrow("IndexedDB not available");
    });

    it("should track database call efficiency", async () => {
      const { openDB } = await import("idb");

      // Multiple calls should be cached
      await setupDB();
      await setupDB();
      await setupDB();

      // Should only call openDB once due to caching
      expect(vi.mocked(openDB)).toHaveBeenCalledTimes(1);
    });
  });

  describe("Component State Logic", () => {
    it("should manage drag state properly", async () => {
      let dispose: any;
      let dragStates: boolean[] = [];

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;

          const [isDragOver, setIsDragOver] = createSignal(false);

          // Track drag state changes
          createRoot(() => {
            const track = () => {
              dragStates.push(isDragOver());
            };

            track(); // Initial state

            return () => {};
          });

          // Simulate drag events
          setIsDragOver(true);  // Drag enter
          setIsDragOver(false); // Drag leave
          setIsDragOver(true);  // Drag enter again
          setIsDragOver(false); // Final drag leave

          setTimeout(() => {
            expect(dragStates).toEqual([false, true, false, true, false]);
            resolve();
          }, 50);
        });
      });

      dispose?.();
    });

    it("should manage selected playlist state", async () => {
      let dispose: any;
      let selectionStates: any[] = [];

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;

          const [selectedPlaylist, setSelectedPlaylist] = createSignal(null);

          // Track selection changes
          createRoot(() => {
            const track = () => {
              selectionStates.push(selectedPlaylist());
            };

            track(); // Initial state

            return () => {};
          });

          const mockPlaylist = {
            id: "playlist-1",
            title: "Test Playlist",
            description: "",
            songIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Select playlist
          setSelectedPlaylist(mockPlaylist);

          // Deselect
          setSelectedPlaylist(null);

          setTimeout(() => {
            expect(selectionStates).toEqual([null, mockPlaylist, null]);
            resolve();
          }, 50);
        });
      });

      dispose?.();
    });
  });
});
