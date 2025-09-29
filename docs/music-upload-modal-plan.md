# Music Upload Modal Implementation Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**: Use solidjs hooks for reactive logic, leverage createResource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/`
9. **LEGACY CODE MARKING**: When implementing new better patterns, clearly mark old code as `@deprecated`, `// LEGACY:`, or `// TODO: migrate to X` so we know which system to use and can clean up later. This prevents confusion between "this is broken and needs debugging now" vs "this works but should be migrated as part of the plan"
10. **MAXIMUM CODE REUSE**: Reuse existing song edit forms, bulk operations, filtering APIs, and modal systems. Build MusicBrainz as modular extensions to existing functionality.

## Overview

This document outlines the implementation plan for adding a music upload modal that allows users to upload audio files through the web interface. The feature will integrate with existing infrastructure for file uploads, media blob processing, and music metadata extraction.

## Current Infrastructure Analysis

### Existing File Upload Systems

1. **HTTP Upload API** (`/api/upload_media_blob`)
   - Located: `tomb/server/src/media/songs.rs`
   - Current limit: 10MB via `DefaultBodyLimit`
   - Handles multipart form data
   - Creates `MediaBlob` records in database
   - Returns blob ID and metadata

2. **Large File Upload API** (`/api/upload`)
   - Located: `tomb/server/src/upload/routes.rs`
   - Admin-only endpoint
   - Handles files up to 1GB
   - Stores files in `assets/private/uploads/`

3. **WebSocket Upload** (exists but not needed)
   - Located: `tomb/client/js/src/web-components/smart-file-upload.tsx`
   - Handles small files (<10MB) via WebSocket
   - We'll use HTTP API instead per requirements

### Music Processing Pipeline

1. **CLI Music Scanner** (`tomb/cli/src/music/scanner.rs`)
   - Function: `process_audio_file()`
   - Extracts metadata using `extract_metadata()`, `extract_standard_fields()`, `extract_basic_metadata()`
   - Generates thumbnails via `extract_thumbnail()`
   - Creates waveforms via `WaveformGenerator`
   - Creates `Song` records in database

2. **Music Job System** (`tomb/grimoire/src/music/jobs.rs`)
   - Job types: `ScanFile`, `ExtractMetadata`, `GenerateThumbnail`, `GenerateWaveform`, `ProcessSong`
   - Job statuses: `Pending`, `InProgress`, `Completed`, `Failed`, etc.
   - Priority system: `High`, `Normal`, `Low`

3. **Metadata Extraction** (`tomb/grimoire/src/music/`)
   - `extract_metadata()`: Full metadata extraction
   - `extract_standard_fields()`: Basic fields (title, artist, album, etc.)
   - `extract_thumbnail()`: Album art extraction
   - Hash generation for deduplication

## Implementation Plan

### Phase 1: Backend API Endpoints

#### 1.1 Extend Existing Large File Upload API

**Location**: Use existing `tomb/server/src/upload/handlers.rs::upload_large_file()`

**Current Features Already in Place**:

- Upload directory from config: `config.static_files.upload_directory`
- File validation (size, MIME type, SHA256)
- Creates `MediaBlob` record with `local_path`
- Currently admin-only (`require_admin` middleware)
- Auto-enqueues thumbnail jobs if enabled

**Required Extensions**:

1. **Add User Tracking to MediaBlob**
   - Add `created_by` field to `media_blobs` table to track which user uploaded each file
   - Update `CreateMediaBlob` struct to include `created_by_user_id`
   - This enables attribution and admin oversight of uploads

2. **Add Music Job Creation**
   - After successful `MediaBlob` creation, detect audio files using `MediaTypeDetector`
   - Create `music_jobs` record with `job_type = 'process_song'`
   - Set `media_blob_id` and `file_path` from upload result

3. **Audio File Detection**
   ```rust
   // In upload handler, after MediaBlob creation:
   let type_detector = MediaTypeDetector::from_config(&config);
   if type_detector.is_audio_file(&upload_request.filename)? {
       // Create music processing job
       let job_id = create_music_job(&db, &media_blob).await?;
       // Include job_id in response
   }
   ```

**Upload Request Metadata**:

