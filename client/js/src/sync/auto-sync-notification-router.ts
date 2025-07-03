//! Auto-Sync Notification Router - Phase 3
//!
//! This module handles routing WebSocket notifications to appropriate sync operations.
//! It provides intelligent notification filtering, domain mapping, and debounced sync
//! triggering for real-time auto-sync functionality.

import type {
  SyncDomain,
  AutoSyncTrigger,
  WebSocketNotification,
  NotificationSyncRule,
} from "./types.js";
import type { NotificationChannel } from "../lib/websocket-types.js";
import type { WebSocketClient } from "../lib/websocket-client.js";
import type { UnifiedSyncManager } from "./types.js";

/**
 * Configuration for auto-sync notification routing
 */
export interface AutoSyncNotificationConfig {
  /** Enable notification-based auto-sync */
  enabled: boolean;
  /** Debounce delay for batching notifications (ms) */
  debounceDelay: number;
  /** Maximum notifications to queue before forcing sync */
  maxQueueSize: number;
  /** Notification channels to monitor */
  monitoredChannels: NotificationChannel[];
  /** Domain-specific sync rules */
  syncRules: NotificationSyncRule[];
  /** Enable user notifications for sync events */
  userNotifications: boolean;
  /** Priority thresholds for immediate sync */
  priorityThresholds: {
    immediate: string[]; // e.g., ['high', 'critical']
    batched: string[]; // e.g., ['medium', 'low']
  };
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Notification queue entry for batched processing
 */
interface QueuedNotification {
  notification: WebSocketNotification;
  receivedAt: number;
  domain: SyncDomain;
  priority: number;
}

/**
 * Debounce state for domain-specific sync triggers
 */
interface DebouncedSyncState {
  timeout: NodeJS.Timeout | null;
  pendingNotifications: QueuedNotification[];
  lastTrigger: number;
}

/**
 * Domain-specific sync statistics
 */
interface DomainSyncStats {
  triggers: number;
  lastSync: number;
}

/**
 * Auto-sync notification router implementation
 */
export class AutoSyncNotificationRouter {
  private syncManager: UnifiedSyncManager;
  private wsClient: WebSocketClient;
  private config: AutoSyncNotificationConfig;

  // State management
  private isActive = false;
  private notificationQueue: QueuedNotification[] = [];
  private domainDebounceState = new Map<SyncDomain, DebouncedSyncState>();
  // Event listeners managed by sync manager

  // Statistics
  private stats = {
    notificationsReceived: 0,
    syncsTriggered: 0,
    lastActivity: 0,
    musicUpdates: 0,
    domainStats: new Map<SyncDomain, DomainSyncStats>(),
  };

  constructor(
    syncManager: UnifiedSyncManager,
    wsClient: WebSocketClient,
    config: AutoSyncNotificationConfig
  ) {
    this.syncManager = syncManager;
    this.wsClient = wsClient;
    this.config = config;

    // Initialize domain debounce state
    this.initializeDomainStates();
  }

  /**
   * Start the notification router
   */
  async start(): Promise<void> {
    if (this.isActive) {
      this.log("already active");
      return;
    }

    this.log("starting auto-sync notification router", {
      enabled: this.config.enabled,
      syncRules: this.config.syncRules?.length || 0,
      monitoredChannels: this.config.monitoredChannels,
    });

    // Subscribe to configured notification channels
    await this.subscribeToChannels();

    // Set up WebSocket notification listeners
    this.setupWebSocketListeners();

    this.isActive = true;
    this.log("auto-sync notification router started");
  }

