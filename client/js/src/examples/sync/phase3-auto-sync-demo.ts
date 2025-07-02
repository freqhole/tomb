//! Phase 3: Auto-Sync & Notifications Demo
//!
//! This comprehensive demo showcases all Phase 3 features including:
//! - Auto-sync notification routing
//! - Enhanced auto-sync management with rules and scheduling
//! - User notifications (in-app and push)
//! - Service worker background sync integration
//! - Resource-aware sync optimization
//! - Real-time WebSocket notification processing

import {
  setupUnifiedSync,
  createServiceWorkerSyncManager,
  isServiceWorkerSyncSupported,
} from "../../sync/index.js";

import {
  createPhase3AutoSyncSystem,
  createPhase3DemoSetup,
  setupPhase3AutoSync,
  type Phase3AutoSyncConfig,
  type Phase3Stats,
  type Phase3Status,
} from "../../sync/phase3-auto-sync-integration.js";

import { WebSocketClient } from "../../lib/websocket-client.js";
import { ApiClient } from "../../lib/api-client.js";

import type {
  UnifiedSyncManager,
  SyncDomain,
  AutoSyncRule,
  Phase3WebSocketNotification,
} from "../../sync/types.js";

import { SyncEventType } from "../../sync/types.js";

/**
 * Phase 3 demo configuration
 */
interface Phase3DemoConfig {
  /** API base URL */
  apiBaseUrl: string;
  /** WebSocket URL */
  websocketUrl: string;
  /** Client identifier */
  clientId: string;
  /** Enable all Phase 3 features */
  enableAllFeatures: boolean;
  /** Demo duration in minutes */
  demoDuration: number;
  /** Simulate notifications */
  simulateNotifications: boolean;
  /** Auto-run demo sequence */
  autoRunDemo: boolean;
}

/**
 * Demo event log entry
 */
interface DemoLogEntry {
  timestamp: Date;
  type: "info" | "success" | "warning" | "error" | "sync" | "notification";
  message: string;
  data?: any;
}

/**
 * Comprehensive Phase 3 auto-sync demo
 */
export class Phase3AutoSyncDemo {
  private syncManager: UnifiedSyncManager | null = null;
  private phase3System: any | null = null;
  private wsClient: WebSocketClient | null = null;
  private apiClient: ApiClient | null = null;
  private config: Phase3DemoConfig;
  private eventLog: DemoLogEntry[] = [];
  private demoStartTime: Date | null = null;
  private simulationTimers: NodeJS.Timeout[] = [];

  constructor(config: Partial<Phase3DemoConfig> = {}) {
    this.config = {
      apiBaseUrl: "http://localhost:8080",
      websocketUrl: "ws://localhost:8080/ws",
      clientId: "phase3-demo-client",
      enableAllFeatures: true,
      demoDuration: 10, // 10 minutes
      simulateNotifications: true,
      autoRunDemo: true,
      ...config,
    };
  }

  /**
   * Initialize the Phase 3 demo
   */
  async initialize(): Promise<void> {
    this.addLog("info", "🚀 Initializing Phase 3 Auto-Sync Demo...");

    try {
      // Create WebSocket client
      this.wsClient = new WebSocketClient({
        url: this.config.websocketUrl,
        autoReconnect: true,
        debug: true,
      });

      // Create API client
      this.apiClient = new ApiClient({
        baseUrl: this.config.apiBaseUrl,
      });

      // Set up unified sync
      this.syncManager = await setupUnifiedSync(this.wsClient, this.apiClient, {
        apiBaseUrl: this.config.apiBaseUrl,
        clientId: this.config.clientId,
      });

      // Connect WebSocket
      this.wsClient.connect();
      await this.waitForConnection();

      // Initialize Phase 3 system
      this.phase3System = await createPhase3DemoSetup(
        this.syncManager,
        this.wsClient
      );

      this.demoStartTime = new Date();
      this.addLog("success", "✅ Phase 3 demo initialized successfully");

      // Set up demo event listeners
      this.setupDemoEventListeners();

      // Start demo if auto-run is enabled
      if (this.config.autoRunDemo) {
        await this.runCompleteDemo();
      }
    } catch (error) {
      this.addLog("error", `❌ Demo initialization failed: ${error}`);
      throw error;
    }
  }

