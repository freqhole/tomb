# WebSocket Real-Time Notification System

## Overview

This document outlines the implementation of a real-time notification system that enables automatic syncing when new content is added to the server. The system uses PostgreSQL NOTIFY/LISTEN, WebSocket connections, and an auto-sync notification router to provide seamless real-time updates.

## System Architecture

```
Database (PostgreSQL) → Notification Listener → WebSocket Publisher → Client Auto-Sync Router → UI Updates
```

### Components

1. **PostgreSQL Triggers & NOTIFY**: Database-level notifications when data changes
2. **Server Notification Infrastructure**: Listens for PostgreSQL notifications
3. **WebSocket Publisher**: Broadcasts notifications to connected clients
4. **Client Auto-Sync Router**: Processes notifications and triggers syncs
5. **UI Integration**: Updates interface with new data

## Implementation Summary

### ✅ What We Built

#### 1. Server-Side Infrastructure

**PostgreSQL Notification Listener** (`server/src/notifications/postgres_listener.rs`):
- Listens to channels: `media_blobs`, `thumbnail_jobs`, `music_notifications`
- Converts database notifications to WebSocket messages
- Directly broadcasts to WebSocket clients with proper message format

**WebSocket Message Format**:
```json
{
  "type": "Notification",
  "data": {
    "id": "uuid",
    "channel": "MediaBlobs",
    "event_type": "song.created",
    "payload": { /* event data */ },
    "priority": "Normal",
    "timestamp": "2025-07-03T15:00:18.160937+00:00"
  }
}
```

**Notification Infrastructure** (`server/src/notifications/mod.rs`):
- Integrates PostgreSQL listener with WebSocket broadcasting
- Starts notification infrastructure on server startup

#### 2. Client-Side Auto-Sync System

**Auto-Sync Notification Router** (`client/js/src/sync/auto-sync-notification-router.ts`):
- Listens for WebSocket notification events
- Converts `event_type` (snake_case) to `eventType` (camelCase)
- Processes sync rules for different notification types
- Triggers immediate or batched syncs based on notification priority

**Sync Rules**:
- `song.created`, `song.updated`, `song.deleted` → Music domain sync
- `media_blob.created` → Music domain sync (batched)
- Custom rules for photos, videos, documents

**UI Integration** (`client/js/src/web-components/unified-sync-demo.tsx`):
- Exposes sync objects to window for debugging
- Provides manual UI refresh function
- Auto-refreshes UI after auto-sync completion

### 📊 Key Metrics

- **Real-time sync**: ~5 second delay from database change to UI update
- **Batched processing**: Queues multiple notifications to avoid spam syncing
- **Error handling**: Graceful failure for unsupported domains (photos, videos)
- **UI updates**: Automatic refresh of item counts and last sync times

## How It Works

### 1. Database to Server Flow

1. CLI adds new music file
2. Database trigger sends NOTIFY on `media_blobs` channel
3. PostgreSQL listener receives notification
4. Server broadcasts to all WebSocket clients

### 2. Client Processing Flow

1. WebSocket client receives notification
2. Auto-sync router processes event type
3. Router triggers sync for relevant domains
4. Sync manager updates local storage
5. UI refreshes with new data

### 3. Event Types Handled

- **`song.created`**: New song added → Immediate sync
- **`media_blob.created`**: New media file → Batched sync
- **`scan_progress`**: CLI progress updates → Batched sync
- **Custom events**: Configurable via sync rules

## Configuration

### Server Configuration

Enable notifications in `grimoire/src/config/app_config.rs`:
```rust
pub struct FeatureFlags {
    pub notifications_enabled: bool, // Set to true
}
```

### Client Configuration

Auto-sync router configuration in `auto-sync-notification-router.ts`:
```typescript
const DEFAULT_SYNC_RULES: NotificationSyncRule[] = [
  {
    id: "song-database-events",
    channels: ["MediaBlobs"],
    eventTypes: ["song.created", "song.updated", "song.deleted"],
    targetDomains: ["music"],
    priorities: ["high"],
  }
];
```

