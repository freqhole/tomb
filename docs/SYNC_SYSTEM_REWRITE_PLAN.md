# Unified Sync System Plan 🚀

**Goal**: Build a new clean, simple, maintainable sync system alongside the existing one based on lessons learned.

**Strategy**: Move existing `sync/` → `sync-legacy/`, build new clean system in `sync/`, preserve working demos as stable reference.

## Current Problems 🚨

### Code Complexity

- **Multiple overlapping systems**: `SyncStorageManager`, `MediaBlobCache`, `WebSocketBinaryConnector`, `IntegratedSyncManager`
- **Dual caching layers**: `binary_data` table vs `media_blob_data` table
- **Inconsistent APIs**: Different methods for same operations across classes
- **Debug nightmare**: 2000+ lines of sync code spread across 10+ files
- **Cache coordination hell**: Multiple systems not talking to each other

### Data Flow Confusion

- **Unclear ownership**: Who stores what where?
- **Field name mismatches**: `data` vs `thumbnail_data` vs `binary_data`
- **Multiple storage interfaces**: IndexedDB direct access vs abstracted managers
- **Race conditions**: Async operations with unclear dependencies

### Integration Complexity

- **WebSocket + HTTP + Storage**: Three different protocols/systems to coordinate
- **Event bubbling chaos**: Events firing between multiple managers
- **Force debug flags**: Had to bypass cache logic to make things work
- **Schema mismatches**: Different expected data shapes at each layer

## New Architecture Design 🏗️

### Core Principle: **Single Source of Truth + Multi-Domain Support**

One unified sync manager that handles all entity types with clear, simple APIs and extensible domain support.

**Directory Strategy:**

- New clean system: `client/js/src/sync/` (gets the simple name)
- Current complex system: `client/js/src/sync-legacy/` (moved from sync/)
- Preserve working demos as stable reference using `sync-legacy/`

```typescript
interface UnifiedSyncManager {
  // Universal sync method
  syncAll(): Promise<SyncResult>;

  // Domain-specific sync (for future extensibility)
  syncDomain(domain: SyncDomain): Promise<SyncResult>;

  // Binary data management
  getBlobUrl(blobId: string): Promise<string | null>;
  getThumbnailUrl(blobId: string): Promise<string | null>;

  // Auto-sync management
  enableAutoSync(): void;
  disableAutoSync(): void;

  // Service worker support
  runInServiceWorker(): Promise<void>;
  runInMainThread(): Promise<void>;
}

// Extensible domain types
type SyncDomain =
  | "music" // songs, playlists, playlist_songs
  | "video" // videos, video_playlists, video_playlist_items
  | "photos" // photos, photo_galleries, photo_gallery_items
  | "documents" // documents, document_folders, document_folder_items
  | "media_blobs"; // All binary data across domains
```

### Unified Storage Model

**One IndexedDB database with extensible domain support:**

```sql
-- Current domain tables
media_blobs        -- Blob metadata only
songs              -- Song metadata
playlists          -- Playlist metadata
playlist_songs     -- Playlist relationships

-- Future domain tables (same pattern)
videos             -- Video metadata
video_playlists    -- Video playlist metadata
video_playlist_items -- Video playlist relationships
photos             -- Photo metadata
photo_galleries    -- Photo gallery metadata
photo_gallery_items -- Photo gallery relationships
documents          -- Document metadata
document_folders   -- Document folder metadata
document_folder_items -- Document folder relationships

-- Unified binary cache (unchanged from existing structure)
binary_cache       -- ALL binary data across domains
  blob_id TEXT PRIMARY KEY
  data BLOB NOT NULL
  mime_type TEXT NOT NULL
  size INTEGER NOT NULL
  cached_at TEXT NOT NULL
  expires_at TEXT     -- Optional expiration
  blob_type TEXT      -- 'original', 'thumbnail', 'waveform'

-- Sync metadata table
sync_metadata      -- Track sync state per domain
  domain TEXT PRIMARY KEY
  last_sync_time TEXT
  total_items INTEGER
  synced_items INTEGER
  error_count INTEGER
```

