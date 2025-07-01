# Media Blobs Table Refactoring Plan: Short Hash Primary Key

## Overview

This document outlines the plan to refactor the `media_blobs` table to use short content hashes as the `id` primary key instead of UUIDs. The `id` column will contain auto-generated short hashes (7-16 chars) derived from SHA256, while keeping the full `sha256` column with a unique constraint for deduplication.
This document outlines the comprehensive plan to refactor the `media_blobs` table to use SHA256 hashes as the `id` primary key instead of UUIDs. The `sha256` column will be removed entirely, and the `id` column will contain SHA256 values. Additionally, we'll add a `slug` field that contains a shortened, human-readable version of the SHA256 for URLs and display purposes. This is a foundational change that will ripple through the entire codebase but will result in significant simplifications and performance improvements.

## Current State Analysis

### Database Schema Issues

- `media_blobs` table currently has UUID primary key in `id` column with separate `sha256` column
- UUIDs are meaningless for content-addressed storage
- Foreign key references use UUIDs instead of content-derived identifiers
- Complex deduplication logic needed since UUID ≠ content hash
- No short, human-readable identifiers for URLs or display
- SHA256 should have unique constraint for deduplication

### Code Impact Assessment

Based on grep analysis, `media_blobs` references are found extensively in:

- **Rust Backend**: 50+ references across repository, service, migration files
- **JavaScript Frontend**: 100+ references in WebSocket clients, data grids, sync components
- **SQL Migrations**: Multiple migration files with table relationships
- **Documentation**: Various docs and examples

## Migration Strategy

### Phase 1: Database Schema Migration

#### Step 1.1: Update Existing Migration File

```sql
-- migrations/004_media_blobs.sql (UPDATED)
-- Since we're starting with empty DB, just update the schema directly

CREATE TABLE IF NOT EXISTS media_blobs (
    id VARCHAR(16) PRIMARY KEY,  -- Short hash (7-16 chars), auto-generated from sha256
    sha256 CHAR(64) NOT NULL UNIQUE,  -- Full SHA256 hash for integrity and deduplication
    data BYTEA,
    size BIGINT,
    mime TEXT,
    source_client_id TEXT,
    local_path TEXT,
    parent_blob_id VARCHAR(16) REFERENCES media_blobs(id),  -- References short hash
    blob_type VARCHAR(20) NOT NULL DEFAULT 'original',
    version BIGINT NOT NULL DEFAULT txid_current(),
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Validation constraints
ALTER TABLE media_blobs ADD CONSTRAINT chk_id_format
    CHECK (id ~ '^[a-f0-9]{7,16}$' AND length(id) >= 7);
ALTER TABLE media_blobs ADD CONSTRAINT chk_sha256_format
    CHECK (sha256 ~ '^[a-f0-9]{64}$');

-- Indexes (sha256 unique constraint provides deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_blobs_sha256 ON media_blobs (sha256);
CREATE INDEX IF NOT EXISTS idx_media_blobs_client_id ON media_blobs (source_client_id);
CREATE INDEX IF NOT EXISTS idx_media_blobs_created_at ON media_blobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_blobs_local_path ON media_blobs (local_path);
CREATE INDEX IF NOT EXISTS idx_media_blobs_mime ON media_blobs (mime);
CREATE INDEX IF NOT EXISTS idx_media_blobs_version ON media_blobs (version);
CREATE INDEX IF NOT EXISTS idx_media_blobs_deleted_at ON media_blobs (deleted_at);
CREATE INDEX IF NOT EXISTS idx_media_blobs_active ON media_blobs (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_blobs_parent ON media_blobs (parent_blob_id);
CREATE INDEX IF NOT EXISTS idx_media_blobs_type ON media_blobs (blob_type);
CREATE INDEX IF NOT EXISTS idx_media_blobs_updated_at ON media_blobs (updated_at);
CREATE INDEX IF NOT EXISTS idx_media_blobs_slug ON media_blobs (slug);  -- For slug-based lookups

-- Auto-generate slug from id
CREATE OR REPLACE FUNCTION generate_media_blob_slug()
RETURNS TRIGGER AS $$
DECLARE
    attempt_length INT := 7;  -- Start with 7 chars (like Git)
    candidate_slug TEXT;
    max_attempts INT := 16;   -- Don't go beyond 16 chars
BEGIN
    -- Generate progressively longer slugs until unique
    WHILE attempt_length <= max_attempts LOOP
        candidate_slug := substring(NEW.id FROM 1 FOR attempt_length);

        -- Check if this slug already exists
        IF NOT EXISTS (
            SELECT 1 and functions (they'll work with TEXT id)
-- ... (rest of existing migration file)
```

#### Step 1.2: Update Enhancement Migrations

Update `migrations/006_enhance_media_blobs.sql` to work with VARCHAR(16) id:

- Update `parent_blob_id` to VARCHAR(16) for short hash references
- Ensure sha256 unique constraint is maintained

### Phase 2: Rust Backend Refactoring

#### Step 2.1: Update Type Definitions

