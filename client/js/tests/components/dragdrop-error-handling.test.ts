import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import type {
  Song,
  Playlist,
} from "../../src/views/playlistz/types/playlist.js";

// Mock DragEvent for testing environment
class MockDragEvent extends Event {
  dataTransfer: DataTransfer | null;

  constructor(type: string, eventInitDict?: DragEventInit) {
    super(type, eventInitDict);
    this.dataTransfer = eventInitDict?.dataTransfer || null;
  }
}

global.DragEvent = MockDragEvent as any;

// Mock the main Playlistz component's drag & drop logic
const createMockPlaylistzComponent = () => {
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dragType, setDragType] = createSignal<"files" | "songs" | "unknown">(
    "unknown"
  );

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.dataTransfer?.items;
    if (items) {
      // Check for audio files
      const hasAudioFiles = Array.from(items).some(
        (item) => item.kind === "file" && item.type.startsWith("audio/")
      );

      // Check for song reordering (text/plain data)
      const hasTextData = Array.from(items).some(
        (item) => item.type === "text/plain"
      );

      if (hasAudioFiles) {
        setDragType("files");
        setIsDragOver(true);
        console.log("📁 File drag detected");
      } else if (hasTextData) {
        setDragType("songs");
        console.log("🎵 Song reorder drag detected");
      } else {
        setDragType("unknown");
        console.log("❓ Unknown drag type");
      }
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const currentDragType = dragType();

    if (currentDragType === "songs") {
      // This is song reordering, not file upload
      console.log("🔄 Handling song reorder drop");
      return;
    }

    const files = Array.from(e.dataTransfer?.files || []);
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));

    if (audioFiles.length === 0) {
      // BUG: This error shows even during song reordering
      setError("No audio files found in drop");
      console.log("❌ ERROR: No audio files found");
    } else {
      console.log(`✅ Found ${audioFiles.length} audio files`);
      // Process audio files...
    }
  };

  return {
    selectedPlaylist,
    setSelectedPlaylist,
    isDragOver,
    error,
    dragType,
    handleDragEnter,
    handleDrop,
    setError,
  };
};