**Key features:**

- ✅ **No database schema changes** (existing PostgreSQL structure unchanged)
- ✅ **Domain extensibility** (easy to add videos, photos, documents)
- ✅ **Unified binary cache** (one table for all blob types across domains)
- ✅ **Sync state tracking** (progress and error monitoring per domain)

### Request Flow Simplification

#### Current Flow (Complex)

```
[UI] → [MediaBlobCache] → [check binary_data table] → [WebSocketBinaryConnector]
  → [WebSocket request] → [Server] → [WebSocket response] → [SyncStorageManager]
  → [store in media_blob_data] → [maybe update MediaBlobCache?] → [UI refresh?]
```

#### New Flow (Simple)

```
[UI] → [SyncManagerV2.syncAll()] → [Service Worker OR Main Thread]
  → [WebSocket metadata sync] → [cache in IndexedDB]
  → [WebSocket binary sync] → [cache in binary_cache] → [auto-refresh UI]

[UI] → [SyncManagerV2.getBlobUrl(id)] → [check binary_cache]
  → if missing: [fetch via WebSocket] → [store in binary_cache] → [return blob URL]
```

#### Auto-Sync Flow (New)

```
[Server] → [WebSocket notification] → [Service Worker] → [auto-sync domain]
  → [update IndexedDB] → [notify main thread] → [UI auto-refresh]
```

### Clean API Design

```typescript
class UnifiedSyncManager {
  private db: IDBDatabase;
  private ws: WebSocketClient;
  private isServiceWorker: boolean;
  private autoSyncEnabled: boolean = false;

  // ========================================
  // PUBLIC API - Domain-Extensible
  // ========================================

  async syncAll(): Promise<SyncResult> {
    const results = await Promise.all([
      this.syncDomain("music"),
      this.syncDomain("media_blobs"),
      // Easy to add: this.syncDomain('video'),
      // Easy to add: this.syncDomain('photos'),
    ]);

    return this.combineSyncResults(results);
  }

  async syncDomain(domain: SyncDomain): Promise<SyncResult> {
    const config = this.getDomainConfig(domain);
    const result = { domain, synced: 0, total: 0, errors: [] };

    for (const table of config.tables) {
      const tableResult = await this.syncTable(table, config.endpoint);
      result.synced += tableResult.synced;
      result.total += tableResult.total;
      result.errors.push(...tableResult.errors);
    }

    await this.updateSyncMetadata(domain, result);
    return result;
  }

  async getBlobUrl(blobId: string): Promise<string | null> {
    const cached = await this.getCachedBinary(blobId);
    if (cached) return this.createBlobUrl(cached);

    const binary = await this.fetchBinaryData(blobId);
    if (!binary) return null;

    await this.cacheBinaryData(blobId, binary);
    return this.createBlobUrl(binary);
  }

  enableAutoSync(): void {
    this.autoSyncEnabled = true;
    // Subscribe to existing Music notifications for auto-sync
    this.ws.send(createMessage.subscribeToNotifications("Music"));
    this.ws.on("notification", this.handleNotification.bind(this));
  }

  // ========================================
  // DOMAIN CONFIGURATION - Extensible
  // ========================================

  private getDomainConfig(domain: SyncDomain): DomainConfig {
    const configs = {
      music: {
        tables: ["songs", "playlists", "playlist_songs"],
        endpoint: "/api/sync/music",
      },
      video: {
        tables: ["videos", "video_playlists", "video_playlist_items"],
        endpoint: "/api/sync/video",
      },
      photos: {
        tables: ["photos", "photo_galleries", "photo_gallery_items"],
        endpoint: "/api/sync/photos",
      },
      documents: {
        tables: ["documents", "document_folders", "document_folder_items"],
        endpoint: "/api/sync/documents",
      },
      media_blobs: {
        tables: ["media_blobs"],
        endpoint: "/api/sync/media_blobs",
      },
    };

    return configs[domain];
  }

  // ========================================
  // AUTO-SYNC & SERVICE WORKER SUPPORT
  // ========================================

  private async handleNotification(
    notification: WebSocketNotification,
  ): Promise<void> {
    if (!this.autoSyncEnabled) return;

    // Map existing notification channels to sync domains
    const domain = this.mapNotificationToDomain(notification);
    if (!domain) return;

    console.log(
      `🔄 Auto-sync triggered for domain: ${domain} (${notification.event_type})`,
    );
    await this.syncDomain(domain);

    if (this.isServiceWorker) {
      // Notify main thread of sync completion
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: "SYNC_COMPLETE",
            domain: notification.domain,
          });
        });
      });
    } else {
      // Emit event for UI components
      window.dispatchEvent(
        new CustomEvent("sync_complete", {
          detail: { domain: notification.domain },
        }),
      );
    }
  }

  private mapNotificationToDomain(
    notification: WebSocketNotification,
  ): SyncDomain | null {
    // Map existing notification channels to sync domains
    switch (notification.channel) {
      case "Music":
        // Music events: song.created, playlist.updated, etc.
        return "music";
      case "MediaBlobs":
        // Blob events: blob.created, thumbnail.generated, etc.
        return "media_blobs";
      default:
        return null;
    }
  }

  async runInServiceWorker(): Promise<void> {
    this.isServiceWorker = true;
    // Service worker specific initialization
  }

  async runInMainThread(): Promise<void> {
    this.isServiceWorker = false;
    // Main thread specific initialization
  }
}

// Domain configuration types
interface DomainConfig {
  tables: string[];
  endpoint: string;
}

// Reuse existing WebSocket notification types
type WebSocketNotification = {
  id: string;
  channel: NotificationChannel;
  event_type: string;
  payload: any;
  priority: string;
  timestamp: string;
};
```

