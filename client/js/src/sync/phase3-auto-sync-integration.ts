//! Phase 3: Auto-Sync & Notifications Integration
//!
//! This module integrates all Phase 3 components to provide a complete
//! auto-sync and notification system. It combines notification routing,
//! enhanced auto-sync management, user notifications, and service worker
//! background sync into a cohesive system.

import type { UnifiedSyncManager, SyncDomain } from "./types.js";

import { SyncEventType } from "./types.js";

import type { WebSocketClient } from "../lib/websocket-client.js";
import type { ServiceWorkerSyncManager } from "./service-worker-types.js";

import {
  AutoSyncNotificationRouter,
  createAutoSyncNotificationRouter,
  type AutoSyncNotificationConfig,
} from "./auto-sync-notification-router.js";

import {
  EnhancedAutoSyncManager,
  createEnhancedAutoSyncManager,
  type EnhancedAutoSyncConfig,
} from "./enhanced-auto-sync-manager.js";

import {
  UserNotificationManager,
  createUserNotificationManager,
  type UserNotificationConfig,
} from "./user-notification-manager.js";

/**
 * Phase 3 auto-sync system configuration
 */
export interface Phase3AutoSyncConfig {
  /** Core auto-sync configuration */
  autoSync: Partial<EnhancedAutoSyncConfig>;
  /** Notification routing configuration */
  notificationRouting: Partial<AutoSyncNotificationConfig>;
  /** User notification configuration */
  userNotifications: Partial<UserNotificationConfig>;
  /** Integration settings */
  integration: {
    /** Enable notification router integration */
    enableNotificationRouter: boolean;
    /** Enable user notifications */
    enableUserNotifications: boolean;
    /** Enable service worker integration */
    enableServiceWorker: boolean;
    /** Auto-start on initialization */
    autoStart: boolean;
    /** Debug mode */
    debug: boolean;
  };
  /** Advanced features */
  advanced: {
    /** Enable intelligent sync scheduling */
    intelligentScheduling: boolean;
    /** Enable cross-domain sync optimization */
    crossDomainOptimization: boolean;
    /** Enable predictive pre-syncing */
    predictivePreSync: boolean;
    /** Enable sync analytics */
    enableAnalytics: boolean;
  };
}

/**
 * Phase 3 auto-sync system statistics
 */
export interface Phase3Stats {
  /** Auto-sync manager stats */
  autoSync: any;
  /** Notification router stats */
  notificationRouter: any;
  /** User notification stats */
  userNotifications: any;
  /** Overall system stats */
  system: {
    totalSyncsTriggered: number;
    averageResponseTime: number;
    lastActivity: Date;
    uptime: number;
    errorRate: number;
  };
}

/**
 * Phase 3 auto-sync system status
 */
export interface Phase3Status {
  /** System enabled state */
  enabled: boolean;
  /** Individual component status */
  components: {
    autoSyncManager: boolean;
    notificationRouter: boolean;
    userNotifications: boolean;
    serviceWorker: boolean;
  };
  /** Resource status */
  resources: {
    battery: { level: number; charging: boolean };
    connection: { type: string; quality: string };
    memory: { usage: number; available: number };
  };
  /** Active sync operations */
  activeSyncs: {
    domain: SyncDomain;
    trigger: string;
    startTime: Date;
    progress: number;
  }[];
}

/**
 * Complete Phase 3 auto-sync system implementation
 */
export class Phase3AutoSyncSystem {
  private syncManager: UnifiedSyncManager;
  private wsClient: WebSocketClient;
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null;
  private config: Phase3AutoSyncConfig;

  // Core components
  private autoSyncManager: EnhancedAutoSyncManager | null = null;
  private notificationRouter: AutoSyncNotificationRouter | null = null;
  private userNotificationManager: UserNotificationManager | null = null;

  // State management
  private isInitialized = false;
  private isEnabled = false;
  private startTime: Date | null = null;
  // Event listeners managed by sync manager

  // Statistics and monitoring
  private stats = {
    totalSyncsTriggered: 0,
    totalNotificationsProcessed: 0,
    errorCount: 0,
    lastActivity: new Date(),
  };

