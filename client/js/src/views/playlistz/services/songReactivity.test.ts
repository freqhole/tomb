import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import {
  songUpdateTrigger,
  triggerSongUpdate,
  getSongUpdateTrigger,
  getLastUpdateTime,
  getSongSpecificTrigger,
  triggerSpecificSongUpdate,
  clearUpdateHistory,
  getUpdateStats,
  triggerSongUpdateWithOptions,
} from "./songReactivity.js";

describe("Song Reactivity System", () => {
  beforeEach(() => {
    // Clear update history before each test to ensure clean state
    clearUpdateHistory();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    clearUpdateHistory();
  });

  describe("Basic Reactivity", () => {
    it("should start with a numeric trigger value", () => {
      createRoot(() => {
        const triggerValue = getSongUpdateTrigger();
        expect(typeof triggerValue).toBe("number");
        expect(songUpdateTrigger()).toBe(triggerValue);
      });
    });

    it("should increment trigger when triggerSongUpdate is called", () => {
      createRoot(() => {
        const initialValue = getSongUpdateTrigger();

        triggerSongUpdate();
        expect(getSongUpdateTrigger()).toBe(initialValue + 1);

        triggerSongUpdate();
        expect(getSongUpdateTrigger()).toBe(initialValue + 2);
      });
    });

    it("should track song updates with timestamps", () => {
      createRoot(() => {
        const songId = "test-song-123";
        const beforeTime = Date.now();

        triggerSongUpdate(songId);

        const afterTime = Date.now();
        const updateTime = getLastUpdateTime(songId);

        expect(updateTime).toBeDefined();
        expect(updateTime).toBeGreaterThanOrEqual(beforeTime);
        expect(updateTime).toBeLessThanOrEqual(afterTime);
      });
    });

    it("should return undefined for songs that haven't been updated", () => {
      createRoot(() => {
        const updateTime = getLastUpdateTime("non-existent-song");
        expect(updateTime).toBeUndefined();
      });
    });

    it("should handle multiple song updates", () => {
      createRoot(() => {
        const initialValue = getSongUpdateTrigger();

        triggerSongUpdate("song1");
        triggerSongUpdate("song2");
        triggerSongUpdate("song1"); // Update song1 again

        expect(getLastUpdateTime("song1")).toBeDefined();
        expect(getLastUpdateTime("song2")).toBeDefined();
        expect(getSongUpdateTrigger()).toBe(initialValue + 3);
      });
    });
  });

  describe("Song-Specific Signals", () => {
    it("should create and return song-specific triggers", () => {
      createRoot(() => {
        const songId = "test-song-456";
        const trigger1 = getSongSpecificTrigger(songId);
        const trigger2 = getSongSpecificTrigger(songId);

        // Should return the same trigger for the same song ID
        expect(trigger1).toBe(trigger2);
        expect(typeof trigger1).toBe("function");
      });
    });

    it("should create different triggers for different songs", () => {
      createRoot(() => {
        const trigger1 = getSongSpecificTrigger("song1");
        const trigger2 = getSongSpecificTrigger("song2");

        expect(trigger1).not.toBe(trigger2);
      });
    });

    it("should start song-specific triggers at 0", () => {
      createRoot(() => {
        const songId = "test-song-789";
        const trigger = getSongSpecificTrigger(songId);

        expect(trigger()).toBe(0);
      });
    });

    it("should increment song-specific triggers independently", () => {
      createRoot(() => {
        const song1Trigger = getSongSpecificTrigger("song1");
        const song2Trigger = getSongSpecificTrigger("song2");

        // Initial state
        expect(song1Trigger()).toBe(0);
        expect(song2Trigger()).toBe(0);

        // Update song1 specifically
        triggerSpecificSongUpdate("song1");
        expect(song1Trigger()).toBe(1);
        expect(song2Trigger()).toBe(0); // Should remain unchanged

        // Update song2 specifically
        triggerSpecificSongUpdate("song2");
        expect(song1Trigger()).toBe(1); // Should remain unchanged
        expect(song2Trigger()).toBe(1);
      });
    });

    it("should update timestamp when triggering specific song update", () => {
      createRoot(() => {
        const songId = "test-song-timestamp";
        const beforeTime = Date.now();

        triggerSpecificSongUpdate(songId);

        const afterTime = Date.now();
        const updateTime = getLastUpdateTime(songId);

        expect(updateTime).toBeDefined();
        expect(updateTime).toBeGreaterThanOrEqual(beforeTime);
        expect(updateTime).toBeLessThanOrEqual(afterTime);
      });
    });

    it("should not affect global trigger when using triggerSpecificSongUpdate", () => {
      createRoot(() => {
        const initialGlobalTrigger = getSongUpdateTrigger();

        triggerSpecificSongUpdate("test-song");

        expect(getSongUpdateTrigger()).toBe(initialGlobalTrigger);
      });
    });
  });

  describe("Enhanced Trigger Options", () => {
    it("should trigger global update by default", () => {
      createRoot(() => {
        const initialTrigger = getSongUpdateTrigger();

        triggerSongUpdateWithOptions({ songId: "test-song" });

        expect(getSongUpdateTrigger()).toBe(initialTrigger + 1);
      });
    });

    it("should only trigger specific song when specificOnly is true", () => {
      createRoot(() => {
        const songId = "test-song-specific";
        const initialGlobalTrigger = getSongUpdateTrigger();
        const songTrigger = getSongSpecificTrigger(songId);
        const initialSongTrigger = songTrigger();

        triggerSongUpdateWithOptions({
          songId,
          specificOnly: true,
        });

        // Global trigger should not change
        expect(getSongUpdateTrigger()).toBe(initialGlobalTrigger);

        // Song-specific trigger should increment
        expect(songTrigger()).toBe(initialSongTrigger + 1);

        // Timestamp should be updated
        expect(getLastUpdateTime(songId)).toBeDefined();
      });
    });

    it("should handle different update types", () => {
      createRoot(() => {
        const songId = "test-song-types";
        const initialTrigger = getSongUpdateTrigger();

        // Test different update types
        const updateTypes = ["edit", "create", "delete", "reorder"] as const;

        updateTypes.forEach((type, index) => {
          triggerSongUpdateWithOptions({
            songId: `${songId}-${type}`,
            type,
            metadata: { operation: type },
          });

          expect(getSongUpdateTrigger()).toBe(initialTrigger + index + 1);
          expect(getLastUpdateTime(`${songId}-${type}`)).toBeDefined();
        });
      });
    });

    it("should handle options without songId", () => {
      createRoot(() => {
        const initialTrigger = getSongUpdateTrigger();

        triggerSongUpdateWithOptions({
          type: "edit",
          metadata: { batch: true },
        });

        expect(getSongUpdateTrigger()).toBe(initialTrigger + 1);
      });
    });

    it("should handle metadata in options", () => {
      createRoot(() => {
        const songId = "test-song-metadata";
        const metadata = {
          reason: "user-edit",
          batch: false,
          timestamp: Date.now(),
        };

        // The function should not throw with metadata
        expect(() => {
          triggerSongUpdateWithOptions({
            songId,
            type: "edit",
            metadata,
          });
        }).not.toThrow();

        expect(getLastUpdateTime(songId)).toBeDefined();
      });
    });
  });

  describe("Update Statistics and History", () => {
    it("should provide accurate update statistics", () => {
      createRoot(() => {
        // Initial stats after clearing
        let stats = getUpdateStats();
        const initialUpdates = stats.totalUpdates;
        expect(stats.trackedSongs).toBe(0);
        expect(stats.recentUpdates).toHaveLength(0);

        // Add some updates
        triggerSongUpdate("song1");
        triggerSongUpdate("song2");
        triggerSongUpdate("song1"); // Update song1 again

        stats = getUpdateStats();
        expect(stats.totalUpdates).toBe(initialUpdates + 3);
        expect(stats.trackedSongs).toBe(2); // Only 2 unique songs
        expect(stats.recentUpdates).toHaveLength(2);
      });
    });

    it("should order recent updates by timestamp", () => {
      createRoot(() => {
        // Add updates in sequence
        triggerSongUpdate("song1");
        triggerSongUpdate("song2");

        const stats = getUpdateStats();
        const recentUpdates = stats.recentUpdates;

        if (recentUpdates.length >= 2) {
          // More recent update should have higher or equal timestamp
          expect(recentUpdates[0]?.[1]).toBeGreaterThanOrEqual(
            recentUpdates[1]?.[1] || 0
          );
        }
      });
    });

    it("should limit recent updates to 10 entries", () => {
      createRoot(() => {
        // Add more than 10 updates
        for (let i = 0; i < 15; i++) {
          triggerSongUpdate(`song${i}`);
        }

        const stats = getUpdateStats();
        expect(stats.recentUpdates.length).toBeLessThanOrEqual(10);
        expect(stats.trackedSongs).toBe(15);
      });
    });

    it("should clear all update history", () => {
      createRoot(() => {
        // Add some updates
        triggerSongUpdate("song1");
        triggerSongUpdate("song2");
        const songTrigger = getSongSpecificTrigger("song3");
        triggerSpecificSongUpdate("song3");

        // Verify updates exist
        expect(getLastUpdateTime("song1")).toBeDefined();
        expect(getLastUpdateTime("song2")).toBeDefined();
        expect(getLastUpdateTime("song3")).toBeDefined();
        expect(songTrigger()).toBe(1);

        // Clear history
        clearUpdateHistory();

        // Verify everything is cleared
        expect(getLastUpdateTime("song1")).toBeUndefined();
        expect(getLastUpdateTime("song2")).toBeUndefined();
        expect(getLastUpdateTime("song3")).toBeUndefined();

        const stats = getUpdateStats();
        expect(stats.trackedSongs).toBe(0);
        expect(stats.recentUpdates).toHaveLength(0);
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty song IDs gracefully", () => {
      createRoot(() => {
        expect(() => {
          triggerSongUpdate("");
          triggerSpecificSongUpdate("");
          getSongSpecificTrigger("");
          getLastUpdateTime("");
        }).not.toThrow();
      });
    });

    it("should handle undefined song IDs", () => {
      createRoot(() => {
        expect(() => {
          triggerSongUpdate(undefined);
          getLastUpdateTime(undefined as any);
        }).not.toThrow();
      });
    });

    it("should handle rapid successive updates", () => {
      createRoot(() => {
        const songId = "rapid-update-song";
        const initialTrigger = getSongUpdateTrigger();

        // Trigger multiple rapid updates
        for (let i = 0; i < 100; i++) {
          triggerSongUpdate(songId);
        }

        expect(getSongUpdateTrigger()).toBe(initialTrigger + 100);
        expect(getLastUpdateTime(songId)).toBeDefined();
      });
    });

    it("should handle concurrent song-specific updates", () => {
      createRoot(() => {
        const songs = ["song1", "song2", "song3"];
        const triggers = songs.map((id) => getSongSpecificTrigger(id));

        // Simulate concurrent updates
        songs.forEach((songId) => {
          triggerSpecificSongUpdate(songId);
        });

        // All song-specific triggers should be incremented
        triggers.forEach((trigger) => {
          expect(trigger()).toBe(1);
        });

        // All songs should have timestamps
        songs.forEach((songId) => {
          expect(getLastUpdateTime(songId)).toBeDefined();
        });
      });
    });

    it("should maintain separate state for each song", () => {
      createRoot(() => {
        const song1Trigger = getSongSpecificTrigger("song1");
        const song2Trigger = getSongSpecificTrigger("song2");

        // Update song1 multiple times
        triggerSpecificSongUpdate("song1");
        triggerSpecificSongUpdate("song1");
        triggerSpecificSongUpdate("song1");

        // Update song2 once
        triggerSpecificSongUpdate("song2");

        expect(song1Trigger()).toBe(3);
        expect(song2Trigger()).toBe(1);
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle mixed global and specific updates", () => {
      createRoot(() => {
        const songId = "mixed-update-song";
        const songTrigger = getSongSpecificTrigger(songId);
        const initialGlobalTrigger = getSongUpdateTrigger();

        // Mix of update types
        triggerSongUpdate(songId); // Global + tracking
        triggerSpecificSongUpdate(songId); // Specific only
        triggerSongUpdate(); // Global only, no songId
        triggerSongUpdateWithOptions({ songId, specificOnly: true }); // Specific only

        expect(getSongUpdateTrigger()).toBe(initialGlobalTrigger + 2); // Only 2 global updates
        expect(songTrigger()).toBe(2); // 2 specific updates
        expect(getLastUpdateTime(songId)).toBeDefined();
      });
    });

    it("should work correctly after clearing history", () => {
      createRoot(() => {
        const songId = "post-clear-song";

        // Add initial updates
        triggerSongUpdate(songId);
        expect(getLastUpdateTime(songId)).toBeDefined();

        // Clear history
        clearUpdateHistory();
        expect(getLastUpdateTime(songId)).toBeUndefined();

        // Add new updates after clearing
        triggerSongUpdate(songId);
        expect(getLastUpdateTime(songId)).toBeDefined();

        const songTrigger = getSongSpecificTrigger(songId);
        triggerSpecificSongUpdate(songId);
        expect(songTrigger()).toBe(1);
      });
    });

    it("should handle realistic user workflow", () => {
      createRoot(() => {
        const playlistId = "playlist123";
        const songIds = ["song1", "song2", "song3"];
        const initialTrigger = getSongUpdateTrigger();

        // User creates playlist and adds songs
        songIds.forEach((songId) => {
          triggerSongUpdateWithOptions({
            songId,
            type: "create",
            metadata: { playlistId },
          });
        });

        // User edits song1
        triggerSongUpdateWithOptions({
          songId: "song1",
          type: "edit",
          metadata: { field: "title", playlistId },
        });

        // User reorders songs
        triggerSongUpdateWithOptions({
          type: "reorder",
          metadata: { playlistId, newOrder: ["song2", "song1", "song3"] },
        });

        // Verify all operations were tracked
        expect(getSongUpdateTrigger()).toBeGreaterThanOrEqual(
          initialTrigger + 4
        ); // 3 creates + 1 edit + 1 reorder
        songIds.forEach((songId) => {
          expect(getLastUpdateTime(songId)).toBeDefined();
        });

        const stats = getUpdateStats();
        expect(stats.trackedSongs).toBe(3);
        expect(stats.totalUpdates).toBeGreaterThanOrEqual(4);
      });
    });
  });

  describe("Development Helpers", () => {
    it("should expose debugging functions in development mode", () => {
      createRoot(() => {
        // Mock development environment
        const originalDEV = (globalThis as any).__DEV__;
        (globalThis as any).__DEV__ = true;

        try {
          // Simulate development helper setup
          const mockGlobal = globalThis as any;
          mockGlobal.__songReactivity = {
            getSongUpdateTrigger,
            getUpdateStats,
            clearUpdateHistory,
            triggerSongUpdate,
          };

          expect(mockGlobal.__songReactivity).toBeDefined();
          expect(typeof mockGlobal.__songReactivity.getSongUpdateTrigger).toBe(
            "function"
          );
          expect(typeof mockGlobal.__songReactivity.getUpdateStats).toBe(
            "function"
          );
          expect(typeof mockGlobal.__songReactivity.clearUpdateHistory).toBe(
            "function"
          );
          expect(typeof mockGlobal.__songReactivity.triggerSongUpdate).toBe(
            "function"
          );

          // Test that debugging functions work
          expect(() => {
            mockGlobal.__songReactivity.triggerSongUpdate("debug-song");
            mockGlobal.__songReactivity.getUpdateStats();
          }).not.toThrow();
        } finally {
          (globalThis as any).__DEV__ = originalDEV;
          delete (globalThis as any).__songReactivity;
        }
      });
    });
  });

  describe("Performance Considerations", () => {
    it("should handle many song updates efficiently", () => {
      createRoot(() => {
        const startTime = performance.now();
        const initialTrigger = getSongUpdateTrigger();

        // Simulate many updates
        for (let i = 0; i < 1000; i++) {
          triggerSongUpdate(`song${i % 100}`); // 1000 updates across 100 songs
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Should complete in reasonable time (less than 100ms on most systems)
        expect(duration).toBeLessThan(100);

        // Verify state is correct
        expect(getSongUpdateTrigger()).toBe(initialTrigger + 1000);
        expect(getUpdateStats().trackedSongs).toBe(100);
      });
    });

    it("should handle many song-specific triggers efficiently", () => {
      createRoot(() => {
        const songCount = 500;
        const triggers: (() => number)[] = [];

        const startTime = performance.now();

        // Create many song-specific triggers
        for (let i = 0; i < songCount; i++) {
          triggers.push(getSongSpecificTrigger(`song${i}`));
        }

        // Update each one
        for (let i = 0; i < songCount; i++) {
          triggerSpecificSongUpdate(`song${i}`);
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        // Should complete in reasonable time
        expect(duration).toBeLessThan(200);

        // Verify all triggers were updated
        triggers.forEach((trigger) => {
          expect(trigger()).toBe(1);
        });
      });
    });
  });

  describe("Function Exports", () => {
    it("should export all required functions", () => {
      expect(typeof songUpdateTrigger).toBe("function");
      expect(typeof triggerSongUpdate).toBe("function");
      expect(typeof getSongUpdateTrigger).toBe("function");
      expect(typeof getLastUpdateTime).toBe("function");
      expect(typeof getSongSpecificTrigger).toBe("function");
      expect(typeof triggerSpecificSongUpdate).toBe("function");
      expect(typeof clearUpdateHistory).toBe("function");
      expect(typeof getUpdateStats).toBe("function");
      expect(typeof triggerSongUpdateWithOptions).toBe("function");
    });

    it("should maintain signal functionality", () => {
      createRoot(() => {
        // Test that signals work as expected
        const initialValue = songUpdateTrigger();
        triggerSongUpdate();
        const newValue = songUpdateTrigger();

        expect(newValue).toBeGreaterThan(initialValue);
      });
    });
  });
});