  /**
   * Stop the notification router
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      this.log("already stopped");
      return;
    }

    this.log("stopping auto-sync notification router");

    // Clear all debounce timeouts
    this.clearAllDebounceTimeouts();

    // Unsubscribe from channels
    await this.unsubscribeFromChannels();

    // Clear WebSocket listeners
    this.clearWebSocketListeners();

    this.isActive = false;
    this.log("auto-sync notification router stopped");
  }

  /**
   * Process a notification and trigger syncs as needed
   */
  async processNotification(
    notification: WebSocketNotification
  ): Promise<void> {
    this.log("processNotification called", {
      channel: notification.channel,
      eventType: notification.eventType,
      isActive: this.isActive,
      configEnabled: this.config.enabled,
    });

    if (!this.isActive || !this.config.enabled) {
      this.log("router not active or disabled, skipping");
      return;
    }

    this.stats.notificationsReceived++;
    this.stats.lastActivity = Date.now();

    // Special handling for music library update notifications
    if (
      notification.channel === "MediaBlobs" &&
      notification.eventType === "music.library.updated"
    ) {
      this.log("music library update detected", notification.payload);
      this.stats.musicUpdates++;
    }

    // Determine target domain(s) for this notification
    const targetDomains = this.getTargetDomains(notification);

    if (targetDomains.length === 0) {
      this.log("no target domains for notification, skipping");
      return;
    }

    this.log("processing notification for domains", { targetDomains });

    // Create queued notifications for each target domain
    for (const domain of targetDomains) {
      const queuedNotification: QueuedNotification = {
        notification,
        receivedAt: Date.now(),
        domain,
        priority: this.calculatePriority(notification, domain),
      };

      // Check if immediate sync is required
      if (this.shouldTriggerImmediateSync(queuedNotification)) {
        await this.triggerImmediateSync(queuedNotification);
      } else {
        this.queueForBatchedSync(queuedNotification);
      }
    }
  }

  /**
   * Get current router statistics
   */
  getStats() {
    return {
      ...this.stats,
      isActive: this.isActive,
      queueSize: this.notificationQueue.length,
      domainStats: Object.fromEntries(this.stats.domainStats),
    };
  }

  /**
   * Update router configuration
   */
  updateConfig(newConfig: Partial<AutoSyncNotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log("⚙️ Auto-sync notification router config updated");
  }

  /**
   * Get pending notifications for a domain
   */
  getPendingNotifications(domain?: SyncDomain): QueuedNotification[] {
    if (domain) {
      const debounceState = this.domainDebounceState.get(domain);
      return debounceState?.pendingNotifications || [];
    }
    return this.notificationQueue;
  }

  /**
   * Force sync for a domain (bypass debouncing)
   */
  async forceSyncForDomain(domain: SyncDomain): Promise<void> {
    console.log(`🔄 Force syncing domain: ${domain}`);

    // Clear any pending debounce for this domain
    this.clearDomainDebounce(domain);

    // Trigger sync immediately
    await this.triggerDomainSync(domain, "manual", []);
  }

  /**
   * Initialize debounce state for all domains
   */
  private initializeDomainStates(): void {
    const domains: SyncDomain[] = ["music", "photos", "documents", "videos"];

    for (const domain of domains) {
      this.domainDebounceState.set(domain, {
        timeout: null,
        pendingNotifications: [],
        lastTrigger: 0,
      });

      this.stats.domainStats.set(domain, {
        triggers: 0,
        lastSync: 0,
      });
    }
  }

  /**
   * Subscribe to notification channels
   */
  private async subscribeToChannels(): Promise<void> {
    for (const channel of this.config.monitoredChannels) {
      const success = this.wsClient.subscribeToNotifications(channel);
      if (success) {
        console.log(`📡 Subscribed to channel: ${channel}`);
      } else {
        console.warn(`⚠️ Failed to subscribe to channel: ${channel}`);
      }
    }
  }

  /**
   * Unsubscribe from notification channels
   */
  private async unsubscribeFromChannels(): Promise<void> {
    for (const channel of this.config.monitoredChannels) {
      const success = this.wsClient.unsubscribeFromNotifications(channel);
      if (success) {
        console.log(`📡 Unsubscribed from channel: ${channel}`);
      }
    }
  }

  /**
   * Set up WebSocket notification listeners
   */
  private setupWebSocketListeners(): void {
    console.log("🔧 AutoSyncNotificationRouter setting up WebSocket listeners");

    // Listen for notifications
    this.wsClient.on(
      "notification",
      this.handleWebSocketNotification.bind(this)
    );

    // Listen for connection status changes
    this.wsClient.on(
      "statusChange",
      this.handleConnectionStatusChange.bind(this)
    );

    console.log("✅ AutoSyncNotificationRouter WebSocket listeners set up");
  }

  /**
   * Clear WebSocket listeners
   */
  private clearWebSocketListeners(): void {
    this.wsClient.off("notification");
    this.wsClient.off("statusChange");
  }