**Files to update:**

- `grimoire/src/media/types.rs` or equivalent
- Any Serde models for MediaBlob

**Changes:**

```rust
// Before
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaBlob {
    pub id: Uuid,
    pub sha256: String,
    pub parent_blob_id: Option<Uuid>,
    // ... other fields
}

// After
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaBlob {
    pub id: String,  // Now contains short hash (7-16 chars) instead of UUID
    pub sha256: String,  // Keep sha256 field for integrity and lookups
    pub parent_blob_id: Option<String>,  // Now contains short hash
    // ... other fields unchanged
}
```

#### Step 2.2: Update Repository Layer

**Files to update:**

- `grimoire/src/media/repository.rs`
- All `sqlx::query!` macros

**Major changes:**

- Change `id` parameter types from `Uuid` to `String`
- Update SQL queries to expect VARCHAR(16) id instead of UUID
- Replace UUID generation with SHA256 calculation + short ID generation
- Keep same field names (`id`, `parent_blob_id`) but change their content
- Add methods for SHA256-based lookups alongside ID lookups
- Database trigger automatically generates unique short IDs

**Example transformation:**

```rust
// Before
pub async fn find_by_id(&self, id: Uuid) -> Result<Option<MediaBlob>, MediaRepositoryError> {
    let row = sqlx::query!(
        "SELECT id, data, sha256, size, mime, ... FROM media_blobs WHERE id = $1",
        id
    )
    // ...
}

// After
pub async fn find_by_id(&self, id: &str) -> Result<Option<MediaBlob>, MediaRepositoryError> {
    let row = sqlx::query!(
        "SELECT id, sha256, data, size, mime, ... FROM media_blobs WHERE id = $1",
        id  // id is now the short hash (7-16 chars)
    )
    // ...
}

// New method for SHA256-based lookups
pub async fn find_by_sha256(&self, sha256: &str) -> Result<Option<MediaBlob>, MediaRepositoryError> {
    let row = sqlx::query!(
        "SELECT id, sha256, data, size, mime, ... FROM media_blobs WHERE sha256 = $1",
        sha256  // Full 64-char SHA256 for integrity checks
    )
    // ...
}

// Create method changes from:
pub async fn create(&self, data: &[u8], mime: &str) -> Result<MediaBlob, MediaRepositoryError> {
    let id = Uuid::new_v4();  // Generate random UUID
    let sha256 = calculate_sha256(data);
    // ...
}

// To:
pub async fn create(&self, sha256: String, data: Option<&[u8]>, mime: &str) -> Result<MediaBlob, MediaRepositoryError> {
    // SHA256 provided by caller (calculated at source: upload handlers, file processors, etc.)
    // id (short hash) will be auto-generated by database trigger from sha256
    // data is optional - some blobs store externally via local_path
    // ...
}
```

#### Step 2.3: Update Service Layer

**Files to update:**

- `grimoire/src/media/service.rs`
- All service methods that work with MediaBlob entities

**Changes:**

- Change method signatures from `Uuid` to `String` for id parameters
- Simplify deduplication logic (natural deduplication through SHA256 unique constraint)
- Keep SHA256 calculation for integrity but use short ID for operations
- Update error handling for string-based IDs (shorter than UUIDs)
- Add SHA256-based lookup methods for content verification
- Leverage database auto-generated short IDs for human-friendly operations

#### Step 2.4: Update API Endpoints

**Files to update:**

- All REST API handlers that work with media blobs
- WebSocket message handlers

**URL pattern changes:**

```rust
// Before: id parameter expects UUID
"/api/media-blobs/{id}/download"  // id = "123e4567-e89b-12d3-a456-426614174000"
"/api/v1/media_blobs/{id}/thumbnail"

// After: id parameter expects short hash
"/api/media-blobs/{id}/download"      // id = "a1b2c3d4" (7-16 chars, human-friendly)
"/api/v1/media_blobs/{id}/thumbnail"  // Same short hash format

// URLs become much cleaner and shorter!
// Can still lookup by full SHA256 if needed for integrity checks
```

#### Step 2.5: Update CLI Tools

**Files to update:**

- `cli/src/thumbnails/commands.rs`
- Any other CLI tools that reference media blobs

### Phase 3: Frontend JavaScript Refactoring

#### Step 3.1: Update API Clients

**Files to update:**

- `client/js/api-client-*.js`
- Any API client wrapper code

**Changes:**

- Update API calls to use short hash for all URLs (shorter, prettier)
- Remove any UUID validation/formatting code
- Update client-side ID handling for shorter string format
- Add SHA256 field handling for integrity verification when needed

#### Step 3.2: Update WebSocket Message Handling

**Files to update:**

- `client/js/websocket-*.js`
- All WebSocket event handlers

**Changes:**

- Message payloads include both `id` (short hash) and `sha256` fields
- Use id for display and operations, sha256 for deduplication/integrity
- Update any UUID-specific validation/parsing
- Prefer short id in user-facing messages and logs

#### Step 3.3: Update Data Grid Components

**Files to update:**

