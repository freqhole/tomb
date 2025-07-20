import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { Playlistz } from "./components/index.js";

// Mock IndexedDB
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
  objectStore: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  createObjectStore: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(() => false)
  }
};

const mockOpenDB = vi.fn();
vi.mock("idb", () => ({
  openDB: mockOpenDB,
}));

// Mock file processing service
vi.mock("./services/fileProcessingService.js", () => ({
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
        file
      }
    }))
  )
}));

// Mock audio service
vi.mock("./services/audioService.js", () => ({
  cleanup: vi.fn()
}));

// Mock time utils
vi.mock("./utils/timeUtils.js", () => ({
  cleanupTimeUtils: vi.fn()
}));

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
})) as any;

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: vi.fn(() => "test-uuid-123")
} as any;

// Mock File constructor for tests
global.File = class MockFile {
  name: string;
  type: string;
  size: number;

  constructor(chunks: any[], name: string, options: any = {}) {
    this.name = name;
    this.type = options.type || "";
    this.size = chunks.join("").length;
  }
} as any;

describe("Playlistz Component Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenDB.mockResolvedValue(mockDB);
    mockDB.getAll.mockResolvedValue([]);

    // Setup successful transaction mocks
    mockDB.transaction.mockReturnValue({
      objectStore: vi.fn(() => ({
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        index: vi.fn(() => ({
          openCursor: vi.fn(() => Promise.resolve(null))
        }))
      })),
      done: Promise.resolve()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Initial Render State", () => {
    it("should show loading state initially", async () => {
      render(() => <Playlistz />);

      // Should show loading spinner and text
      expect(screen.getByText("loading playlistz...")).toBeInTheDocument();
      expect(screen.getByText(/debug: isInitialized = false/)).toBeInTheDocument();
    });

    it("should show welcome screen after initialization with 0 playlists", async () => {
      mockDB.getAll.mockResolvedValue([]);

      render(() => <Playlistz />);

      // Wait for initialization
      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // BUG: Should show "found 0 playlists" but signal might not be reactive
      const playlistCount = screen.getByText(/found \d+ playlists/);
      expect(playlistCount).toHaveTextContent("found 0 playlists");
    });

    it("should show existing playlists count if database has data", async () => {
      const mockPlaylists = [
        {
          id: "1",
          title: "My Playlist",
          description: "Test playlist",
          songIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: "2",
          title: "Another Playlist",
          description: "Another test",
          songIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      mockDB.getAll.mockResolvedValue(mockPlaylists);

      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // BUG: This is the main issue - UI shows 0 but DB has 2
      const playlistCount = screen.getByText(/found \d+ playlists/);

      // This test documents the current broken behavior
      // It should show "found 2 playlists" but will show "found 0 playlists"
      console.log("📊 Playlist count text:", playlistCount.textContent);
      expect(playlistCount).toHaveTextContent("found 0 playlists"); // Current bug
    });
  });

  describe("Playlist Creation Workflow", () => {
    it("should create new playlist and update UI", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Click create playlist button
      const createButton = screen.getByRole("button", { name: /\+ playlist/i });
      fireEvent.click(createButton);

      // Should switch to playlist view
      await waitFor(() => {
        expect(screen.getByDisplayValue("new playlist")).toBeInTheDocument();
      });

      // Should show empty songs state
      expect(screen.getByText("no songs yet")).toBeInTheDocument();
      expect(screen.getByText(/playlist id:/)).toBeInTheDocument();
    });

    it("should go back to playlist list from playlist view", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Create playlist
      const createButton = screen.getByRole("button", { name: /\+ playlist/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByDisplayValue("new playlist")).toBeInTheDocument();
      });

      // Go back
      const backButton = screen.getByRole("button", { name: /back to playlists/i });
      fireEvent.click(backButton);

      // Should be back to welcome screen
      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });
    });
  });

  describe("File Upload Workflow", () => {
    beforeEach(() => {
      // Mock successful file processing
      const { processAudioFiles } = require("./services/fileProcessingService.js");
      processAudioFiles.mockResolvedValue([
        {
          success: true,
          song: {
            title: "Test Song",
            artist: "Test Artist",
            album: "Test Album",
            duration: 180,
            image: null,
            file: new File([""], "test.mp3", { type: "audio/mpeg" })
          }
        }
      ]);
    });

    it("should handle file drop on welcome screen", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Simulate drag enter with audio files
      const dragEvent = new DragEvent("dragenter", {
        dataTransfer: {
          items: [{
            kind: "file",
            type: "audio/mpeg"
          }]
        } as any
      });

      fireEvent(document.documentElement, dragEvent);

      // Should show drag overlay
      await waitFor(() => {
        expect(screen.getByText("drop your music here")).toBeInTheDocument();
      });
    });

    it("should process dropped files and create playlist", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Create mock files
      const mockFile = new File([""], "test.mp3", { type: "audio/mpeg" });
      const files = [mockFile];

      // Simulate file drop
      const dropEvent = new DragEvent("drop", {
        dataTransfer: {
          files: files as any
        } as any
      });

      fireEvent(document.documentElement, dropEvent);

      // Should create new playlist and switch to playlist view
      await waitFor(() => {
        expect(screen.getByText(/created from 1 dropped file/)).toBeInTheDocument();
      }, { timeout: 2000 });

      // Should show playlist view with the new playlist
      expect(screen.getByDisplayValue(/new playlist/)).toBeInTheDocument();
    });

    it("should show error for non-audio files", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Mock empty audio files result
      const { filterAudioFiles } = require("./services/fileProcessingService.js");
      filterAudioFiles.mockReturnValue([]);

      // Create mock non-audio file
      const mockFile = new File([""], "test.txt", { type: "text/plain" });

      const dropEvent = new DragEvent("drop", {
        dataTransfer: {
          files: [mockFile] as any
        } as any
      });

      fireEvent(document.documentElement, dropEvent);

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText("no audio files found in the dropped items")).toBeInTheDocument();
      });
    });
  });

  describe("UI Reactivity Issues", () => {
    it("should update playlist count after creating playlist (currently broken)", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Initial count should be 0
      expect(screen.getByText("found 0 playlists")).toBeInTheDocument();

      // Create a playlist
      const createButton = screen.getByRole("button", { name: /\+ playlist/i });
      fireEvent.click(createButton);

      // Go back to see if count updated
      await waitFor(() => {
        expect(screen.getByDisplayValue("new playlist")).toBeInTheDocument();
      });

      const backButton = screen.getByRole("button", { name: /back to playlists/i });
      fireEvent.click(backButton);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // BUG: Should now show "found 1 playlists" but probably still shows 0
      const playlistCount = screen.getByText(/found \d+ playlists/);
      console.log("📊 After creation, count shows:", playlistCount.textContent);

      // This documents the current broken behavior
      expect(playlistCount).toHaveTextContent("found 0 playlists"); // Still broken
    });

    it("should show select existing playlist button when playlists exist (broken)", async () => {
      // Start with existing playlists in database
      const mockPlaylists = [
        {
          id: "existing-1",
          title: "Existing Playlist",
          description: "Pre-existing",
          songIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      mockDB.getAll.mockResolvedValue(mockPlaylists);

      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // BUG: Should show "select existing playlist" button but won't due to reactivity issue
      const selectButton = screen.queryByText("select existing playlist");
      expect(selectButton).not.toBeInTheDocument(); // Documents current bug
    });
  });

  describe("Error Handling", () => {
    it("should show error notification", async () => {
      // Mock database initialization failure
      mockOpenDB.mockRejectedValue(new Error("Database initialization failed"));

      render(() => <Playlistz />);

      // Should show error in initialization
      await waitFor(() => {
        expect(screen.getByText(/failed to initialize/)).toBeInTheDocument();
      });
    });

    it("should auto-clear errors after timeout", async () => {
      render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      // Trigger an error by dropping invalid files
      const { filterAudioFiles } = require("./services/fileProcessingService.js");
      filterAudioFiles.mockReturnValue([]);

      const dropEvent = new DragEvent("drop", {
        dataTransfer: {
          files: [new File([""], "test.txt", { type: "text/plain" })] as any
        } as any
      });

      fireEvent(document.documentElement, dropEvent);

      // Error should appear
      await waitFor(() => {
        expect(screen.getByText("no audio files found in the dropped items")).toBeInTheDocument();
      });

      // Error should disappear after timeout (3 seconds for this error)
      await waitFor(() => {
        expect(screen.queryByText("no audio files found in the dropped items")).not.toBeInTheDocument();
      }, { timeout: 4000 });
    });
  });

  describe("Database Operation Tracking", () => {
    it("should track number of setupDB calls during component lifecycle", async () => {
      const { container } = render(() => <Playlistz />);

      await waitFor(() => {
        expect(screen.getByText("welcome to playlistz")).toBeInTheDocument();
      });

      console.log(`📊 setupDB called ${mockOpenDB.mock.calls.length} times during initial render`);

      // Create a playlist to trigger more DB operations
      const createButton = screen.getByRole("button", { name: /\+ playlist/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(screen.getByDisplayValue("new playlist")).toBeInTheDocument();
      });

      console.log(`📊 setupDB called ${mockOpenDB.mock.calls.length} times after playlist creation`);

      // This documents the excessive DB connection issue
      expect(mockOpenDB.mock.calls.length).toBeGreaterThan(2);
    });
  });
});
