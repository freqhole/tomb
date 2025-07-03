/**
 * WebSocket Notification Debug Helper
 *
 * Run this in the browser console to debug WebSocket notification flow.
 * This script will help you test and troubleshoot the notification system.
 */

// Global debug object to expose functions
window.notificationDebug = {

  /**
   * Test if WebSocket connection is working by checking current status
   */
  checkWebSocketStatus() {
    console.log("🔍 Checking WebSocket status...");

    // Look for WebSocket client in common locations
    const possibleClients = [
      window.websocketClient,
      window.wsClient,
      window.ws,
    ];

    for (const client of possibleClients) {
      if (client) {
        console.log("✅ Found WebSocket client:", {
          status: client.getStatus ? client.getStatus() : "unknown",
          isConnected: client.isConnected ? client.isConnected() : "unknown",
          url: client.url || "unknown",
          client: client
        });
        return client;
      }
    }

    console.log("❌ No WebSocket client found. Try running after page loads.");
    return null;
  },

  /**
   * Monitor all WebSocket events by hooking into the client
   */
  monitorWebSocketEvents() {
    const client = this.checkWebSocketStatus();
    if (!client) return;

    console.log("👂 Setting up WebSocket event monitoring...");

    // Hook into all possible events
    const events = ['notification', 'rawMessage', 'statusChange', 'error', 'open', 'close'];

    events.forEach(eventName => {
      const originalOn = client.on;
      if (originalOn) {
        client.on(eventName, (data) => {
          console.log(`📡 WebSocket Event [${eventName}]:`, data);
        });
      }
    });

    console.log("✅ WebSocket monitoring enabled");
  },

  /**
   * Test notification processing by simulating a song.created notification
   */
  testSongNotification() {
    console.log("🧪 Testing song.created notification...");

    const testNotification = {
      id: "test-" + Date.now(),
      channel: "MediaBlobs",
      event_type: "song.created",
      payload: {
        id: 123,
        title: "Test Song",
        artist: "Test Artist",
        album: "Test Album"
      },
      priority: "high",
      timestamp: new Date().toISOString()
    };

    // Try to find and trigger WebSocket client directly
    const client = this.checkWebSocketStatus();
    if (client && client._eventListeners) {
      console.log("📤 Simulating notification via WebSocket client...");

      // Trigger notification event handlers directly
      const notificationHandlers = client._eventListeners.notification || [];
      notificationHandlers.forEach(handler => {
        try {
          handler(testNotification);
          console.log("✅ Called notification handler");
        } catch (error) {
          console.error("❌ Error calling notification handler:", error);
        }
      });
    }

    // Also try to find auto-sync system
    if (window.autoSyncSystem) {
      console.log("📤 Testing auto-sync system notification handling...");
      if (window.autoSyncSystem.processNotification) {
        window.autoSyncSystem.processNotification(testNotification);
      }
    }

    console.log("🧪 Test notification sent:", testNotification);
  },

  /**
   * Check auto-sync system status
   */
  checkAutoSyncStatus() {
    console.log("🔍 Checking auto-sync system status...");

    const possibleSystems = [
      window.autoSyncSystem,
      window.phase3System,
      window.syncManager,
    ];

    for (const system of possibleSystems) {
      if (system) {
        console.log("✅ Found auto-sync system:", {
          status: system.getStatus ? system.getStatus() : "unknown",
          stats: system.getStats ? system.getStats() : "unknown",
          isEnabled: system.isEnabled || "unknown",
          pending: system.getPendingNotifications ? system.getPendingNotifications() : "unknown",
          system: system
        });
      }
    }
  },

  /**
   * Enable debug mode on all components
   */
  enableAllDebugging() {
    console.log("🔧 Enabling all debugging...");

    // Enable unified sync debug
    if (window.unifiedSyncDebug) {
      window.unifiedSyncDebug.enable();
      console.log("✅ Unified sync debug enabled");
    }

    // Set debug flags
    localStorage.setItem('debug', 'true');
    localStorage.setItem('websocket-debug', 'true');
    localStorage.setItem('sync-debug', 'true');

    console.log("✅ Debug flags set in localStorage");
  },

  /**
   * Check notification router status
   */
  checkNotificationRouter() {
    console.log("🔍 Checking notification router...");

    // Look for notification router in auto-sync system
    if (window.autoSyncSystem && window.autoSyncSystem.notificationRouter) {
      const router = window.autoSyncSystem.notificationRouter;
      console.log("✅ Found notification router:", {
        isActive: router.isActive,
        config: router.config,
        stats: router.getStats ? router.getStats() : "unknown",
        pending: router.getPendingNotifications ? router.getPendingNotifications() : "unknown"
      });
    } else {
      console.log("❌ No notification router found");
    }
  },

  /**
   * Run a comprehensive debug check
   */
  runFullDiagnostic() {
    console.log("🔍 Running full notification system diagnostic...");
    console.log("=" * 50);

    this.enableAllDebugging();
    this.checkWebSocketStatus();
    this.checkAutoSyncStatus();
    this.checkNotificationRouter();
    this.monitorWebSocketEvents();

    console.log("=" * 50);
    console.log("🧪 Running test notification...");
    this.testSongNotification();

    console.log("✅ Full diagnostic complete!");
    console.log("💡 Check the console output above for any issues.");
    console.log("💡 Also check the UI logs in the sync demo component.");
  },

  /**
   * Send a test notification via server API (if available)
   */
  async sendTestNotificationViaServer() {
    console.log("📤 Sending test notification via server...");

    try {
      // Try to find API client
      const apiClient = window.apiClient;
      if (!apiClient) {
        console.log("❌ No API client found, trying direct fetch...");

        // Try direct POST to notification endpoint
        const response = await fetch('/api/test-notification', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: 'MediaBlobs',
            event_type: 'song.created',
            payload: {
              id: 999,
              title: 'Debug Test Song',
              artist: 'Debug Artist'
            }
          })
        });

        if (response.ok) {
          console.log("✅ Test notification sent via server");
        } else {
          console.log("❌ Server returned error:", response.status);
        }
      }
    } catch (error) {
      console.error("❌ Error sending test notification:", error);
      console.log("💡 Try running the SQL test script instead:");
      console.log("   psql -d your_db_name -f scripts/simple_notification_test.sql");
    }
  }
};

// Auto-run basic diagnostic on load
console.log("🚀 Notification Debug Helper loaded!");
console.log("💡 Available commands:");
console.log("  - notificationDebug.runFullDiagnostic()");
console.log("  - notificationDebug.testSongNotification()");
console.log("  - notificationDebug.checkWebSocketStatus()");
console.log("  - notificationDebug.checkAutoSyncStatus()");
console.log("  - notificationDebug.sendTestNotificationViaServer()");
console.log("");
console.log("🔧 Run notificationDebug.runFullDiagnostic() to start debugging!");
