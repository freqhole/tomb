# WebSocket Binary Sync System

This document describes the WebSocket-based binary data synchronization system that enables offline caching of media blob thumbnails and binary data.

## Overview

The system provides:
- **Offline-capable binary cache** using IndexedDB for persistent storage
- **WebSocket-based sync** for real-time thumbnail and binary data updates
- **Automatic syncing** when new media blobs are created
- **Integration** with existing music sync infrastructure

## Architecture

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│ IntegratedSyncManager│    │ WebSocketBinaryConnector│    │ IntegratedMediaBlobCache│
│                     │────│                      │────│                     │
│ - Music sync        │    │ - Thumbnail listener │    │ - IndexedDB storage │
│ - Binary sync       │    │ - Auto-sync          │    │ - Blob URL creation │
│ - Progress tracking │    │ - Event handling     │    │ - Cache management  │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
          │                           │                           │
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   WebSocket Client  │    │   Existing Storage   │    │   Binary Data Table │
│                     │    │                      │    │                     │
│ - getThumbnails()   │    │ - media_blobs        │    │ - media_blob_data   │
│ - Event listeners   │    │ - songs              │    │ - Key/Value store   │
│ - Real-time updates │    │ - playlists          │    │ - Uint8Array data   │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

## Components

### 1. IntegratedSyncManager

The main orchestrator that combines music synchronization with binary data sync.

**Key Features:**
- Manages both music and binary sync operations
- Provides unified progress tracking
- Handles errors and retries
- Supports selective sync (music only, binary only, or both)

**Usage:**
```typescript
import { createIntegratedSyncManager } from './sync/integrated-sync-manager.js';

const syncManager = createIntegratedSyncManager(websocketClient, storage, {
  enableWebSocketBinarySync: true,
  autoSyncOnNewBlobs: true,
  apiBaseUrl: 'http://localhost:8080',
  authToken: 'your-token',
  clientId: 'your-client-id'
});

await syncManager.initialize();
const result = await syncManager.sync();
```

### 2. WebSocketBinaryConnector

Handles WebSocket communication for binary data synchronization.

**Key Features:**
- Listens for thumbnail responses from WebSocket
- Automatically processes binary data from number arrays
- Handles new media blob notifications
- Provides manual thumbnail requests
- Batch processing with concurrency control

**WebSocket Message Flow:**
```
Client Request:
{
  type: "GetThumbnails",
  data: { media_blob_id: "f169f32" }
}

Server Response:
{
  type: "Thumbnails",
  data: {
    media_blob_id: "f169f32",
    thumbnails: [
      {
        id: "071b723",
        thumbnail_data: [255, 216, ...], // Binary data as number array
        mime: "image/webp",
        size: 8432
      }
    ]
  }
}
```

### 3. IntegratedMediaBlobCache

Provides the binary data storage and blob URL management.

**Key Features:**
- Uses existing `webauthn_sync_storage` IndexedDB database
- Stores binary data in `media_blob_data` table
- Creates and manages blob URLs for UI usage
- Automatic cleanup and cache management
- Statistics and performance tracking

**Storage Schema:**
```typescript
interface CachedBinaryData {
  id: string;        // Media blob ID
  data: Uint8Array;  // Binary data
  mime: string;      // MIME type
  size: number;      // File size
  cached_at: string; // Timestamp
}
```

## Usage Examples

### Basic Setup

```typescript
// 1. Set up storage
const storage = new SyncStorageManager({
  database_name: "webauthn_sync_storage",
  version: 4,
  max_storage_size: 100 * 1024 * 1024
});

// 2. Set up WebSocket client
const wsClient = new WebSocketClient({
  url: "ws://localhost:8080/ws",
  autoReconnect: true
});

// 3. Create integrated sync manager
const syncManager = createIntegratedSyncManager(wsClient, storage, {
  enableWebSocketBinarySync: true,
  autoSyncOnNewBlobs: true,
  // ... other config
});

// 4. Initialize and sync
await syncManager.initialize();
await wsClient.connect();
await syncManager.sync();
```

### Using Cached Thumbnails

```typescript
// Request thumbnails for a media blob
const success = await syncManager.requestThumbnails(mediaBlobId);

// Get cached thumbnail URL
const thumbnailUrl = await syncManager.getThumbnailUrl(mediaBlobId);

if (thumbnailUrl) {
  // Use in UI
  imageElement.src = thumbnailUrl;

  // Clean up when done
  syncManager.releaseThumbnailUrl(mediaBlobId);
}
```

