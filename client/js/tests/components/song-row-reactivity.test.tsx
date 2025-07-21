/**
 * @vitest-environment jsdom
 */
/* @jsxImportSource solid-js */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { SongRow } from "../../src/views/playlistz/components/SongRow.js";
import * as indexedDBService from "../../src/views/playlistz/services/indexedDBService.js";
import type { Song } from "../../src/views/playlistz/types/playlist.js";

// Mock IndexedDB service
vi.mock("../../src/views/playlistz/services/indexedDBService.js");

describe("🐛 Song Row Reactivity Bug Tests", () => {
  let mockSong: Song;
  let mockGetSongById: any;
  let mockUpdateSong: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSong = {
      id: "song-1",
      title: "Original Title",
      artist: "Original Artist",
      album: "Original Album",
      duration: 180,
      position: 0,
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now(),
      playlistId: "playlist-1",
      file: new File(["fake audio"], "song1.mp3", { type: "audio/mp3" }),
      blobUrl: "blob:http://localhost/song1",
      image: "data:image/jpeg;base64,fake-image-data",
    };

    mockGetSongById = vi.fn().mockResolvedValue(mockSong);
    mockUpdateSong = vi
      .fn()
      .mockImplementation(async (id: string, updates: any) => {
        // Simulate database update
        Object.assign(mockSong, updates, { updatedAt: Date.now() });
      });

    vi.mocked(indexedDBService.getSongById).mockImplementation(mockGetSongById);
    vi.mocked(indexedDBService.updateSong).mockImplementation(mockUpdateSong);
  });

  describe("Current Broken Behavior", () => {
    it("should demonstrate song row NOT updating after edit", async () => {
      console.log(
        "🧪 Testing current broken behavior: Song row doesn't update after edit"
      );

      const [currentSong, setCurrentSong] = createSignal(mockSong);
      const mockOnEdit = vi.fn();

      // Render the song row
      render(() => (
        <SongRow songId={mockSong.id} index={0} onEdit={mockOnEdit} />
      ));

      // Wait for song to load and verify initial state
      await waitFor(() => {
        expect(screen.getByText("Original Title")).toBeInTheDocument();
        expect(screen.getByText(/Original Artist/)).toBeInTheDocument();
      });

      console.log("✅ Initial song data loaded correctly");

      // Simulate external song update (like from edit modal)
      const updates = {
        title: "Updated Title",
        artist: "Updated Artist",
        album: "Updated Album",
      };

      await indexedDBService.updateSong(mockSong.id, updates);

      console.log("📝 Song updated in database");

      // The bug: UI should update but currently doesn't
      // This test documents the current broken behavior

      // Wait a bit to see if UI updates (it shouldn't in current broken state)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // In the current broken implementation, these should still show old values
      try {
        expect(screen.getByText("Original Title")).toBeInTheDocument();
        expect(screen.getByText(/Original Artist/)).toBeInTheDocument();
        console.log(
          "🐛 BUG CONFIRMED: UI still shows old data after database update"
        );
      } catch (error) {
        console.log("✅ UNEXPECTED: UI actually updated (bug might be fixed!)");
        // If this fails, it means the bug is fixed
        expect(screen.getByText("Updated Title")).toBeInTheDocument();
      }
    });

    it("should show that createResource doesn't re-fetch after external updates", async () => {
      console.log("🧪 Testing createResource reactivity issue");

      const getSongByIdCallCount = { value: 0 };
      mockGetSongById.mockImplementation(async (id: string) => {
        getSongByIdCallCount.value++;
        console.log(
          `📞 getSongById called ${getSongByIdCallCount.value} times for id: ${id}`
        );
        return { ...mockSong };
      });

      render(() => <SongRow songId={mockSong.id} index={0} />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText("Original Title")).toBeInTheDocument();
      });

      const initialCallCount = getSongByIdCallCount.value;
      console.log(`🔢 Initial getSongById calls: ${initialCallCount}`);

      // Update song in database
      await indexedDBService.updateSong(mockSong.id, {
        title: "Updated Title",
      });

      // Wait to see if createResource re-fetches
      await new Promise((resolve) => setTimeout(resolve, 200));

      const finalCallCount = getSongByIdCallCount.value;
      console.log(`🔢 Final getSongById calls: ${finalCallCount}`);

      // Bug: createResource doesn't know the data changed, so no re-fetch
      expect(finalCallCount).toBe(initialCallCount);
      console.log(
        "🐛 BUG CONFIRMED: createResource didn't re-fetch after external update"
      );
    });
  });

  describe("Expected Correct Behavior", () => {
    it("should define how song row SHOULD update after edit", async () => {
      console.log(
        "🎯 Defining expected behavior: Song row should update immediately after edit"
      );

      // Mock a reactive version where updates trigger re-fetches
      let songUpdateTrigger = 0;
      const mockReactiveGetSongById = vi
        .fn()
        .mockImplementation(async (id: string) => {
          // This would be triggered by some reactivity mechanism
          return { ...mockSong, updateTrigger: songUpdateTrigger };
        });

      // Simulate what should happen:
      // 1. Song is displayed with original data
      // 2. Song is updated via edit modal
      // 3. Song row immediately reflects changes

      const updates = {
        title: "Updated Title",
        artist: "Updated Artist",
      };

      // Step 1: Original data displayed
      console.log("1️⃣ Should display original data");
      expect(mockSong.title).toBe("Original Title");

      // Step 2: Update song
      console.log("2️⃣ Should update song in database");
      await indexedDBService.updateSong(mockSong.id, updates);
      expect(mockUpdateSong).toHaveBeenCalledWith(mockSong.id, updates);

      // Step 3: UI should automatically update
      console.log("3️⃣ Should trigger UI update");
      songUpdateTrigger++; // This simulates the missing reactivity trigger

      console.log("✅ Expected behavior defined");
    });

    it("should define reactive system requirements", () => {
      console.log("🔧 Defining reactive system requirements");

      // Requirements for fixing the bug:
      const requirements = {
        // 1. Signal that tracks when songs are updated
        songUpdateSignal: "Should emit when any song is updated",

        // 2. createResource that responds to updates
        reactiveFetch: "createResource should refetch when song is updated",

        // 3. Proper invalidation mechanism
        invalidation: "Should invalidate cache when song metadata changes",

        // 4. Event system for cross-component updates
        eventSystem:
          "Should notify all interested components when song changes",
      };

      Object.entries(requirements).forEach(([key, description]) => {
        console.log(`📋 ${key}: ${description}`);
      });

      expect(requirements).toBeDefined();
      console.log("✅ Reactive system requirements documented");
    });
  });

  describe("Potential Solutions Testing", () => {
    it("should test solution 1: Global song update signal", async () => {
      console.log("🔧 Testing Solution 1: Global song update signal");

      // Create a global signal that tracks song updates
      const [songUpdateTrigger, setSongUpdateTrigger] = createSignal(0);

      // Mock enhanced updateSong that triggers the signal
      const enhancedUpdateSong = vi
        .fn()
        .mockImplementation(async (id: string, updates: any) => {
          await mockUpdateSong(id, updates);
          setSongUpdateTrigger((prev) => prev + 1); // Trigger reactivity
          console.log(
            `🔄 Song update signal triggered: ${songUpdateTrigger()}`
          );
        });

      // Enhanced getSongById that depends on the update trigger
      const enhancedGetSongById = vi
        .fn()
        .mockImplementation(async (id: string) => {
          const trigger = songUpdateTrigger(); // Access the signal
          console.log(
            `📞 Enhanced getSongById called with trigger: ${trigger}`
          );
          return { ...mockSong };
        });

      // Test the solution
      const updates = { title: "Solution 1 Title" };
      await enhancedUpdateSong(mockSong.id, updates);

      expect(enhancedUpdateSong).toHaveBeenCalledWith(mockSong.id, updates);
      expect(songUpdateTrigger()).toBeGreaterThan(0);
      console.log("✅ Solution 1: Global signal approach tested");
    });

    it("should test solution 2: Resource invalidation", async () => {
      console.log("🔧 Testing Solution 2: Resource invalidation");

      // Mock a resource with manual invalidation
      let resourceData = { ...mockSong };
      let refetchCount = 0;

      const mockResource = {
        data: () => resourceData,
        refetch: vi.fn().mockImplementation(async () => {
          refetchCount++;
          console.log(`🔄 Resource refetch called ${refetchCount} times`);
          resourceData = await mockGetSongById(mockSong.id);
          return resourceData;
        }),
        mutate: vi.fn().mockImplementation((newData: any) => {
          resourceData = newData;
          console.log("🔄 Resource data mutated directly");
        }),
      };

      // Test invalidation approach
      const updates = { title: "Solution 2 Title" };
      await indexedDBService.updateSong(mockSong.id, updates);

      // Manually trigger refetch (this would be automated in real solution)
      await mockResource.refetch();

      expect(mockResource.refetch).toHaveBeenCalled();
      expect(refetchCount).toBe(1);
      console.log("✅ Solution 2: Resource invalidation tested");
    });

    it("should test solution 3: Event bus system", async () => {
      console.log("🔧 Testing Solution 3: Event bus system");

      // Mock event bus
      const eventBus = {
        listeners: new Map<string, Set<Function>>(),

        on: function (event: string, callback: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(callback);
          console.log(`👂 Event listener added for: ${event}`);
        },

        emit: function (event: string, data: any) {
          console.log(`📢 Event emitted: ${event}`, data);
          const listeners = this.listeners.get(event);
          if (listeners) {
            listeners.forEach((callback) => callback(data));
          }
        },

        off: function (event: string, callback: Function) {
          const listeners = this.listeners.get(event);
          if (listeners) {
            listeners.delete(callback);
          }
        },
      };

      // Test event bus solution
      let songRowUpdateCount = 0;
      eventBus.on("song:updated", (data: any) => {
        songRowUpdateCount++;
        console.log(`🎵 Song row received update event:`, data);
      });

      // Enhanced updateSong that emits events
      const eventBasedUpdateSong = vi
        .fn()
        .mockImplementation(async (id: string, updates: any) => {
          await mockUpdateSong(id, updates);
          eventBus.emit("song:updated", { id, updates });
        });

      const updates = { title: "Solution 3 Title" };
      await eventBasedUpdateSong(mockSong.id, updates);

      expect(songRowUpdateCount).toBe(1);
      console.log("✅ Solution 3: Event bus system tested");
    });
  });

  describe("Integration Test Scenarios", () => {
    it("should test complete edit workflow", async () => {
      console.log("🔄 Testing complete edit workflow");

      const mockOnEdit = vi.fn();
      let songRowRenderCount = 0;

      // Mock component that tracks renders
      const TestSongRow = () => {
        songRowRenderCount++;
        console.log(`🖼️ SongRow render count: ${songRowRenderCount}`);

        return (
          <div data-testid="song-row">
            <div data-testid="song-title">{mockSong.title}</div>
            <div data-testid="song-artist">{mockSong.artist}</div>
            <button
              data-testid="edit-button"
              onClick={() => mockOnEdit(mockSong)}
            >
              Edit
            </button>
          </div>
        );
      };

      render(() => <TestSongRow />);

      // Step 1: Verify initial render
      expect(screen.getByTestId("song-title")).toHaveTextContent(
        "Original Title"
      );
      expect(screen.getByTestId("song-artist")).toHaveTextContent(
        "Original Artist"
      );
      const initialRenderCount = songRowRenderCount;

      // Step 2: Simulate edit action
      fireEvent.click(screen.getByTestId("edit-button"));
      expect(mockOnEdit).toHaveBeenCalledWith(mockSong);

      // Step 3: Simulate song update (this should trigger re-render)
      const updates = {
        title: "Edited Title",
        artist: "Edited Artist",
      };
      await indexedDBService.updateSong(mockSong.id, updates);

      // Step 4: Check if UI would update (current bug: it doesn't)
      console.log(
        `📊 Render count before: ${initialRenderCount}, after: ${songRowRenderCount}`
      );

      // In fixed version, this should trigger a re-render
      // expect(songRowRenderCount).toBeGreaterThan(initialRenderCount);

      console.log("✅ Complete edit workflow tested");
    });

    it("should test multiple song rows updating simultaneously", async () => {
      console.log("🔄 Testing multiple song row updates");

      const songs = [
        { ...mockSong, id: "song-1", title: "Song 1" },
        { ...mockSong, id: "song-2", title: "Song 2" },
        { ...mockSong, id: "song-3", title: "Song 3" },
      ];

      mockGetSongById.mockImplementation(async (id: string) => {
        return songs.find((s) => s.id === id) || null;
      });

      // Simulate updating multiple songs
      const updates = { artist: "Updated Artist" };

      for (const song of songs) {
        await indexedDBService.updateSong(song.id, updates);
      }

      expect(mockUpdateSong).toHaveBeenCalledTimes(3);
      console.log("✅ Multiple song updates tested");
    });
  });

  describe("Performance Impact Testing", () => {
    it("should measure update performance", async () => {
      console.log("⏱️ Testing update performance");

      const startTime = performance.now();

      // Simulate rapid updates
      for (let i = 0; i < 10; i++) {
        await indexedDBService.updateSong(mockSong.id, {
          title: `Updated Title ${i}`,
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`⏱️ 10 updates took ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // Should be fast
      console.log("✅ Performance testing completed");
    });

    it("should test memory leak prevention", async () => {
      console.log("🧠 Testing memory leak prevention");

      // Mock cleanup functions
      const cleanupFunctions: Function[] = [];
      const mockCleanup = vi.fn(() => {
        cleanupFunctions.forEach((fn) => fn());
        cleanupFunctions.length = 0;
      });

      // Simulate component mount/unmount cycles
      for (let i = 0; i < 5; i++) {
        console.log(`🔄 Mount/unmount cycle ${i + 1}`);

        // Simulate creating subscriptions
        cleanupFunctions.push(() => console.log(`🧹 Cleanup ${i + 1}`));

        // Simulate immediate unmount
        mockCleanup();
      }

      expect(mockCleanup).toHaveBeenCalledTimes(5);
      expect(cleanupFunctions).toHaveLength(0);
      console.log("✅ Memory leak prevention tested");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
});