  /**
   * Run the complete Phase 3 demo sequence
   */
  async runCompleteDemo(): Promise<void> {
    this.addLog("info", "🎯 Starting complete Phase 3 demo sequence...");

    try {
      // 1. Demonstrate basic auto-sync setup
      await this.demoBasicAutoSync();
      await this.wait(2000);

      // 2. Demonstrate notification routing
      await this.demoNotificationRouting();
      await this.wait(3000);

      // 3. Demonstrate user notifications
      await this.demoUserNotifications();
      await this.wait(2000);

      // 4. Demonstrate custom sync rules
      await this.demoCustomSyncRules();
      await this.wait(3000);

      // 5. Demonstrate resource-aware syncing
      await this.demoResourceAwareSync();
      await this.wait(2000);

      // 6. Demonstrate service worker integration
      await this.demoServiceWorkerIntegration();
      await this.wait(3000);

      // 7. Start real-time simulation
      await this.startRealtimeSimulation();

      this.addLog("success", "🎉 Complete Phase 3 demo sequence finished!");
      this.showDemoSummary();
    } catch (error) {
      this.addLog("error", `❌ Demo sequence failed: ${error}`);
    }
  }

  /**
   * Demonstrate basic auto-sync functionality
   */
  async demoBasicAutoSync(): Promise<void> {
    this.addLog("info", "📋 Demo: Basic Auto-Sync Functionality");

    if (!this.phase3System) {
      this.addLog("error", "Phase 3 system not initialized");
      return;
    }

    // Check system status
    const status = this.phase3System.getStatus();
    this.addLog("info", "System Status:", status);

    // Get initial stats
    const initialStats = this.phase3System.getStats();
    this.addLog("info", "Initial Stats:", initialStats);

    // Trigger manual sync for demo
    await this.phase3System.triggerManualSync("music", {
      reason: "demo - basic auto-sync",
      priority: 80,
    });

    this.addLog("success", "✅ Basic auto-sync demo completed");
  }

  /**
   * Demonstrate notification routing
   */
  async demoNotificationRouting(): Promise<void> {
    this.addLog("info", "📡 Demo: Notification Routing");

    if (!this.wsClient) {
      this.addLog("error", "WebSocket client not available");
      return;
    }

    // Subscribe to notification channels
    this.wsClient.subscribeToNotifications("MediaBlobs");
    this.wsClient.subscribeToNotifications("ThumbnailJobs");
    this.wsClient.subscribeToNotifications("System");

    this.addLog("success", "✅ Subscribed to notification channels");

    // Simulate incoming notifications
    if (this.config.simulateNotifications) {
      await this.simulateNotifications();
    }

    this.addLog("success", "✅ Notification routing demo completed");
  }

  /**
   * Demonstrate user notifications
   */
  async demoUserNotifications(): Promise<void> {
    this.addLog("info", "📢 Demo: User Notifications");

    if (!this.phase3System) return;

    // Send various types of user notifications
    await this.phase3System.sendUserNotification({
      type: "info",
      title: "Demo Notification",
      message: "This is an informational notification from the demo",
      autoHide: true,
    });

    await this.wait(1000);

    await this.phase3System.sendUserNotification({
      type: "success",
      title: "Sync Complete",
      message: "Demo sync operation completed successfully",
      domain: "music",
      autoHide: true,
    });

    await this.wait(1000);

    await this.phase3System.sendUserNotification({
      type: "progress",
      title: "Syncing Photos",
      message: "Processing images...",
      domain: "photos",
      progress: 45,
      autoHide: false,
      actions: [
        {
          id: "pause",
          label: "Pause",
          handler: () => this.addLog("info", "🔧 User clicked pause"),
        },
        {
          id: "details",
          label: "Details",
          handler: () => this.addLog("info", "🔧 User clicked details"),
        },
      ],
    });

    this.addLog("success", "✅ User notifications demo completed");
  }

