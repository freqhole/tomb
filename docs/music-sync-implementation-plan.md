# Music Sync Implementation Plan

## Task Checklist - Phase Overview

- [ ] **Phase 1**: Core Infrastructure Enhancement (Tasks 1.1-1.3)
- [ ] **Phase 2**: Music File Processing Engine (Tasks 2.1-2.4)
- [ ] **Phase 3**: CLI Music Scanner (Tasks 3.1-3.3)
- [ ] **Phase 4**: WebSocket-Enhanced Sync (Tasks 4.1-4.4)
- [ ] **Phase 5**: Advanced Features (Tasks 5.1-5.2)

## Quick Reference

### Key Constraints

- **Media Blob Size Limit**: 10MB (from existing `config.jsonc` media section) - applies to client uploads only
- **Audio Formats**: mp3, ogg, wav, flac, m4a (hardcoded in file_walker.rs, TODO exists to use config)
- **Storage Strategy**: Filesystem scans use `local_path`, generated content uses bytea
- **Sync Target**: Raw bytea data → IndexedDB for UI rendering (thumbnails, waveforms)

### Core Architecture

- **Server**: PostgreSQL + WebSocket notifications + Job queue system
- **Client**: IndexedDB sync + Service worker + HTTP API fallback
- **CLI**: Lean wrapper around grimoire package logic
- **Jobs**: Database-backed progress tracking, resumable operations

### Important Note About Existing Code

- **grimoire/src/filesys/file_walker.rs**: Rough reference code that was just dropped in
- **grimoire/src/filesys/mod.rs**: Currently empty
- **Status**: file_walker.rs probably doesn't compile and needs cleanup
- **Remove**: JSON file reading/writing, checkpoint file usage, OUTPUT_FILE constants
- **Keep**: Core audio metadata extraction, hashing, and scanning logic patterns

## Task List

### Phase 1: Core Infrastructure Enhancement

#### ✅ Task 1.1: Enhanced Media Type Detection

**Standalone Task - No Dependencies**

- **Goal**: Create centralized media type utilities (reuse existing config structure)
- **Files to Create**: `grimoire/src/media/mod.rs`
- **Specifications**:
  - Extend existing `media` config section with `supported_audio_formats: ["mp3", "ogg", "wav", "flac", "m4a"]`
  - Replace hardcoded list in `grimoire/src/filesys/file_walker.rs` (TODO already exists)
  - Add MIME type detection functions
  - Reuse existing `max_blob_file_size` and `max_fs_file_size` from config
  - **Clean up file_walker.rs**: Remove JSON file I/O, checkpoint files, OUTPUT_FILE usage
- **Acceptance Criteria**:
  - [ ] Extend existing media config (no new top-level sections)
  - [ ] MIME type utilities ready
  - [ ] Remove hardcoded file extensions from file_walker.rs

#### ✅ Task 1.2: Music Job System Setup

**Depends on: Database migrations**

- **Goal**: Extend job queue for music processing operations
- **Files to Create**: `migrations/016_music_jobs.sql`
- **Specifications**:
  - Create `music_scan_sessions` table (id, base_path, progress tracking)
  - Create `music_jobs` table (scan_directory, extract_metadata, generate_waveform, extract_thumbnail)
  - Add proper indexes and constraints
  - Reference existing `media_blobs` and `songs` tables
- **Acceptance Criteria**:
  - [ ] Tables created with migrations
  - [ ] Job types enum defined
  - [ ] Progress tracking schema ready

#### ✅ Task 1.3: Music WebSocket Messages

**Depends on: Existing notification system**

- **Goal**: Define music domain WebSocket notifications
- **Files to Modify**: `server/src/notifications/types.rs`
- **Specifications**:
  - Add message types: `song_created`, `song_updated`, `song_deleted`
  - Add message types: `playlist_created`, `playlist_updated`, `playlist_deleted`
  - Add message types: `scan_progress`, `scan_completed`
  - Include relevant data payloads (song_id, session_id, progress info)
- **Acceptance Criteria**:
  - [ ] Message types defined
  - [ ] Payload schemas documented
  - [ ] Integration with existing notification system

### Phase 2: Music File Processing Engine

#### ✅ Task 2.1: Modular Music Processing Structure

**Depends on: Task 1.1 (media types)**

