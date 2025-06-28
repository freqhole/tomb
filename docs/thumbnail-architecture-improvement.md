# Thumbnail Architecture Improvement Plan

## Overview

The current thumbnail system has a fragile architecture where critical data is stored in both database columns and JSONB metadata, leading to serialization errors, inconsistent data access patterns, and maintenance headaches.

## Current Problems

### 1. **Dual Schema Nightmare**

- Core job data scattered between columns and JSONB `metadata`
- Some methods use column-first, others metadata-first
- Inconsistent data sources causing serialization failures

### 2. **Fragile Serialization Dependencies**

- `ThumbnailJob` struct changes break existing metadata
- "missing field `id`" errors when deserializing old jobs
- Repository methods failing due to incomplete metadata

### 3. **Performance & Query Issues**

- Can't efficiently query/index data buried in JSONB
- Complex repository logic handling both data sources
- Difficult debugging due to opaque metadata

### 4. **Migration Complexity**

- Adding new fields requires careful compatibility handling
- No clear separation between core vs extensible data

## Architecture Goals

### ✅ **Column-First Hybrid Approach**

- **Database Columns**: All core, queryable, indexable data
- **Metadata JSONB**: Only for optional, extensible, job-specific parameters

### ✅ **Clear Data Separation**

```
COLUMNS (Core Data):
- id, media_blob_id, job_type, status, priority
- target_width, target_height, retry_count, max_retries
- created_at, updated_at, scheduled_at, started_at, completed_at
- error_message, worker_id

METADATA (Optional/Extensible):
- processing_tool, quality_settings, debug_info
- job-specific parameters, performance metrics
- backward-compatibility data
```

## Implementation Plan

### Phase 1: Migration Consolidation (High Priority)

#### Task 1.1: Update `005_thumbnail_jobs.sql`

- [x] ✅ Basic consolidated migration created
- [ ] 🔄 Add missing columns for complete column-first approach
- [ ] 🔄 Add proper constraints and validation
- [ ] 🔄 Include data migration from old metadata format

#### Task 1.2: Repository Method Standardization

- [x] ✅ Fixed `get_pending_jobs` to use `claim_thumbnail_jobs()` function
- [x] ✅ Fixed `update_job_status` to use columns directly
- [x] ✅ Fixed `get_jobs_by_status` and `get_job` to construct from columns
- [ ] 🔄 Audit remaining methods for metadata dependencies
- [ ] 🔄 Standardize all repository methods to column-first pattern

#### Task 1.3: Complete Schema Migration

```sql
-- Additional columns needed:
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Migrate any remaining metadata to columns
UPDATE thumbnail_jobs
SET priority = COALESCE(metadata->>'priority', 'normal')
WHERE priority IS NULL;

-- Clean up metadata to only contain extensible data
UPDATE thumbnail_jobs
SET metadata = metadata - 'id' - 'media_blob_id' - 'job_type' - 'status' - 'priority'
                       - 'retry_count' - 'max_retries' - 'created_at' - 'updated_at';
```

### Phase 2: CLI & Generation Issues (High Priority)

#### Task 2.1: CLI Thumbnail Generation Investigation

**Issue 1**: `cli thumbnails generate --media-blob-id <id>` requires `--job-type` parameter that isn't obvious to users.

**Root Cause**: UX issue - when no `--job-type` specified, command should either:

1. Generate all applicable thumbnail types for the media blob, or
2. Show available job types for that specific media type

**Issue 2**: `cli thumbnails bulk-generate` creates duplicate thumbnails for media that already has thumbnails.

**Root Cause**: Deduplication function `job_exists_for_blob()` only checked for active jobs, not existing thumbnails. When completed jobs are cleaned up but thumbnails remain, the function incorrectly returns false.

**Investigation Results**:

- [x] ✅ CLI generates jobs correctly when `--job-type` is specified
- [x] ✅ File path resolution works (fixed in Phase 1)
- [x] ✅ Thumbnail generation working end-to-end
- [x] ✅ Found `bulk-generate` command that automatically finds missing thumbnails
- [x] ✅ Fixed duplicate thumbnail creation by improving deduplication logic

#### Task 2.2: CLI Command Improvements

- [x] ✅ Fixed serialization errors in `thumbnails list` command
- [ ] 🔄 **UX Fix**: `generate` command should auto-detect job types when not specified
- [ ] 🔄 **Discovery**: Promote `bulk-generate` as primary workflow for missing thumbnails
- [ ] 🔄 Add thumbnail verification/listing capabilities
- [ ] 🔄 Improve error reporting and debugging output

**Better CLI Workflow Discovery**:

```bash
# 🎯 Primary workflow for missing thumbnails:
cargo run -p cli -- thumbnails bulk-generate --dry-run --limit 10

# Actually generate missing thumbnails:
cargo run -p cli -- thumbnails bulk-generate --limit 10

# For specific blobs, should auto-detect job types:
cargo run -p cli -- thumbnails generate --media-blob-id <id>  # Should try all applicable types

# Check what failed and retry:
cargo run -p cli -- thumbnails list --status failed --limit 20
```

### Phase 3: Architecture Cleanup (Medium Priority)

#### Task 3.1: Repository Pattern Standardization

```rust
// Standard pattern for all repository methods:
impl ThumbnailRepository {
    pub async fn method_name(&self) -> Result<ThumbnailJob, ThumbnailError> {
        let row = sqlx::query!("SELECT id, media_blob_id, job_type, status, ...")
            .fetch_one(self.db.pool())
            .await?;

        // Construct from columns (never deserialize whole struct from metadata)
        Ok(ThumbnailJob {
            id: row.id,
            media_blob_id: row.media_blob_id,
            // ... other core fields from columns
            metadata: row.metadata, // Keep as-is for extensible data
        })
    }
}
```