- `client/js/infinite-data-grid*.js`
- `client/js/all-components*.js`
- `client/js/freqhole-demo*.js`
- Any feed/grid components

**Changes:**

- Use `item.id` for display and user interaction (7-16 chars, readable)
- Use `item.sha256` for deduplication and integrity verification
- Update any UUID-specific formatting/validation
- Modify selection tracking to use short id (much cleaner than UUIDs)
- Display short id in UI, full sha256 available when needed

#### Step 3.4: Update Feed Components

**Files to update:**

- `client/js/` (all JavaScript files need review for schema changes)
- Focus on media blob display and WebSocket components

**Changes:**

- Use `id` field (short hash) for user-facing display and URLs
- Keep `sha256` field for integrity and deduplication checks
- Update caching to use short id as keys (much more efficient)
- Implement short-id-first lookup pattern in API calls

### Phase 4: Testing & Validation

#### Step 4.1: Database Migration Testing

- Test migration on copy of production data
- Verify data integrity after migration
- Test rollback procedures
- Performance testing of SHA256-based queries

#### Step 4.2: Backend Testing

- Update all unit tests that reference media blob IDs
- Integration tests for API endpoints
- WebSocket message handling tests

#### Step 4.3: Frontend Testing

- Test all UI components that display media blobs
- Verify WebSocket real-time updates work correctly
- Test file upload/download flows

### Phase 5: Documentation Updates

#### Step 5.1: API Documentation

- Update OpenAPI/Swagger specs
- Update any API documentation with new URL patterns

#### Step 5.2: Database Documentation

- Update ERD diagrams
- Update any schema documentation

#### Step 5.3: Developer Documentation

- Update any developer guides
- Update examples and tutorials

## Expected Benefits

### Performance Improvements

- **Deduplication**: Automatic via SHA256 unique constraint
- **Short Primary Keys**: 7-16 chars vs 36-char UUIDs
- **Clean URLs**: `/api/media-blobs/a1b2c3d4/download`

### Code Simplification

- **No UUID Generation**: Content-derived IDs instead
- **Natural Deduplication**: Database constraint handles it
- **Meaningful Keys**: IDs represent content, not arbitrary values

### Data Integrity

- **Content-Based Identity**: ID derived from content hash
- **Automatic Collision Resolution**: Progressive length extension
- **Unique Content**: SHA256 constraint prevents duplicates

## Potential Challenges & Mitigations

### Challenge 1: Variable-Length Primary Keys

- **Issue**: Short hashes are variable length (7-16 chars)
- **Mitigation**: VARCHAR(16) handles range efficiently; much shorter than UUIDs anyway

### Challenge 2: Code Changes Across Stack

- **Issue**: Need to update Rust, JavaScript, and SQL code
- **Mitigation**: Field names stay the same (`id`), just content changes; systematic testing

### Challenge 3: Content-Based IDs

- **Issue**: IDs now have meaning and can't be arbitrarily changed
- **Mitigation**: This is actually a feature - IDs represent content identity

### Challenge 4: Foreign Key References

- **Issue**: Tables with `parent_blob_id` need VARCHAR(16) support
- **Mitigation**: Update schema since starting with empty DB

## Implementation Timeline

### Implementation Steps

**Completed:**

- [x] Consolidate migrations 018-021 into 008_music_functions.sql
- [x] Test clean migration run on fresh database
- [x] Rewrite media_blobs migration with short hash ID + trigger
- [x] Update all foreign key references across migrations to use VARCHAR(16)
- [x] Test complete migration suite with new schema

**Next Steps:**

- [ ] Update Rust backend (repository, service, API layers)
- [ ] Update JavaScript frontend components
- [ ] Testing and deployment

## Rollback Plan

### Emergency Rollback

If issues are discovered:

1. Create reverse migration changing id back to UUID type
2. Regenerate UUIDs for existing SHA256 ids
3. Add back separate sha256 column
4. Git revert code changes

### Development Safety

- Work in feature branch until fully tested
- Use development database for initial testing
- Keep migration reversible until confirmed working

## Success Criteria

- [x] Clean migration run completed
- [x] Migration consolidation completed
- [x] New media_blobs schema with short hash IDs
- [x] All foreign key references updated to VARCHAR(16)
- [x] Complete migration suite runs successfully
- [ ] All functionality works with new ID format
- [ ] Code significantly simplified
- [ ] Performance improvements measurable

## Key Implementation Notes

- **Short ID Generation**: 7-16 char prefixes of SHA256, auto-collision resolution
- **Deduplication**: Unique SHA256 constraint handles duplicate content
- **SHA256 Calculation**: At source (upload handlers, file processors) not repository layer
- **Optional Data Storage**: `data` column optional, some blobs use `local_path` instead
- **Minimal Code Changes**: `id` field stays, just different content (short hash vs UUID)
- **Clean URLs**: Much shorter, content-derived identifiers
- **Integrity**: Full SHA256 still available for verification

This approach maintains all benefits of content-addressed storage while minimizing refactoring complexity.