- Add optional `process_music: bool` field to `UploadRequest.metadata`
- Add optional `cover_art_for_album: String` field to link album art to album name

#### 1.2 Leverage Existing Music Job System

**Location**: Use existing system from `tomb/migrations/016_music_jobs.sql`

The system already has:

- `music_jobs` table with job types: `scan_file`, `extract_metadata`, `generate_thumbnail`, `generate_waveform`, `process_song`
- `claim_music_jobs()` function for worker job claiming
- Job status tracking and retry logic
- Session management via `music_scan_sessions`

**Integration Steps**:

1. Extend existing `upload_large_file` handler to detect audio files using `MediaTypeDetector`
2. After successful upload to `MediaBlob`, create `music_jobs` record with `job_type = 'process_song'`
3. Set `media_blob_id` and `file_path` (from MediaBlob.local_path)
4. Existing music job workers will automatically process the file using CLI logic from `tomb/cli/src/music/scanner.rs::process_audio_file()`
5. Job processing includes: metadata extraction, thumbnail generation, waveform creation, and Song record creation
6. Return job ID in upload response for status tracking

#### 1.3 Job Status Tracking Endpoint

**Location**: `tomb/server/src/media/songs.rs` (extend existing)

```rust
/// Get status of music processing job
pub async fn get_music_job_status(
    Path(job_id): Path<String>,
    Extension(db): Extension<DatabaseConnection>,
) -> Result<Json<MusicJobStatusResponse>, StatusCode>

#[derive(Debug, Serialize)]
pub struct MusicJobStatusResponse {
    pub job_id: String,
    pub status: String, // "pending", "in_progress", "completed", "failed"
    pub progress_percentage: Option<f32>, // 0.0 to 100.0
    pub processing_step: Option<String>, // "metadata", "thumbnail", "waveform", "song_creation"
    pub song_id: Option<String>, // Available when completed - for opening song edit modal
    pub error_message: Option<String>,
    pub error_type: Option<String>, // "unsupported_format", "corrupted_file", "metadata_extraction_failed"
    pub can_retry: bool,
    pub file_path: String,
    pub original_filename: String, // For display purposes
    pub created_at: String,
    pub updated_at: String,
}

/// Job cancellation endpoint
pub async fn cancel_music_job(
    Path(job_id): Path<String>,
    Extension(db): Extension<DatabaseConnection>,
) -> Result<Json<CancelJobResponse>, StatusCode>

#[derive(Debug, Serialize)]
pub struct CancelJobResponse {
    pub job_id: String,
    pub cancelled: bool,
    pub message: String,
}
```

Query existing `music_jobs` table for status information. When job completes successfully, include the created `song_id` from the job result for seamless transition to song editing.

#### 1.4 Route Configuration

**Location**: `tomb/server/src/upload/routes.rs`

```rust
// Extend existing admin upload route to handle music processing
// No new routes needed - use existing /api/upload

// Add music job status and cancellation routes for admins
let job_status_routes = Router::new()
    .route("/api/music_job_status/:job_id", get(get_music_job_status))
    .route("/api/music_job_cancel/:job_id", post(cancel_music_job))
    .layer(middleware::from_fn(require_admin))
    .layer(middleware::from_fn(require_authentication));
```

**Security**:

- Music upload: Admin-only (same as existing `/api/upload`)
- Job status: Admin-only
- Maintains existing security model

### Phase 2: Frontend Modal Implementation

#### 2.1 User Menu Integration

**Location**: `tomb/client/js/src/views/freqhole/components/auth/UserMenu.tsx`

Add "add music" button between user info and sign out (admin only):

```tsx
{
  /* Menu Actions */
}
<div class="py-2">
  <Show when={isAdmin()}>
    <button
      onClick={() => {
        events.emit("modal:open", {
          modal: "addMusicModal",
          data: {},
        });
        setIsOpen(false);
      }}
      class="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200 flex items-center gap-3"
    >
      <MusicIcon size={16} />
      <span class="text-sm">add music</span>
    </button>
  </Show>

  {/* Existing sign out button */}
</div>;
```

#### 2.2 Add Music Modal Component

