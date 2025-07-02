# WebSocket Binary Sync Plan

## Overview

Create a clean, cursor-based WebSocket interface for binary data synchronization that mirrors the existing HTTP pagination pattern used for structured data (songs, playlists, media_blobs).

## Investigation: Existing GetMediaBlobData

**Found existing WebSocket binary system:**

- ✅ `GetMediaBlobData` message already exists (client → server)
- ✅ `MediaBlobData` response already exists (server → client)
- ❌ **Problem:** `MediaBlobData` sends `data: Vec<u8>` as JSON array `[1,2,3,255]`
- ❌ **Result:** Browser crashes from binary data in JSON

**Current Flow:**

1. Client: `{"type": "GetMediaBlobData", "data": {"id": "blob_123"}}`
2. Server: `{"type": "MediaBlobData", "data": {"id": "blob_123", "data": [1,2,3,255], "mime": "audio/mp3"}}`
3. 💥 Browser crash from large binary arrays in JSON

## Problem Statement

The existing `GetMediaBlobData` system has the right structure but one critical flaw:

- ✅ Simple 1:1 request/response protocol
- ✅ Individual blob requests work
- ❌ **Fatal flaw:** Binary data serialized as JSON array causes browser crashes
- ❌ No way to sync in batches efficiently

## Solution: Fix Existing GetMediaBlobData

### Goal

Fix the existing `GetMediaBlobData` system to avoid JSON serialization:

- ✅ Keep the simple 1:1 request/response protocol
- ✅ Reuse existing `GetMediaBlobData` message type
- ❌ **Change:** Server responds with **raw binary WebSocket frame** instead of JSON
- ✅ Client can batch requests as needed
- ✅ Stores directly to `media_blob_data` table in IndexedDB

### WebSocket Binary Protocol

#### 1. Client → Server: `GetMediaBlobData` (EXISTING)

Request binary data for a single blob ID - **no changes needed**.

```json
{
  "type": "GetMediaBlobData",
  "data": { "id": "blob_id_123" }
}
```

#### 2. Server → Client: Raw Binary Response (CHANGE REQUIRED)

**Current (broken):**

```json
{
  "type": "MediaBlobData",
  "data": {
    "id": "blob_id_123",
    "data": [1, 2, 3, 255], // 💥 Browser crash!
    "mime": "audio/mp3"
  }
}
```

**New (fixed):**

- **Message Type:** Binary WebSocket frame
- **Content:** Raw binary file data (no JSON wrapper)
- **Metadata:** Client gets mime/size from already-synced media_blobs table

### Server Implementation

#### Modify Existing Handler

Change existing `GetMediaBlobData` handler to send raw binary instead of JSON.

**Current handler location:** `server/src/websocket/handlers.rs` line ~414

**Current code:**

```rust
Some(WebSocketResponse::MediaBlobData {
    id: blob.id,
    data,  // Vec<u8> gets JSON serialized as [1,2,3,255] 💥
    mime: blob.mime,
})
```

**New approach:**

1. Same SQL query: `SELECT data FROM media_blobs WHERE id = $1`
2. **Change:** Send raw `Vec<u8>` as binary WebSocket frame
3. **Remove:** JSON wrapper entirely

#### Implementation Strategy

**✅ Selected: Option A** - Send pure binary (no metadata)

- Client uses media_blobs table for mime/size info
- Simpler implementation
- Client already has all metadata from media_blobs sync

### Client Implementation

#### Binary Sync Flow

**Coupled with media_blobs sync:**

1. **Sync media_blobs:** Get metadata via HTTP (already implemented)
2. **For each new/updated blob:** Immediately request binary data via `GetMediaBlobData`
3. **Receive raw binary:** Handle binary WebSocket frame (not JSON)
4. **Store data:** Write directly to `media_blob_data` table

**Rationale:** Binary data sync should happen alongside media_blobs creation/updates since they share the same server cursor. This keeps them naturally in sync.

#### Changes Required

**Phase 1: Create new binary handling in sync/ (avoid breaking existing code):**

- `client/js/src/sync/` - Create new binary WebSocket frame handling
- `client/js/src/sync/` - Add media_blob_data storage methods
- Keep existing `websocket-types.ts` unchanged during development

**Phase 2: Remove existing JSON handling (after sync/ is stable):**