## Implementation Plan 📋

### Phase 0: Preserve Working System (1 hour)

```bash
# 1. Move existing sync system to legacy
mv client/js/src/sync/ client/js/src/sync-legacy/

# 2. Update imports in existing demos (only ~4 files)
# - examples/sync/test-sync-integration.ts
# - web-components/sync-demo.tsx
# - web-components/websocket-thumbnail-demo.tsx

# 3. Verify existing demos still work with sync-legacy/
# This preserves our hard-won thumbnail success as stable reference!
```

### Phase 1: Core Infrastructure (2-3 days)

```typescript
// client/js/src/sync/sync-manager.ts
class UnifiedSyncManager {
  // Basic IndexedDB setup (reuse existing schema)
  // WebSocket connection management
  // Domain-configurable metadata sync
  // Service worker + main thread support
}

// client/js/src/sync/domain-configs.ts
export const DOMAIN_CONFIGS = {
  music: { tables: ["songs", "playlists", "playlist_songs"] },
  video: { tables: ["videos", "video_playlists", "video_playlist_items"] },
  // etc...
};

// client/js/src/sync/storage.ts
class UnifiedStorage {
  // Clean IndexedDB operations
  // Generic table sync methods
  // Binary cache management
}
```

### Phase 2: Service Worker Integration (1-2 days)

```typescript
// client/js/src/sync/service-worker.ts
// Service worker implementation with sync manager
// Background sync capabilities
// Existing notification system integration

// client/js/src/sync/main-thread.ts
// Main thread wrapper for sync manager
// Communication with service worker
// Fallback when service workers not available
```

### Phase 3: Auto-Sync & Notifications (1 day)

```typescript
// Add to UnifiedSyncManager:
enableAutoSync(): void
handleNotification(notification: WebSocketNotification): Promise<void>

// REUSE existing notification system:
// ✅ Music channel already exists with song/playlist events
// ✅ MediaBlobs channel for blob/thumbnail events
// ✅ WebSocket notification types already defined
// ✅ Server-side infrastructure already operational
```

### Phase 4: Unified UI Demo (1-2 days)

