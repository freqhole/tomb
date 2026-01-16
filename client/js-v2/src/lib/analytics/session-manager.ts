/**
 * Session manager for analytics
 *
 * Manages session identifiers for grouping related analytics events.
 * Uses existing cookie session system and generates client-side session IDs
 * for tracking user listening sessions across page reloads.
 */

export interface SessionManagerConfig {
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeout?: number;
  /** Enable debug logging */
  enableDebugLogs?: boolean;
}

export class SessionManager {
  private config: Required<SessionManagerConfig>;
  private currentSessionId: string | null = null;
  private sessionStartTime: number | null = null;
  private lastActivityTime: number | null = null;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      sessionTimeout: config.sessionTimeout || 30 * 60 * 1000, // 30 minutes
      enableDebugLogs: config.enableDebugLogs || false,
    };

    this.initializeSession();
  }

  /**
   * Get current session ID, creating one if needed
   */
  getSessionId(): string {
    this.updateLastActivity();

    if (this.isSessionExpired()) {
      this.debugLog("session expired, creating new one");
      this.createNewSession();
    }

    if (!this.currentSessionId) {
      this.createNewSession();
    }

    return this.currentSessionId!;
  }

  /**
   * Start a new session explicitly
   */
  startNewSession(): string {
    this.debugLog("explicitly starting new session");
    this.createNewSession();
    return this.currentSessionId!;
  }

  /**
   * Update activity timestamp to keep session alive
   */
  updateActivity(): void {
    this.updateLastActivity();
    this.debugLog("session activity updated");
  }

  /**
   * Get session info for debugging
   */
  getSessionInfo(): {
    sessionId: string | null;
    startTime: number | null;
    lastActivity: number | null;
    isExpired: boolean;
    timeRemaining: number | null;
  } {
    const now = Date.now();
    const timeRemaining = this.lastActivityTime
      ? Math.max(0, this.config.sessionTimeout - (now - this.lastActivityTime))
      : null;

    return {
      sessionId: this.currentSessionId,
      startTime: this.sessionStartTime,
      lastActivity: this.lastActivityTime,
      isExpired: this.isSessionExpired(),
      timeRemaining,
    };
  }

  /**
   * Initialize session from stored data or create new one
   */
  private initializeSession(): void {
    try {
      // Try to restore session from localStorage
      const stored = localStorage.getItem("analytics_session");
      if (stored) {
        const sessionData = JSON.parse(stored);

        if (this.isValidStoredSession(sessionData)) {
          this.currentSessionId = sessionData.sessionId;
          this.sessionStartTime = sessionData.startTime;
          this.lastActivityTime = sessionData.lastActivity;

          if (!this.isSessionExpired()) {
            this.debugLog("restored session from storage", {
              sessionId: this.currentSessionId,
              age: Date.now() - this.sessionStartTime!,
            });
            return;
          } else {
            this.debugLog("stored session expired");
          }
        }
      }
    } catch (error) {
      this.debugLog("failed to restore session from storage", error);
    }

    // Create new session if restoration failed or session expired
    this.createNewSession();
  }

  /**
   * Create a new session
   */
  private createNewSession(): void {
    const now = Date.now();
    this.currentSessionId = this.generateSessionId();
    this.sessionStartTime = now;
    this.lastActivityTime = now;

    this.debugLog("new session created", {
      sessionId: this.currentSessionId,
    });

    this.saveSessionToStorage();
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    // Use crypto.randomUUID if available, otherwise fallback
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback for older browsers
    return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Check if current session is expired
   */
  private isSessionExpired(): boolean {
    if (!this.lastActivityTime) return true;

    const now = Date.now();
    return (now - this.lastActivityTime) > this.config.sessionTimeout;
  }

  /**
   * Update last activity time and save to storage
   */
  private updateLastActivity(): void {
    this.lastActivityTime = Date.now();
    this.saveSessionToStorage();
  }

  /**
   * Save session data to localStorage
   */
  private saveSessionToStorage(): void {
    try {
      const sessionData = {
        sessionId: this.currentSessionId,
        startTime: this.sessionStartTime,
        lastActivity: this.lastActivityTime,
      };

      localStorage.setItem("analytics_session", JSON.stringify(sessionData));
    } catch (error) {
      this.debugLog("failed to save session to storage", error);
    }
  }

  /**
   * Validate stored session data
   */
  private isValidStoredSession(data: any): boolean {
    return (
      data &&
      typeof data.sessionId === "string" &&
      typeof data.startTime === "number" &&
      typeof data.lastActivity === "number" &&
      data.sessionId.length > 0
    );
  }

  /**
   * Debug logging helper
   */
  private debugLog(message: string, data?: unknown): void {
    if (this.config.enableDebugLogs) {
      console.log(`[session-manager] ${message}`, data);
    }
  }
}

// Create default session manager instance
export const sessionManager = new SessionManager();

// Convenience function to get current session ID
export function getCurrentSessionId(): string {
  return sessionManager.getSessionId();
}

// Convenience function to update activity
export function updateSessionActivity(): void {
  sessionManager.updateActivity();
}