**Location**: `tomb/client/js/src/views/freqhole/components/modals/AddMusicModal.tsx`

```tsx
interface AddMusicModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UploadItem {
  id: string;
  file: File;
  status:
    | "pending"
    | "uploading"
    | "processing"
    | "completed"
    | "error"
    | "cancelled"
    | "duplicate";
  progress: number;
  processingStep?: string; // "metadata" | "thumbnail" | "waveform" | "song_creation"
  jobId?: string;
  songId?: string;
  error?: string;
  errorType?: string; // "unsupported_format" | "corrupted_file" | "duplicate" | "size_limit"
  canRetry: boolean;
  canCancel: boolean;
  existingSongId?: string; // For duplicate files
  albumArtFor?: string; // Album name if this is album art
}

export function AddMusicModal(props: AddMusicModalProps) {
  const [uploads, setUploads] = createSignal<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);

  // File selection and validation
  // Upload progress tracking
  // Job status polling
  // Success/error handling
}
```

**Features**:

- File drag & drop interface
- Multiple file selection
- File type validation (audio files and image files for album art)
- File size validation (max 100MB per file)
- Pre-upload duplicate detection with user choice
- Upload progress bars with granular processing steps
- Processing status indicators with detailed progress
- Success state with "edit metadata" and "view song" buttons
- Comprehensive error handling with specific error types and retry/cancel options
- Album art association workflow

#### 2.3 Upload Service

**Location**: `tomb/client/js/src/views/freqhole/services/audioUploadService.ts`

```tsx
// Pre-upload duplicate check
async checkForDuplicate(sha256: string): Promise<DuplicateCheckResponse> {
  const response = await apiClient.get(`/api/media_blob/check_duplicate/${sha256}`);
  return response.data;
}

async uploadMusicFile(
  file: File,
  options?: { albumArtFor?: string; replaceDuplicate?: boolean }
): Promise<UploadResponse> {
  // Calculate SHA256 hash (client-side)
  const sha256 = await this.calculateSHA256(file);

  // Check for duplicates first (unless user chose to replace)
  if (!options?.replaceDuplicate) {
    const duplicateCheck = await this.checkForDuplicate(sha256);
    if (duplicateCheck.exists) {
      throw new DuplicateFileError(duplicateCheck);
    }
  }

  const uploadRequest = {
    filename: file.name,
    mime_type: file.type,
    sha256: sha256,
    size: file.size,
    metadata: {
      process_music: this.isAudioFile(file),
      album_art_for: options?.albumArtFor,
      original_filename: file.name,
      replace_duplicate: options?.replaceDuplicate || false
    }
  };

  const formData = new FormData();
  formData.append('file', file);
  formData.append('metadata', JSON.stringify(uploadRequest));

  const response = await apiClient.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
}

async getMusicJobStatus(jobId: string): Promise<MusicJobStatusResponse> {
  const response = await apiClient.get(`/api/music_job_status/${jobId}`);
  return response.data;
}

async cancelMusicJob(jobId: string): Promise<CancelJobResponse> {
  const response = await apiClient.post(`/api/music_job_cancel/${jobId}`);
  return response.data;
}

startStatusPolling(
  jobId: string,
  callback: (status: MusicJobStatusResponse) => void,
) {
  // Poll job status every 2 seconds until completed/failed/cancelled
}

private isAudioFile(file: File): boolean {
  const audioExtensions = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac'];
  return audioExtensions.some(ext =>
    file.name.toLowerCase().endsWith(ext)
  );
}

private isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}
}
```

#### 2.4 Modal UI Design

**File Selection Area**:

```tsx
<div
  class={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
    isDragOver() ? "border-magenta-400 bg-magenta-600/10" : "border-gray-600"
  }`}
  onDragOver={(e) => handleDragOver(e)}
  onDrop={(e) => handleDrop(e)}
>
  <MusicIcon size={48} class="mx-auto mb-4 text-gray-400" />
  <h3 class="text-lg font-semibold mb-2">add music files</h3>
  <p class="text-gray-400 mb-4">drag audio files here or click to select</p>
  <p class="text-sm text-gray-500">
    supports mp3, flac, wav, m4a, ogg • max 100mb per file
  </p>
  <p class="text-sm text-gray-500">also accepts jpg/png for album artwork</p>
  <button class="mt-4 px-6 py-2 bg-magenta-600 hover:bg-magenta-500 rounded">
    Select Files
  </button>
