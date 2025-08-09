import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSignal, createEffect } from "solid-js";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import type {
  Song,
  Playlist,
} from "../../src/views/playlistz/types/playlist.js";

// Mock background service that would manage dynamic backgrounds
const createMockBackgroundService = () => {
  const [currentBackground, setCurrentBackground] = createSignal<string | null>(
    null
  );
  const [backgroundType, setBackgroundType] = createSignal<
    "default" | "playlist" | "song"
  >("default");
  const [isTransitioning, setIsTransitioning] = createSignal(false);
  const [backgroundHistory, setBackgroundHistory] = createSignal<string[]>([]);

  const setBackground = async (
    imageUrl: string | null,
    type: "default" | "playlist" | "song"
  ) => {
    if (imageUrl === currentBackground()) return;

    setIsTransitioning(true);

    // Add to history for fallback
    if (imageUrl && !backgroundHistory().includes(imageUrl)) {
      setBackgroundHistory((prev) => [...prev, imageUrl]);
    }

    // Simulate transition delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    setCurrentBackground(imageUrl);
    setBackgroundType(type);
    setIsTransitioning(false);
  };

  const getFallbackBackground = () => {
    const history = backgroundHistory();
    return history[history.length - 1] || null;
  };

  return {
    currentBackground,
    backgroundType,
    isTransitioning,
    backgroundHistory,
    setBackground,
    getFallbackBackground,
  };
};