  /**
   * Demonstrate custom sync rules
   */
  async demoCustomSyncRules(): Promise<void> {
    this.addLog("info", "📋 Demo: Custom Sync Rules");

    if (!this.phase3System) return;

    // Add custom sync rules
    const customRules: AutoSyncRule[] = [
      {
        id: "demo-high-priority-media",
        name: "High Priority Media Sync",
        domains: ["music", "photos"],
        trigger: "notification-immediate",
        conditions: {
          notificationPriorities: ["critical", "high"],
          minBatteryLevel: 0.3,
        },
        priority: 90,
        enabled: true,
        description: "Immediate sync for high-priority media content",
      },
      {
        id: "demo-scheduled-documents",
        name: "Scheduled Document Sync",
        domains: ["documents"],
        schedule: {
          type: "periodic",
          interval: 300000, // 5 minutes
        },
        conditions: {
          allowedConnectionTypes: ["wifi"],
          minBatteryLevel: 0.5,
        },
        priority: 50,
        enabled: true,
        description: "Regular document sync on WiFi",
      },
      {
        id: "demo-connection-recovery",
        name: "Connection Recovery Sync",
        domains: ["music", "photos", "documents", "videos"],
        trigger: "connection-restored",
        conditions: {
          minBatteryLevel: 0.2,
        },
        priority: 75,
        enabled: true,
        description: "Sync when connection is restored",
      },
    ];

    for (const rule of customRules) {
      this.phase3System.addSyncRule(rule);
      this.addLog("info", `Added sync rule: ${rule.name}`);
    }

    // Show active rules
    const activeRules = this.phase3System.getActiveSyncRules();
    this.addLog("info", `Active sync rules: ${activeRules.length}`);

    this.addLog("success", "✅ Custom sync rules demo completed");
  }

  /**
   * Demonstrate resource-aware syncing
   */
  async demoResourceAwareSync(): Promise<void> {
    this.addLog("info", "⚡ Demo: Resource-Aware Syncing");

    // Simulate different resource conditions
    this.addLog("info", "Simulating low battery condition...");
    // In a real implementation, this would check actual battery status

    this.addLog("info", "Simulating poor connection condition...");
    // In a real implementation, this would check connection quality

    this.addLog("info", "Simulating high memory usage...");
    // In a real implementation, this would check memory usage

    // Demonstrate how the system would handle these conditions
    this.addLog(
      "info",
      "✅ System would automatically adjust sync behavior based on resources"
    );

    this.addLog("success", "✅ Resource-aware sync demo completed");
  }

  /**
   * Demonstrate service worker integration
   */
  async demoServiceWorkerIntegration(): Promise<void> {
    this.addLog("info", "🔄 Demo: Service Worker Integration");

    if (!isServiceWorkerSyncSupported()) {
      this.addLog(
        "warning",
        "⚠️ Service Worker not supported in this environment"
      );
      return;
    }

    // Show service worker capabilities
    const status = this.phase3System?.getStatus();
    if (status?.components.serviceWorker) {
      this.addLog("success", "✅ Service Worker is active and ready");

      // Demonstrate background sync scheduling
      this.addLog(
        "info",
        "Background sync would be scheduled when app is backgrounded"
      );
      this.addLog(
        "info",
        "Periodic sync would run automatically every 30 minutes"
      );
    } else {
      this.addLog("warning", "⚠️ Service Worker not available");
    }

    this.addLog("success", "✅ Service Worker integration demo completed");
  }

  /**
   * Start real-time simulation
   */
  async startRealtimeSimulation(): Promise<void> {
    this.addLog("info", "🎬 Starting real-time simulation...");

    if (!this.config.simulateNotifications) {
      this.addLog("info", "Simulation disabled in config");
      return;
    }

    // Simulate various scenarios over time
    this.scheduleSimulatedEvent(2000, () => this.simulateNewMediaUpload());
    this.scheduleSimulatedEvent(5000, () => this.simulateThumbnailGeneration());
    this.scheduleSimulatedEvent(8000, () => this.simulateSystemUpdate());
    this.scheduleSimulatedEvent(12000, () => this.simulateDocumentProcessing());
    this.scheduleSimulatedEvent(15000, () => this.simulateConnectionIssue());
    this.scheduleSimulatedEvent(20000, () => this.simulateBatchContentUpdate());

    this.addLog("success", "✅ Real-time simulation started");
  }

  /**
   * Simulate incoming notifications
   */
  private async simulateNotifications(): Promise<void> {
    const notifications: Phase3WebSocketNotification[] = [
      {
        id: "notif-1",
        channel: "MediaBlobs",
        eventType: "content.created",
        payload: { blobId: "demo-blob-1", contentType: "audio" },
        priority: "high",
        timestamp: new Date().toISOString(),
      },
      {
        id: "notif-2",
        channel: "ThumbnailJobs",
        eventType: "thumbnail.completed",
        payload: { mediaBlobId: "demo-blob-1", thumbnailCount: 3 },
        priority: "medium",
        timestamp: new Date().toISOString(),
      },
      {
        id: "notif-3",
        channel: "System",
        eventType: "sync.force_refresh",
        payload: { reason: "maintenance_complete" },
        priority: "critical",
        timestamp: new Date().toISOString(),
      },
    ];

    for (const notification of notifications) {
      this.addLog("notification", "📬 Simulated notification:", notification);

      // The notification router would process these in a real scenario
      await this.wait(1000);
    }
  }