</div>
```

**Upload Progress List**:

```tsx
<For each={uploads()}>
  {(upload) => (
    <div class="p-4 border border-gray-700">
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium truncate">{upload.file.name}</span>
        <StatusBadge status={upload.status} />
      </div>

      {/* Detailed progress for uploading/processing */}
      <Show
        when={upload.status === "uploading" || upload.status === "processing"}
      >
        <div class="mb-2">
          <ProgressBar progress={upload.progress} />
          <Show when={upload.processingStep}>
            <div class="text-xs text-gray-400 mt-1">
              {upload.processingStep === "metadata" && "extracting metadata..."}
              {upload.processingStep === "thumbnail" &&
                "generating thumbnail..."}
              {upload.processingStep === "waveform" && "creating waveform..."}
              {upload.processingStep === "song_creation" &&
                "creating song record..."}
            </div>
          </Show>
        </div>
        <Show when={upload.canCancel}>
          <button
            class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500"
            onClick={() => cancelUpload(upload.id)}
          >
            cancel
          </button>
        </Show>
      </Show>

      {/* Duplicate file handling */}
      <Show when={upload.status === "duplicate"}>
        <div class="mt-2 p-3 bg-yellow-900/20 border border-yellow-600/30">
          <div class="text-sm text-yellow-400 mb-2">
            this file already exists in your library
          </div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 text-black"
              onClick={() => viewExistingSong(upload.existingSongId)}
            >
              view existing
            </button>
            <button
              class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500"
              onClick={() => replaceFile(upload.id)}
            >
              replace
            </button>
            <button
              class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500"
              onClick={() => skipFile(upload.id)}
            >
              skip
            </button>
          </div>
        </div>
      </Show>

      {/* Album art association */}
      <Show when={upload.file.type.startsWith("image/")}>
        <div class="mt-2 p-3 bg-magenta-900/20 border border-magenta-600/30">
          <div class="text-sm text-magenta-400 mb-2">
            associate with album (optional)
          </div>
          <input
            type="text"
            placeholder="album name"
            value={upload.albumArtFor || ""}
            onInput={(e) => setAlbumArtFor(upload.id, e.currentTarget.value)}
            class="w-full px-3 py-1 text-sm bg-black border border-gray-600 text-white"
          />
        </div>
      </Show>

      {/* Success state */}
      <Show when={upload.status === "completed" && upload.songId}>
        <div class="mt-2 flex gap-2">
          <button
            class="px-4 py-1 text-sm bg-magenta-600 hover:bg-magenta-500"
            onClick={() => openSongEditModal(upload.songId)}
          >
            edit metadata
          </button>
          <button
            class="px-4 py-1 text-sm border border-gray-600 hover:border-gray-500"
            onClick={() => navigateToSong(upload.songId)}
          >
            view song
          </button>
        </div>
      </Show>

      {/* Error handling with specific error types */}
      <Show when={upload.status === "error"}>
        <div class="mt-2 p-3 bg-red-900/20 border border-red-600/30">
          <div class="text-sm text-red-400 mb-2">
            {upload.errorType === "unsupported_format" &&
              "unsupported audio format"}
            {upload.errorType === "corrupted_file" &&
              "file appears to be corrupted"}
            {upload.errorType === "metadata_extraction_failed" &&
              "could not extract metadata"}
            {upload.errorType === "size_limit" && "file exceeds size limit"}
            {!upload.errorType && "upload failed"}
          </div>
          <div class="text-xs text-gray-400 mb-2">{upload.error}</div>
          <div class="flex gap-2">
            <Show when={upload.canRetry}>
              <button
                class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500"
                onClick={() => retryUpload(upload.id)}
              >
                retry
              </button>
            </Show>
            <button
              class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500"
              onClick={() => removeUpload(upload.id)}
            >
              remove
            </button>
          </div>
        </div>
      </Show>
    </div>
  )}
