//! User Notification Manager - Phase 3
//!
//! This module handles user notifications for sync events, providing both
//! in-app notifications and system push notifications for sync status updates,
//! new content availability, and sync completion events.

import type {
  SyncDomain,
  AnySyncEvent,
  AutoSyncTriggeredEvent,
  SyncCompletedEvent,
  SyncFailedEvent,
  SyncProgressEvent,
} from "./types.js";

import { SyncEventType } from "./types.js";

import type { UnifiedSyncManager } from "./types.js";
import type { ServiceWorkerSyncManager } from "./service-worker-types.js";

/**
 * User notification configuration
 */
export interface UserNotificationConfig {
  /** Enable in-app notifications */
  inApp: {
    enabled: boolean;
    position: "top-right" | "top-left" | "bottom-right" | "bottom-left";
    autoHide: boolean;
    autoHideDelay: number; // milliseconds
    showProgress: boolean;
    maxNotifications: number;
  };
  /** Enable system push notifications */
  push: {
    enabled: boolean;
    requestPermission: boolean;
    showSyncComplete: boolean;
    showSyncFailed: boolean;
    showNewContent: boolean;
    batchNotifications: boolean;
    quietHours: { start: string; end: string };
  };
  /** Notification filtering */
  filters: {
    domains: SyncDomain[];
    minPriority: "low" | "medium" | "high" | "critical";
    eventTypes: SyncEventType[];
    debounceDelay: number;
  };
  /** Sound and vibration */
  feedback: {
    enableSounds: boolean;
    enableVibration: boolean;
    soundVolume: number; // 0-1
    customSounds: Record<string, string>; // event -> sound URL
  };
}

/**
 * In-app notification data
 */
export interface InAppNotification {
  /** Unique notification ID */
  id: string;
  /** Notification type */
  type: "info" | "success" | "warning" | "error" | "progress";
  /** Notification title */
  title: string;
  /** Notification message */
  message: string;
  /** Associated domain */
  domain?: SyncDomain;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Timestamp */
  timestamp: Date;
  /** Auto-hide enabled */
  autoHide: boolean;
  /** Action buttons */
  actions?: NotificationAction[];
  /** Custom data */
  data?: any;
}

/**
 * Notification action button
 */
export interface NotificationAction {
  /** Action identifier */
  id: string;
  /** Button text */
  label: string;
  /** Action handler */
  handler: () => void | Promise<void>;
  /** Button style */
  style?: "primary" | "secondary" | "danger";
}

/**
 * Push notification data
 */
export interface PushNotificationData {
  /** Notification title */
  title: string;
  /** Notification body */
  body: string;
  /** Notification icon */
  icon?: string;
  /** Notification badge */
  badge?: string;
  /** Notification tag (for grouping) */
  tag?: string;
  /** Auto-close delay */
  requireInteraction?: boolean;
  /** Notification data */
  data?: any;
  /** Action buttons */
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

/**
 * Notification statistics
 */
export interface NotificationStats {
  /** Total notifications sent */
  totalSent: number;
  /** In-app notifications */
  inAppSent: number;
  /** Push notifications */
  pushSent: number;
  /** Notifications by type */
  byType: Record<string, number>;
  /** Notifications by domain */
  byDomain: Record<SyncDomain, number>;
  /** User interactions */
  interactions: {
    clicked: number;
    dismissed: number;
    actionsTriggered: number;
  };
  /** Permission status */
  permissions: {
    push: NotificationPermission;
    requested: boolean;
  };
}

/**
 * User notification manager implementation
 */
export class UserNotificationManager {
  private syncManager: UnifiedSyncManager;
  private serviceWorkerSyncManager: ServiceWorkerSyncManager | null;
  private config: UserNotificationConfig;

  // State management
  private isEnabled = false;
  private inAppNotifications = new Map<string, InAppNotification>();
  private debounceTimeouts = new Map<string, NodeJS.Timeout>();

  // UI elements
  private notificationContainer: HTMLElement | null = null;
  private activeNotificationElements = new Map<string, HTMLElement>();

  // Statistics
  private stats: NotificationStats = {
    totalSent: 0,
    inAppSent: 0,
    pushSent: 0,
    byType: {},
    byDomain: {} as Record<SyncDomain, number>,
    interactions: {
      clicked: 0,
      dismissed: 0,
      actionsTriggered: 0,
    },
    permissions: {
      push: "default",
      requested: false,
    },
  };