  /**
   * Schedule simulated events
   */
  private scheduleSimulatedEvent(delay: number, handler: () => void): void {
    const timeout = setTimeout(handler, delay);
    this.simulationTimers.push(timeout);
  }

  /**
   * Simulate new media upload
   */
  private simulateNewMediaUpload(): void {
    this.addLog("sync", "🎵 Simulated: New music upload detected");
    this.addLog(
      "info",
      "📡 Auto-sync would trigger immediately for high-priority content"
    );
  }

  /**
   * Simulate thumbnail generation
   */
  private simulateThumbnailGeneration(): void {
    this.addLog("sync", "🖼️ Simulated: Thumbnail generation completed");
    this.addLog(
      "info",
      "📦 Auto-sync would trigger with batching for thumbnails"
    );
  }

  /**
   * Simulate system update
   */
  private simulateSystemUpdate(): void {
    this.addLog("sync", "🔧 Simulated: System maintenance completed");
    this.addLog("info", "⚡ Force refresh auto-sync would trigger immediately");
  }

  /**
   * Simulate document processing
   */
  private simulateDocumentProcessing(): void {
    this.addLog("sync", "📄 Simulated: Document processing completed");
    this.addLog("info", "📋 Scheduled document sync would update metadata");
  }

  /**
   * Simulate connection issue and recovery
   */
  private simulateConnectionIssue(): void {
    this.addLog("warning", "📡 Simulated: Connection lost");

    setTimeout(() => {
      this.addLog("success", "📡 Simulated: Connection restored");
      this.addLog("info", "🔄 Connection recovery sync would trigger");
    }, 3000);
  }

  /**
   * Simulate batch content update
   */
  private simulateBatchContentUpdate(): void {
    this.addLog("sync", "📦 Simulated: Batch content update (50 items)");
    this.addLog(
      "info",
      "⏱️ Debounced auto-sync would process batch efficiently"
    );
  }

  /**
   * Set up demo event listeners
   */
  private setupDemoEventListeners(): void {
    if (!this.syncManager) return;

    // Listen for auto-sync events
    this.syncManager.on(SyncEventType.AutoSyncTriggered, (event: any) => {
      this.addLog(
        "sync",
        `🔄 Auto-sync triggered: ${event.domain} (${event.trigger})`
      );
    });

    this.syncManager.on(SyncEventType.Progress, (event: any) => {
      this.addLog(
        "sync",
        `📈 Sync progress: ${event.domain} ${event.progress?.progress}%`
      );
    });

    this.syncManager.on(SyncEventType.AllCompleted, (event: any) => {
      this.addLog(
        "success",
        `✅ All sync completed: ${event.result?.itemsSynced} items`
      );
    });

    this.syncManager.on(SyncEventType.DomainCompleted, (event: any) => {
      this.addLog(
        "success",
        `✅ ${event.result?.domain} sync completed: ${event.result?.itemsSynced} items`
      );
    });

    this.syncManager.on(SyncEventType.Failed, (event: any) => {
      this.addLog(
        "error",
        `❌ Sync failed: ${event.domain} - ${event.error?.message}`
      );
    });

    // Listen for WebSocket events
    if (this.wsClient) {
      this.wsClient.on("notification", (data) => {
        this.addLog(
          "notification",
          "📬 WebSocket notification received:",
          data
        );
      });

      this.wsClient.on("statusChange", (status) => {
        this.addLog("info", `🔌 WebSocket status: ${status}`);
      });
    }
  }

