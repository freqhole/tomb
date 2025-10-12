/**
 * Event buffer for batching analytics events
 *
 * Collects events in memory and sends them in batches at regular intervals
 * or when the buffer reaches capacity. Handles failed requests gracefully
 * and provides page unload event draining.
 */

import { analyticsClient, type MediaEventRequest } from "./analytics-client";

export interface EventBufferConfig {
  /** Maximum number of events to buffer before auto-sending */
  maxBufferSize?: number;
  /** Time in milliseconds between batch sends */
  flushInterval?: number;
  /** Maximum time to wait for page unload drain */
  unloadTimeout?: number;
  /** Enable debug logging */
  enableDebugLogs?: boolean;
  /** Base URL for API requests */
  baseUrl?: string;
}

export class EventBuffer {
  private buffer: MediaEventRequest[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private config: Required<EventBufferConfig>;
  private isDestroyed = false;
  private unloadListener: (() => void) | null = null;
  private baseUrl: string;
  private sessionClientId: string;

  constructor(config: EventBufferConfig = {}) {
    this.config = {
      maxBufferSize: config.maxBufferSize || 1000,
      flushInterval: config.flushInterval || 10000, // 10 seconds
      unloadTimeout: config.unloadTimeout || 2000, // 2 seconds
      enableDebugLogs: config.enableDebugLogs || false,
      baseUrl: config.baseUrl || window.location.origin,
    };
    this.sessionClientId = this.generateSessionClientId();

    this.baseUrl = this.config.baseUrl;
    this.setupUnloadHandler();
    this.startFlushTimer();
  }

  /**
   * Set base URL for API requests
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Add an event to the buffer
   */
  addEvent(event: MediaEventRequest): void {
    if (this.isDestroyed) {
      this.debugLog("buffer destroyed, ignoring event", event);
      return;
    }

    // Add client_id for correlation tracking if not already present
    const eventWithClientId = {
      ...event,
      client_id: event.client_id || this.sessionClientId,
    };

    this.buffer.push(eventWithClientId);
    this.debugLog(
      `event added to buffer (${this.buffer.length}/${this.config.maxBufferSize})`,
      { client_id: eventWithClientId.client_id }
    );

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.debugLog("buffer full, auto-flushing");
      void this.flush();
    }
  }

  /**
   * Generate a unique client ID for the session
   */
  private generateSessionClientId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the current session client ID
   */
  public getSessionClientId(): string {
    return this.sessionClientId;
  }

  /**
   * Manually flush all buffered events
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      this.debugLog("buffer empty, nothing to flush");
      return;
    }

    const eventsToSend = [...this.buffer];
    this.debugLog(`flushing ${eventsToSend.length} events`);

    try {
      const result = await analyticsClient.submitBatch(eventsToSend);

      // Remove successfully processed events
      if (result.processed > 0) {
        this.buffer.splice(0, result.processed);
        this.debugLog(
          `${result.processed} events sent successfully, ${this.buffer.length} remaining in buffer`
        );
      }

      // Log any failures
      if (result.failed > 0) {
        this.debugLog(`${result.failed} events failed to send, kept in buffer`);
      }

      if (result.errors.length > 0) {
        this.debugLog("batch errors:", result.errors);
      }
    } catch (error) {
      // Keep events in buffer on network failure
      this.debugLog("flush failed, events kept in buffer", {
        error: error instanceof Error ? error.message : String(error),
        bufferSize: this.buffer.length,
      });

      // Don't throw - analytics failures shouldn't break the app
    }
  }

  /**
   * Get current buffer status
   */
  getStatus(): {
    bufferSize: number;
    maxBufferSize: number;
    nextFlushIn: number | null;
  } {
    const nextFlushIn = this.flushTimer ? this.config.flushInterval : null;

    return {
      bufferSize: this.buffer.length,
      maxBufferSize: this.config.maxBufferSize,
      nextFlushIn,
    };
  }

  /**
   * Clear all buffered events (use with caution)
   */
  clear(): void {
    this.debugLog(`clearing buffer with ${this.buffer.length} events`);
    this.buffer = [];
  }

  /**
   * Destroy the buffer and clean up resources
   */
  destroy(): Promise<void> {
    if (this.isDestroyed) {
      return Promise.resolve();
    }

    this.debugLog("destroying event buffer");
    this.isDestroyed = true;

    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Remove unload listener
    if (this.unloadListener) {
      window.removeEventListener("beforeunload", this.unloadListener);
      this.unloadListener = null;
    }

    // Final flush
    return this.flush();
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.isDestroyed) return;

    this.flushTimer = setTimeout(() => {
      this.debugLog("timer triggered flush");
      void this.flush().finally(() => {
        if (!this.isDestroyed) {
          this.startFlushTimer();
        }
      });
    }, this.config.flushInterval);
  }

  /**
   * Set up page unload handler to try to send events before page closes
   */
  private setupUnloadHandler(): void {
    this.unloadListener = () => {
      if (this.buffer.length === 0) return;

      this.debugLog(
        `page unloading with ${this.buffer.length} buffered events, attempting to send`
      );

      // Use sendBeacon for reliability during page unload
      try {
        const payload = JSON.stringify({ events: this.buffer });
        const success = navigator.sendBeacon(
          `${this.baseUrl}/api/analytics/events`,
          new Blob([payload], { type: "application/json" })
        );

        if (success) {
          this.debugLog("events sent via sendBeacon on page unload");
          this.buffer = [];
        } else {
          this.debugLog("sendBeacon failed, events may be lost");
        }
      } catch (error) {
        this.debugLog("sendBeacon error", error);

        // Fallback to synchronous fetch (may not complete)
        try {
          void fetch(`${this.baseUrl}/api/analytics/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: this.buffer }),
            credentials: "include",
            keepalive: true,
          });
        } catch (fetchError) {
          this.debugLog("fallback fetch also failed", fetchError);
        }
      }
    };

    window.addEventListener("beforeunload", this.unloadListener);
  }

  /**
   * Debug logging helper
   */
  private debugLog(message: string, data?: unknown): void {
    if (this.config.enableDebugLogs) {
      console.log(`[event-buffer] ${message}`, data);
    }
  }
}

// Create default buffer instance
export const eventBuffer = new EventBuffer();

// Convenience function to add events
export function trackEvent(event: MediaEventRequest): void {
  eventBuffer.addEvent(event);
}

// Convenience function to flush immediately
export function flushEvents(): Promise<void> {
  return eventBuffer.flush();
}

// Convenience function to get session client ID
export function getSessionClientId(): string {
  return eventBuffer.getSessionClientId();
}