describe("🎨 Dynamic Background System Tests", () => {
  let mockPlaylist: Playlist;
  let mockSongs: Song[];
  let backgroundService: ReturnType<typeof createMockBackgroundService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPlaylist = {
      id: "playlist-1",
      title: "Test Playlist",
      description: "Test playlist with cover",
      songIds: ["song-1", "song-2", "song-3"],
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now(),
      image: "data:image/jpeg;base64,playlist-cover-image",
    };

    mockSongs = [
      {
        id: "song-1",
        title: "Song with Album Art",
        artist: "Artist 1",
        album: "Album 1",
        duration: 180,
        position: 0,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: new File(["fake audio"], "song1.mp3", { type: "audio/mp3" }),
        blobUrl: "blob:http://localhost/song1",
        image: "data:image/jpeg;base64,song1-album-art",
      },
      {
        id: "song-2",
        title: "Song without Album Art",
        artist: "Artist 2",
        album: "Album 2",
        duration: 200,
        position: 1,
        createdAt: Date.now() - 43200000,
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: new File(["fake audio"], "song2.mp3", { type: "audio/mp3" }),
        blobUrl: "blob:http://localhost/song2",
        // No image property
      },
      {
        id: "song-3",
        title: "Another Song with Art",
        artist: "Artist 3",
        album: "Album 3",
        duration: 220,
        position: 2,
        createdAt: Date.now() - 21600000,
        updatedAt: Date.now(),
        playlistId: "playlist-1",
        file: new File(["fake audio"], "song3.mp3", { type: "audio/mp3" }),
        blobUrl: "blob:http://localhost/song3",
        image: "data:image/jpeg;base64,song3-album-art",
      },
    ];

    backgroundService = createMockBackgroundService();
  });

  describe("Current Missing Functionality", () => {
    it("should demonstrate lack of dynamic background system", () => {
      // Currently, there's no background system
      expect(backgroundService.currentBackground()).toBeNull();
      expect(backgroundService.backgroundType()).toBe("default");
    });

    it("should show static background limitations", () => {
      // Mock current static background approach
      const staticBackground = "linear-gradient(to bottom, #1a1a1a, #000000)";

      // Simulate selecting different playlists/songs
      const contexts = [
        { type: "playlist", name: "Rock Playlist", image: "rock-cover.jpg" },
        { type: "song", name: "Jazz Song", image: "jazz-album.jpg" },
        {
          type: "playlist",
          name: "Classical Playlist",
          image: "classical-cover.jpg",
        },
      ];

      contexts.forEach((context) => {
        // In current static system, background never changes
        expect(staticBackground).toBe("default-gradient.png");
      });
    });
  });

  describe("Expected Dynamic Background Behavior", () => {
    it("should define background hierarchy requirements", () => {
      const backgroundHierarchy = {
        priority: [
          "1. Current playing song's album art (highest priority)",
          "2. Selected playlist cover image",
          "3. Previous song's album art (fallback)",
          "4. Default gradient background (lowest priority)",
        ],

        rules: {
          playbackActive:
            "During playback, use current song's album art if available",
          playbackPaused:
            "When paused, maintain current song's background or fall back to playlist",
          noPlayback: "When no song is playing, use selected playlist cover",
          noPlaylist: "When no playlist selected, use default background",
          missingImages: "Fall back through hierarchy until valid image found",
        },

        transitions: {
          songChange: "Smooth fade transition (300ms) when song changes",
          playlistChange: "Quick transition (200ms) when playlist changes",
          playbackStart: "Gentle transition (400ms) when starting playback",
          playbackStop: "Slow transition (500ms) when stopping playback",
        },
      };

      expect(backgroundHierarchy).toBeDefined();
      expect(backgroundHierarchy.priority).toHaveLength(4);
      expect(backgroundHierarchy.rules).toBeDefined();
      expect(backgroundHierarchy.transitions).toBeDefined();
    });

    it("should define CSS implementation requirements", () => {
      const cssRequirements = {
        structure: {
          backgroundContainer:
            "Fixed-position container covering full viewport",
          backgroundImage:
            "Background image with proper sizing and positioning",
          overlay: "Semi-transparent overlay for content readability",
          transition: "CSS transitions for smooth background changes",
        },

        positioning: {
          zIndex: "Background should be behind all content (z-index: -1)",
          attachment: "Fixed attachment to prevent scrolling issues",
          size: "Cover entire viewport (background-size: cover)",
          position: "Center image (background-position: center)",
        },

        performance: {
          preloading: "Preload next likely background images",
          caching: "Cache frequently used backgrounds",
          optimization: "Optimize image sizes for backgrounds",
          cleanup: "Clean up unused background resources",
        },

        accessibility: {
          contrast: "Ensure sufficient contrast with overlay",
          reducedMotion: "Respect prefers-reduced-motion setting",
          fallbacks: "Provide fallback colors for failed image loads",
        },
      };

      expect(cssRequirements).toBeDefined();
      expect(cssRequirements.structure).toBeDefined();
      expect(cssRequirements.positioning).toBeDefined();
      expect(cssRequirements.performance).toBeDefined();
      expect(cssRequirements.accessibility).toBeDefined();
    });
  });

  describe("Background Service Testing", () => {
    it("should test playlist background setting", async () => {
      // Initially no background
      expect(backgroundService.currentBackground()).toBeNull();

      // Set playlist background
      await backgroundService.setBackground(mockPlaylist.image!, "playlist");

      expect(backgroundService.currentBackground()).toBe(mockPlaylist.image);
      expect(backgroundService.backgroundType()).toBe("playlist");
      expect(backgroundService.backgroundHistory()).toContain(
        mockPlaylist.image
      );
    });

    it("should test song background priority", async () => {
      // Start with playlist background
      await backgroundService.setBackground(mockPlaylist.image!, "playlist");
      expect(backgroundService.backgroundType()).toBe("playlist");

      // Song starts playing - should override playlist background
      const songWithArt = mockSongs[0];
      await backgroundService.setBackground(songWithArt.image!, "song");

      expect(backgroundService.currentBackground()).toBe(songWithArt.image);
      expect(backgroundService.backgroundType()).toBe("song");
    });

    it("should test fallback hierarchy", async () => {
      // Build up background history
      await backgroundService.setBackground(mockPlaylist.image!, "playlist");
      await backgroundService.setBackground(mockSongs[0].image!, "song");
      await backgroundService.setBackground(mockSongs[2].image!, "song");

      const history = backgroundService.backgroundHistory();
      expect(history).toHaveLength(3);
      expect(history).toContain(mockPlaylist.image);
      expect(history).toContain(mockSongs[0].image);
      expect(history).toContain(mockSongs[2].image);

      // Test fallback when current song has no art
      const fallback = backgroundService.getFallbackBackground();
      expect(fallback).toBe(mockSongs[2].image); // Most recent
    });

    it("should test smooth transitions", async () => {
      const transitionLog: string[] = [];

      // Monitor transition state
      const stopMonitoring = createEffect(() => {
        if (backgroundService.isTransitioning()) {
          transitionLog.push("transition-start");
        } else if (
          transitionLog[transitionLog.length - 1] === "transition-start"
        ) {
          transitionLog.push("transition-end");
        }
      });

      // Trigger background change
      const changePromise = backgroundService.setBackground(
        mockPlaylist.image!,
        "playlist"
      );

      // Should be transitioning immediately
      expect(backgroundService.isTransitioning()).toBe(true);
      transitionLog.push("transition-detected");

      await changePromise;

      // Should be done transitioning
      expect(backgroundService.isTransitioning()).toBe(false);
      expect(transitionLog).toContain("transition-detected");

      stopMonitoring();
    });
  });

  describe("Integration with Audio System", () => {
    it("should test background changes during playback", async () => {
      // Mock audio state
      const mockAudioState = {
        currentSong: vi.fn(),
        isPlaying: vi.fn(),
        currentPlaylist: vi.fn(),
      };

      // Simulate playback flow
      const playbackFlow = async () => {
        // 1. Select playlist - should show playlist background
        mockAudioState.currentPlaylist.mockReturnValue(mockPlaylist);
        await backgroundService.setBackground(mockPlaylist.image!, "playlist");

        expect(backgroundService.backgroundType()).toBe("playlist");

        // 2. Start playing song with album art - should switch to song background
        mockAudioState.currentSong.mockReturnValue(mockSongs[0]);
        mockAudioState.isPlaying.mockReturnValue(true);
        await backgroundService.setBackground(mockSongs[0].image!, "song");

        expect(backgroundService.backgroundType()).toBe("song");

        // 3. Play song without album art - should keep current or fallback
        mockAudioState.currentSong.mockReturnValue(mockSongs[1]); // No image
        // Don't change background since song has no art

        console.log("3️⃣ Song without art playing, background unchanged");
        expect(backgroundService.currentBackground()).toBe(mockSongs[0].image);

        // 4. Stop playback - should return to playlist background
        mockAudioState.isPlaying.mockReturnValue(false);
        mockAudioState.currentSong.mockReturnValue(null);
        await backgroundService.setBackground(mockPlaylist.image!, "playlist");

        expect(backgroundService.backgroundType()).toBe("playlist");
      };

      await playbackFlow();
    });

    it("should test playlist switching", async () => {
      const secondPlaylist: Playlist = {
        ...mockPlaylist,
        id: "playlist-2",
        title: "Second Playlist",
        image: "data:image/jpeg;base64,second-playlist-cover",
      };

      // Start with first playlist
      await backgroundService.setBackground(mockPlaylist.image!, "playlist");
      expect(backgroundService.currentBackground()).toBe(mockPlaylist.image);

      // Switch to second playlist
      await backgroundService.setBackground(secondPlaylist.image!, "playlist");
      expect(backgroundService.currentBackground()).toBe(secondPlaylist.image);

      // History should contain both
      const history = backgroundService.backgroundHistory();
      expect(history).toContain(mockPlaylist.image);
      expect(history).toContain(secondPlaylist.image);
    });
  });

  describe("Performance and Optimization", () => {
    it("should test background preloading", async () => {
      const mockPreloader = {
        preloadedImages: new Set<string>(),

        preloadImage: vi.fn().mockImplementation(async (url: string) => {
          return new Promise((resolve) => {
            // Simulate image loading
            setTimeout(() => {
              mockPreloader.preloadedImages.add(url);
              console.log(`🖼️ Preloaded: ${url.substring(0, 50)}...`);
              resolve(url);
            }, 50);
          });
        }),

        preloadPlaylistImages: async (playlist: Playlist, songs: Song[]) => {
          const imagesToPreload = [
            playlist.image,
            ...songs.map((s) => s.image).filter(Boolean),
          ].filter(Boolean) as string[];

          await Promise.all(
            imagesToPreload.map((url) => mockPreloader.preloadImage(url))
          );

          return imagesToPreload.length;
        },
      };

      const preloadedCount = await mockPreloader.preloadPlaylistImages(
        mockPlaylist,
        mockSongs
      );

      expect(preloadedCount).toBe(3); // playlist + 2 songs with images
      expect(mockPreloader.preloadedImages.size).toBe(3);
      expect(mockPreloader.preloadImage).toHaveBeenCalledTimes(3);
    });

    it("should test memory management", async () => {
      const mockMemoryManager = {
        activeBackgrounds: new Map<string, { url: string; lastUsed: number }>(),
        maxCacheSize: 10,

        addToCache: (url: string) => {
          mockMemoryManager.activeBackgrounds.set(url, {
            url,
            lastUsed: Date.now(),
          });

          // Clean up if cache is too large
          if (
            mockMemoryManager.activeBackgrounds.size >
            mockMemoryManager.maxCacheSize
          ) {
            mockMemoryManager.cleanup();
          }
        },

        cleanup: () => {
          const entries = Array.from(
            mockMemoryManager.activeBackgrounds.entries()
          );
          entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);

          // Remove oldest entries
          const toRemove = entries.slice(
            0,
            entries.length - mockMemoryManager.maxCacheSize
          );
          toRemove.forEach(([key]) => {
            mockMemoryManager.activeBackgrounds.delete(key);
          });
        },

        getCacheSize: () => mockMemoryManager.activeBackgrounds.size,
      };

      // Add many backgrounds to trigger cleanup
      for (let i = 0; i < 15; i++) {
        mockMemoryManager.addToCache(`background-${i}`);
      }

      expect(mockMemoryManager.getCacheSize()).toBeLessThanOrEqual(10);
      console.log(`📊 Final cache size: ${mockMemoryManager.getCacheSize()}`);
    });

    it("should test performance metrics", async () => {
      const performanceTracker = {
        transitionTimes: [] as number[],
        loadTimes: [] as number[],

        measureTransition: async (transitionFn: () => Promise<void>) => {
          const start = performance.now();
          await transitionFn();
          const end = performance.now();
          const duration = end - start;

          performanceTracker.transitionTimes.push(duration);
          console.log(`⏱️ Transition took: ${duration.toFixed(2)}ms`);

          return duration;
        },

        getAverageTransitionTime: () => {
          const times = performanceTracker.transitionTimes;
          return times.length > 0
            ? times.reduce((a, b) => a + b, 0) / times.length
            : 0;
        },
      };

      // Measure several transitions
      for (let i = 0; i < 5; i++) {
        await performanceTracker.measureTransition(async () => {
          await backgroundService.setBackground(
            mockSongs[i % mockSongs.length].image!,
            "song"
          );
        });
      }

      const averageTime = performanceTracker.getAverageTransitionTime();
      console.log(`📊 Average transition time: ${averageTime.toFixed(2)}ms`);

      // Should be reasonably fast
      expect(averageTime).toBeLessThan(500);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should test missing image handling", async () => {
      const errorHandler = {
        handleMissingImage: async (url: string | undefined) => {
          if (!url) {
            console.log("⚠️ No image URL provided");
            return backgroundService.getFallbackBackground();
          }

          try {
            // Simulate image load attempt
            await new Promise((resolve, reject) => {
              setTimeout(() => {
                if (url.includes("broken")) {
                  reject(new Error("Image failed to load"));
                } else {
                  resolve(url);
                }
              }, 10);
            });

            return url;
          } catch (error) {
            return backgroundService.getFallbackBackground();
          }
        },
      };

      // Test with missing URL
      const result1 = await errorHandler.handleMissingImage(undefined);
      expect(result1).toBeNull(); // No fallback available yet

      // Set up fallback
      await backgroundService.setBackground(mockPlaylist.image!, "playlist");

      // Test with broken URL
      const result2 = await errorHandler.handleMissingImage("broken-image-url");
      expect(result2).toBe(mockPlaylist.image); // Should use fallback
    });

    it("should test rapid background changes", async () => {
      const rapidChangeTest = async () => {
        const changes = [
          { url: mockPlaylist.image!, type: "playlist" as const },
          { url: mockSongs[0].image!, type: "song" as const },
          { url: mockSongs[2].image!, type: "song" as const },
          { url: mockPlaylist.image!, type: "playlist" as const },
        ];

        // Fire all changes rapidly
        const promises = changes.map((change) =>
          backgroundService.setBackground(change.url, change.type)
        );

        await Promise.all(promises);

        // Should end up with the last change
        expect(backgroundService.currentBackground()).toBe(mockPlaylist.image);
        expect(backgroundService.backgroundType()).toBe("playlist");
      };

      await rapidChangeTest();
    });

    it("should test browser compatibility", () => {
      const compatibilityChecker = {
        features: {
          cssCustomProperties: 'CSS.supports("color", "var(--test)")',
          backgroundBlendMode:
            'CSS.supports("background-blend-mode", "multiply")',
          cssTransitions: 'CSS.supports("transition", "all 0.3s ease")',
          objectFit: 'CSS.supports("object-fit", "cover")',
        },

        checkFeature: (feature: string, fallback?: string) => {
          // Mock feature detection
          const isSupported = !feature.includes("blend"); // Simulate some features not supported

          return isSupported;
        },

        getCompatibilityReport: () => {
          const report = Object.entries(compatibilityChecker.features).map(
            ([name, test]) => ({
              feature: name,
              supported: compatibilityChecker.checkFeature(test),
            })
          );

          return report;
        },
      };

      const report = compatibilityChecker.getCompatibilityReport();
      const supportedFeatures = report.filter((r) => r.supported).length;

      expect(report.length).toBe(4);
      expect(supportedFeatures).toBeGreaterThan(0);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
});
