# Offline Binary Cache Implementation

## Overview

This document outlines the implementation of an offline-capable binary cache system for media blob data. The cache will store binary data (primarily thumbnails and small media files) using a simple key/value interface where the key is the blob ID and the value is the binary data.

## Requirements

### Core Requirements
- **Key/Value Interface**: Simple `get(blobId)` and `set(blobId, binaryData)` operations
- **Offline Capable**: Works without network connectivity once data is cached
- **Persistent**: Data survives browser restarts and page reloads
- **Memory Efficient**: Handle binary data without JSON serialization overhead
- **WebSocket Integration**: Sync data via existing WebSocket connection

### Performance Requirements
- Support for files up to 10MB (database storage limit)
- Efficient storage and retrieval of binary data
- Minimal memory footprint when not in use
- Fast blob URL generation for display

## Storage Options Analysis

### Option 1: IndexedDB (Recommended)
**Pros:**
- Native binary data support (Uint8Array, Blob)
- Large storage capacity (typically gigabytes)
- Persistent across browser sessions
- Good performance for binary data
- Wide browser support

**Cons:**
- More complex API than localStorage
- Asynchronous operations only

**Implementation:**
```typescript
interface BinaryCacheEntry {
  id: string;          // blob ID
  data: Uint8Array;    // binary data
  mime: string;        // MIME type
  size: number;        // file size
  cached_at: string;   // timestamp
}
```

### Option 2: Cache API
**Pros:**
- Designed for storing responses/binary data
- Good performance
- Service Worker integration

**Cons:**
- Primarily designed for HTTP responses
- Less flexible for arbitrary key/value storage
- More complex for simple binary caching

### Option 3: Web Storage (Not Suitable)
**Cons:**
- String-only storage (would require base64 encoding)
- Small storage limits (5-10MB)
- Poor performance for binary data

## Recommended Architecture

### 1. Binary Cache Interface
```typescript
interface BinaryCache {
  // Core operations
  get(blobId: string): Promise<Uint8Array | null>;
  set(blobId: string, data: Uint8Array, mime: string): Promise<void>;
  has(blobId: string): Promise<boolean>;
  delete(blobId: string): Promise<void>;

  // Utility operations
  getBlobUrl(blobId: string): Promise<string | null>;
  releaseBlobUrl(blobId: string): void;
  getStats(): Promise<CacheStats>;
  clear(): Promise<void>;
}
```

### 2. Sync Manager Integration
```typescript
interface BinarySyncManager {
  // Sync all cached media blobs
  syncAllBinary(websocketClient: WebSocketClient): Promise<SyncResult>;

  // Sync specific blob
  syncBlob(blobId: string, websocketClient: WebSocketClient): Promise<boolean>;

  // Sync with filters
  syncByType(mimeFilter: string, websocketClient: WebSocketClient): Promise<SyncResult>;
}
```

### 3. WebSocket Data Flow
Based on the thumbnail demo, the flow is:

1. **Request**: `websocketClient.getThumbnails(originalBlobId)`
2. **Response**:
   ```typescript
   {
     media_blob_id: "f169f32",  // Original blob
     thumbnails: [
       {
         id: "071b723",         // Thumbnail blob ID
         data: [255, 216, ...], // Binary as number array
         mime: "image/webp",
         size: 8432
       }
     ]
   }
   ```
3. **Cache**: Store under original blob ID for easy retrieval

## Implementation Tasks

### Phase 1: Core Cache Implementation
- [ ] **Create IndexedDB Binary Cache**
  - Database schema with `binary_data` table
  - Core CRUD operations (get, set, has, delete)
  - Proper binary data handling (Uint8Array)
  - Error handling and connection management

- [ ] **Blob URL Management**
  - `getBlobUrl()` - Create object URLs from cached data
  - `releaseBlobUrl()` - Clean up URLs to prevent memory leaks
  - URL lifecycle tracking

- [ ] **Cache Statistics**
  - Total items and size
  - Hit/miss rates
  - Storage usage tracking

### Phase 2: WebSocket Integration
- [ ] **WebSocket Binary Sync**
  - Integration with existing WebSocket client
  - Handle `thumbnails` message type
  - Convert number arrays to Uint8Array
  - Proper ID mapping (thumbnail ID → original blob ID)