## Testing

### Manual Testing

1. **Database Test Script**: `scripts/simple_notification_test.sql`
   ```sql
   SELECT pg_notify('media_blobs', '{"event_type":"song.created","id":"test-123"}');
   ```

2. **Browser Console Debug**:
   ```javascript
   // Check system status
   window.autoSyncSystem.getStats();

   // Manual UI refresh
   window.refreshUIFromSyncManager();

   // Test notification processing
   window.autoSyncSystem.notificationRouter.processNotification({...});
   ```

3. **CLI Integration**: Run music sync CLI and observe real-time UI updates

### Debug Commands

```javascript
// Enable debug logging
window.unifiedSyncDebug.enable();

// Check WebSocket status
window.websocketClient.getStatus();

// Check auto-sync router stats
window.autoSyncSystem.getStats();
```

## Troubleshooting

### Common Issues

1. **Notifications not received**: Check WebSocket connection status
2. **UI not updating**: Verify event listeners are attached
3. **Sync not triggering**: Check auto-sync router configuration
4. **Wrong event format**: Ensure snake_case → camelCase conversion

### Debug Checklist

- [ ] WebSocket connection established (`connected`)
- [ ] Auto-sync system enabled (`isActive: true`)
- [ ] Notification router receiving events (`notificationsReceived > 0`)
- [ ] Sync manager has updated data
- [ ] UI refresh function available (`window.refreshUIFromSyncManager`)

## 🧹 Cleanup Tasks

The current implementation includes extensive debugging code added during development. Here are the tasks to clean up and productionize the system:

### Priority 1: Remove Debug Code

#### Server-Side Debug Cleanup

**File**: `server/src/notifications/postgres_listener.rs`
- [ ] Remove excessive `console.log` statements
- [ ] Remove debug timing logs
- [ ] Keep only essential error and status logs
- [ ] Use appropriate log levels (info, warn, error)

#### Client-Side Debug Cleanup

**File**: `client/js/src/sync/auto-sync-notification-router.ts`
- [ ] Remove `console.log("📬 AutoSyncNotificationRouter.processNotification called: ...")`
- [ ] Remove `console.log("🔍 ALL NOTIFICATION DEBUG: ...")`
- [ ] Remove `console.log("📦 Queued notification for batched sync: ...")`
- [ ] Remove `console.log("🔄 Auto-sync triggered for ...")`
- [ ] Keep only essential error logging
- [ ] Remove manual `window.refreshUIFromSyncManager()` call in production

**File**: `client/js/src/web-components/unified-sync-demo.tsx`
- [ ] Remove window object exposure (`window.websocketClient`, `window.syncManager`, etc.)
- [ ] Remove `window.refreshUIFromSyncManager` function
- [ ] Remove debug logging for button state checks
- [ ] Remove `addLog("🔧 Debug objects exposed to window")`
- [ ] Keep only essential user-facing logs

### Priority 2: Production Hardening

#### Error Handling Improvements

**File**: `server/src/notifications/postgres_listener.rs`
- [ ] Add retry logic for failed WebSocket broadcasts
- [ ] Add circuit breaker for repeated failures
- [ ] Add metrics collection for notification delivery
- [ ] Add proper health checks

**File**: `client/js/src/sync/auto-sync-notification-router.ts`
- [ ] Add retry logic for failed syncs
- [ ] Add exponential backoff for repeated failures
- [ ] Add proper error recovery mechanisms
- [ ] Add user notifications for persistent failures

#### Performance Optimizations

- [ ] Implement proper event throttling/debouncing
- [ ] Add notification deduplication
- [ ] Optimize WebSocket message parsing
- [ ] Add connection pooling for PostgreSQL listeners

### Priority 3: Configuration & Feature Flags

#### Runtime Configuration