- `client/js/src/lib/websocket-types.ts` - Remove `MediaBlobData` JSON schema
- `client/js/src/lib/websocket-client.ts` - Change `mediaBlobData` event to handle binary
- `client/js/src/lib/media-blob-manager.ts` - Remove `MediaBlobData` interface

#### Example Client Code

```typescript
async syncBinaryData(): Promise<void> {
  // Get blob IDs from media_blobs table (already synced)
  const mediaBlobs = await this.storage.getMediaBlobs();

  for (const blob of mediaBlobs) {
    // Skip if already have binary data
    if (await this.storage.hasBinaryData(blob.id)) continue;

    // Request individual blob (existing method)
    this.wsClient.getMediaBlobData(blob.id);

    // Wait for raw binary WebSocket frame (new handling)
    const binaryData = await this.waitForBinaryFrame(blob.id);

    // Store to IndexedDB (use blob metadata from media_blobs)
    await this.storage.storeBinaryData(
      blob.id,
      binaryData,
      { mime: blob.mime, size: blob.size }
    );
  }
}
```

### Benefits

1. **Maximum Efficiency:** Pure binary WebSocket frames - no JSON overhead
2. **Simple Protocol:** One blob ID in, one binary response out
3. **No JSON Corruption:** Binary data never touches JSON parser
4. **Client Control:** Client manages batching/concurrency as needed
5. **Metadata Separation:** Blob metadata comes from already-synced media_blobs table
6. **Memory Safe:** Individual blob responses prevent large batch memory issues

### Implementation Phases

#### Phase 1: Server WebSocket Handler

- **Modify existing** `GetMediaBlobData` handler in `websocket/handlers.rs`
- **Change** from `WebSocketResponse::MediaBlobData` JSON to raw binary frame
- **Note:** This is a breaking change for existing clients, but current JSON handling is broken anyway

#### Phase 2: Client sync/ Implementation (Stable First)

- **Create new** binary WebSocket frame handling in `sync/` folder
- **Implement** binary sync method in unified sync manager
- **Couple** with media_blobs sync (request binary data as metadata syncs)
- **Test** thoroughly before touching existing `lib/` code

#### Phase 3: Integration & Testing

- Connect binary sync to music domain sync
- Test binary data coupling with media_blobs sync
- Verify IndexedDB storage efficiency
- Add binary sync to demo UI
- **Create simple blob image grid UI:** Display first 100 media_blob_data rows as 100x100px images on demo page

#### Phase 4: Cleanup Legacy Code (After sync/ is stable)

- **Remove** unused `MediaBlobData` types and handlers in `lib/`
- **Remove** JSON binary data parsing code
- **Simplify** WebSocket response schemas
- **Migrate** any remaining code to use new `sync/` binary handling

### Files to Modify

#### Server

- `server/src/websocket/handlers.rs` - **Modify** existing `GetMediaBlobData` handler
- `server/src/websocket/messages.rs` - **Remove** `MediaBlobData` response variant
- Send binary WebSocket frames directly from database blob data

#### Client

- `client/js/src/sync/unified-sync-manager.ts` - **Add** binary sync method
- `client/js/src/sync/` - **Create** new binary WebSocket handling (separate from lib/)
- `client/js/src/lib/websocket-types.ts` - **Remove** `MediaBlobData` JSON schema (Phase 4)
- `client/js/src/lib/websocket-client.ts` - **Modify** to handle binary frames (Phase 4)
- `client/js/src/lib/media-blob-manager.ts` - **Remove** JSON binary handling (Phase 4)

### Success Criteria

- [ ] **Reuse** existing `GetMediaBlobData` WebSocket message
- [ ] Server responds with pure binary WebSocket frame (not JSON)
- [ ] **Remove** all JSON binary data serialization code
- [ ] `media_blob_data` table populates in IndexedDB
- [ ] Client uses media_blobs metadata for mime/size info
- [ ] No browser crashes from binary data in JSON
- [ ] **Cleanup** unused MediaBlobData JSON handling code

---

**Created:** 2024
**Status:** Investigation Complete - Implementation Strategy Defined
**Key Finding:** Existing `GetMediaBlobData` system just needs JSON→Binary fix
**Strategy:** Option A - Pure binary, coupled with media_blobs sync, staged implementation
**Next:** Implement server binary response, then stable sync/ client code, then cleanup lib/