- [ ] **Sync Manager**
  - Batch processing of media blobs
  - Priority-based syncing (images first, then audio album art)
  - Progress tracking and error handling
  - Retry logic for failed requests

### Phase 3: Integration with Existing Systems
- [ ] **Music Sync Manager Integration**
  - Add binary cache to `MusicSyncManager`
  - Automatic thumbnail syncing after media blob sync
  - Configuration options for binary cache

- [ ] **Thumbnail Component Updates**
  - Use cached thumbnails when available
  - Fallback to WebSocket requests if not cached
  - Seamless integration with existing `useThumbnail` hook

### Phase 4: Advanced Features
- [ ] **Cache Management**
  - LRU eviction when storage limits reached
  - Configurable cache size limits
  - Automatic cleanup of old entries

- [ ] **Performance Optimizations**
  - Lazy loading of cache data
  - Batch operations for multiple blobs
  - Memory-efficient streaming for large files

- [ ] **Development Tools**
  - Cache inspector/debugger
  - Performance monitoring
  - Storage usage visualization

## File Structure

```
src/
├── sync/
│   ├── binary-cache.ts              # Core cache interface
│   ├── indexeddb-binary-cache.ts    # IndexedDB implementation
│   ├── binary-sync-manager.ts       # WebSocket sync logic
│   └── cache-stats.ts               # Statistics tracking
├── hooks/
│   ├── useBinaryCache.ts            # React/Solid hook
│   └── useCachedThumbnail.ts        # Enhanced thumbnail hook
└── utils/
    ├── binary-utils.ts              # Binary data helpers
    └── blob-url-manager.ts          # URL lifecycle management
```

## Configuration Options

```typescript
interface BinaryCacheConfig {
  // Storage settings
  maxSize: number;           // Max cache size in bytes (default: 500MB)
  maxAge: number;            // Max age in days (default: 30)

  // Sync settings
  batchSize: number;         // Items per sync batch (default: 10)
  maxConcurrent: number;     // Concurrent requests (default: 3)
  priorityTypes: string[];   // MIME types to sync first

  // Performance settings
  enableLazyLoading: boolean;  // Load on demand
  enableCompression: boolean;  // Compress binary data
}
```

## Success Criteria

### Functional
- [ ] Store and retrieve binary data by blob ID
- [ ] Sync thumbnails via WebSocket
- [ ] Generate blob URLs for display
- [ ] Work offline once data is cached
- [ ] Integration with existing sync system

### Performance
- [ ] Handle 1000+ cached items without performance degradation
- [ ] Sub-100ms retrieval times for cached data
- [ ] Efficient memory usage (no unnecessary data copies)
- [ ] Fast initial load times

### User Experience
- [ ] Thumbnails display instantly when cached
- [ ] Graceful fallback to WebSocket when not cached
- [ ] Visual indicators for cache status
- [ ] No blocking UI operations

## Testing Strategy

### Unit Tests
- Binary cache CRUD operations
- WebSocket message handling
- Blob URL lifecycle management
- Error conditions and edge cases

### Integration Tests
- End-to-end sync flow
- Music sync manager integration
- Thumbnail component integration
- Cross-browser compatibility

### Performance Tests
- Large cache performance
- Memory usage profiling
- Network efficiency measurement
- Storage quota handling

## Migration Strategy

1. **Implement alongside existing system** - No breaking changes
2. **Gradual feature enablement** - Optional binary cache in music sync
3. **A/B testing** - Compare cached vs non-cached performance
4. **Full rollout** - Enable by default once stable

## Monitoring and Metrics

### Key Metrics
- Cache hit rate
- Storage usage
- Sync success rate
- Performance improvements
- Error rates

### Debugging Tools
- Cache contents inspector
- Sync progress visualization
- Performance profiler
- Network request analysis

---

## Next Steps

1. Start with Phase 1: Core cache implementation using IndexedDB
2. Create demo component to test basic functionality
3. Integrate with WebSocket thumbnail system
4. Expand to full sync manager integration
5. Add performance monitoring and optimization

This implementation will provide a robust, offline-capable binary cache that integrates seamlessly with the existing WebSocket-based sync system while maintaining good performance and user experience.
