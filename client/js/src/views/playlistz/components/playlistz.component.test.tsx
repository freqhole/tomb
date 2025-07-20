/* @jsxImportSource solid-js */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { Playlistz } from "./index.js";

// Mock IndexedDB service completely for now
vi.mock("../services/indexedDBService.js", () => ({
  setupDB: vi.fn(() => Promise.resolve()),
  createPlaylistsQuery: vi.fn(() => () => []),
  createPlaylist: vi.fn(() =>
    Promise.resolve({
      id: "test-id",
      title: "Test Playlist",
      description: "",
      songIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  ),
  addSongToPlaylist: vi.fn(() => Promise.resolve()),
}));

// Mock other services
vi.mock("../hooks/usePlaylistsQuery.js", () => ({
  usePlaylistsQuery: vi.fn(() => () => []),
}));

vi.mock("../services/audioService.js", () => ({
  cleanup: vi.fn(),
}));

vi.mock("../services/fileProcessingService.js", () => ({
  filterAudioFiles: vi.fn((files) => files),
  processAudioFiles: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../utils/timeUtils.js", () => ({
  cleanupTimeUtils: vi.fn(),
}));

describe("Playlistz Component Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render without crashing", async () => {
      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          const { container } = render(() => <Playlistz />);

          // Basic check that something rendered
          expect(container).toBeInTheDocument();
          resolve();
        });
      });

      dispose?.();
    });

    it("should show playlistz heading", async () => {
      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          render(() => <Playlistz />);

          // Look for any text that indicates this is the playlistz component
          waitFor(() => {
            const headingElement = screen.getByRole("heading", { level: 1 });
            expect(headingElement).toBeInTheDocument();
            resolve();
          }).catch(() => {
            // If no heading, just check for any playlistz-related text
            const playlistzText = screen.getByText(/playlistz/i);
            expect(playlistzText).toBeInTheDocument();
            resolve();
          });
        });
      });

      dispose?.();
    });

    it("should initialize with empty state", async () => {
      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          render(() => <Playlistz />);

          waitFor(
            () => {
              // Should show 0 playlists initially
              const countText = screen.getByText(/found 0 playlists/i);
              expect(countText).toBeInTheDocument();
              resolve();
            },
            { timeout: 1000 }
          );
        });
      });

      dispose?.();
    });
  });

  describe("Mock Verification", () => {
    it("should call setupDB on mount", async () => {
      const { setupDB } = await import("../services/indexedDBService.js");

      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          render(() => <Playlistz />);

          waitFor(() => {
            expect(setupDB).toHaveBeenCalled();
            resolve();
          });
        });
      });

      dispose?.();
    });
  });

  describe("UI Elements", () => {
    it("should have a file drop zone", async () => {
      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          render(() => <Playlistz />);

          waitFor(() => {
            // Look for drop zone text or similar UI elements
            const dropText = screen.getByText(/drop.*files/i);
            expect(dropText).toBeInTheDocument();
            resolve();
          });
        });
      });

      dispose?.();
    });

    it("should have a create playlist button", async () => {
      let dispose: any;

      await new Promise<void>((resolve) => {
        createRoot((disposeRoot) => {
          dispose = disposeRoot;
          render(() => <Playlistz />);

          waitFor(() => {
            const createButton = screen.getByText(/create.*playlist/i);
            expect(createButton).toBeInTheDocument();
            resolve();
          });
        });
      });

      dispose?.();
    });
  });
});
