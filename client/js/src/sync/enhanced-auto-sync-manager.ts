//! Enhanced Auto-Sync Manager - Phase 3
//!
//! This module provides advanced auto-sync capabilities with intelligent scheduling,
//! rule-based triggers, resource awareness, and integration with the service worker
//! background sync system.

import type {
  SyncDomain,
  AutoSyncConfig,
  AutoSyncTrigger,
  AutoSyncRule,
  AutoSyncStats,
  AutoSyncTriggeredEvent,
  SyncEventListener,
  Phase3WebSocketNotification,
} from "./types.js";

import { SyncEventType } from "./types.js";
import type { UnifiedSyncManager } from "./types.js";
import type { ServiceWorkerSyncManager } from "./service-worker-types.js";
import type { AutoSyncNotificationRouter } from "./auto-sync-notification-router.js";

/**
 * Enhanced auto-sync configuration
 */
export interface EnhancedAutoSyncConfig extends AutoSyncConfig {
  /** Custom sync rules */
  customRules: AutoSyncRule[];
  /** Resource awareness settings */
  resourceAwareness: {
    enabled: boolean;
    batteryThreshold: number; // 0.2 = 20%
    connectionTypes: string[]; // ['wifi', '4g']
    memoryThreshold: number; // MB
  };
  /** Smart scheduling */
  smartScheduling: {
    enabled: boolean;
    quietHours: { start: string; end: string }; // "22:00" to "07:00"
    adaptiveInterval: boolean; // Adjust interval based on activity
    minInterval: number; // Minimum interval in minutes
    maxInterval: number; // Maximum interval in minutes
  };
  /** Background sync integration */
  backgroundSync: {
    enabled: boolean;
    prioritizeBackground: boolean;
    fallbackToForeground: boolean;
  };
  /** User preference integration */
  userPreferences: {
    respectDataSaver: boolean;
    respectLowPowerMode: boolean;
    maxDailySync: number; // Maximum syncs per day
  };
}

/**
 * Auto-sync rule execution context
 */
// AutoSyncExecutionContext interface removed - not used in current implementation

/**
 * Current system resource state
 */
interface ResourceState {
  battery: {
    level: number;
    charging: boolean;
  };
  connection: {
    type: string;
    effectiveType: string;
    downlink: number;
  };
  memory: {
    used: number;
    available: number;
  };
  performance: {
    cpuUsage: number;
    isLowPowerMode: boolean;
  };
}

/**
 * Enhanced auto-sync manager implementation
 */
export class EnhancedAutoSyncManager {
  private syncManager: UnifiedSyncManager;
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null;
  private notificationRouter: AutoSyncNotificationRouter | null;
  private config: EnhancedAutoSyncConfig;

  // State management
  private isEnabled = false;
  private scheduledSyncs = new Map<string, NodeJS.Timeout>();
  private activeRules = new Map<string, AutoSyncRule>();
  private resourceMonitor: ResourceMonitor | null = null;

  // Statistics and tracking
  private stats: AutoSyncStats = {
    totalSyncsTriggered: 0,
    ruleBasedTriggers: 0,
    scheduledTriggers: 0,
    notificationTriggers: 0,
    backgroundSyncs: 0,
    failedSyncs: 0,
    lastActivity: new Date(),
    domainStats: new Map(),
    resourceOptimizations: 0,
  };

  private eventListeners = new Map<SyncEventType, Set<SyncEventListener>>();

  constructor(
    syncManager: UnifiedSyncManager,
    config: EnhancedAutoSyncConfig,
    serviceWorkerSyncManager?: ServiceWorkerSyncManager,
    notificationRouter?: AutoSyncNotificationRouter
  ) {
    this.syncManager = syncManager;
    this.config = config;
    this.serviceWorkerSyncManager = serviceWorkerSyncManager || null;
    this.notificationRouter = notificationRouter || null;

    // Initialize resource monitor if resource awareness is enabled
    if (this.config.resourceAwareness.enabled) {
      this.resourceMonitor = new ResourceMonitor();
    }

    // Initialize domain stats
    this.initializeDomainStats();

    // Set up default rules if none provided
    if (this.config.customRules.length === 0) {
      this.config.customRules = this.createDefaultRules();
    }
  }