### Progress Tracking

```typescript
syncManager.addEventListener('progress', (event) => {
  const progress = event.detail;

  console.log('Overall:', progress.overallStatus);
  console.log('Music sync:', progress.musicSync.status);
  console.log('Binary sync:', progress.binarySync.status);
  console.log('Combined progress:', progress.combinedProgress + '%');
});

syncManager.addEventListener('complete', (event) => {
  const result = event.detail;
  console.log('Sync complete!', {
    musicItems: result.musicSync.itemsSynced,
    thumbnails: result.binarySync.thumbnailsCached,
    totalBytes: result.binarySync.bytesCached
  });
});
```

### Real-time Updates

The system automatically handles real-time updates:

```typescript
// Automatically triggered when server sends WebSocket messages:
// - "Thumbnails" responses are cached automatically
// - "MediaBlob" notifications trigger thumbnail requests
// - New binary data is stored in IndexedDB

syncManager.addEventListener('media_blob_added', (event) => {
  const { mediaBlob } = event.detail;
  console.log('New media blob detected:', mediaBlob.id);
  // Thumbnails will be requested automatically
});
```

## Configuration

### Integrated Sync Manager Config

```typescript
interface IntegratedSyncManagerConfig {
  // Basic config
  apiBaseUrl: string;
  authToken: string;
  clientId: string;

  // Binary sync
  enableWebSocketBinarySync: boolean;
  autoSyncOnNewBlobs: boolean;

  // Binary sync options
  binarySync?: {
    maxFileSize?: number;           // Max file size to cache
    priorityMimeTypes?: string[];   // Priority MIME types
    batchSize?: number;             // Batch processing size
    debug?: boolean;                // Debug logging
  };

  // Binary cache options
  binaryCache?: {
    maxCacheSize?: number;          // Max cache size in bytes
    maxAge?: number;                // Max age in days
    autoCleanup?: boolean;          // Enable automatic cleanup
  };
}
```

### Default Configuration

```typescript
export const defaultIntegratedSyncConfig = {
  enableWebSocketBinarySync: true,
  autoSyncOnNewBlobs: true,
  binarySync: {
    priorityMimeTypes: ['image/', 'audio/'],
    batchSize: 5,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    debug: false
  },
  binaryCache: {
    maxCacheSize: 500 * 1024 * 1024, // 500MB
    maxAge: 30, // 30 days
    autoCleanup: true
  }
};
```

## Performance Considerations

### Memory Management
- Blob URLs are created on-demand and must be released
- Binary data is stored efficiently as Uint8Array
- Cache cleanup runs automatically to prevent storage bloat

### Network Efficiency
- Batch processing prevents WebSocket flooding
- Concurrency limits control simultaneous requests
- Priority MIME types ensure important content syncs first

### Storage Management
- Uses existing IndexedDB database to avoid fragmentation
- Automatic cleanup removes old cached data
- Statistics tracking helps monitor cache performance

## Error Handling

The system provides comprehensive error handling:

```typescript
syncManager.addEventListener('error', (event) => {
  const { error, context } = event.detail;

  if (context.thumbnailId) {
    console.error('Thumbnail cache error:', context.thumbnailId, error);
  } else if (context.mediaBlob) {
    console.error('Media blob error:', context.mediaBlob.id, error);
  } else {
    console.error('General sync error:', error);
  }
});
```

## Testing

See `examples/sync/integrated-sync-example.ts` for a complete working example that demonstrates:
- Setup and initialization
- Sync operations
- Thumbnail usage
- Real-time updates
- Statistics and monitoring
- Cleanup procedures

## Integration with Existing Systems

This system is designed to work alongside existing sync infrastructure:

- **Music Sync Manager**: Continues to handle songs, playlists, and media blob metadata
- **WebSocket Client**: Extended with binary data listeners but maintains existing functionality
- **Storage Manager**: Uses the same IndexedDB database with a new `media_blob_data` table
- **UI Components**: Can gradually adopt cached thumbnails with fallback to existing methods

## Migration Strategy

1. **Phase 1**: Deploy alongside existing system (no breaking changes)
2. **Phase 2**: Enable binary sync in development/testing
3. **Phase 3**: Gradually enable for users with feature flags
4. **Phase 4**: Make binary sync default for all users

The system is designed for zero-downtime deployment and backward compatibility.