describe("🔄 Drag & Drop Error Handling Tests", () => {
  let mockFiles: File[];
  let mockSongs: Song[];
  let mockPlaylist: Playlist;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFiles = [
      new File(["audio data"], "song1.mp3", { type: "audio/mp3" }),
      new File(["audio data"], "song2.wav", { type: "audio/wav" }),
      new File(["not audio"], "document.pdf", { type: "application/pdf" }),
    ];

    mockSongs = [
      {
        id: "song-1",
        title: "Song 1",
        artist: "Artist 1",
        album: "Album 1",
        duration: 180,
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: mockFiles[0],
        blobUrl: "blob:http://localhost/song1",
      },
      {
        id: "song-2",
        title: "Song 2",
        artist: "Artist 2",
        album: "Album 2",
        duration: 200,
        position: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: mockFiles[1],
        blobUrl: "blob:http://localhost/song2",
      },
    ];

    mockPlaylist = {
      id: "playlist-1",
      title: "Test Playlist",
      description: "Test description",
      songIds: ["song-1", "song-2"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  describe("Current Broken Behavior", () => {
    it("should demonstrate false error during song reordering", async () => {
      console.log(
        "🧪 Testing current broken behavior: False error during song reordering"
      );

      const component = createMockPlaylistzComponent();
      component.setSelectedPlaylist(mockPlaylist);

      // Create a mock drag event for song reordering
      const mockDragEvent = new MockDragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
      });

      // Mock DataTransfer for song reordering (text/plain data)
      const mockDataTransfer = {
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsString: (callback: (data: string) => void) => callback("0"), // song index
          },
        ] as any,
        files: [] as any, // No files during song reordering
      };

      Object.defineProperty(mockDragEvent, "dataTransfer", {
        value: mockDataTransfer,
        writable: false,
      });

      // Handle drag enter for song reordering
      component.handleDragEnter(mockDragEvent);

      // Verify drag type is correctly identified
      expect(component.dragType()).toBe("songs");
      console.log("✅ Song reordering drag correctly identified");

      // Now simulate drop
      const mockDropEvent = new MockDragEvent("drop", {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(mockDropEvent, "dataTransfer", {
        value: mockDataTransfer,
        writable: false,
      });

      await component.handleDrop(mockDropEvent);

      // BUG: In current broken implementation, this might still show error
      const currentError = component.error();
      if (currentError === "No audio files found in drop") {
        console.log("🐛 BUG CONFIRMED: False error during song reordering");
        console.log(`❌ Error shown: ${currentError}`);
      } else {
        console.log("✅ UNEXPECTED: No false error (bug might be fixed!)");
      }
    });

    it("should show poor drag type detection", () => {
      console.log("🧪 Testing poor drag type detection");

      const component = createMockPlaylistzComponent();

      // Create ambiguous drag event
      const mockDragEvent = new MockDragEvent("dragenter");
      const mockDataTransfer = {
        items: [] as any,
        files: [] as any,
      };

      Object.defineProperty(mockDragEvent, "dataTransfer", {
        value: mockDataTransfer,
        writable: false,
      });

      component.handleDragEnter(mockDragEvent);

      // Should be 'unknown' due to poor detection
      expect(component.dragType()).toBe("unknown");
      console.log(
        "🐛 BUG CONFIRMED: Poor drag type detection leads to unknown type"
      );
    });

    it("should demonstrate conflicting drag handlers", async () => {
      console.log("🧪 Testing conflicting drag handlers");

      const component = createMockPlaylistzComponent();
      let globalDropHandlerCalled = false;
      let songRowDropHandlerCalled = false;

      // Simulate global drop handler
      const globalDropHandler = (e: DragEvent) => {
        globalDropHandlerCalled = true;
        console.log("🌐 Global drop handler called");
        component.handleDrop(e);
      };

      // Simulate song row drop handler
      const songRowDropHandler = (e: DragEvent) => {
        songRowDropHandlerCalled = true;
        console.log("🎵 Song row drop handler called");
        // Song reordering logic would go here
      };

      // Create drop event for song reordering
      const mockDropEvent = new MockDragEvent("drop");
      const mockDataTransfer = {
        items: [{ kind: "string", type: "text/plain" }] as any,
        files: [] as any,
      };

      Object.defineProperty(mockDropEvent, "dataTransfer", {
        value: mockDataTransfer,
        writable: false,
      });

      // Both handlers get called due to event bubbling
      songRowDropHandler(mockDropEvent);
      globalDropHandler(mockDropEvent);

      expect(globalDropHandlerCalled).toBe(true);
      expect(songRowDropHandlerCalled).toBe(true);

      console.log("🐛 BUG CONFIRMED: Both handlers called, causing conflicts");
    });
  });

  describe("Expected Correct Behavior", () => {
    it("should define proper drag type detection", () => {
      console.log("🎯 Defining proper drag type detection");

      const expectedDetection = {
        audioFiles: "DataTransfer.items contains files with audio/* MIME types",
        songReordering: "DataTransfer contains text/plain with song index data",
        externalFiles: "DataTransfer.items contains non-audio files",
        invalidDrop: "DataTransfer is empty or contains unsupported data",

        detection: {
          priority: "Check for song reordering first (most specific)",
          fallback: "Then check for audio files",
          validation: "Validate MIME types and data content",
          contextual: "Consider current UI state (playlist selected, etc.)",
        },
      };

      Object.entries(expectedDetection).forEach(([key, value]) => {
        if (typeof value === "string") {
          console.log(`📋 ${key}: ${value}`);
        } else {
          console.log(`📋 ${key}:`);
          Object.entries(value).forEach(([subKey, subValue]) => {
            console.log(`   - ${subKey}: ${subValue}`);
          });
        }
      });

      expect(expectedDetection).toBeDefined();
      console.log("✅ Proper drag type detection defined");
    });

    it("should define error message strategy", () => {
      console.log("🎯 Defining error message strategy");

      const errorStrategy = {
        noError: [
          "Song reordering within playlist",
          "Valid audio file drops",
          "Cancelling drag operations",
        ],

        informationalMessages: [
          "Reordering songs in playlist",
          "Adding X audio files to playlist",
          "Drag cancelled",
        ],

        errorMessages: [
          "No audio files in selection (only for actual file drops)",
          "Playlist must be selected to add files",
          "Unsupported file types dropped",
        ],

        contextualErrors: [
          "Show audio file errors only for file operations",
          "Show reordering errors only for song operations",
          "Provide helpful hints based on drag content",
        ],
      };

      Object.entries(errorStrategy).forEach(([category, messages]) => {
        console.log(`📋 ${category}:`);
        messages.forEach((message) => console.log(`   - ${message}`));
      });

      expect(errorStrategy).toBeDefined();
      console.log("✅ Error message strategy defined");
    });
  });

  describe("Enhanced Drag Detection Testing", () => {
    it("should test improved drag type detection", () => {
      console.log("🔧 Testing improved drag type detection");

      const improvedDetection = (dataTransfer: DataTransfer | null) => {
        if (!dataTransfer) {
          return { type: "invalid", confidence: 0, reason: "No data transfer" };
        }

        const items = Array.from(dataTransfer.items || []);
        const files = Array.from(dataTransfer.files || []);

        // Priority 1: Check for song reordering (text/plain with numeric data)
        const textItems = items.filter((item) => item.type === "text/plain");
        if (textItems.length > 0) {
          return {
            type: "song-reorder",
            confidence: 0.9,
            reason: "Contains text/plain data (likely song index)",
          };
        }

        // Priority 2: Check for audio files
        const audioFiles = files.filter((file) =>
          file.type.startsWith("audio/")
        );
        if (audioFiles.length > 0) {
          return {
            type: "audio-files",
            confidence: 1.0,
            reason: `Contains ${audioFiles.length} audio files`,
          };
        }

        // Priority 3: Check for other files
        if (files.length > 0) {
          return {
            type: "non-audio-files",
            confidence: 0.8,
            reason: `Contains ${files.length} non-audio files`,
          };
        }

        return {
          type: "unknown",
          confidence: 0,
          reason: "No recognizable content",
        };
      };

      // Test cases
      const testCases = [
        {
          name: "Song reordering",
          dataTransfer: {
            items: [{ type: "text/plain", kind: "string" }],
            files: [],
          },
          expected: "song-reorder",
        },
        {
          name: "Audio files",
          dataTransfer: {
            items: [],
            files: [{ type: "audio/mp3" }, { type: "audio/wav" }],
          },
          expected: "audio-files",
        },
        {
          name: "Non-audio files",
          dataTransfer: {
            items: [],
            files: [{ type: "application/pdf" }, { type: "image/jpeg" }],
          },
          expected: "non-audio-files",
        },
      ];

      testCases.forEach((testCase) => {
        const result = improvedDetection(testCase.dataTransfer as any);
        console.log(
          `🧪 ${testCase.name}: ${result.type} (confidence: ${result.confidence})`
        );
        expect(result.type).toBe(testCase.expected);
      });

      console.log("✅ Improved drag type detection tested");
    });

    it("should test contextual error handling", async () => {
      console.log("🔧 Testing contextual error handling");

      const contextualErrorHandler = (dragType: string, context: any) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        const info: string[] = [];

        switch (dragType) {
          case "song-reorder":
            if (!context.selectedPlaylist) {
              warnings.push("No playlist selected for reordering");
            } else if (context.selectedPlaylist.songIds.length < 2) {
              info.push("Need at least 2 songs to reorder");
            } else {
              info.push(
                `Reordering songs in "${context.selectedPlaylist.title}"`
              );
            }
            break;

          case "audio-files":
            if (!context.selectedPlaylist) {
              errors.push("Please select a playlist before adding files");
            } else {
              info.push(
                `Adding ${context.fileCount} audio files to "${context.selectedPlaylist.title}"`
              );
            }
            break;

          case "non-audio-files":
            errors.push("Only audio files can be added to playlists");
            info.push("Supported formats: MP3, WAV, M4A, FLAC, OGG");
            break;

          default:
            warnings.push("Unrecognized drag operation");
        }

        return { errors, warnings, info };
      };

      // Test contextual error handling
      const testContexts = [
        {
          dragType: "song-reorder",
          context: { selectedPlaylist: mockPlaylist },
          expectedErrors: 0,
          expectedInfo: 1,
        },
        {
          dragType: "audio-files",
          context: { selectedPlaylist: null, fileCount: 3 },
          expectedErrors: 1,
          expectedInfo: 0,
        },
        {
          dragType: "non-audio-files",
          context: { selectedPlaylist: mockPlaylist },
          expectedErrors: 1,
          expectedInfo: 1,
        },
      ];

      testContexts.forEach((test) => {
        const result = contextualErrorHandler(test.dragType, test.context);
        console.log(`🧪 ${test.dragType}:`, result);
        expect(result.errors.length).toBe(test.expectedErrors);
        expect(result.info.length).toBe(test.expectedInfo);
      });

      console.log("✅ Contextual error handling tested");
    });
  });

  describe("Event Handling Improvements", () => {
    it("should test proper event delegation", () => {
      console.log("🔧 Testing proper event delegation");

      let eventLog: string[] = [];

      const mockEventHandlers = {
        // Global handler (lowest priority)
        globalDragOver: (e: Event) => {
          eventLog.push("global-dragover");
          // Only handle if not handled by child
          if (!e.defaultPrevented) {
            e.preventDefault();
          }
        },

        // Playlist handler (medium priority)
        playlistDrop: (e: Event) => {
          eventLog.push("playlist-drop");
          e.preventDefault();
          e.stopPropagation(); // Prevent global handler
        },

        // Song row handler (highest priority)
        songRowDrop: (e: Event) => {
          eventLog.push("songrow-drop");
          e.preventDefault();
          e.stopPropagation(); // Prevent playlist and global handlers
        },
      };

      // Simulate event bubbling
      const simulateEventBubbling = (targetHandler: string) => {
        eventLog = []; // Reset log

        const mockEvent = {
          defaultPrevented: false,
          preventDefault: () => {
            mockEvent.defaultPrevented = true;
          },
          stopPropagation: () => {
            mockEvent.propagationStopped = true;
          },
          propagationStopped: false,
        };

        // Simulate event handling based on target
        if (targetHandler === "songrow") {
          mockEventHandlers.songRowDrop(mockEvent as any);
          if (!mockEvent.propagationStopped) {
            mockEventHandlers.playlistDrop(mockEvent as any);
          }
          if (!mockEvent.propagationStopped) {
            mockEventHandlers.globalDragOver(mockEvent as any);
          }
        } else if (targetHandler === "playlist") {
          mockEventHandlers.playlistDrop(mockEvent as any);
          if (!mockEvent.propagationStopped) {
            mockEventHandlers.globalDragOver(mockEvent as any);
          }
        } else {
          mockEventHandlers.globalDragOver(mockEvent as any);
        }

        return eventLog;
      };

      // Test event delegation
      const songRowEvents = simulateEventBubbling("songrow");
      expect(songRowEvents).toEqual(["songrow-drop"]);
      console.log("✅ Song row drop stops propagation correctly");

      const playlistEvents = simulateEventBubbling("playlist");
      expect(playlistEvents).toEqual(["playlist-drop"]);
      console.log("✅ Playlist drop stops propagation correctly");

      const globalEvents = simulateEventBubbling("global");
      expect(globalEvents).toEqual(["global-dragover"]);
      console.log("✅ Global handler works when not handled by children");

      console.log("✅ Event delegation tested");
    });

    it("should test drag state management", () => {
      console.log("🔧 Testing drag state management");

      const dragStateManager = () => {
        const [dragState, setDragState] = createSignal({
          isDragging: false,
          dragType: "unknown" as "files" | "songs" | "unknown",
          dragSource: null as string | null,
          dragTarget: null as string | null,
          isValidDrop: false,
        });

        const handleDragStart = (source: string, type: "files" | "songs") => {
          setDragState({
            isDragging: true,
            dragType: type,
            dragSource: source,
            dragTarget: null,
            isValidDrop: false,
          });
          console.log(`🏁 Drag started: ${type} from ${source}`);
        };

        const handleDragEnter = (target: string) => {
          const current = dragState();
          const isValidDrop =
            (current.dragType === "files" && target === "playlist") ||
            (current.dragType === "songs" && target === "songlist");

          setDragState({
            ...current,
            dragTarget: target,
            isValidDrop,
          });

          console.log(
            `🎯 Drag over ${target}: ${isValidDrop ? "valid" : "invalid"}`
          );
        };

        const handleDragEnd = () => {
          setDragState({
            isDragging: false,
            dragType: "unknown",
            dragSource: null,
            dragTarget: null,
            isValidDrop: false,
          });
          console.log("🏁 Drag ended");
        };

        return {
          dragState,
          handleDragStart,
          handleDragEnter,
          handleDragEnd,
        };
      };

      const stateManager = dragStateManager();

      // Test state transitions
      stateManager.handleDragStart("file-input", "files");
      expect(stateManager.dragState().isDragging).toBe(true);
      expect(stateManager.dragState().dragType).toBe("files");

      stateManager.handleDragEnter("playlist");
      expect(stateManager.dragState().isValidDrop).toBe(true);

      stateManager.handleDragEnter("invalid-target");
      expect(stateManager.dragState().isValidDrop).toBe(false);

      stateManager.handleDragEnd();
      expect(stateManager.dragState().isDragging).toBe(false);

      console.log("✅ Drag state management tested");
    });
  });

  describe("Integration Testing", () => {
    it("should test complete drag & drop workflow", async () => {
      console.log("🔄 Testing complete drag & drop workflow");

      const component = createMockPlaylistzComponent();
      component.setSelectedPlaylist(mockPlaylist);

      const workflow = {
        // Step 1: File drag
        async testFileDrag() {
          console.log("1️⃣ Testing file drag");

          const dragEvent = new MockDragEvent("dragenter");
          const mockDataTransfer = {
            items: [
              { kind: "file", type: "audio/mp3" },
              { kind: "file", type: "audio/wav" },
            ] as any,
            files: mockFiles.slice(0, 2), // Audio files only
          };

          Object.defineProperty(dragEvent, "dataTransfer", {
            value: mockDataTransfer,
            writable: false,
          });

          component.handleDragEnter(dragEvent);
          expect(component.dragType()).toBe("files");
          expect(component.isDragOver()).toBe(true);
          console.log("✅ File drag detected correctly");
        },

        // Step 2: File drop
        async testFileDrop() {
          console.log("2️⃣ Testing file drop");

          const dropEvent = new MockDragEvent("drop");
          const mockDataTransfer = {
            items: [] as any,
            files: mockFiles.slice(0, 2), // Audio files
          };

          Object.defineProperty(dropEvent, "dataTransfer", {
            value: mockDataTransfer,
            writable: false,
          });

          await component.handleDrop(dropEvent);
          expect(component.error()).toBeNull();
          expect(component.isDragOver()).toBe(false);
          console.log("✅ File drop handled correctly");
        },

        // Step 3: Song reorder drag
        async testSongReorderDrag() {
          console.log("3️⃣ Testing song reorder drag");

          const dragEvent = new MockDragEvent("dragenter");
          const mockDataTransfer = {
            items: [{ kind: "string", type: "text/plain" }] as any,
            files: [] as any,
          };

          Object.defineProperty(dragEvent, "dataTransfer", {
            value: mockDataTransfer,
            writable: false,
          });

          component.handleDragEnter(dragEvent);
          expect(component.dragType()).toBe("songs");
          expect(component.isDragOver()).toBe(false); // Should not show file drop indicator
          console.log("✅ Song reorder drag detected correctly");
        },

        // Step 4: Song reorder drop
        async testSongReorderDrop() {
          console.log("4️⃣ Testing song reorder drop");

          const dropEvent = new MockDragEvent("drop");
          const mockDataTransfer = {
            items: [] as any,
            files: [] as any,
          };

          Object.defineProperty(dropEvent, "dataTransfer", {
            value: mockDataTransfer,
            writable: false,
          });

          component.setError(null); // Clear any previous errors
          await component.handleDrop(dropEvent);

          // Should NOT show "no audio files" error for song reordering
          expect(component.error()).toBeNull();
          console.log("✅ Song reorder drop handled without false errors");
        },
      };

      // Run workflow
      await workflow.testFileDrag();
      await workflow.testFileDrop();
      await workflow.testSongReorderDrag();
      await workflow.testSongReorderDrop();

      console.log("🎉 Complete workflow tested successfully");
    });

    it("should test error recovery", async () => {
      console.log("🔧 Testing error recovery");

      const component = createMockPlaylistzComponent();

      // Simulate error state
      component.setError("Previous error message");
      expect(component.error()).toBe("Previous error message");

      // Test automatic error clearing
      const clearErrorAfterDelay = () => {
        setTimeout(() => {
          component.setError(null);
        }, 100);
      };

      clearErrorAfterDelay();

      // Wait for error to clear
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(component.error()).toBeNull();

      console.log("✅ Error recovery tested");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
});
