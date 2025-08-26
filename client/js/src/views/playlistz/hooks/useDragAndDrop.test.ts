import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { useDragAndDrop } from "./useDragAndDrop.js";
import { createMockFile } from "../test-setup.js";
import type { Playlist } from "../types/playlist.js";

// Mock the services
vi.mock("../services/fileProcessingService.js", () => ({
  filterAudioFiles: vi.fn((files) =>
    Array.from(files).filter((f) => f.type.startsWith("audio/"))
  ),
}));

vi.mock("../services/playlistDownloadService.js", () => ({
  parsePlaylistZip: vi.fn(),
}));

vi.mock("../services/indexedDBService.js", () => ({
  createPlaylist: vi.fn(),
  addSongToPlaylist: vi.fn(),
}));

// Mock DataTransfer for DragEvent
class MockDataTransfer {
  files: FileList;
  items: DataTransferItemList;
  dropEffect: string = "none";
  effectAllowed: string = "all";

  constructor(files: File[] = []) {
    this.files = this.createFileList(files);
    this.items = this.createDataTransferItemList(files);
  }

  createFileList(files: File[]): FileList {
    const fileList = files as any;
    fileList.length = files.length;
    fileList.item = (index: number) => files[index] || null;
    return fileList;
  }

  createDataTransferItemList(files: File[]): DataTransferItemList {
    const items = files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
      getAsString: vi.fn(),
    }));

    return {
      length: items.length,
      ...items,
      add: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    } as any;
  }

  getData(format: string): string {
    return "";
  }

  setData(format: string, data: string): void {}
}

// Create mock DragEvent
function createMockDragEvent(type: string, files: File[] = []): DragEvent {
  const event = new Event(type) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: new MockDataTransfer(files),
    writable: false,
  });
  Object.defineProperty(event, "preventDefault", {
    value: vi.fn(),
    writable: false,
  });
  Object.defineProperty(event, "stopPropagation", {
    value: vi.fn(),
    writable: false,
  });
  Object.defineProperty(event, "currentTarget", {
    value: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
      }),
    },
    writable: false,
  });
  Object.defineProperty(event, "clientX", {
    value: 400,
    writable: true,
  });
  Object.defineProperty(event, "clientY", {
    value: 300,
    writable: true,
  });
  return event;
}