  constructor(
    syncManager: UnifiedSyncManager,
    config: UserNotificationConfig,
    serviceWorkerSyncManager?: ServiceWorkerSyncManager
  ) {
    this.syncManager = syncManager;
    this.config = config;
    this.serviceWorkerSyncManager = serviceWorkerSyncManager || null;

    // Initialize domain stats
    this.initializeDomainStats();
  }

  /**
   * Initialize the notification manager
   */
  async initialize(): Promise<void> {
    if (this.isEnabled) {
      console.log("📢 User notification manager already initialized");
      return;
    }

    console.log("🚀 Initializing user notification manager...");

    // Request push notification permission if configured
    if (this.config.push.enabled && this.config.push.requestPermission) {
      await this.requestPushPermission();
    }

    // Set up in-app notification container
    if (this.config.inApp.enabled) {
      this.setupInAppNotifications();
    }

    // Set up sync event listeners
    this.setupSyncEventListeners();

    // Set up service worker integration
    if (this.serviceWorkerSyncManager) {
      this.setupServiceWorkerIntegration();
    }

    this.isEnabled = true;
    console.log("✅ User notification manager initialized");
  }

  /**
   * Shutdown the notification manager
   */
  async shutdown(): Promise<void> {
    if (!this.isEnabled) return;

    console.log("⏹️ Shutting down user notification manager...");

    // Clear all timeouts
    this.clearAllDebounceTimeouts();

    // Remove event listeners
    this.clearSyncEventListeners();

    // Clear in-app notifications
    this.clearAllInAppNotifications();

    // Remove notification container
    if (this.notificationContainer) {
      this.notificationContainer.remove();
      this.notificationContainer = null;
    }

    this.isEnabled = false;
    console.log("✅ User notification manager shutdown complete");
  }

  /**
   * Send in-app notification
   */
  async sendInAppNotification(
    notification: Omit<InAppNotification, "id" | "timestamp">
  ): Promise<string> {
    if (!this.config.inApp.enabled) {
      return "";
    }

    // Apply filters
    if (!this.shouldShowNotification(notification)) {
      return "";
    }

    const id = this.generateNotificationId();
    const fullNotification: InAppNotification = {
      ...notification,
      id,
      timestamp: new Date(),
    };

    // Add to queue and display
    this.inAppNotifications.set(id, fullNotification);
    this.displayInAppNotification(fullNotification);

    // Update statistics
    this.stats.inAppSent++;
    this.stats.totalSent++;
    this.updateTypeStats(notification.type);
    if (notification.domain) {
      this.updateDomainStats(notification.domain);
    }

    // Queue management
    this.manageNotificationQueue();

    // Play sound if enabled
    this.playNotificationSound(notification.type);

    // Trigger vibration if enabled
    this.triggerVibration(notification.type);

    console.log(`📱 In-app notification sent: ${notification.title}`);
    return id;
  }

  /**
   * Send push notification
   */
  async sendPushNotification(data: PushNotificationData): Promise<boolean> {
    if (!this.config.push.enabled || !this.hasPushPermission()) {
      return false;
    }

    // Check quiet hours
    if (this.isInQuietHours()) {
      console.log("🔕 Push notification blocked by quiet hours");
      return false;
    }

    try {
      // Send through service worker if available
      if (this.serviceWorkerSyncManager && "serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(data.title, {
          body: data.body,
          icon: data.icon || "/icon-192.png",
          badge: data.badge || "/badge-72.png",
          tag: data.tag,
          requireInteraction: data.requireInteraction || false,
          data: data.data,
        });
      } else {
        // Fallback to direct browser notification
        new Notification(data.title, {
          body: data.body,
          icon: data.icon || "/icon-192.png",
          tag: data.tag,
          requireInteraction: data.requireInteraction || false,
          data: data.data,
        });
      }

      // Update statistics
      this.stats.pushSent++;
      this.stats.totalSent++;