  constructor(
    syncManager: UnifiedSyncManager,
    wsClient: WebSocketClient,
    config: Phase3AutoSyncConfig,
    serviceWorkerSyncManager?: ServiceWorkerSyncManager
  ) {
    this.syncManager = syncManager;
    this.wsClient = wsClient;
    this.config = config;
    this.serviceWorkerSyncManager = serviceWorkerSyncManager || null;
  }

  /**
   * Initialize the complete Phase 3 auto-sync system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("🚀 Phase 3 auto-sync system already initialized");
      return;
    }

    console.log("🚀 Initializing Phase 3 auto-sync system...");
    this.startTime = new Date();

    try {
      // 1. Initialize notification router
      if (this.config.integration.enableNotificationRouter) {
        await this.initializeNotificationRouter();
      }

      // 2. Initialize enhanced auto-sync manager
      await this.initializeAutoSyncManager();

      // 3. Initialize user notification manager
      if (this.config.integration.enableUserNotifications) {
        await this.initializeUserNotificationManager();
      }

      // 4. Set up component integration
      await this.setupComponentIntegration();

      // 5. Set up system monitoring
      this.setupSystemMonitoring();

      this.isInitialized = true;

      // Auto-start if configured
      if (this.config.integration.autoStart) {
        await this.enable();
      }

      console.log("✅ Phase 3 auto-sync system initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Phase 3 auto-sync system:", error);
      throw error;
    }
  }

  /**
   * Enable the auto-sync system
   */
  async enable(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("System must be initialized before enabling");
    }

    if (this.isEnabled) {
      console.log("🔄 Phase 3 auto-sync system already enabled");
      return;
    }

    console.log("🔛 Enabling Phase 3 auto-sync system...");