  /**
   * Handle incoming WebSocket notification
   */
  private async handleWebSocketNotification(data: {
    id: string;
    channel: NotificationChannel;
    event_type: string;
    payload?: any;
    priority: string;
    timestamp: string;
  }): Promise<void> {
    this.log("received WebSocket notification", {
      id: data.id,
      channel: data.channel,
      event_type: data.event_type,
      priority: data.priority,
    });

    // Convert snake_case to camelCase for internal processing
    const notification: WebSocketNotification = {
      id: data.id,
      channel: data.channel,
      eventType: data.event_type, // Convert event_type to eventType
      payload: data.payload,
      priority: data.priority,
      timestamp: data.timestamp,
    };

    await this.processNotification(notification);
  }

  /**
   * Handle WebSocket connection status changes
   */
  private handleConnectionStatusChange(status: string): void {
    console.log(`🔌 WebSocket connection status: ${status}`);

    if (status === "connected") {
      // Resubscribe to channels after reconnection
      this.subscribeToChannels();
    }
  }

  /**
   * Determine target domains for a notification
   */
  private getTargetDomains(notification: WebSocketNotification): SyncDomain[] {
    const domains: SyncDomain[] = [];

    // Apply sync rules
    for (const rule of this.config.syncRules) {
      if (this.doesNotificationMatchRule(notification, rule)) {
        domains.push(...rule.targetDomains);
      }
    }

    // Default channel-to-domain mapping
    const defaultMapping = this.getDefaultChannelMapping(notification.channel);
    if (defaultMapping.length > 0 && domains.length === 0) {
      domains.push(...defaultMapping);
    }

    // Remove duplicates
    return [...new Set(domains)];
  }