  /**
   * Enable auto-sync with enhanced features
   */
  async enable(): Promise<void> {
    if (this.isEnabled) {
      console.log("🔄 Enhanced auto-sync already enabled");
      return;
    }

    console.log("🚀 Enabling enhanced auto-sync...");

    // Start resource monitoring
    if (this.resourceMonitor) {
      await this.resourceMonitor.start();
    }

    // Set up periodic sync schedules
    this.setupPeriodicSyncs();

    // Install auto-sync rules
    this.installRules();

    // Set up notification router integration
    if (this.notificationRouter) {
      await this.setupNotificationIntegration();
    }

    // Set up service worker integration
    if (this.serviceWorkerSyncManager && this.config.backgroundSync.enabled) {
      await this.setupServiceWorkerIntegration();
    }

    this.isEnabled = true;

    console.log("✅ Enhanced auto-sync enabled");
  }

  /**
   * Disable auto-sync
   */
  async disable(): Promise<void> {
    if (!this.isEnabled) {
      console.log("🔄 Enhanced auto-sync already disabled");
      return;
    }

    console.log("⏹️ Disabling enhanced auto-sync...");

    // Clear all scheduled syncs
    this.clearAllScheduledSyncs();

    // Stop resource monitoring
    if (this.resourceMonitor) {
      await this.resourceMonitor.stop();
    }

    // Stop notification router
    if (this.notificationRouter) {
      await this.notificationRouter.stop();
    }

    this.isEnabled = false;

    console.log("✅ Enhanced auto-sync disabled");
  }

  /**
   * Add custom auto-sync rule
   */
  addRule(rule: AutoSyncRule): void {
    this.activeRules.set(rule.id, rule);
    this.config.customRules.push(rule);

    if (this.isEnabled) {
      this.installRule(rule);
    }

    console.log(`📋 Added auto-sync rule: ${rule.id}`);
  }

  /**
   * Remove auto-sync rule
   */
  removeRule(ruleId: string): void {
    this.activeRules.delete(ruleId);
    this.config.customRules = this.config.customRules.filter(
      (r) => r.id !== ruleId
    );

    // Cancel any scheduled syncs for this rule
    const scheduleKey = `rule:${ruleId}`;
    if (this.scheduledSyncs.has(scheduleKey)) {
      clearTimeout(this.scheduledSyncs.get(scheduleKey)!);
      this.scheduledSyncs.delete(scheduleKey);
    }

    console.log(`🗑️ Removed auto-sync rule: ${ruleId}`);
  }

  /**
   * Trigger auto-sync for specific domain with context
   */
  async triggerSync(
    domain: SyncDomain,
    trigger: AutoSyncTrigger,
    context?: {
      ruleId?: string;
      notifications?: Phase3WebSocketNotification[];
      priority?: number;
    }
  ): Promise<void> {
    if (!this.isEnabled) {
      console.log("⚠️ Auto-sync disabled, ignoring trigger");
      return;
    }

    // Check resource constraints
    if (this.resourceMonitor) {
      const resourceState = await this.resourceMonitor.getCurrentState();
      if (!this.shouldAllowSync(resourceState)) {
        console.log("⚡ Sync blocked by resource constraints");
        this.stats.resourceOptimizations++;

        // Try to schedule for later if background sync is available
        if (
          this.serviceWorkerSyncManager &&
          this.config.backgroundSync.enabled
        ) {
          await this.scheduleBackgroundSync(domain, trigger, context);
        }
        return;
      }
    }

    // Check smart scheduling constraints
    if (this.config.smartScheduling.enabled && this.isInQuietHours()) {
      console.log("🔕 Sync blocked by quiet hours");
      await this.scheduleForLater(domain, trigger, context);
      return;
    }

    // Execute the sync
    await this.executeSync(domain, trigger, context);
  }

  /**
   * Get current auto-sync statistics
   */
  getStats(): AutoSyncStats {
    return {
      ...this.stats,
      domainStats: new Map(this.stats.domainStats),
    };
  }

  /**
   * Update auto-sync configuration
   */
  updateConfig(newConfig: Partial<EnhancedAutoSyncConfig>): void {
    this.config = { ...this.config, ...newConfig };

    if (this.isEnabled) {
      // Restart with new configuration
      this.disable().then(() => this.enable());
    }
  }