</For>
```

### Phase 3: Integration Points

#### 3.1 Modal System Integration

**Location**: `tomb/client/js/src/views/freqhole/components/modals/ModalContainer.tsx`

Add to modal switch statement:

```tsx
case "addMusicModal":
  return <AddMusicModal isOpen={props.isOpen} onClose={props.onClose} />;
```

#### 3.2 Event System Integration

**Location**: `tomb/client/js/src/views/freqhole/hooks/useGlobalEvents.ts`

Add events:

```tsx
interface FreqholeEvents {
  // ... existing events
  "upload:audio-started": { fileId: string; filename: string };
  "upload:audio-progress": { fileId: string; progress: number };
  "upload:audio-completed": { fileId: string; songId: string };
  "upload:audio-failed": { fileId: string; error: string };
}
```

#### 3.3 API Client Integration

**Location**: `tomb/client/js/src/lib/api-client.ts`

Add methods:

```tsx
async uploadMusicFile(file: File): Promise<UploadResponse> {
  // Implementation using existing upload format
}

async getMusicJobStatus(jobId: string): Promise<MusicJobStatusResponse> {
  // Implementation
}
```

### Phase 4: Job Processing Integration

#### 4.1 Use Existing Music Job Workers

**Location**: Existing system already in place

The music job system already includes:

- Job types: `ProcessSong` handles complete audio file processing pipeline
- Workers that claim jobs via `claim_music_jobs()` function
- Processing logic in `tomb/cli/src/music/scanner.rs::process_audio_file()`
- Automatic retry logic and error handling

#### 4.2 Create Music Job Records

**Location**: `tomb/server/src/upload/handlers.rs`

In the `upload_large_file` handler, after creating MediaBlob:

```rust
// Check if uploaded file is audio and should be processed
let type_detector = MediaTypeDetector::from_config(&config);
let mut job_id: Option<String> = None;