  /**
   * Check if notification matches a sync rule
   */
  private doesNotificationMatchRule(
    notification: WebSocketNotification,
    rule: NotificationSyncRule
  ): boolean {
    // Channel match
    if (rule.channels && !rule.channels.includes(notification.channel)) {
      return false;
    }

    // Event type match
    if (rule.eventTypes && !rule.eventTypes.includes(notification.eventType)) {
      return false;
    }

    // Priority match
    if (rule.priorities && !rule.priorities.includes(notification.priority)) {
      return false;
    }

    // Payload conditions
    if (rule.payloadConditions && notification.payload) {
      for (const [key, expectedValue] of Object.entries(
        rule.payloadConditions
      )) {
        if (notification.payload[key] !== expectedValue) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get default domain mapping for notification channel
   */
  private getDefaultChannelMapping(channel: NotificationChannel): SyncDomain[] {
    switch (channel) {
      case "MediaBlobs":
        return ["music", "photos", "videos"];
      case "ThumbnailJobs":
        return ["photos", "videos"];
      case "UserAuth":
        return []; // No automatic sync for auth events
      case "System":
        return ["music", "photos", "documents", "videos"]; // System-wide
      case "Analytics":
        return []; // No sync for analytics
      default:
        return [];
    }
  }

  /**
   * Calculate priority score for notification
   */
  private calculatePriority(
    notification: WebSocketNotification,
    domain: SyncDomain
  ): number {
    let priority = 0;

    // Base priority from notification
    switch (notification.priority) {
      case "critical":
        priority += 100;
        break;
      case "high":
        priority += 75;
        break;
      case "medium":
        priority += 50;
        break;
      case "low":
        priority += 25;
        break;
      default:
        priority += 10;
    }

    // Channel-specific adjustments
    switch (notification.channel) {
      case "MediaBlobs":
        priority += 20;
        break;
      case "ThumbnailJobs":
        priority += 10;
        break;
      case "System":
        priority += 30;
        break;
    }

    // Domain-specific adjustments
    const domainStats = this.stats.domainStats.get(domain);
    if (domainStats) {
      const timeSinceLastSync = Date.now() - domainStats.lastSync;
      if (timeSinceLastSync > 300000) {
        // 5 minutes
        priority += 15;
      }
    }

    return priority;
  }

  /**
   * Check if notification should trigger immediate sync
   */
  private shouldTriggerImmediateSync(
    queuedNotification: QueuedNotification
  ): boolean {
    const { notification } = queuedNotification;

    // High priority notifications
    if (
      this.config.priorityThresholds.immediate.includes(notification.priority)
    ) {
      return true;
    }

    // Queue overflow protection
    if (this.notificationQueue.length >= this.config.maxQueueSize) {
      return true;
    }

    // Special handling for music library updates
    if (
      notification.channel === "MediaBlobs" &&
      notification.eventType === "music.library.updated"
    ) {
      // Create a delayed sync to ensure all DB operations are complete
      setTimeout(() => {
        console.log(
          "🎵 Music library updated from CLI scan, scheduling delayed sync"
        );
        this.triggerDomainSync(
          queuedNotification.domain,
          "notification-immediate", // Use a valid AutoSyncTrigger
          [queuedNotification]
        );
      }, 5000); // 5-second delay before sync to ensure DB operations are complete

      // Return false as we're handling it with setTimeout
      return false;
    }

    return false;
  }

  /**
   * Trigger immediate sync for high-priority notification
   */
  private async triggerImmediateSync(
    queuedNotification: QueuedNotification
  ): Promise<void> {
    const { domain } = queuedNotification;

    console.log(`⚡ Triggering immediate sync for domain: ${domain}`);

    // Clear any pending debounce for this domain
    this.clearDomainDebounce(domain);

    // Trigger sync
    await this.triggerDomainSync(domain, "notification-immediate", [
      queuedNotification,
    ]);
  }

  /**
   * Queue notification for batched sync
   */
  private queueForBatchedSync(queuedNotification: QueuedNotification): void {
    const { domain } = queuedNotification;
    const debounceState = this.domainDebounceState.get(domain);

    if (!debounceState) {
      console.warn(`No debounce state for domain: ${domain}`);
      return;
    }

    // Add to domain-specific queue
    debounceState.pendingNotifications.push(queuedNotification);

    // Clear existing timeout
    if (debounceState.timeout) {
      clearTimeout(debounceState.timeout);
    }

    // Set new debounce timeout
    debounceState.timeout = setTimeout(async () => {
      await this.triggerBatchedSync(domain);
    }, this.config.debounceDelay);

    this.log(`queued notification for batched sync: ${domain}`, {
      pendingCount: debounceState.pendingNotifications.length,
    });
  }

  /**
   * Trigger batched sync for a domain
   */
  private async triggerBatchedSync(domain: SyncDomain): Promise<void> {
    const debounceState = this.domainDebounceState.get(domain);

    if (!debounceState || debounceState.pendingNotifications.length === 0) {
      return;
    }

    console.log(
      `📦 Triggering batched sync for domain: ${domain} (${debounceState.pendingNotifications.length} notifications)`
    );

    const notifications = [...debounceState.pendingNotifications];

    // Clear state
    debounceState.pendingNotifications = [];
    debounceState.timeout = null;

    // Trigger sync
    await this.triggerDomainSync(domain, "notification-batched", notifications);
  }

  /**
   * Trigger sync for a specific domain
   */
  private async triggerDomainSync(
    domain: SyncDomain,
    trigger: AutoSyncTrigger,
    notifications: QueuedNotification[]
  ): Promise<void> {
    // Update statistics
    const domainStats = this.stats.domainStats.get(domain);
    if (domainStats) {
      domainStats.triggers++;
      domainStats.lastSync = Date.now();
    }
    this.stats.syncsTriggered++;

    // Special handling for music library updates
    let syncOptions: any = { includeBinaryData: true };

    // Handle music library updates with special options
    const isMusicLibraryUpdate = notifications.some(
      (n) =>
        n.notification.channel === "MediaBlobs" &&
        n.notification.eventType === "music.library.updated"
    );

    if (isMusicLibraryUpdate) {
      this.log("using special options for music library update sync");
      syncOptions = {
        ...syncOptions,
        forceRefresh: true,
        // Only sync metadata first, then binary data in a separate pass
        // This ensures users see new music entries quickly
        syncStrategy: "metadata-first",
      };
    }

    // Update debounce state
    const debounceState = this.domainDebounceState.get(domain);
    if (debounceState) {
      debounceState.lastTrigger = Date.now();
    }

    this.log(`auto-sync triggered for ${domain}`, {
      trigger,
      notificationCount: notifications.length,
      notificationIds: notifications.map((n) => n.notification.id),
    });

    try {
      // Trigger the actual sync through the sync manager
      await this.syncManager.syncDomain(domain, syncOptions);

      this.log(
        `auto-sync completed for ${domain}`,
        isMusicLibraryUpdate ? { musicLibraryUpdate: true } : {}
      );
    } catch (error) {
      console.error(`Auto-sync failed for ${domain}:`, error);
    }
  }

  /**
   * Clear debounce timeout for a specific domain
   */
  private clearDomainDebounce(domain: SyncDomain): void {
    const debounceState = this.domainDebounceState.get(domain);
    if (debounceState?.timeout) {
      clearTimeout(debounceState.timeout);
      debounceState.timeout = null;
    }
  }

  /**
   * Clear all debounce timeouts
   */
  private clearAllDebounceTimeouts(): void {
    for (const [domain] of this.domainDebounceState) {
      this.clearDomainDebounce(domain);
    }
  }

  /**
   * Debug logging (toggleable via config)
   */
  private log(message: string, data?: any): void {
    if (this.config.debug) {
      console.log(`[AutoSyncNotificationRouter] ${message}`, data || "");
    }
  }
}

/**
 * Create auto-sync notification router with default configuration
 */
export function createAutoSyncNotificationRouter(
  syncManager: UnifiedSyncManager,
  wsClient: WebSocketClient,
  config?: Partial<AutoSyncNotificationConfig>
): AutoSyncNotificationRouter {
  const defaultConfig: AutoSyncNotificationConfig = {
    enabled: true,
    debounceDelay: 5000, // 5 seconds
    maxQueueSize: 50,
    monitoredChannels: ["MediaBlobs", "ThumbnailJobs", "System"],
    debug: false,
    syncRules: [
      // Music library updates - specific handling for CLI music scan completion
      {
        id: "music-library-updates",
        channels: ["MediaBlobs"],
        eventTypes: ["music.library.updated"],
        targetDomains: ["music"],
        priorities: ["high"],
      },
      // Song database trigger events - real-time song CRUD operations
      {
        id: "song-database-events",
        channels: ["MediaBlobs"],
        eventTypes: ["song.created", "song.updated", "song.deleted"],
        targetDomains: ["music"],
        priorities: ["high"],
      },
      // Media content updates
      {
        id: "media-content-updates",
        channels: ["MediaBlobs"],
        eventTypes: ["content.created", "content.updated", "content.processed"],
        targetDomains: ["music", "photos", "videos"],
        priorities: ["high", "medium"],
      },
      // Thumbnail generation
      {
        id: "thumbnail-updates",
        channels: ["ThumbnailJobs"],
        eventTypes: ["thumbnail.completed", "thumbnail.batch_completed"],
        targetDomains: ["photos", "videos"],
        priorities: ["medium", "low"],
      },
      // System-wide updates
      {
        id: "system-updates",
        channels: ["System"],
        eventTypes: ["sync.force_refresh", "content.bulk_update"],
        targetDomains: ["music", "photos", "documents", "videos"],
        priorities: ["critical", "high"],
      },
    ],
    userNotifications: true,
    priorityThresholds: {
      immediate: ["critical", "high"],
      batched: ["medium", "low"],
    },
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new AutoSyncNotificationRouter(syncManager, wsClient, finalConfig);
}

/**
 * Default notification sync rules for common scenarios
 */
export const DEFAULT_SYNC_RULES: NotificationSyncRule[] = [
  // New media uploads
  {
    id: "new-media-uploads",
    channels: ["MediaBlobs"],
    eventTypes: ["upload.completed", "content.created"],
    targetDomains: ["music", "photos", "videos"],
    priorities: ["high", "medium"],
    description: "Sync new media uploads across relevant domains",
  },

  // Thumbnail generation completed
  {
    id: "thumbnail-generation",
    channels: ["ThumbnailJobs"],
    eventTypes: ["thumbnail.completed", "thumbnail.batch_completed"],
    targetDomains: ["photos", "videos"],
    priorities: ["medium"],
    description: "Sync when thumbnails are generated",
  },

  // Document processing
  {
    id: "document-processing",
    channels: ["System"],
    eventTypes: ["document.processed", "document.indexed"],
    targetDomains: ["documents"],
    priorities: ["medium", "low"],
    description: "Sync when documents are processed",
  },

  // Critical system updates
  {
    id: "critical-system-updates",
    channels: ["System"],
    eventTypes: ["sync.force_refresh", "system.maintenance_complete"],
    targetDomains: ["music", "photos", "documents", "videos"],
    priorities: ["critical"],
    description: "Force sync for critical system updates",
  },
];