describe("useDragAndDrop", () => {
  let dispose: () => void;
  let hook: ReturnType<typeof useDragAndDrop>;

  beforeEach(() => {
    vi.clearAllMocks();

    createRoot((disposeFn) => {
      dispose = disposeFn;
      hook = useDragAndDrop();
    });
  });

  afterEach(() => {
    if (dispose) {
      dispose();
    }
  });

  describe("basic functionality", () => {
    it("should initialize with correct default state", () => {
      expect(hook.isDragOver()).toBe(false);
      expect(hook.error()).toBeNull();
      expect(hook.dragInfo().type).toBe("unknown");
    });

    it("should handle drag enter correctly", () => {
      const audioFile = createMockFile(["audio data"], "song.mp3", {
        type: "audio/mp3",
      });
      const dragEvent = createMockDragEvent("dragenter", [audioFile]);

      hook.handleDragEnter(dragEvent);

      expect(hook.isDragOver()).toBe(true);
      expect(hook.dragInfo().type).toBe("audio-files");
    });
  });

  describe("bug reproduction - async error handling", () => {
    it("should reproduce stuck overlay when handleDrop throws unhandled error", async () => {
      // This test reproduces the actual bug: when the main component's
      // handleFileDrop function throws an error, the drag overlay gets stuck

      const { addSongToPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      // Mock service to throw an error
      vi.mocked(addSongToPlaylist).mockRejectedValue(
        new Error("Database connection failed")
      );

      const audioFile = createMockFile(["audio data"], "song.mp3", {
        type: "audio/mp3",
      });

      // Step 1: Start drag
      const enterEvent = createMockDragEvent("dragenter", [audioFile]);
      hook.handleDragEnter(enterEvent);
      expect(hook.isDragOver()).toBe(true);

      // Step 2: Simulate the main component's handleFileDrop wrapper
      const simulateMainComponentHandleDrop = async (e: DragEvent) => {
        // This simulates the wrapper function in the main component
        // that calls handleDrop but has no error handling
        await hook.handleDrop(e, {
          selectedPlaylist: {
            id: "test-playlist",
            title: "Test Playlist",
            description: "",
            songIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          playlists: [],
          onPlaylistCreated: () => {},
          onPlaylistSelected: () => {},
        });
      };

      // Step 3: Drop files
      const dropEvent = createMockDragEvent("drop", [audioFile]);

      // The main component wrapper should throw an error
      await expect(simulateMainComponentHandleDrop(dropEvent)).rejects.toThrow(
        "Database connection failed"
      );

      // BUG: Even though handleDrop sets isDragOver to false at the start,
      // if there's an unhandled error in the wrapper, the user sees a stuck overlay
      // because the error interrupts the async flow

      // The hook itself correctly sets isDragOver to false
      expect(hook.isDragOver()).toBe(false);

      // But the error is set
      expect(hook.error()).toBe("Failed to process dropped files");

      // This demonstrates that the hook works correctly, but the integration
      // layer (main component) needs error handling
    });

    it("should work correctly when wrapper has proper error handling", async () => {
      const { addSongToPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      // Mock service to succeed
      vi.mocked(addSongToPlaylist).mockResolvedValue({
        id: "test-song",
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        duration: 180,
        position: 0,
        playlistId: "test-playlist",
        fileSize: 1024,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const audioFile = createMockFile(["audio data"], "song.mp3", {
        type: "audio/mp3",
      });

      // Start drag
      const enterEvent = createMockDragEvent("dragenter", [audioFile]);
      hook.handleDragEnter(enterEvent);
      expect(hook.isDragOver()).toBe(true);

      // Simulate main component wrapper WITH error handling
      const simulateFixedMainComponentHandleDrop = async (e: DragEvent) => {
        try {
          await hook.handleDrop(e, {
            selectedPlaylist: {
              id: "test-playlist",
              title: "Test Playlist",
              description: "",
              songIds: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            playlists: [],
            onPlaylistCreated: () => {},
            onPlaylistSelected: () => {},
          });
        } catch (error) {
          // Proper error handling ensures drag state is cleared
          hook.setIsDragOver(false);
          throw error;
        }
      };

      // Drop files
      const dropEvent = createMockDragEvent("drop", [audioFile]);
      await simulateFixedMainComponentHandleDrop(dropEvent);

      // Should work correctly
      expect(hook.isDragOver()).toBe(false);
      expect(hook.error()).toBeNull();
    });
  });

  describe("integration with empty callbacks", () => {
    it("should handle drop with empty callbacks but may not update UI", async () => {
      const { createPlaylist, addSongToPlaylist } = await import(
        "../services/indexedDBService.js"
      );

      vi.mocked(createPlaylist).mockResolvedValue({
        id: "new-playlist",
        title: "New Playlist",
        description: "Created from 1 dropped file",
        songIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      vi.mocked(addSongToPlaylist).mockResolvedValue({
        id: "test-song",
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album",
        duration: 180,
        position: 0,
        playlistId: "new-playlist",
        fileSize: 1024,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const audioFile = createMockFile(["audio data"], "song.mp3", {
        type: "audio/mp3",
      });

      // Start drag
      const enterEvent = createMockDragEvent("dragenter", [audioFile]);
      hook.handleDragEnter(enterEvent);

      // Drop with empty callbacks (reproducing the main component's current state)
      const dropEvent = createMockDragEvent("drop", [audioFile]);
      await hook.handleDrop(dropEvent, {
        selectedPlaylist: null,
        playlists: [],
        onPlaylistCreated: () => {
          // Empty callback - playlist created but UI doesn't know about it
        },
        onPlaylistSelected: () => {
          // Empty callback - playlist not selected in UI
        },
      });

      // Hook works correctly
      expect(hook.isDragOver()).toBe(false);
      expect(hook.error()).toBeNull();

      // Services were called correctly
      expect(createPlaylist).toHaveBeenCalled();
      expect(addSongToPlaylist).toHaveBeenCalled();

      // But UI state may not be updated due to empty callbacks
      // This is the integration issue - the hook works but UI doesn't reflect changes
    });
  });
});
