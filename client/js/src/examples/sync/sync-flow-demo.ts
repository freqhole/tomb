//! Complete Sync Flow Demo
//!
//! This script demonstrates the end-to-end sync flow for the music domain
//! including songs, playlists, and playlist songs with proper error handling
//! and progress tracking.

import { SongSync, createSongSync } from "../../sync/song-sync.js";
import { PlaylistSync, createPlaylistSync } from "../../sync/playlist-sync.js";
import { PlaylistSongSync, createPlaylistSongSync } from "../../sync/playlist-song-sync.js";
import { SyncStorageManager } from "../../sync/sync-storage.js";
import { SyncStatus } from "../../sync/sync-constants.js";

/**
 * Demo configuration
 */
interface DemoConfig {
  apiBaseUrl: string;
  authToken: string;
  clientId: string;
  enableLogging: boolean;
}

/**
 * Sync flow demo class
 */
export class SyncFlowDemo {
  private config: DemoConfig;
  private storage: SyncStorageManager;
  private songSync: SongSync;
  private playlistSync: PlaylistSync;
  private playlistSongSync: PlaylistSongSync;

  constructor(config: DemoConfig) {
    this.config = config;

    // Initialize shared storage
    this.storage = new SyncStorageManager({
      database_name: "sync_demo_storage",
      version: 4,
      max_storage_size: 10 * 1024 * 1024, // 10MB
      max_cache_age_days: 30,
    });

    // Initialize sync managers
    this.songSync = createSongSync({
      apiBaseUrl: config.apiBaseUrl,
      authToken: config.authToken,
      clientId: config.clientId,
      batchSize: 50,
      maxRetryAttempts: 3,
      retryDelay: 1000,
    }, this.storage);

    this.playlistSync = createPlaylistSync({
      apiBaseUrl: config.apiBaseUrl,
      authToken: config.authToken,
      clientId: config.clientId,
      batchSize: 25,
      maxRetryAttempts: 3,
      retryDelay: 1000,
    }, this.storage);

    this.playlistSongSync = createPlaylistSongSync({
      apiBaseUrl: config.apiBaseUrl,
      authToken: config.authToken,
      clientId: config.clientId,
      batchSize: 100,
      maxRetryAttempts: 3,
      retryDelay: 1000,
    }, this.storage);

    this.setupEventListeners();
  }

  /**
   * Initialize the demo
   */
  async initialize(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("🚀 Initializing sync flow demo...");
    }