**File**: `grimoire/src/config/app_config.rs`
- [ ] Add notification batching configuration
- [ ] Add retry policy configuration
- [ ] Add WebSocket connection limits
- [ ] Add notification channel filtering

**File**: `client/js/src/sync/auto-sync-notification-router.ts`
- [ ] Make sync rules configurable at runtime
- [ ] Add per-domain sync policies
- [ ] Add user preference controls
- [ ] Add bandwidth-aware syncing

### Priority 4: Testing & Monitoring

#### Automated Testing

- [ ] Add unit tests for notification router
- [ ] Add integration tests for WebSocket flow
- [ ] Add end-to-end tests for CLI → UI flow
- [ ] Add performance benchmarks

#### Monitoring & Observability

- [ ] Add notification delivery metrics
- [ ] Add sync success/failure rates
- [ ] Add latency monitoring
- [ ] Add user experience metrics

### Implementation Context

#### Key Files Modified During Development

1. **Server Infrastructure**:
   - `server/src/notifications/postgres_listener.rs` - PostgreSQL notification listener
   - `server/src/notifications/websocket_publisher.rs` - WebSocket message formatting
   - `server/src/notifications/mod.rs` - Notification infrastructure setup
   - `server/src/startup.rs` - Integration with app startup

2. **Client Auto-Sync**:
   - `client/js/src/sync/auto-sync-notification-router.ts` - Main notification processing
   - `client/js/src/sync/auto-sync-integration.ts` - Auto-sync system integration
   - `client/js/src/web-components/unified-sync-demo.tsx` - UI integration

3. **Configuration**:
   - `grimoire/src/config/app_config.rs` - Feature flags

#### Critical Code Patterns

**WebSocket Message Conversion**:
```typescript
// Convert server format to client format
const notification: WebSocketNotification = {
  id: data.id,
  channel: data.channel,
  eventType: data.event_type, // snake_case → camelCase
  payload: data.payload,
  priority: data.priority,
  timestamp: data.timestamp,
};
```

**UI Refresh Pattern**:
```typescript
// Force UI update after auto-sync
const freshStatus = manager.getStatus();
const freshProgress = manager.getProgress();
setSyncStatus(freshStatus);
setSyncProgress(freshProgress);
setLastSyncTime(new Date());
```

**Sync Rule Configuration**:
```typescript
{
  id: "song-database-events",
  channels: ["MediaBlobs"],
  eventTypes: ["song.created", "song.updated", "song.deleted"],
  targetDomains: ["music"],
  priorities: ["high"],
}
```

### Cleanup Approach

1. **Start with client-side cleanup** (less risky than server changes)
2. **Remove debug logs incrementally** (test after each removal)
3. **Replace with proper logging framework** (structured logging)
4. **Add feature flags** for debug mode in development
5. **Test thoroughly** after each cleanup phase

### Success Criteria

- [ ] No debug objects exposed to `window` in production
- [ ] Clean, minimal console output
- [ ] Proper error handling and recovery
- [ ] Configurable notification behavior
- [ ] Automated test coverage
- [ ] Production monitoring in place

## Future Enhancements

### Planned Features

1. **Smart Sync Scheduling**: Only sync during user activity periods
2. **Bandwidth-Aware Syncing**: Adjust sync frequency based on connection speed
3. **User Preferences**: Allow users to configure auto-sync behavior
4. **Push Notifications**: Native OS notifications for important sync events
5. **Offline Support**: Queue notifications for processing when connection restored

### Architecture Improvements

1. **Notification Persistence**: Store notifications in database for reliability
2. **Horizontal Scaling**: Support multiple server instances
3. **Advanced Filtering**: User-defined notification rules
4. **Analytics Integration**: Track sync patterns and user behavior

## Conclusion

The WebSocket notification system provides real-time sync capabilities that enhance the user experience by automatically keeping data up-to-date. The implementation successfully demonstrates end-to-end real-time communication from database changes to UI updates.

The system is currently functional with extensive debugging capabilities. The next phase should focus on production hardening and cleanup as outlined in the tasks above.