      console.log(`🔔 Push notification sent: ${data.title}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to send push notification:", error);
      return false;
    }
  }

  /**
   * Dismiss in-app notification
   */
  dismissInAppNotification(id: string): void {
    const notification = this.inAppNotifications.get(id);
    if (!notification) return;

    // Remove from DOM
    const element = this.activeNotificationElements.get(id);
    if (element) {
      element.remove();
      this.activeNotificationElements.delete(id);
    }

    // Remove from memory
    this.inAppNotifications.delete(id);

    // Update statistics
    this.stats.interactions.dismissed++;

    console.log(`📱 Dismissed notification: ${id}`);
  }

  /**
   * Clear all in-app notifications
   */
  clearAllInAppNotifications(): void {
    for (const id of this.inAppNotifications.keys()) {
      this.dismissInAppNotification(id);
    }
  }

  /**
   * Get current notification statistics
   */
  getStats(): NotificationStats {
    return {
      ...this.stats,
      permissions: {
        push: Notification.permission,
        requested: this.stats.permissions.requested,
      },
    };
  }

  /**
   * Update notification configuration
   */
  updateConfig(newConfig: Partial<UserNotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Re-setup in-app notifications if container config changed
    if (newConfig.inApp && this.notificationContainer) {
      this.setupInAppNotifications();
    }

    console.log("⚙️ Notification configuration updated");
  }

  /**
   * Get active in-app notifications
   */
  getActiveNotifications(): InAppNotification[] {
    return Array.from(this.inAppNotifications.values());
  }

  /**
   * Request push notification permission
   */
  async requestPushPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
      console.warn("⚠️ Browser doesn't support notifications");
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission === "denied") {
      console.warn("⚠️ Notification permission denied by user");
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.stats.permissions.requested = true;
      this.stats.permissions.push = permission;

      if (permission === "granted") {
        console.log("✅ Push notification permission granted");
        return true;
      } else {
        console.log("❌ Push notification permission denied");
        return false;
      }
    } catch (error) {
      console.error("❌ Error requesting notification permission:", error);
      return false;
    }
  }

  /**
   * Check if push notification permission is granted
   */
  hasPushPermission(): boolean {
    return "Notification" in window && Notification.permission === "granted";
  }

  /**
   * Initialize domain statistics
   */
  private initializeDomainStats(): void {
    const domains: SyncDomain[] = ["music", "photos", "documents", "videos"];
    for (const domain of domains) {
      this.stats.byDomain[domain] = 0;
    }
  }

  /**
   * Set up in-app notification container
   */
  private setupInAppNotifications(): void {
    // Remove existing container
    if (this.notificationContainer) {
      this.notificationContainer.remove();
    }

    // Create notification container
    this.notificationContainer = document.createElement("div");
    this.notificationContainer.id = "unified-sync-notifications";
    this.notificationContainer.className = `notification-container ${this.config.inApp.position}`;

    // Add styles
    this.addNotificationStyles();

    // Append to body
    document.body.appendChild(this.notificationContainer);
  }

  /**
   * Set up sync event listeners
   */
  private setupSyncEventListeners(): void {
    // Auto-sync triggered
    this.syncManager.on(
      SyncEventType.AutoSyncTriggered,
      this.handleAutoSyncTriggered.bind(this)
    );

    // Sync progress
    this.syncManager.on(
      SyncEventType.Progress,
      this.handleSyncProgress.bind(this)
    );

    // Sync completed
    this.syncManager.on(
      SyncEventType.AllCompleted,
      this.handleSyncCompleted.bind(this)
    );
    this.syncManager.on(
      SyncEventType.DomainCompleted,
      this.handleDomainCompleted.bind(this)
    );

    // Sync failed
    this.syncManager.on(SyncEventType.Failed, this.handleSyncFailed.bind(this));
  }

  /**
   * Clear sync event listeners
   */
  private clearSyncEventListeners(): void {
    // Event listeners would be cleared here
    // Implementation depends on sync manager's off method signature
  }

  /**
   * Set up service worker integration
   */
  private setupServiceWorkerIntegration(): void {
    // Listen for service worker sync events
    if (this.serviceWorkerSyncManager) {
      // Service worker events would be handled here
    }
  }

  /**
   * Handle auto-sync triggered event
   */
  private async handleAutoSyncTriggered(event: AnySyncEvent): Promise<void> {
    if (event.type !== SyncEventType.AutoSyncTriggered) return;

    const autoSyncEvent = event as AutoSyncTriggeredEvent;

    await this.sendInAppNotification({
      type: "info",
      title: "Auto-sync Started",
      message: `Syncing ${autoSyncEvent.domain} content (${autoSyncEvent.trigger})`,
      domain: autoSyncEvent.domain,
      autoHide: true,
      actions: [
        {
          id: "view-progress",
          label: "View Progress",
          handler: () => this.showSyncProgress(autoSyncEvent.domain),
        },
      ],
    });
  }

  /**
   * Handle sync progress event
   */
  private async handleSyncProgress(event: AnySyncEvent): Promise<void> {
    if (event.type !== SyncEventType.Progress) return;

    const progressEvent = event as SyncProgressEvent;

    // Update existing progress notification or create new one
    const progressId = `progress-${progressEvent.domain}`;
    const existingNotification = this.inAppNotifications.get(progressId);

    if (existingNotification) {
      // Update existing progress notification
      existingNotification.progress = progressEvent.progress.progress;
      existingNotification.message = `Syncing ${progressEvent.domain}: ${progressEvent.progress.itemsProcessed}/${progressEvent.progress.totalItems} items`;
      this.updateProgressNotification(existingNotification);
    } else if (this.config.inApp.showProgress) {
      // Create new progress notification
      await this.sendInAppNotification({
        type: "progress",
        title: `Syncing ${progressEvent.domain}`,
        message: `${progressEvent.progress.itemsProcessed}/${progressEvent.progress.totalItems} items`,
        domain: progressEvent.domain,
        progress: progressEvent.progress.progress,
        autoHide: false,
      });
    }
  }

  /**
   * Handle sync completed event
   */
  private async handleSyncCompleted(event: AnySyncEvent): Promise<void> {
    if (event.type !== SyncEventType.AllCompleted) return;

    const completedEvent = event as SyncCompletedEvent;

    // Send completion notification
    await this.sendInAppNotification({
      type: "success",
      title: "Sync Complete",
      message: `Successfully synced ${completedEvent.result.itemsSynced} items`,
      autoHide: true,
    });

    // Send push notification if enabled
    if (this.config.push.showSyncComplete) {
      await this.sendPushNotification({
        title: "Sync Complete",
        body: `Successfully synced ${completedEvent.result.itemsSynced} items`,
        tag: "sync-complete",
        requireInteraction: false,
      });
    }
  }

  /**
   * Handle domain completed event
   */
  private async handleDomainCompleted(event: AnySyncEvent): Promise<void> {
    const completedEvent = event as SyncCompletedEvent;

    // Clear progress notification for this domain
    const progressId = `progress-${completedEvent.result.domain}`;
    this.dismissInAppNotification(progressId);

    // Send domain completion notification
    await this.sendInAppNotification({
      type: "success",
      title: `${completedEvent.result.domain} Sync Complete`,
      message: `Synced ${completedEvent.result.itemsSynced} items in ${completedEvent.result.duration}ms`,
      domain: completedEvent.result.domain,
      autoHide: true,
    });
  }

  /**
   * Handle sync failed event
   */
  private async handleSyncFailed(event: AnySyncEvent): Promise<void> {
    if (event.type !== SyncEventType.Failed) return;

    const failedEvent = event as SyncFailedEvent;

    // Send failure notification
    await this.sendInAppNotification({
      type: "error",
      title: "Sync Failed",
      message: `Failed to sync ${failedEvent.domain}: ${failedEvent.error.message}`,
      domain: failedEvent.domain,
      autoHide: false,
      actions: [
        {
          id: "retry",
          label: "Retry",
          style: "primary",
          handler: () => this.retrySyncForDomain(failedEvent.domain),
        },
        {
          id: "details",
          label: "Details",
          handler: () => this.showErrorDetails(failedEvent.error),
        },
      ],
    });

    // Send push notification if enabled
    if (this.config.push.showSyncFailed) {
      await this.sendPushNotification({
        title: "Sync Failed",
        body: `Failed to sync ${failedEvent.domain}`,
        tag: "sync-failed",
        requireInteraction: true,
      });
    }
  }

  /**
   * Display in-app notification in DOM
   */
  private displayInAppNotification(notification: InAppNotification): void {
    if (!this.notificationContainer) return;

    const element = this.createNotificationElement(notification);
    this.notificationContainer.appendChild(element);
    this.activeNotificationElements.set(notification.id, element);

    // Auto-hide if configured
    if (notification.autoHide && this.config.inApp.autoHide) {
      setTimeout(() => {
        this.dismissInAppNotification(notification.id);
      }, this.config.inApp.autoHideDelay);
    }

    // Trigger animation
    requestAnimationFrame(() => {
      element.classList.add("show");
    });
  }

  /**
   * Create notification DOM element
   */
  private createNotificationElement(
    notification: InAppNotification
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = `notification notification-${notification.type}`;
    element.dataset.id = notification.id;

    const html = `
      <div class="notification-content">
        <div class="notification-header">
          <h4 class="notification-title">${this.escapeHtml(notification.title)}</h4>
          <button class="notification-close" data-action="close">×</button>
        </div>
        <p class="notification-message">${this.escapeHtml(notification.message)}</p>
        ${
          notification.progress !== undefined
            ? `
          <div class="notification-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${notification.progress}%"></div>
            </div>
            <span class="progress-text">${Math.round(notification.progress)}%</span>
          </div>
        `
            : ""
        }
        ${
          notification.actions
            ? `
          <div class="notification-actions">
            ${notification.actions
              .map(
                (action) => `
              <button class="notification-action ${action.style || "secondary"}" data-action="${action.id}">
                ${this.escapeHtml(action.label)}
              </button>
            `
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;

    element.innerHTML = html;

    // Add event listeners
    element.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;

      if (action === "close") {
        this.dismissInAppNotification(notification.id);
        this.stats.interactions.dismissed++;
      } else if (action && notification.actions) {
        const actionHandler = notification.actions.find((a) => a.id === action);
        if (actionHandler) {
          actionHandler.handler();
          this.stats.interactions.actionsTriggered++;
        }
      } else {
        this.stats.interactions.clicked++;
      }
    });

    return element;
  }

  /**
   * Update progress notification
   */
  private updateProgressNotification(notification: InAppNotification): void {
    const element = this.activeNotificationElements.get(notification.id);
    if (!element) return;

    const progressFill = element.querySelector(".progress-fill") as HTMLElement;
    const progressText = element.querySelector(".progress-text") as HTMLElement;
    const messageElement = element.querySelector(
      ".notification-message"
    ) as HTMLElement;

    if (progressFill && notification.progress !== undefined) {
      progressFill.style.width = `${notification.progress}%`;
    }

    if (progressText && notification.progress !== undefined) {
      progressText.textContent = `${Math.round(notification.progress)}%`;
    }

    if (messageElement) {
      messageElement.textContent = notification.message;
    }
  }

  /**
   * Add notification styles to document
   */
  private addNotificationStyles(): void {
    if (document.getElementById("unified-sync-notification-styles")) return;

    const styles = document.createElement("style");
    styles.id = "unified-sync-notification-styles";
    styles.textContent = `
      .notification-container {
        position: fixed;
        z-index: 10000;
        max-width: 400px;
        pointer-events: none;
      }

      .notification-container.top-right {
        top: 20px;
        right: 20px;
      }

      .notification-container.top-left {
        top: 20px;
        left: 20px;
      }

      .notification-container.bottom-right {
        bottom: 20px;
        right: 20px;
      }

      .notification-container.bottom-left {
        bottom: 20px;
        left: 20px;
      }

      .notification {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        margin-bottom: 12px;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        pointer-events: auto;
        border-left: 4px solid;
      }

      .notification.show {
        opacity: 1;
        transform: translateX(0);
      }

      .notification-info { border-left-color: #3b82f6; }
      .notification-success { border-left-color: #10b981; }
      .notification-warning { border-left-color: #f59e0b; }
      .notification-error { border-left-color: #ef4444; }
      .notification-progress { border-left-color: #8b5cf6; }

      .notification-content {
        padding: 16px;
      }

      .notification-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .notification-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #111827;
      }

      .notification-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .notification-close:hover {
        color: #374151;
      }

      .notification-message {
        margin: 0 0 12px 0;
        color: #4b5563;
        font-size: 14px;
        line-height: 1.4;
      }

      .notification-progress {
        margin-bottom: 12px;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4px;
      }

      .progress-fill {
        height: 100%;
        background: #8b5cf6;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 12px;
        color: #6b7280;
      }

      .notification-actions {
        display: flex;
        gap: 8px;
      }

      .notification-action {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid;
        transition: all 0.2s ease;
      }

      .notification-action.primary {
        background: #3b82f6;
        color: white;
        border-color: #3b82f6;
      }

      .notification-action.primary:hover {
        background: #2563eb;
        border-color: #2563eb;
      }

      .notification-action.secondary {
        background: white;
        color: #374151;
        border-color: #d1d5db;
      }

      .notification-action.secondary:hover {
        background: #f9fafb;
        border-color: #9ca3af;
      }

      .notification-action.danger {
        background: #ef4444;
        color: white;
        border-color: #ef4444;
      }

      .notification-action.danger:hover {
        background: #dc2626;
        border-color: #dc2626;
      }
    `;

    document.head.appendChild(styles);
  }

  /**
   * Manage notification queue size
   */
  private manageNotificationQueue(): void {
    const notifications = Array.from(this.inAppNotifications.values());
    const maxNotifications = this.config.inApp.maxNotifications;

    if (notifications.length > maxNotifications) {
      // Remove oldest notifications
      const sortedByTime = notifications.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      const toRemove = sortedByTime.slice(
        0,
        notifications.length - maxNotifications
      );

      for (const notification of toRemove) {
        this.dismissInAppNotification(notification.id);
      }
    }
  }

  /**
   * Check if notification should be shown based on filters
   */
  private shouldShowNotification(
    notification: Partial<InAppNotification>
  ): boolean {
    // Domain filter
    if (
      notification.domain &&
      !this.config.filters.domains.includes(notification.domain)
    ) {
      return false;
    }

    // Event type would be checked here if we had it
    // Priority would be checked here if we had it

    return true;
  }

  /**
   * Check if current time is in quiet hours
   */
  private isInQuietHours(): boolean {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const startTime = this.parseTimeString(this.config.push.quietHours.start);
    const endTime = this.parseTimeString(this.config.push.quietHours.end);

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
   * Play notification sound
   */
  private playNotificationSound(type: string): void {
    if (!this.config.feedback.enableSounds) return;

    try {
      const soundUrl =
        this.config.feedback.customSounds[type] ||
        this.getDefaultSoundUrl(type);
      if (soundUrl) {
        const audio = new Audio(soundUrl);
        audio.volume = this.config.feedback.soundVolume;
        audio.play().catch((error) => {
          console.warn("Failed to play notification sound:", error);
        });
      }
    } catch (error) {
      console.warn("Error playing notification sound:", error);
    }
  }

  /**
   * Trigger haptic feedback
   */
  private triggerVibration(type: string): void {
    if (!this.config.feedback.enableVibration || !("vibrate" in navigator))
      return;

    try {
      let pattern: number[];
      switch (type) {
        case "success":
          pattern = [100];
          break;
        case "error":
          pattern = [100, 50, 100];
          break;
        case "warning":
          pattern = [150];
          break;
        default:
          pattern = [50];
      }

      navigator.vibrate(pattern);
    } catch (error) {
      console.warn("Error triggering vibration:", error);
    }
  }

  /**
   * Get default sound URL for notification type
   */
  private getDefaultSoundUrl(type: string): string | null {
    // Return default sound URLs or null
    const soundMap: Record<string, string> = {
      success: "/sounds/success.mp3",
      error: "/sounds/error.mp3",
      warning: "/sounds/warning.mp3",
      info: "/sounds/info.mp3",
    };

    return soundMap[type] || null;
  }

  /**
   * Update statistics by type
   */
  private updateTypeStats(type: string): void {
    this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
  }

  /**
   * Update statistics by domain
   */
  private updateDomainStats(domain: SyncDomain): void {
    this.stats.byDomain[domain] = (this.stats.byDomain[domain] || 0) + 1;
  }

  /**
   * Generate unique notification ID
   */
  private generateNotificationId(): string {
    return `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Escape HTML for safe insertion
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clear all debounce timeouts
   */
  private clearAllDebounceTimeouts(): void {
    for (const timeout of this.debounceTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.debounceTimeouts.clear();
  }

  /**
   * Show sync progress for domain
   */
  private showSyncProgress(domain: SyncDomain): void {
    console.log(`📊 Showing sync progress for ${domain}`);
    // Implementation would show a detailed progress modal/panel
  }

  /**
   * Retry sync for domain
   */
  private async retrySyncForDomain(domain: SyncDomain): Promise<void> {
    console.log(`🔄 Retrying sync for ${domain}`);
    try {
      await this.syncManager.syncDomain(domain);
    } catch (error) {
      console.error("Retry failed:", error);
    }
  }

  /**
   * Show error details
   */
  private showErrorDetails(error: any): void {
    console.log("📋 Showing error details:", error);
    // Implementation would show detailed error information
  }
}

/**
 * Create user notification manager with default configuration
 */
export function createUserNotificationManager(
  syncManager: UnifiedSyncManager,
  config?: Partial<UserNotificationConfig>,
  serviceWorkerSyncManager?: ServiceWorkerSyncManager
): UserNotificationManager {
  const defaultConfig: UserNotificationConfig = {
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
  };

  const finalConfig = { ...defaultConfig, ...config };
  return new UserNotificationManager(
    syncManager,
    finalConfig,
    serviceWorkerSyncManager
  );
}