- **Goal**: Refactor `file_walker.rs` into clean, modular services (clean up rough reference code first)
- **Files to Create**:
  ```
  grimoire/src/music/mod.rs
  grimoire/src/music/scanner.rs       // Directory traversal
  grimoire/src/music/metadata.rs      // Audio metadata extraction
  grimoire/src/music/thumbnail.rs     // MP3 embedded art extraction
  grimoire/src/music/waveform.rs      // Waveform generation
  grimoire/src/music/hasher.rs        // File SHA256 utilities
  grimoire/src/music/title_builder.rs // Smart title construction
  ```
- **Specifications**:
  - Extract reusable functions from existing `file_walker.rs` (remove JSON I/O, file checkpoints)
  - Each module has single responsibility
  - Use async/await patterns throughout
  - Proper error handling with `anyhow::Result`
  - **Remove from file_walker.rs**: CHECKPOINT_FILE, OUTPUT_FILE, append_json_object, ScanCheckpoint
- **Acceptance Criteria**:
  - [ ] Modular structure created
  - [ ] Functions extracted and tested
  - [ ] No duplicate code

#### ✅ Task 2.2: Smart Title Construction

**Standalone Task - No Dependencies**

- **Goal**: Build intelligent song titles from metadata
- **Files to Create**: `grimoire/src/music/title_builder.rs`
- **Specifications**:
  - Priority order: `Title + Artist` → `Title only` → `Filename` → `Full path`
  - Handle missing/empty metadata gracefully
  - Clean up title formatting (trim, remove extensions)
  - Support multiple metadata tag formats
- **Acceptance Criteria**:
  - [ ] Title construction algorithm implemented
  - [ ] Edge cases handled (missing data)
  - [ ] Unit tests for various scenarios

#### ✅ Task 2.3: Waveform Generation (Bytea Storage)

**Depends on: Task 1.2 (job system)**

- **Goal**: Generate waveforms and store as bytea in database
- **Files to Create**: `grimoire/src/music/waveform.rs`
- **Specifications**:
  - Replace `/tmp/file.png` approach with in-memory generation
  - Store PNG data directly in `media_blobs.data` column
  - Link via `songs.waveform_blob_id` foreign key
  - Process as background job for performance
- **Acceptance Criteria**:
  - [ ] In-memory waveform generation
  - [ ] Bytea storage implementation
  - [ ] Job queue integration

#### ✅ Task 2.4: MP3 Thumbnail Extraction (Bytea Storage)

**Depends on: Task 1.2 (job system)**

- **Goal**: Extract album art and store as bytea
- **Files to Create**: `grimoire/src/music/thumbnail.rs`
- **Specifications**:
  - Use `lofty` crate for embedded image extraction
  - Store image data in `media_blobs.data` column
  - Link via `songs.thumbnail_blob_id` foreign key
  - Handle various image formats (JPEG, PNG)
  - Process as background job
- **Acceptance Criteria**:
  - [ ] Embedded art extraction working
  - [ ] Multiple image format support
  - [ ] Bytea storage implementation

### Phase 3: CLI Music Scanner

#### ✅ Task 3.1: CLI Music Scan Command

**Depends on: Tasks 2.1-2.4 (music processing), Task 1.2 (job system)**

- **Goal**: Create user-friendly CLI for music library scanning
- **Files to Create**: `cli/src/music.rs`, update `cli/src/cli.rs`
- **Command Specifications**:
  ```bash
  cargo run --bin cli music scan /path/to/music/library
  cargo run --bin cli music scan --resume <session-id>
  cargo run --bin cli music status
  ```
- **Implementation Requirements**:
  - Lean CLI wrapper around grimoire functions
  - Progress display with file counts and current path
  - Graceful interrupt handling (Ctrl+C)
  - Session management for resumable scans
- **Acceptance Criteria**:
  - [ ] CLI commands working
  - [ ] Progress indicators
  - [ ] Resumable scan support

#### ✅ Task 3.2: Database-Backed Progress Tracking

**Depends on: Task 1.2 (job system tables)**

- **Goal**: Replace JSON file checkpoints with database state (file_walker.rs currently uses JSON files)
- **Files to Modify**: `grimoire/src/music/scanner.rs`
- **Specifications**:
  - Use `music_scan_sessions` table for progress tracking
  - Store: base_path, total_files, processed_files, last_processed_path
  - Update progress every batch (not every file)
  - Handle interrupted scans gracefully
- **Database Schema** (from Task 1.2):
  ```sql
  CREATE TABLE music_scan_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_path TEXT NOT NULL,
      total_files INTEGER,
      processed_files INTEGER DEFAULT 0,
      last_processed_path TEXT,
      status VARCHAR(20) DEFAULT 'running',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error_message TEXT
  );
  ```