    try {
      // Enable auto-sync manager
      if (this.autoSyncManager) {
        await this.autoSyncManager.enable();
      }

      // Start notification router
      if (this.notificationRouter) {
        await this.notificationRouter.start();
      }

      // Enable user notifications
      if (this.userNotificationManager) {
        await this.userNotificationManager.initialize();
      }

      this.isEnabled = true;
      this.logSystemEvent("system_enabled");

      console.log("✅ Phase 3 auto-sync system enabled");
    } catch (error) {
      console.error("❌ Failed to enable Phase 3 auto-sync system:", error);
      throw error;
    }
  }

  /**
   * Disable the auto-sync system
   */
  async disable(): Promise<void> {
    if (!this.isEnabled) {
      console.log("⏹️ Phase 3 auto-sync system already disabled");
      return;
    }

    console.log("⏹️ Disabling Phase 3 auto-sync system...");

    try {
      // Disable auto-sync manager
      if (this.autoSyncManager) {
        await this.autoSyncManager.disable();
      }

      // Stop notification router
      if (this.notificationRouter) {
        await this.notificationRouter.stop();
      }

      // Shutdown user notifications
      if (this.userNotificationManager) {
        await this.userNotificationManager.shutdown();
      }

      this.isEnabled = false;
      this.logSystemEvent("system_disabled");

      console.log("✅ Phase 3 auto-sync system disabled");
    } catch (error) {
      console.error("❌ Failed to disable Phase 3 auto-sync system:", error);
      throw error;
    }
  }

  /**
   * Get comprehensive system status
   */
  getStatus(): Phase3Status {
    const resources = this.getCurrentResourceStatus();

    return {
      enabled: this.isEnabled,
      components: {
        autoSyncManager: !!this.autoSyncManager,
        notificationRouter: !!this.notificationRouter,
        userNotifications: !!this.userNotificationManager,
        serviceWorker: !!this.serviceWorkerSyncManager,
      },
      resources,
      activeSyncs: this.getActiveSyncs(),
    };
  }

  /**
   * Get comprehensive system statistics
   */
  getStats(): Phase3Stats {
    return {
      autoSync: this.autoSyncManager?.getStats() || null,
      notificationRouter: this.notificationRouter?.getStats() || null,
      userNotifications: this.userNotificationManager?.getStats() || null,
      system: {
        totalSyncsTriggered: this.stats.totalSyncsTriggered,
        averageResponseTime: 0, // Would be calculated from response times
        lastActivity: this.stats.lastActivity,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        errorRate:
          this.stats.errorCount / Math.max(this.stats.totalSyncsTriggered, 1),
      },
    };
  }

  /**
   * Update system configuration
   */
  async updateConfig(newConfig: Partial<Phase3AutoSyncConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };

    // Update component configurations
    if (this.autoSyncManager && newConfig.autoSync) {
      this.autoSyncManager.updateConfig(newConfig.autoSync);
    }

    if (this.notificationRouter && newConfig.notificationRouting) {
      this.notificationRouter.updateConfig(newConfig.notificationRouting);
    }

    if (this.userNotificationManager && newConfig.userNotifications) {
      this.userNotificationManager.updateConfig(newConfig.userNotifications);
    }

    this.logSystemEvent("config_updated");
    console.log("⚙️ Phase 3 auto-sync system configuration updated");
  }

  /**
   * Trigger manual sync for specific domain
   */
  async triggerManualSync(
    domain: SyncDomain,
    options?: {
      includeBinaryData?: boolean;
      priority?: number;
      reason?: string;
    }
  ): Promise<void> {
    if (!this.isEnabled) {
      throw new Error("Auto-sync system is disabled");
    }

    console.log(`🔄 Manual sync triggered for ${domain}`);

    if (this.autoSyncManager) {
      await this.autoSyncManager.forceSync(domain, options?.reason || "manual");
    } else {
      // Fallback to direct sync manager
      await this.syncManager.syncDomain(domain, {
        includeBinaryData: options?.includeBinaryData ?? true,
      });
    }

    this.stats.totalSyncsTriggered++;
    this.stats.lastActivity = new Date();
  }

  /**
   * Get pending notifications for processing
   */
  getPendingNotifications(domain?: SyncDomain): any[] {
    if (!this.notificationRouter) return [];
    return this.notificationRouter.getPendingNotifications(domain);
  }

  /**
   * Add custom sync rule
   */
  addSyncRule(rule: any): void {
    if (!this.autoSyncManager) {
      throw new Error("Auto-sync manager not initialized");
    }

    this.autoSyncManager.addRule(rule);
    this.logSystemEvent("rule_added", { ruleId: rule.id });
  }

  /**
   * Remove sync rule
   */
  removeSyncRule(ruleId: string): void {
    if (!this.autoSyncManager) {
      throw new Error("Auto-sync manager not initialized");
    }

    this.autoSyncManager.removeRule(ruleId);
    this.logSystemEvent("rule_removed", { ruleId });
  }

  /**
   * Send user notification
   */
  async sendUserNotification(notification: any): Promise<void> {
    if (!this.userNotificationManager) {
      console.warn("User notification manager not available");
      return;
    }

    await this.userNotificationManager.sendInAppNotification(notification);
  }

  /**
   * Get active sync rules
   */
  getActiveSyncRules(): any[] {
    if (!this.autoSyncManager) return [];
    return this.autoSyncManager.getActiveRules();
  }

  /**
   * Perform system health check
   */
  async performHealthCheck(): Promise<{
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check component health
    if (!this.autoSyncManager) {
      issues.push("Auto-sync manager not initialized");
    }

    if (
      this.config.integration.enableNotificationRouter &&
      !this.notificationRouter
    ) {
      issues.push("Notification router not initialized");
    }

    if (
      this.config.integration.enableUserNotifications &&
      !this.userNotificationManager
    ) {
      issues.push("User notification manager not initialized");
    }

    // Check WebSocket connection
    if (this.wsClient.getStatus() !== "connected") {
      issues.push("WebSocket connection not active");
      recommendations.push("Check network connectivity");
    }

    // Check permissions
    if (this.config.integration.enableUserNotifications) {
      if (!this.userNotificationManager?.hasPushPermission()) {
        recommendations.push(
          "Grant notification permissions for better user experience"
        );
      }
    }

    // Check resource constraints
    const resourceStatus = this.getCurrentResourceStatus();
    if (
      resourceStatus.battery.level < 0.2 &&
      !resourceStatus.battery.charging
    ) {
      recommendations.push("Low battery detected - auto-sync may be limited");
    }

    return {
      healthy: issues.length === 0,
      issues,
      recommendations,
    };
  }

  /**
   * Initialize notification router component
   */
  private async initializeNotificationRouter(): Promise<void> {
    console.log("📡 Initializing notification router...");

    this.notificationRouter = createAutoSyncNotificationRouter(
      this.syncManager,
      this.wsClient,
      this.config.notificationRouting
    );

    console.log("✅ Notification router initialized");
  }

  /**
   * Initialize enhanced auto-sync manager
   */
  private async initializeAutoSyncManager(): Promise<void> {
    console.log("🔄 Initializing enhanced auto-sync manager...");

    this.autoSyncManager = createEnhancedAutoSyncManager(
      this.syncManager,
      this.config.autoSync,
      this.serviceWorkerSyncManager || undefined,
      this.notificationRouter || undefined
    );

    console.log("✅ Enhanced auto-sync manager initialized");
  }

  /**
   * Initialize user notification manager
   */
  private async initializeUserNotificationManager(): Promise<void> {
    console.log("📢 Initializing user notification manager...");

    this.userNotificationManager = createUserNotificationManager(
      this.syncManager,
      this.config.userNotifications,
      this.serviceWorkerSyncManager || undefined
    );

    console.log("✅ User notification manager initialized");
  }

  /**
   * Set up integration between components
   */
  private async setupComponentIntegration(): Promise<void> {
    console.log("🔗 Setting up component integration...");

    // Connect notification router to auto-sync manager
    if (this.notificationRouter && this.autoSyncManager) {
      // The notification router will call autoSyncManager.triggerSync()
      // when relevant notifications are received
    }

    // Connect auto-sync events to user notifications
    if (this.autoSyncManager && this.userNotificationManager) {
      // User notification manager will listen to sync manager events
      // This is handled automatically through the sync manager's event system
    }

    console.log("✅ Component integration complete");
  }

  /**
   * Set up system monitoring and analytics
   */
  private setupSystemMonitoring(): void {
    if (!this.config.advanced.enableAnalytics) return;

    console.log("📊 Setting up system monitoring...");

    // Monitor sync events
    this.syncManager.on(SyncEventType.AutoSyncTriggered, (event) => {
      this.stats.totalSyncsTriggered++;
      this.stats.lastActivity = new Date();
      this.logSystemEvent("auto_sync_triggered", { event });
    });

    this.syncManager.on(SyncEventType.Failed, (event) => {
      this.stats.errorCount++;
      this.logSystemEvent("sync_failed", { event });
    });

    // Monitor notification processing
    if (this.notificationRouter) {
      // Would set up notification monitoring here
    }

    console.log("✅ System monitoring setup complete");
  }

  /**
   * Get current resource status
   */
  private getCurrentResourceStatus(): Phase3Status["resources"] {
    // This would integrate with the resource monitor from enhanced auto-sync manager
    return {
      battery: { level: 1.0, charging: false },
      connection: { type: "wifi", quality: "good" },
      memory: { usage: 50, available: 100 },
    };
  }

  /**
   * Get currently active sync operations
   */
  private getActiveSyncs(): Phase3Status["activeSyncs"] {
    // This would track active sync operations
    return [];
  }

  /**
   * Log system events for analytics
   */
  private logSystemEvent(event: string, data?: any): void {
    if (!this.config.integration.debug) return;

    console.log(`📊 [Phase3] ${event}:`, data);

    // In a real implementation, this would send to analytics service
  }
}