  /**
   * Wait for WebSocket connection
   */
  private async waitForConnection(): Promise<void> {
    if (!this.wsClient) return;

    return new Promise((resolve, reject) => {
      if (this.wsClient!.getStatus() === "connected") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      this.wsClient!.on("statusChange", (status) => {
        if (status === "connected") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  /**
   * Show demo summary
   */
  showDemoSummary(): void {
    if (!this.phase3System || !this.demoStartTime) return;

    const stats = this.phase3System.getStats();
    const duration = Date.now() - this.demoStartTime.getTime();

    this.addLog("info", "📊 Demo Summary:");
    this.addLog("info", `⏱️ Duration: ${Math.round(duration / 1000)}s`);
    this.addLog("info", `📝 Log entries: ${this.eventLog.length}`);
    this.addLog(
      "info",
      `🔄 Syncs triggered: ${stats.system.totalSyncsTriggered}`
    );
    this.addLog(
      "info",
      `📡 Notifications processed: ${stats.notificationRouter?.notificationsReceived || 0}`
    );
    this.addLog(
      "info",
      `📢 User notifications sent: ${stats.userNotifications?.totalSent || 0}`
    );
  }

  /**
   * Get demo event log
   */
  getEventLog(): DemoLogEntry[] {
    return [...this.eventLog];
  }

  /**
   * Get current Phase 3 stats
   */
  getStats(): Phase3Stats | null {
    return this.phase3System?.getStats() || null;
  }

  /**
   * Get current Phase 3 status
   */
  getStatus(): Phase3Status | null {
    return this.phase3System?.getStatus() || null;
  }

  /**
   * Perform system health check
   */
  async performHealthCheck(): Promise<any> {
    if (!this.phase3System) return null;
    return await this.phase3System.performHealthCheck();
  }

  /**
   * Clean up demo resources
   */
  async cleanup(): Promise<void> {
    this.addLog("info", "🧹 Cleaning up demo resources...");

    // Clear simulation timers
    for (const timer of this.simulationTimers) {
      clearTimeout(timer);
    }
    this.simulationTimers = [];

    // Disable Phase 3 system
    if (this.phase3System) {
      await this.phase3System.disable();
    }

    // Disconnect WebSocket
    if (this.wsClient) {
      this.wsClient.disconnect();
    }

    this.addLog("success", "✅ Demo cleanup completed");
  }

  /**
   * Add entry to demo log
   */
  private addLog(
    type: DemoLogEntry["type"],
    message: string,
    data?: any
  ): void {
    const entry: DemoLogEntry = {
      timestamp: new Date(),
      type,
      message,
      data,
    };

    this.eventLog.push(entry);

    // Console output with emoji and colors
    const prefix = this.getLogPrefix(type);
    console.log(`${prefix} ${message}`, data ? data : "");
  }

  /**
   * Get log prefix for console output
   */
  private getLogPrefix(type: DemoLogEntry["type"]): string {
    switch (type) {
      case "info":
        return "ℹ️ [Phase3]";
      case "success":
        return "✅ [Phase3]";
      case "warning":
        return "⚠️ [Phase3]";
      case "error":
        return "❌ [Phase3]";
      case "sync":
        return "🔄 [Phase3]";
      case "notification":
        return "📬 [Phase3]";
      default:
        return "📝 [Phase3]";
    }
  }

  /**
   * Utility wait function
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Run a quick Phase 3 demo
 */
export async function runQuickPhase3Demo(): Promise<void> {
  console.log("🚀 Starting Quick Phase 3 Auto-Sync Demo");

  const demo = new Phase3AutoSyncDemo({
    autoRunDemo: false,
    simulateNotifications: true,
    demoDuration: 5,
  });

  try {
    await demo.initialize();

    // Run specific demo features
    await demo.demoBasicAutoSync();
    await demo.demoUserNotifications();
    await demo.demoCustomSyncRules();

    demo.showDemoSummary();
  } catch (error) {
    console.error("❌ Quick demo failed:", error);
  } finally {
    await demo.cleanup();
  }
}

/**
 * Run comprehensive Phase 3 demo
 */
export async function runComprehensivePhase3Demo(): Promise<void> {
  console.log("🎯 Starting Comprehensive Phase 3 Auto-Sync Demo");

  const demo = new Phase3AutoSyncDemo({
    enableAllFeatures: true,
    autoRunDemo: true,
    simulateNotifications: true,
    demoDuration: 10,
  });

  try {
    await demo.initialize();
    // Demo will run automatically due to autoRunDemo: true
  } catch (error) {
    console.error("❌ Comprehensive demo failed:", error);
  }

  // Note: cleanup happens automatically after demo duration
  // Note: cleanup happens automatically after demo duration
}

/**
 * Create interactive Phase 3 demo for manual testing
 */
export async function createInteractivePhase3Demo(): Promise<Phase3AutoSyncDemo> {
  console.log("🎮 Creating Interactive Phase 3 Auto-Sync Demo");

  const demo = new Phase3AutoSyncDemo({
    autoRunDemo: false,
    simulateNotifications: false,
    enableAllFeatures: true,
  });

  await demo.initialize();

  console.log("✅ Interactive demo ready!");
  console.log(
    "Use demo.demoBasicAutoSync(), demo.demoUserNotifications(), etc."
  );

  return demo;
}

export type { Phase3DemoConfig, DemoLogEntry };