- **Acceptance Criteria**:
  - [ ] Database progress tracking
  - [ ] Resumable scan implementation
  - [ ] Batch update performance

#### ✅ Task 3.3: Smart Duplicate Detection

**Depends on: Task 2.1 (hasher module)**

- **Goal**: Prevent duplicate song entries efficiently
- **Files to Modify**: `grimoire/src/music/scanner.rs`
- **Specifications**:
  - Primary key: SHA256 hash of file content (`media_blobs.content_hash`)
  - Before processing: check if hash exists in database
  - If exists: update `local_path` if different, skip metadata extraction
  - If new: full processing pipeline
  - Handle moved files (same content, different path)
- **Acceptance Criteria**:
  - [ ] Hash-based deduplication
  - [ ] Path update for moved files
  - [ ] Skip processing for duplicates

### Phase 4: WebSocket-Enhanced Sync

#### ✅ Task 4.1: Music Domain Sync Engine

**Depends on: Task 1.3 (WebSocket messages), existing sync infrastructure**

- **Goal**: Add music-specific sync capabilities to existing engine
- **Files to Create**: `client/js/src/sync/music-sync.ts`
- **Files to Modify**: `client/js/src/sync/core-sync-engine.ts`
- **Specifications**:
  - Listen for `song_created`, `song_updated`, `song_deleted` WebSocket messages
  - Trigger incremental sync when music notifications received
  - Handle `scan_progress` messages for UI progress indicators
  - Integrate with existing sync infrastructure (don't reinvent)
- **Acceptance Criteria**:
  - [ ] WebSocket message handling
  - [ ] Incremental sync triggers
  - [ ] Progress notification support

#### ✅ Task 4.2: Service Worker Background Sync

**Depends on: Task 4.1 (sync engine)**

- **Goal**: Enable background sync when app is closed
- **Files to Create**: `client/js/src/sync/service-worker.ts`
- **Specifications**:
  - Register service worker for background sync events
  - Queue failed sync operations for retry
  - Progressive sync strategy: metadata → thumbnails → on-demand audio
  - Handle network connectivity changes
- **Acceptance Criteria**:
  - [ ] Service worker registration
  - [ ] Background sync functionality
  - [ ] Progressive download strategy

#### ✅ Task 4.3: Storage Strategy Implementation

**Depends on: Existing media blob infrastructure**

- **Goal**: Implement dual storage strategy based on file source
- **Files to Modify**: Server file upload handlers, client sync logic
- **Storage Rules** (using existing `config.media` limits):
  - **Client Uploads**: Files ≤ `max_blob_file_size` → `media_blobs.data` (bytea)
  - **Filesystem Scans**: Always → `media_blobs.local_path` (reference only)
  - **Generated Content**: Thumbnails/waveforms → `media_blobs.data` (bytea)
- **Client Handling**:
  - Check for `data` field first (immediate access)
  - Fallback to HTTP API for `local_path` files
- **Acceptance Criteria**:
  - [ ] Storage decision logic
  - [ ] Client fallback mechanism
  - [ ] No duplication of filesystem files

#### ✅ Task 4.4: IndexedDB Bytea Sync (UI Assets)

**Depends on: Task 4.3 (storage strategy), existing IDB sync**

- **Goal**: Sync raw bytea data to IndexedDB for instant UI rendering
- **Files to Modify**: `client/js/src/sync/media-blob-sync.ts`
- **Specifications**:
  - Sync `media_blobs.data` (bytea) → IDB `data` field (raw bytes)
  - Priority content: thumbnails, waveforms, album art
  - WebSocket triggers immediate sync of new bytea content
  - UI checks IDB first, HTTP API fallback for large files
- **Data Flow**:
  ```
  CLI generates thumbnail → media_blobs.data (bytea) → WebSocket `song_created`
  → Client sync → IndexedDB data field → UI renders immediately
  ```
- **Acceptance Criteria**:
  - [ ] Bytea → IDB sync working
  - [ ] WebSocket-triggered immediate sync
  - [ ] UI-first rendering strategy

### Phase 5: Advanced Features

#### ✅ Task 5.1: Music Library Analytics

**Depends on: Phase 3 (populated music data)**

- **Goal**: Generate insights about music collection
- **Files to Create**: `cli/src/analytics.rs`, `grimoire/src/music/analytics.rs`
- **CLI Commands**:
  ```bash
  cargo run --bin cli music stats
  cargo run --bin cli music stats --genre
  cargo run --bin cli music stats --quality
  ```
- **Metrics to Calculate**:
  - Total library: size (GB), duration (hours), file count
  - Genre distribution with percentages
  - Bitrate quality analysis (low/medium/high categories)
  - Top artists/albums by track count
- **Acceptance Criteria**:
  - [ ] CLI analytics commands
  - [ ] Comprehensive metrics calculation
  - [ ] Human-readable output format

#### ✅ Task 5.2: Music Search and Discovery

**Depends on: Phase 3 (populated music data)**

- **Goal**: Advanced search capabilities across music metadata
- **Files to Create**: `grimoire/src/music/search.rs`
- **Search Features**:
  - PostgreSQL full-text search on: titles, artists, albums, genres
  - Tag-based filtering with boolean operators
  - Fuzzy matching for typos and partial matches
  - Advanced queries: year ranges, duration filters, rating filters
- **Acceptance Criteria**:
  - [ ] Full-text search implementation
  - [ ] Advanced filtering options
  - [ ] Fuzzy matching for typos

## Technical Implementation Details

### Database Schema Changes

#### Migration 016: Music Jobs System

```sql
-- Extend job system for music processing
CREATE TABLE music_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL, -- 'scan_directory', 'extract_metadata', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    file_path TEXT NOT NULL,
    scan_session_id UUID REFERENCES music_scan_sessions(id),
    media_blob_id UUID REFERENCES media_blobs(id),
    song_id UUID REFERENCES songs(id),
    parameters JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
```

### CLI Command Structure

```
music scan <directory>              # Scan directory for music files
music scan --resume <session-id>    # Resume interrupted scan
music status                        # Show scan progress
music library stats                 # Show library statistics
music playlist generate --genre rock # Generate playlists
```

### WebSocket Message Format

```typescript
interface MusicNotification {
  type: "song_created" | "song_updated" | "scan_progress" | "scan_completed";
  data: {
    song_id?: string;
    session_id?: string;
    progress?: {
      total: number;
      processed: number;
      current_file: string;
    };
  };
}
```

### Service Worker Architecture

```typescript
// Progressive sync strategy
1. Sync song metadata first (small, fast)
2. Sync bytea data (thumbnails/waveforms) to IDB data field (medium priority)
3. Reference audio files via local_path → HTTP API when needed (low priority)
4. Background sync when idle
```

## Risk Mitigation

### Large Library Handling

- **Risk**: Memory exhaustion with large music libraries
- **Mitigation**: Batch processing with configurable batch sizes
- **Monitoring**: Track memory usage and adjust batch sizes dynamically

### File System Changes

- **Risk**: Files moved/deleted during scan
- **Mitigation**: Handle file system errors gracefully, update database accordingly
- **Recovery**: Re-scan capability with smart duplicate detection

### Database Performance

- **Risk**: Slow queries on large music tables
- **Mitigation**: Proper indexing strategy, pagination for large result sets
- **Monitoring**: Query performance metrics and optimization

## Task Execution Guidelines

### For New Conversation Threads

1. **Reference this document**: `axum_tutorial/docs/music-sync-implementation-plan.md`
2. **Pick a specific task**: Use format "Working on Task X.Y: [Task Name]"
3. **Check dependencies**: Ensure prerequisite tasks are completed
4. **Follow specifications**: Each task has clear acceptance criteria

### Success Metrics

- **Scan Performance**: 1000+ songs/minute processing
- **Sync Latency**: <2 second WebSocket → UI updates
- **Storage Efficiency**: No filesystem duplication, UI assets in IDB
- **Reliability**: Resumable scans after interruption
- **UX**: Immediate thumbnail rendering from IDB bytea

### Key Dependencies

- **lofty**: Audio metadata extraction (already in use)
- **sqlx**: Database operations (already configured)
- **WebSocket**: Real-time notifications (already working)
- **IndexedDB**: Client-side storage (already in sync engine)

### Execution Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
(All tasks within a phase can be parallelized if dependencies met)
```

## Quick Task Reference

**Ready to start**: 1.1, 1.3, 2.2
**After DB migration**: 1.2, 2.3, 2.4
**After Phase 2**: 3.1, 3.2, 3.3
**After WebSocket setup**: 4.1, 4.2
**After storage strategy**: 4.3, 4.4
**After data population**: 5.1, 5.2