  /**
   * Add event listener for auto-sync events
   */
  on(eventType: SyncEventType, listener: SyncEventListener): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: SyncEventType, listener?: SyncEventListener): void {
    if (listener) {
      this.eventListeners.get(eventType)?.delete(listener);
    } else {
      this.eventListeners.delete(eventType);
    }
  }

  /**
   * Get active rules
   */
  getActiveRules(): AutoSyncRule[] {
    return Array.from(this.activeRules.values());
  }

  /**
   * Force immediate sync bypassing all constraints
   */
  async forceSync(domain: SyncDomain, reason: string): Promise<void> {
    console.log(`🔥 Force sync triggered for ${domain}: ${reason}`);

    await this.executeSync(domain, "manual", {
      priority: 100,
    });
  }

  /**
   * Initialize domain statistics
   */
  private initializeDomainStats(): void {
    const domains: SyncDomain[] = ["music", "photos", "documents", "videos"];

    for (const domain of domains) {
      this.stats.domainStats.set(domain, {
        syncsTriggered: 0,
        lastSync: null,
        averageInterval: 0,
        failureCount: 0,
      });
    }
  }

  /**
   * Create default auto-sync rules
   */
  private createDefaultRules(): AutoSyncRule[] {
    return [
      // Periodic sync for all domains
      {
        id: "periodic-all-domains",
        name: "Periodic Full Sync",
        domains: ["music", "photos", "documents", "videos"],
        schedule: {
          type: "periodic",
          interval: this.config.periodicInterval * 60 * 1000, // Convert to ms
        },
        conditions: {
          minBatteryLevel: 0.3,
          allowedConnectionTypes: ["wifi"],
          maxMemoryUsage: 80,
        },
        priority: 50,
        enabled: true,
      },

      // High-priority notification-based sync
      {
        id: "high-priority-notifications",
        name: "High Priority Content Updates",
        domains: ["music", "photos", "videos"],
        trigger: "notification-immediate",
        conditions: {
          notificationPriorities: ["critical", "high"],
          minBatteryLevel: 0.2,
        },
        priority: 90,
        enabled: true,
      },

      // Background sync for low-priority updates
      {
        id: "background-low-priority",
        name: "Background Low Priority Sync",
        domains: ["documents"],
        schedule: {
          type: "periodic",
          interval: 3600000, // 1 hour
        },
        conditions: {
          preferBackground: true,
          minBatteryLevel: 0.5,
          allowedConnectionTypes: ["wifi"],
        },
        priority: 20,
        enabled: true,
      },

      // Connection recovery sync
      {
        id: "connection-recovery",
        name: "Connection Recovery Sync",
        domains: ["music", "photos", "documents", "videos"],
        trigger: "connection-restored",
        conditions: {
          minBatteryLevel: 0.3,
        },
        priority: 70,
        enabled: true,
      },
    ];
  }

  /**
   * Set up periodic sync schedules
   */
  private setupPeriodicSyncs(): void {
    for (const rule of this.config.customRules) {
      if (rule.schedule && rule.enabled) {
        this.scheduleRuleExecution(rule);
      }
    }
  }

  /**
   * Install all auto-sync rules
   */
  private installRules(): void {
    for (const rule of this.config.customRules) {
      if (rule.enabled) {
        this.installRule(rule);
      }
    }
  }

  /**
   * Install a specific auto-sync rule
   */
  private installRule(rule: AutoSyncRule): void {
    this.activeRules.set(rule.id, rule);

    if (rule.schedule) {
      this.scheduleRuleExecution(rule);
    }

    console.log(`📋 Installed auto-sync rule: ${rule.name}`);
  }

  /**
   * Schedule rule execution based on its schedule
   */
  private scheduleRuleExecution(rule: AutoSyncRule): void {
    if (!rule.schedule) return;

    const scheduleKey = `rule:${rule.id}`;

    // Clear existing schedule
    if (this.scheduledSyncs.has(scheduleKey)) {
      clearTimeout(this.scheduledSyncs.get(scheduleKey)!);
    }

    let delay: number;

    switch (rule.schedule.type) {
      case "periodic":
        delay = rule.schedule.interval || 3600000;
        break;
      case "daily":
        delay = this.calculateDailyDelay(rule.schedule.time || "00:00");
        break;
      case "weekly":
        delay = this.calculateWeeklyDelay(
          rule.schedule.dayOfWeek || 0,
          rule.schedule.time || "00:00"
        );
        break;
      case "cron":
        // For cron, we'd need a cron parser - simplified here
        delay = 3600000; // 1 hour fallback
        break;
      default:
        return;
    }

    const timeout = setTimeout(async () => {
      await this.executeRule(rule);

      // Reschedule if periodic
      if (rule.schedule!.type === "periodic") {
        this.scheduleRuleExecution(rule);
      }
    }, delay);

    this.scheduledSyncs.set(scheduleKey, timeout);
  }

  /**
   * Execute an auto-sync rule
   */
  private async executeRule(rule: AutoSyncRule): Promise<void> {
    console.log(`📋 Executing auto-sync rule: ${rule.name}`);

    // Check if conditions are met
    if (!(await this.checkRuleConditions(rule))) {
      console.log(`⏭️ Rule conditions not met: ${rule.name}`);
      return;
    }

    // Execute sync for each domain in the rule
    for (const domain of rule.domains) {
      try {
        await this.triggerSync(domain, "scheduled", {
          ruleId: rule.id,
          priority: rule.priority,
        });
      } catch (error) {
        console.error(`❌ Rule execution failed for ${domain}:`, error);
      }
    }
  }

  /**
   * Check if rule conditions are satisfied
   */
  private async checkRuleConditions(rule: AutoSyncRule): Promise<boolean> {
    if (!rule.conditions) return true;

    // Check resource state if resource monitoring is enabled
    if (this.resourceMonitor) {
      const resourceState = await this.resourceMonitor.getCurrentState();

      // Battery level check
      if (rule.conditions.minBatteryLevel) {
        if (resourceState.battery.level < rule.conditions.minBatteryLevel) {
          return false;
        }
      }

      // Connection type check
      if (rule.conditions.allowedConnectionTypes) {
        if (
          !rule.conditions.allowedConnectionTypes.includes(
            resourceState.connection.type
          )
        ) {
          return false;
        }
      }

      // Memory usage check
      if (
        rule.conditions.maxMemoryUsage &&
        resourceState.memory.available > 0
      ) {
        const memoryUsagePercent =
          (resourceState.memory.used / resourceState.memory.available) * 100;
        if (memoryUsagePercent > rule.conditions.maxMemoryUsage) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Set up notification router integration
   */
  private async setupNotificationIntegration(): Promise<void> {
    if (!this.notificationRouter) return;

    // The notification router will call our triggerSync method
    // when relevant notifications are received
    await this.notificationRouter.start();
  }

  /**
   * Set up service worker integration for background sync
   */
  private async setupServiceWorkerIntegration(): Promise<void> {
    if (!this.serviceWorkerSyncManager) return;

    // Register background sync capabilities
    // The service worker will handle sync when the main thread is not available
  }

  /**
   * Execute sync with full context
   */
  private async executeSync(
    domain: SyncDomain,
    trigger: AutoSyncTrigger,
    context?: {
      ruleId?: string;
      notifications?: Phase3WebSocketNotification[];
      priority?: number;
    }
  ): Promise<void> {
    try {
      // Update statistics
      this.updateSyncStats(domain, trigger);

      // Emit auto-sync triggered event
      this.emitEvent({
        type: SyncEventType.AutoSyncTriggered,
        domain,
        trigger: trigger as "new_content" | "periodic" | "manual",
        timestamp: new Date(),
      });

      // Determine sync method (foreground vs background)
      const useBackground = this.shouldUseBackgroundSync(trigger, context);

      if (useBackground && this.serviceWorkerSyncManager) {
        // Delegate to service worker
        await this.serviceWorkerSyncManager.registerBackgroundSync({
          type: "background-sync",
          domain,
          options: {
            includeBinaryData: true,
          },
          priority: context?.priority || 50,
          maxRetries: 3,
          retryDelay: 5000,
        });

        this.stats.backgroundSyncs++;
        console.log(`🔄 Background sync scheduled for ${domain}`);
      } else {
        // Execute in foreground
        await this.syncManager.syncDomain(domain, {
          includeBinaryData: true,
        });

        console.log(`✅ Foreground sync completed for ${domain}`);
      }
    } catch (error) {
      this.stats.failedSyncs++;
      const domainStats = this.stats.domainStats.get(domain);
      if (domainStats) {
        domainStats.failureCount++;
      }

      console.error(`❌ Auto-sync failed for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Determine if background sync should be used
   */
  private shouldUseBackgroundSync(
    trigger: AutoSyncTrigger,
    context?: { priority?: number }
  ): boolean {
    if (!this.config.backgroundSync.enabled || !this.serviceWorkerSyncManager) {
      return false;
    }

    // High-priority syncs should run in foreground
    if (context?.priority && context.priority > 80) {
      return false;
    }

    // Prefer background for scheduled syncs
    if (trigger === "scheduled") {
      return this.config.backgroundSync.prioritizeBackground;
    }

    return false;
  }

  /**
   * Update sync statistics
   */
  private updateSyncStats(domain: SyncDomain, trigger: AutoSyncTrigger): void {
    this.stats.totalSyncsTriggered++;
    this.stats.lastActivity = new Date();

    // Update trigger-specific stats
    switch (trigger) {
      case "scheduled":
        this.stats.scheduledTriggers++;
        break;
      case "notification-immediate":
      case "notification-batched":
        this.stats.notificationTriggers++;
        break;
      case "manual":
        this.stats.ruleBasedTriggers++;
        break;
    }

    // Update domain stats
    const domainStats = this.stats.domainStats.get(domain);
    if (domainStats) {
      domainStats.syncsTriggered++;

      if (domainStats.lastSync) {
        const interval = Date.now() - domainStats.lastSync.getTime();
        domainStats.averageInterval =
          (domainStats.averageInterval + interval) / domainStats.syncsTriggered;
      }

      domainStats.lastSync = new Date();
    }
  }

  /**
   * Check if current time is in quiet hours
   */
  private isInQuietHours(): boolean {
    if (!this.config.smartScheduling.enabled) return false;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const startTime = this.parseTimeString(
      this.config.smartScheduling.quietHours.start
    );
    const endTime = this.parseTimeString(
      this.config.smartScheduling.quietHours.end
    );

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Quiet hours span midnight
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  /**
   * Parse time string (HH:MM) to minutes
   */
  private parseTimeString(timeStr: string): number {
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0] || "0");
    const minutes = parseInt(parts[1] || "0");
    return hours * 60 + minutes;
  }

  /**
   * Calculate delay for daily schedule
   */
  private calculateDailyDelay(time: string): number {
    const now = new Date();
    const parts = time.split(":");
    const hours = parseInt(parts[0] || "0");
    const minutes = parseInt(parts[1] || "0");

    const targetTime = new Date(now);
    targetTime.setHours(hours, minutes, 0, 0);

    // If target time has passed today, schedule for tomorrow
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    return targetTime.getTime() - now.getTime();
  }

  /**
   * Calculate delay for weekly schedule
   */
  private calculateWeeklyDelay(dayOfWeek: number, time: string): number {
    const now = new Date();
    const parts = time.split(":");
    const hours = parseInt(parts[0] || "0");
    const minutes = parseInt(parts[1] || "0");

    const targetDate = new Date(now);
    const daysUntilTarget = (dayOfWeek - now.getDay() + 7) % 7;

    targetDate.setDate(now.getDate() + daysUntilTarget);
    targetDate.setHours(hours, minutes, 0, 0);

    // If target time has passed this week, schedule for next week
    if (targetDate <= now) {
      targetDate.setDate(targetDate.getDate() + 7);
    }

    return targetDate.getTime() - now.getTime();
  }

  /**
   * Schedule sync for later when blocked
   */
  private async scheduleForLater(
    domain: SyncDomain,
    trigger: AutoSyncTrigger,
    context?: any
  ): Promise<void> {
    // Calculate next available time slot
    const delay = this.calculateNextAvailableSlot();

    setTimeout(async () => {
      await this.triggerSync(domain, trigger, context);
    }, delay);

    console.log(`⏰ Sync scheduled for later: ${domain} (${delay}ms)`);
  }

  /**
   * Schedule background sync when foreground is blocked
   */
  private async scheduleBackgroundSync(
    domain: SyncDomain,
    _trigger: AutoSyncTrigger,
    context?: any
  ): Promise<void> {
    if (!this.serviceWorkerSyncManager) return;

    await this.serviceWorkerSyncManager.registerBackgroundSync({
      type: "background-sync",
      domain,
      options: {
        includeBinaryData: true,
      },
      priority: context?.priority || 30,
      maxRetries: 3,
      retryDelay: 5000,
    });

    console.log(
      `🔄 Background sync scheduled for resource-constrained environment: ${domain}`
    );
  }

  /**
   * Calculate next available time slot outside constraints
   */
  private calculateNextAvailableSlot(): number {
    // If in quiet hours, wait until they end
    if (this.isInQuietHours()) {
      const endTime = this.parseTimeString(
        this.config.smartScheduling.quietHours.end
      );
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      let minutesUntilEnd = endTime - currentTime;
      if (minutesUntilEnd <= 0) {
        minutesUntilEnd += 24 * 60; // Next day
      }

      return minutesUntilEnd * 60 * 1000; // Convert to milliseconds
    }

    // Default: wait 5 minutes
    return 5 * 60 * 1000;
  }

  /**
   * Check if sync should be allowed based on resources
   */
  private shouldAllowSync(resourceState: ResourceState): boolean {
    const config = this.config.resourceAwareness;

    // Battery check
    if (
      resourceState.battery.level < config.batteryThreshold &&
      !resourceState.battery.charging
    ) {
      return false;
    }

    // Connection type check
    if (!config.connectionTypes.includes(resourceState.connection.type)) {
      return false;
    }

    // Memory check
    const memoryUsageMB = resourceState.memory.used / (1024 * 1024);
    if (memoryUsageMB > config.memoryThreshold) {
      return false;
    }

    return true;
  }

  /**
   * Clear all scheduled syncs
   */
  private clearAllScheduledSyncs(): void {
    for (const timeout of this.scheduledSyncs.values()) {
      clearTimeout(timeout);
    }
    this.scheduledSyncs.clear();
  }

  /**
   * Emit auto-sync event to listeners
   */
  private emitEvent(event: AutoSyncTriggeredEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in auto-sync event listener:", error);
        }
      }
    }
  }
}

/**
 * Simple resource monitor for tracking system resources
 */
class ResourceMonitor {
  private batteryManager: any = null;
  private connectionInfo: any = null;
  private memoryInfo: any = null;

  async start(): Promise<void> {
    // Get battery manager
    if ("getBattery" in navigator) {
      try {
        this.batteryManager = await (navigator as any).getBattery();
      } catch (error) {
        console.warn("Battery API not available:", error);
      }
    }

    // Get connection info
    this.connectionInfo =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    // Get memory info
    this.memoryInfo = (performance as any).memory;
  }

  async stop(): Promise<void> {
    // Cleanup if needed
  }

  async getCurrentState(): Promise<ResourceState> {
    return {
      battery: {
        level: this.batteryManager?.level || 1.0,
        charging: this.batteryManager?.charging || false,
      },
      connection: {
        type: this.connectionInfo?.type || "unknown",
        effectiveType: this.connectionInfo?.effectiveType || "4g",
        downlink: this.connectionInfo?.downlink || 10,
      },
      memory: {
        used: this.memoryInfo?.usedJSHeapSize || 0,
        available: this.memoryInfo?.totalJSHeapSize || 100 * 1024 * 1024,
      },
      performance: {
        cpuUsage: 0, // Would need more complex monitoring
        isLowPowerMode: false, // Browser doesn't expose this
      },
    };
  }
}

/**
 * Create enhanced auto-sync manager with default configuration
 */
export function createEnhancedAutoSyncManager(
  syncManager: UnifiedSyncManager,
  config?: Partial<EnhancedAutoSyncConfig>,
  serviceWorkerSyncManager?: ServiceWorkerSyncManager,
  notificationRouter?: AutoSyncNotificationRouter
): EnhancedAutoSyncManager {
  const defaultConfig: EnhancedAutoSyncConfig = {
    enabled: true,
    syncOnNewContent: true,
    periodicInterval: 30, // 30 minutes
    domains: ["music", "photos"],
    debounceDelay: 5000, // 5 seconds
    customRules: [],
    resourceAwareness: {
      enabled: true,
      batteryThreshold: 0.2, // 20%
      connectionTypes: ["wifi", "ethernet"],
      memoryThreshold: 100, // 100MB
    },
    smartScheduling: {
      enabled: true,
      quietHours: { start: "22:00", end: "07:00" },
      adaptiveInterval: true,
      minInterval: 15, // 15 minutes
      maxInterval: 120, // 2 hours
    },
    backgroundSync: {
      enabled: true,
      prioritizeBackground: true,
      fallbackToForeground: true,
    },
    userPreferences: {
      respectDataSaver: true,
      respectLowPowerMode: true,
      maxDailySync: 48, // Every 30 minutes
    },
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new EnhancedAutoSyncManager(
    syncManager,
    finalConfig,
    serviceWorkerSyncManager,
    notificationRouter
  );
}