/**
 * Create and configure Phase 3 auto-sync system with sensible defaults
 */
export function createPhase3AutoSyncSystem(
  syncManager: UnifiedSyncManager,
  wsClient: WebSocketClient,
  config?: Partial<Phase3AutoSyncConfig>,
  serviceWorkerSyncManager?: ServiceWorkerSyncManager
): Phase3AutoSyncSystem {
  const defaultConfig: Phase3AutoSyncConfig = {
    autoSync: {
      enabled: true,
      syncOnNewContent: true,
      periodicInterval: 30, // 30 minutes
      domains: ["music", "photos", "documents", "videos"],
      debounceDelay: 5000, // 5 seconds
      customRules: [],
      resourceAwareness: {
        enabled: true,
        batteryThreshold: 0.2,
        connectionTypes: ["wifi", "ethernet"],
        memoryThreshold: 100, // 100MB
      },
      smartScheduling: {
        enabled: true,
        quietHours: { start: "22:00", end: "07:00" },
        adaptiveInterval: true,
        minInterval: 15,
        maxInterval: 120,
      },
      backgroundSync: {
        enabled: true,
        prioritizeBackground: true,
        fallbackToForeground: true,
      },
      userPreferences: {
        respectDataSaver: true,
        respectLowPowerMode: true,
        maxDailySync: 48,
      },
    },
    notificationRouting: {
      enabled: true,
      debounceDelay: 5000,
      maxQueueSize: 50,
      monitoredChannels: ["MediaBlobs", "ThumbnailJobs", "System"],
      syncRules: [], // Will use defaults
      userNotifications: true,
      priorityThresholds: {
        immediate: ["critical", "high"],
        batched: ["medium", "low"],
      },
    },
    userNotifications: {
      inApp: {
        enabled: true,
        position: "top-right",
        autoHide: true,
        autoHideDelay: 5000,
        showProgress: true,
        maxNotifications: 5,
      },
      push: {
        enabled: true,
        requestPermission: true,
        showSyncComplete: true,
        showSyncFailed: true,
        showNewContent: true,
        batchNotifications: true,
        quietHours: { start: "22:00", end: "07:00" },
      },
      filters: {
        domains: ["music", "photos", "documents", "videos"],
        minPriority: "low",
        eventTypes: [
          SyncEventType.AutoSyncTriggered,
          SyncEventType.Progress,
          SyncEventType.AllCompleted,
          SyncEventType.DomainCompleted,
          SyncEventType.Failed,
        ],
        debounceDelay: 1000,
      },
      feedback: {
        enableSounds: false,
        enableVibration: true,
        soundVolume: 0.5,
        customSounds: {},
      },
    },
    integration: {
      enableNotificationRouter: true,
      enableUserNotifications: true,
      enableServiceWorker: !!serviceWorkerSyncManager,
      autoStart: true,
      debug: false,
    },
    advanced: {
      intelligentScheduling: true,
      crossDomainOptimization: true,
      predictivePreSync: false,
      enableAnalytics: true,
    },
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new Phase3AutoSyncSystem(
    syncManager,
    wsClient,
    finalConfig,
    serviceWorkerSyncManager
  );
}

/**
 * Quick setup function for Phase 3 auto-sync with minimal configuration
 */
export async function setupPhase3AutoSync(
  syncManager: UnifiedSyncManager,
  wsClient: WebSocketClient,
  options?: {
    enableBackgroundSync?: boolean;
    enableUserNotifications?: boolean;
    enableDebugMode?: boolean;
    autoStart?: boolean;
  }
): Promise<Phase3AutoSyncSystem> {
  const config: Partial<Phase3AutoSyncConfig> = {
    integration: {
      enableNotificationRouter: true,
      enableUserNotifications: options?.enableUserNotifications ?? true,
      enableServiceWorker: options?.enableBackgroundSync ?? true,
      autoStart: options?.autoStart ?? true,
      debug: options?.enableDebugMode ?? false,
    },
  };

  const system = createPhase3AutoSyncSystem(syncManager, wsClient, config);
  await system.initialize();

  return system;
}

/**
 * Utility function to create a complete Phase 3 demo setup
 */
export async function createPhase3DemoSetup(
  syncManager: UnifiedSyncManager,
  wsClient: WebSocketClient
): Promise<Phase3AutoSyncSystem> {
  console.log("🎯 Setting up Phase 3 demo configuration...");

  const demoConfig: Partial<Phase3AutoSyncConfig> = {
    integration: {
      enableNotificationRouter: true,
      enableUserNotifications: true,
      enableServiceWorker: true,
      autoStart: true,
      debug: true, // Enable debug mode for demo
    },
    autoSync: {
      periodicInterval: 5, // 5 minutes for demo
      debounceDelay: 2000, // 2 seconds for demo
    },
    userNotifications: {
      inApp: {
        enabled: true,
        position: "top-right",
        autoHide: true,
        autoHideDelay: 3000, // 3 seconds for demo
        showProgress: true,
        maxNotifications: 10, // More notifications for demo
      },
      push: {
        enabled: true,
        requestPermission: true,
        showSyncComplete: true,
        showSyncFailed: true,
        showNewContent: true,
        batchNotifications: true,
        quietHours: { start: "22:00", end: "07:00" },
      },
    },
    advanced: {
      intelligentScheduling: true,
      crossDomainOptimization: true,
      predictivePreSync: false,
      enableAnalytics: true,
    },
  };

  const system = createPhase3AutoSyncSystem(syncManager, wsClient, demoConfig);
  await system.initialize();

  console.log("✅ Phase 3 demo setup complete");
  return system;
}

// Types are already exported at declaration