```typescript
// client/js/src/web-components/unified-sync-demo.tsx
<unified-sync-demo
  auto-connect="true"
  enable-service-worker="true"
  enable-auto-sync="true"
/>

// Features:
// - Auto WebSocket connection with status indicator
// - One "Sync All" button (no domain-specific buttons)
// - Progress bars and stats (reuse from sync-demo)
// - Service worker toggle
// - Auto-sync enable/disable
// - Real-time sync notifications using existing Music/MediaBlobs channels

// Keep existing demos working as stable reference:
// - sync-demo.tsx → uses sync-legacy/ (preserve thumbnail victory!)
// - websocket-thumbnail-demo.tsx → uses sync-legacy/
// - New unified-sync-demo.tsx → uses clean sync/
```

### Phase 5: Multi-Domain Foundation (1 day)

```typescript
// Add domain configs for future domains:
// - video (videos, video_playlists, video_playlist_items)
// - photos (photos, photo_galleries, photo_gallery_items)
// - documents (documents, document_folders, document_folder_items)

// Extend existing notification channels:
// - Add "Video", "Photos", "Documents" to NotificationChannel enum
// - Create event types similar to existing MusicEventType
// - Reuse existing notification infrastructure
```

## File Structure 📁

### New (Clean & Extensible)

```
client/js/src/sync/              # New clean system gets simple name
├── sync-manager.ts            # 400 lines - main sync logic + domains
├── storage.ts                 # 200 lines - IndexedDB operations
├── domain-configs.ts          # 100 lines - domain configuration
├── service-worker.ts          # 150 lines - service worker implementation
├── main-thread.ts             # 100 lines - main thread wrapper
├── websocket.ts               # 50 lines - WebSocket helpers (reuse existing)
├── notifications.ts           # 25 lines - notification mapping (reuse existing)
└── hook.ts                    # 50 lines - React/Solid hook

client/js/src/web-components/
├── unified-sync-demo.tsx      # 300 lines - unified demo UI

Total: ~1375 lines (25% reduction due to reusing existing notification system)
```

### Keep (Stable Reference)

```
client/js/src/sync-legacy/       # Moved from sync/, preserved as-is
├── All existing files unchanged
├── Working demos continue using this (sync-demo.tsx, websocket-thumbnail-demo.tsx)
├── Stable reference for our hard-won thumbnail success!
├── Can be compared against new system for debugging
└── Provides fallback if new sync/ has issues

client/js/src/web-components/
├── sync-demo.tsx              # Updated imports to sync-legacy/, otherwise unchanged
├── websocket-thumbnail-demo.tsx # Updated imports to sync-legacy/, otherwise unchanged
└── unified-sync-demo.tsx      # NEW - uses clean sync/ system

server/src/notifications/
├── Existing notification infrastructure REUSED
├── Music channel events already perfect for auto-sync
├── WebSocket types already defined
└── No new server-side code needed for basic auto-sync
```

## Benefits of Rewrite 🎯

### Developer Experience

- **70% less code** (600 vs 2000+ lines)
- **Single file to understand** instead of 10+ files
- **Clear data flow** - no hidden state changes
- **Simple debugging** - one place to add logs
- **Predictable behavior** - no race conditions

### User Experience

- **Faster syncing** - no redundant operations
- **Reliable thumbnails** - single storage system
- **Better error handling** - unified error states
- **Consistent caching** - no cache misses between systems

### Maintenance

- **Easy to extend** - add new binary types easily
- **Simple testing** - mock one manager instead of 5
- **Clear responsibilities** - each method has one job
- **No technical debt** - fresh start with lessons learned

## Server-Side Enhancements 🔧

### Reuse Existing Server Infrastructure ✅

**No new server endpoints needed!** Existing infrastructure already provides:

```rust
// EXISTING endpoints (reuse):
GET /api/sync/songs           // Already exists
GET /api/sync/playlists       // Already exists
GET /api/sync/media_blobs     // Already exists
WebSocket /ws                 // Already has notification support

// EXISTING notification system (reuse):
// server/src/notifications/music_events.rs
pub enum MusicEventType {
    SongCreated,           // Perfect for auto-sync!
    SongUpdated,           // Perfect for auto-sync!
    PlaylistCreated,       // Perfect for auto-sync!
    PlaylistUpdated,       // Perfect for auto-sync!
    // ... all the events we need already exist
}

// client/js/src/lib/websocket-types.ts
NotificationChannel::Music    // Already subscriptable
NotificationChannel::MediaBlobs // Already subscriptable
```

**Future server work (when adding video/photos/documents):**

- Add new notification channels: `Video`, `Photos`, `Documents`
- Create event types similar to existing `MusicEventType`
- Reuse existing notification infrastructure patterns

### No Database Changes Required

- ✅ **Existing PostgreSQL schema unchanged**
- ✅ **Existing IndexedDB schema reused**
- ✅ **New binary_cache table only if needed**
- ✅ **Gradual adoption without migration**

## Risk Mitigation 🛡️

### What Could Go Wrong

- **Data loss during migration** → Full backup before migration
- **Performance regression** → Benchmark before/after
- **UI breakage** → Gradual component migration
- **WebSocket issues** → Keep WebSocket client unchanged

### Rollback Plan

- **Feature flag** to instantly switch back to old system
- **Database backup** to restore data if needed
- **Old code preserved** in git branches until stable
- **Monitoring** to detect issues early

## Success Metrics 📊

### Code Quality

- **Lines of code**: Target 35% reduction (2000+ → 1375, due to reusing notifications)
- **File count**: Similar count but better organized (unified-sync/ directory)
- **Domain extensibility**: <50 lines to add new domain support
- **Cyclomatic complexity**: Target <10 per method
- **Test coverage**: Target >90% for new code

### Performance

- **Sync time**: Target 50% faster (fewer redundant operations)
- **Memory usage**: Target 30% less (single cache system)
- **Cache hit rate**: Target >95% (unified caching)
- **Error rate**: Target <1% (better error handling)

### Developer Experience

- **Time to understand**: Target <30 minutes (vs 3+ hours currently)
- **Time to add new domain**: Target <1 hour (reuse notification patterns)
- **Time to add feature**: Target <1 hour (vs 1+ day currently)
- **Bug fix time**: Target <30 minutes (vs 3+ hours currently)
- **Onboarding time**: Target <1 day (vs 1+ week currently)

### UI/UX Experience

- **Auto-connect**: WebSocket connects automatically on page load
- **Unified sync**: One button syncs everything (no domain confusion)
- **Service worker**: Background sync continues when tab is closed
- **Auto-sync**: Real-time updates when server data changes
- **Progress stats**: Visual feedback with numbers and progress bars

---

## Conclusion 🎉

The current sync system evolved organically and became overly complex. This unified sync plan provides a path to a **clean, maintainable, extensible** solution that's **built alongside** the existing system with **significantly better developer experience**.

**Key insights**:

- Most complexity came from coordinating multiple independent systems
- Solution is **one unified system** with **domain extensibility**
- **Reuse existing notification infrastructure** (Music/MediaBlobs channels already perfect!)
- **Service worker support** enables background sync and better UX
- **Auto-sync notifications** provide real-time updates with zero server changes
- **No database changes** means low-risk adoption

**Timeline**: ~1 week for complete implementation (faster due to reusing notifications)
**Risk**: Very low (existing system preserved in sync-legacy/, working demos untouched)
**Payoff**:

- Massive improvement in maintainability and developer productivity
- Foundation for easy multi-domain expansion (videos, photos, documents)
- Modern UX with service workers and auto-sync
- Unified demo that's actually enjoyable to use
- Zero server-side changes needed for basic functionality
- **Stable reference preserved**: Our hard-won thumbnail success stays working!

**Migration Strategy**: New clean system in `sync/`, complex system in `sync-legacy/`, side-by-side demos for comparison.

Let's build a unified sync system that's **future-ready and developer-friendly**! 🚀