if type_detector.is_audio_file(&upload_request.filename)? {
    // Check if music processing was requested in metadata
    let process_music = upload_request.metadata
        .as_object()
        .and_then(|obj| obj.get("process_music"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true); // Default to true for audio files

    if process_music {
        job_id = Some(sqlx::query_scalar!(
            r#"
            INSERT INTO music_jobs (job_type, file_path, media_blob_id, status, priority)
            VALUES ($1, $2, $3, 'pending', 'high')
            RETURNING id
            "#,
            "process_song",
            media_blob.local_path.as_ref().unwrap(),
            &media_blob.id
        ).fetch_one(&db).await?.to_string());
    }
}

// Include job_id in response metadata for frontend tracking
let mut response_metadata = serde_json::Map::new();
if let Some(jid) = job_id {
    response_metadata.insert("job_id".to_string(), jid.into());
    response_metadata.insert("will_process_music".to_string(), true.into());
}
```

#### 4.3 Database Schema Changes for User Tracking

**New Migration Required**: Add `created_by` field to `media_blobs` table

```sql
-- Migration: Add user tracking to media_blobs
ALTER TABLE media_blobs ADD COLUMN created_by UUID REFERENCES users(id);
CREATE INDEX idx_media_blobs_created_by ON media_blobs(created_by);
COMMENT ON COLUMN media_blobs.created_by IS 'User who uploaded this media blob';

-- Update existing records to have NULL created_by (can be backfilled later if needed)
```

**Code Changes Required**:

1. **Update `CreateMediaBlob` struct**:

   ```rust
   pub struct CreateMediaBlob {
       // ... existing fields
       pub created_by_user_id: Option<Uuid>, // New field
   }
   ```

2. **Update upload handler**:
   ```rust
   let media_blob_params = CreateMediaBlob {
       // ... existing fields
       created_by_user_id: Some(user.user().id), // Track uploader
       // ...
   };
   ```

The existing `music_jobs` table already supports uploaded audio files with `media_blob_id` foreign key. When jobs complete, the `song_id` field is populated with the created song record ID.

### Phase 5: Security and Validation

#### 5.1 File Type Validation

- Server-side MIME type checking
- File extension validation
- Magic number validation for audio files
- File size limits (100MB per file, 500MB total per session)

#### 5.2 Rate Limiting

- Limit uploads per user per hour
- Implement upload queue to prevent server overload
- Add concurrent upload limits

#### 5.3 Authentication

- Require authenticated user (not anonymous)
- Both regular users and admins can upload
- Log upload activities for auditing

### Phase 6: Error Handling and User Experience

#### 6.1 Client-Side Validation

- File type checking before upload
- File size validation
- Duplicate detection (same filename)
- Clear error messages

#### 6.2 Upload States

1. **File Selection**: Drag/drop or file picker
2. **Validation**: File type and size checks
3. **Upload**: Progress bar with percentage
4. **Processing**: Status indicators for metadata extraction
5. **Success**: Link to edit metadata
6. **Error**: Clear error message with retry option

#### 6.3 Batch Operations

- Allow multiple file uploads simultaneously
- Show overall progress
- Handle partial failures gracefully
- Provide batch retry functionality

### Phase 7: Testing Strategy

#### 7.1 Backend Testing

- Unit tests for upload endpoint
- Integration tests for job processing
- Test various audio formats
- Test file size limits
- Test error conditions

#### 7.2 Frontend Testing

- Component tests for modal
- Upload service tests
- File validation tests
- Error handling tests
- User interaction tests

#### 7.3 End-to-End Testing

- Full upload workflow
- Job status polling
- Error recovery
- Integration with song edit modal

## Implementation Timeline

### Week 1: Backend Foundation

- Create upload endpoint
- Implement job processor
- Add job status tracking
- Basic security and validation

### Week 2: Frontend Modal

- Create modal component
- Implement file selection UI
- Add upload service
- Progress tracking

### Week 3: Integration

- Connect frontend to backend
- Job status polling
- Error handling
- Integration with existing modals

### Week 4: Polish and Testing

- User experience improvements
- Comprehensive testing
- Performance optimization
- Documentation

## Dependencies

### Required Libraries

- **Backend**: No new dependencies (uses existing multipart, sea-orm, etc.)
- **Frontend**: No new dependencies (uses existing SolidJS, fetch API)

### Existing Services

- MediaBlob system for file storage
- **Existing music job queue system** (`music_jobs` table, `claim_music_jobs()` function)
- **Existing music processing pipeline** (`process_audio_file()` in CLI scanner)
- Modal system for UI
- Authentication system for security
- Music metadata extraction (grimoire)

## Success Metrics

1. **Functionality**: Users can successfully upload audio files and get song records
2. **Performance**: Files process within 30 seconds for typical audio files
3. **Reliability**: 99% success rate for valid audio files
4. **User Experience**: Clear progress indication and error handling
5. **Security**: Authenticated users only, proper file validation
6. **Configuration**: Upload directory from config, supports various audio formats
7. **Song Creation**: Completed jobs return song IDs for immediate metadata editing
8. **Upload Attribution**: Track which admin user uploaded each file for accountability
9. **Error Handling**: Specific error types with appropriate user actions
10. **Duplicate Prevention**: Pre-upload duplicate detection with user choice
11. **Job Control**: Ability to cancel in-progress jobs
12. **Album Art Workflow**: Associate uploaded images with specific albums

## Future Enhancements

1. **Bulk Metadata Editing**: Edit metadata for multiple uploaded files at once
2. **Auto-tagging**: Automatic genre/mood detection
3. **MusicBrainz Integration**: Automatic metadata lookup during upload
4. **Duplicate Detection**: Check for existing songs before processing
5. **Upload Templates**: Save common metadata for batch application
6. **Album Art Association**: Link uploaded JPG files as album art for music files
7. **Batch Album Processing**: Upload multiple files + album art as a cohesive album
8. **Quick Actions**: "Edit Metadata" and "View Song" buttons after successful processing
9. **Batch Song Editing**: Select multiple completed uploads and edit metadata together
10. **Upload History**: View which admin uploaded each media file for better management
11. **User-Scoped Uploads**: Filter uploads by user for better organization
12. **Smart Album Detection**: Automatically group uploaded files by album metadata
13. **Bulk Album Art**: Apply single album art image to multiple songs in batch
14. **Upload Presets**: Save common upload settings (quality, processing options)
15. **Progress Persistence**: Resume interrupted uploads across browser sessions