    try {
      await this.storage.initialize();
      await this.songSync.initialize();
      await this.playlistSync.initialize();
      await this.playlistSongSync.initialize();

      if (this.config.enableLogging) {
        console.log("✅ Demo initialization complete");
      }
    } catch (error) {
      console.error("❌ Demo initialization failed:", error);
      throw error;
    }
  }

  /**
   * Run complete sync flow demo
   */
  async runDemo(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("\n🎵 Starting complete sync flow demo...\n");
    }

    try {
      // Step 1: Check sync recommendations
      await this.checkSyncRecommendations();

      // Step 2: Sync songs
      await this.syncSongs();

      // Step 3: Sync playlists
      await this.syncPlaylists();

      // Step 4: Sync playlist songs for each playlist
      await this.syncPlaylistSongs();

      // Step 5: Display sync statistics
      await this.displaySyncStats();

      // Step 6: Demonstrate offline operations
      await this.demonstrateOfflineOps();

      if (this.config.enableLogging) {
        console.log("\n🎉 Sync flow demo completed successfully!");
      }
    } catch (error) {
      console.error("❌ Sync flow demo failed:", error);
      throw error;
    }
  }

  /**
   * Check sync recommendations for all domains
   */
  private async checkSyncRecommendations(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("📊 Checking sync recommendations...");
    }

    try {
      const [songRecs, playlistRecs, playlistSongRecs] = await Promise.all([
        this.songSync.getRecommendations(),
        this.playlistSync.getRecommendations(),
        this.playlistSongSync.getRecommendations(),
      ]);

      if (this.config.enableLogging) {
        console.log("Songs:", {
          shouldSync: songRecs.shouldSync,
          estimatedItems: songRecs.estimatedItems,
          estimatedDuration: `${songRecs.estimatedDuration}ms`,
        });
        console.log("Playlists:", {
          shouldSync: playlistRecs.shouldSync,
          estimatedItems: playlistRecs.estimatedItems,
          estimatedDuration: `${playlistRecs.estimatedDuration}ms`,
        });
        console.log("Playlist Songs:", {
          shouldSync: playlistSongRecs.shouldSync,
          estimatedItems: playlistSongRecs.estimatedItems,
          estimatedDuration: `${playlistSongRecs.estimatedDuration}ms`,
        });
      }
    } catch (error) {
      console.warn("⚠️ Failed to get sync recommendations:", error);
    }
  }

  /**
   * Sync songs with progress tracking
   */
  private async syncSongs(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("🎵 Syncing songs...");
    }

    try {
      const startTime = Date.now();
      await this.songSync.sync();
      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(`✅ Songs synced in ${duration}ms`);
      }
    } catch (error) {
      console.error("❌ Song sync failed:", error);
      throw error;
    }
  }

  /**
   * Sync playlists with progress tracking
   */
  private async syncPlaylists(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("📝 Syncing playlists...");
    }

    try {
      const startTime = Date.now();
      await this.playlistSync.sync();
      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(`✅ Playlists synced in ${duration}ms`);
      }
    } catch (error) {
      console.error("❌ Playlist sync failed:", error);
      throw error;
    }
  }

  /**
   * Sync playlist songs for all playlists
   */
  private async syncPlaylistSongs(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("🔗 Syncing playlist songs...");
    }

    try {
      // Get all playlists to sync their songs
      const playlists = await this.storage.getAllPlaylists();

      if (playlists.length === 0) {
        if (this.config.enableLogging) {
          console.log("ℹ️ No playlists found, skipping playlist songs sync");
        }
        return;
      }

      const startTime = Date.now();

      // Sync playlist songs for each playlist
      for (const playlist of playlists.slice(0, 3)) { // Limit to first 3 for demo
        if (this.config.enableLogging) {
          console.log(`  🔗 Syncing songs for playlist: ${playlist.title}`);
        }

        try {
          await this.playlistSongSync.syncPlaylist(playlist.id);
        } catch (error) {
          console.warn(`⚠️ Failed to sync playlist ${playlist.id}:`, error);
        }
      }

      const duration = Date.now() - startTime;

      if (this.config.enableLogging) {
        console.log(`✅ Playlist songs synced in ${duration}ms`);
      }
    } catch (error) {
      console.error("❌ Playlist songs sync failed:", error);
      throw error;
    }
  }

  /**
   * Display sync statistics
   */
  private async displaySyncStats(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("\n📈 Sync Statistics:");
    }

    try {
      const stats = await this.storage.getStorageStats();

      if (this.config.enableLogging) {
        console.log("Storage Stats:", {
          totalItems: stats.total_items,
          totalSize: `${(stats.total_size_bytes / 1024 / 1024).toFixed(2)}MB`,
          musicStats: {
            songs: stats.music_stats.total_songs,
            playlists: stats.music_stats.total_playlists,
            playlistSongs: stats.music_stats.total_playlist_songs,
          },
          lastUpdated: stats.last_updated_at,
        });
      }
    } catch (error) {
      console.warn("⚠️ Failed to get storage stats:", error);
    }
  }

  /**
   * Demonstrate offline operations
   */
  private async demonstrateOfflineOps(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("\n🔄 Demonstrating offline operations...");
    }

    try {
      // Get first playlist for demo
      const playlists = await this.storage.getAllPlaylists();
      const songs = await this.storage.getAllSongs();

      if (playlists.length > 0 && songs.length > 0) {
        const playlist = playlists[0];
        const song = songs[0];

        // Demonstrate adding a song to playlist offline
        if (this.config.enableLogging) {
          console.log(`  ➕ Adding song "${song.title}" to playlist "${playlist.title}" (offline)`);
        }

        const playlistSong = await this.playlistSongSync.addSongToPlaylist(
          playlist.id,
          song.id
        );

        if (this.config.enableLogging) {
          console.log(`  ✅ Created playlist song with ID: ${playlistSong.id}`);
        }

        // Show offline operations queue
        const offlineOps = await this.storage.getOfflineOperations();
        if (this.config.enableLogging) {
          console.log(`  📋 Offline operations queued: ${offlineOps.length}`);
        }
      } else {
        if (this.config.enableLogging) {
          console.log("  ℹ️ No playlists or songs available for offline demo");
        }
      }
    } catch (error) {
      console.warn("⚠️ Offline operations demo failed:", error);
    }
  }

  /**
   * Get current sync status for all managers
   */
  async getSyncStatus(): Promise<{
    songs: SyncStatus;
    playlists: SyncStatus;
    playlistSongs: SyncStatus;
  }> {
    return {
      songs: this.songSync.getStatus(),
      playlists: this.playlistSync.getStatus(),
      playlistSongs: this.playlistSongSync.getStatus(),
    };
  }

  /**
   * Setup event listeners for all sync managers
   */
  private setupEventListeners(): void {
    if (!this.config.enableLogging) return;

    // Song sync events
    this.songSync.addEventListener("songs_synced", (event: any) => {
      console.log(`🎵 Songs synced: ${event.detail.songs.length} items`);
    });

    this.songSync.addEventListener("error", (event: any) => {
      console.error("🎵 Song sync error:", event.detail.error);
    });

    // Playlist sync events
    this.playlistSync.addEventListener("playlists_synced", (event: any) => {
      console.log(`📝 Playlists synced: ${event.detail.playlists.length} items`);
    });

    this.playlistSync.addEventListener("error", (event: any) => {
      console.error("📝 Playlist sync error:", event.detail.error);
    });

    // Playlist song sync events
    this.playlistSongSync.addEventListener("playlist_songs_synced", (event: any) => {
      console.log(`🔗 Playlist songs synced: ${event.detail.playlistSongs.length} items`);
    });

    this.playlistSongSync.addEventListener("error", (event: any) => {
      console.error("🔗 Playlist song sync error:", event.detail.error);
    });
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    if (this.config.enableLogging) {
      console.log("🧹 Cleaning up sync demo resources...");
    }

    try {
      await Promise.all([
        this.songSync.destroy(),
        this.playlistSync.destroy(),
        this.playlistSongSync.destroy(),
      ]);

      if (this.config.enableLogging) {
        console.log("✅ Cleanup complete");
      }
    } catch (error) {
      console.warn("⚠️ Cleanup failed:", error);
    }
  }
}

/**
 * Create and run a sync flow demo
 */
export async function createAndRunSyncDemo(config: DemoConfig): Promise<SyncFlowDemo> {
  const demo = new SyncFlowDemo(config);
  await demo.initialize();
  await demo.runDemo();
  return demo;
}

/**
 * Quick demo function for testing
 */
export async function quickSyncDemo(): Promise<void> {
  const demo = new SyncFlowDemo({
    apiBaseUrl: "http://localhost:3000",
    authToken: "demo-token", // Replace with real token
    clientId: "demo-client",
    enableLogging: true,
  });

  try {
    await demo.initialize();
    await demo.runDemo();
  } catch (error) {
    console.error("Quick demo failed:", error);
  } finally {
    await demo.destroy();
  }
}

/**
 * Check if sync demo is supported in current environment
 */
export function isSyncDemoSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof fetch !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  );
}

// Export for module usage
export default SyncFlowDemo;

// Browser global for testing
if (typeof window !== "undefined") {
  (window as any).SyncFlowDemo = SyncFlowDemo;
  (window as any).quickSyncDemo = quickSyncDemo;
}