#### Task 3.2: Service Layer Updates

- [ ] 🔄 Update `ThumbnailService` to work with column-first data
- [ ] 🔄 Remove any remaining metadata serialization dependencies
- [ ] 🔄 Use metadata only for job-specific parameters

#### Task 3.3: Database Function Updates

- [x] ✅ `claim_thumbnail_jobs()` function working correctly
- [x] ✅ `job_exists_for_blob()` function working correctly
- [ ] 🔄 Add functions for common queries (job metrics, cleanup, etc.)

### Phase 4: Testing & Validation (Medium Priority)

#### Task 4.1: End-to-End Testing

- [ ] 🔄 Create test suite for thumbnail generation workflow
- [ ] 🔄 Test CLI commands with various scenarios
- [ ] 🔄 Verify database consistency after operations

#### Task 4.2: Performance Optimization

- [ ] 🔄 Add missing indexes for new columns
- [ ] 🔄 Optimize queries to use column-based filtering
- [ ] 🔄 Remove unnecessary metadata serialization overhead

## Immediate Action Items (Next Session)

### 🚨 **Critical Fixes**

1. **~~Investigate CLI thumbnail generation issue~~** ✅ RESOLVED
   - ✅ Issue was UX - missing `--job-type` parameter
   - ✅ `bulk-generate` command is the better workflow for finding missing thumbnails
   - [ ] 🔄 Improve `generate` command UX to auto-detect job types

2. **~~Fix duplicate thumbnail creation in bulk-generate~~** ✅ RESOLVED
   - ✅ Updated `job_exists_for_blob()` function to check existing thumbnails in `media_blobs` table
   - ✅ Function now checks both active jobs AND existing thumbnail results
   - ✅ Prevents duplicate job creation when thumbnails already exist

3. **Complete repository method audit**
   - Find any remaining methods using metadata serialization
   - Standardize all to column-first pattern

4. **Add missing columns to migration**
   - Ensure all core ThumbnailJob fields have dedicated columns
   - Remove dependency on metadata for core data

### 🎯 **Success Criteria**

- [x] ✅ CLI `thumbnails generate` produces visible thumbnail files (when job-type specified)
- [x] ✅ CLI `thumbnails bulk-generate` no longer creates duplicate thumbnails
- [ ] 🔄 CLI `thumbnails generate` auto-detects job types when not specified
- [x] ✅ All repository methods work without metadata deserialization
- [ ] 🔄 Can query/filter jobs using SQL on columns directly
- [x] ✅ No more "missing field" serialization errors
- [ ] 🔄 Clear separation: columns for core data, metadata for extensions

## Technical Debt Metrics

### Before (Current State)

- ❌ Dual data sources causing failures
- ❌ Complex repository methods with serialization
- ❌ Fragile to struct changes
- ❌ Poor query performance on metadata

### After (Target State)

- ✅ Single source of truth in columns
- ✅ Simple, reliable repository methods
- ✅ Robust to schema evolution
- ✅ Fast queries with proper indexing
- ✅ Clear architecture boundaries

## Notes

- **Database Recreation**: No data safety concerns, can drop/recreate for clean migration
- **Metadata Usage**: Keep JSONB for truly optional/extensible data (processing parameters, debug info)
- **Backward Compatibility**: Not required since database can be recreated

## CLI Workflow Examples

### 🎯 **Recommended Workflows**

**1. Find and generate missing thumbnails:**

```bash
# See what needs thumbnails (safe to run)
cargo run -p cli -- thumbnails bulk-generate --dry-run

# Generate thumbnails for all missing
cargo run -p cli -- thumbnails bulk-generate --limit 50

# Generate for specific file types only
cargo run -p cli -- thumbnails bulk-generate --mime-types "video/quicktime,video/mp4"
```

**2. Debug and retry failed jobs:**

```bash
# See what failed
cargo run -p cli -- thumbnails list --status failed_permanently --limit 10

# Retry specific media blob (specify job type for now)
cargo run -p cli -- thumbnails generate --media-blob-id <id> --job-type video_thumbnail

# Check status
cargo run -p cli -- thumbnails status
```

**3. Maintenance:**

```bash
# Clean up duplicates
cargo run -p cli -- thumbnails cleanup-duplicates --dry-run

# Clean up old completed jobs
cargo run -p cli -- thumbnails cleanup --older-than 7
```

## Fixed Issues

### 🔧 **Duplicate Thumbnail Fix**

**Problem**: `bulk-generate` was creating duplicate thumbnails because the deduplication function only checked for active jobs, not existing thumbnail results.

**Solution**: Updated `job_exists_for_blob()` database function to check both:

1. **Active Jobs**: `pending` and `in_progress` jobs in `thumbnail_jobs` table
2. **Existing Thumbnails**: Actual thumbnail blobs in `media_blobs` table with `parent_blob_id`

**Job Type to Blob Type Mapping**:

- `image_thumbnail` → `blob_type = 'thumbnail'`
- `video_thumbnail` → `blob_type = 'thumbnail'`
- `video_preview` → `blob_type = 'preview'`
- `audio_waveform` → `blob_type = 'waveform'`

**Result**: `bulk-generate` now properly skips media that already has thumbnails, preventing duplicates.

---

_Last Updated: 2025-06-28_
_Status: In Progress - Phase 1 partially complete_
