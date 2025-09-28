# MusicBrainz Integration Plan

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

## Overview

This document outlines the plan for integrating MusicBrainz metadata and cover art services into the Tomb music application. The integration will allow users to enhance their music metadata and obtain high-quality album artwork through the MusicBrainz API.

## Goals

- **Metadata Enhancement**: Use existing song metadata to query MusicBrainz for improved/complete metadata
- **Cover Art Retrieval**: Fetch album artwork from MusicBrainz Cover Art Archive
- **Review Workflow**: Allow users to review and edit MusicBrainz results before applying changes
- **Flexible Querying**: Enable customizable search queries for better match accuracy
- **Album-Centric**: Optimize for bulk album metadata updates while supporting single songs
- **Modular Design**: Only expose UI when MusicBrainz API key is configured

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client UI     │───▶│   Server API    │───▶│   MusicBrainz   │
│                 │    │                 │    │      API        │
│ - Search Form   │    │ - Query Builder │    │ - Metadata      │
│ - Results View  │    │ - Data Mapper   │    │ - Cover Art     │
│ - Review Modal  │    │ - Rate Limiter  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Technical Implementation

### 1. Configuration Management

**Server Configuration** (`assets/config/config.jsonc`):

```json
{
  "musicbrainz": {
    "enabled": false,
    "user_agent": "tomb-music-app/1.0.0 (contact@example.com)",
    "rate_limit_ms": 1000,
    "base_url": "https://musicbrainz.org/ws/2",
    "cover_art_url": "https://coverartarchive.org"
  }
}
```

**Configuration Validation**:

- Ensure user_agent follows MusicBrainz guidelines (required)
- Respect rate limiting requirements (1 request/second for all users)
- No API key needed for metadata retrieval

### 2. Backend Components

#### 2.1 MusicBrainz Client (`grimoire/src/musicbrainz/`)

**Core Client** (`client.rs`):

```rust
pub struct MusicBrainzClient {
    client: reqwest::Client,
    config: MusicBrainzConfig,
    rate_limiter: RateLimiter,
}

impl MusicBrainzClient {
    // Search methods
    pub async fn search_recordings(&self, query: RecordingSearchQuery) -> Result<Vec<Recording>>;
    pub async fn search_releases(&self, query: ReleaseSearchQuery) -> Result<Vec<Release>>;
    pub async fn search_release_groups(&self, query: ReleaseGroupSearchQuery) -> Result<Vec<ReleaseGroup>>;

    // Lookup methods
    pub async fn get_recording(&self, mbid: Uuid) -> Result<Recording>;
    pub async fn get_release(&self, mbid: Uuid) -> Result<Release>;
    pub async fn get_cover_art(&self, mbid: Uuid) -> Result<Vec<CoverArt>>;

    // Rate limiting
    async fn execute_request<T>(&self, request: Request) -> Result<T>;
}
```

**Data Models** (`models.rs`):

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Recording {
    pub id: Uuid,
    pub title: String,
    pub length: Option<u32>, // milliseconds
    pub artist_credit: Vec<ArtistCredit>,
    pub releases: Vec<RecordingRelease>,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Release {
    pub id: Uuid,
    pub title: String,
    pub date: Option<String>,
    pub country: Option<String>,
    pub artist_credit: Vec<ArtistCredit>,
    pub media: Vec<Medium>,
    pub cover_art_archive: CoverArtArchive,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoverArt {
    pub image_url: String,
    pub thumbnail_url: String,
    pub types: Vec<CoverArtType>, // front, back, booklet, etc.
    pub approved: bool,
    pub front: bool,
    pub back: bool,
}
```

**Query Builder** (`queries.rs`):

```rust
pub struct RecordingSearchQuery {
    pub artist: Option<String>,
    pub title: Option<String>,
    pub release: Option<String>,
    pub duration: Option<u32>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

impl RecordingSearchQuery {
    // Build Lucene query string for MusicBrainz API
    pub fn to_query_string(&self) -> String;

    // Create from existing song metadata
    pub fn from_song(song: &Song) -> Self;
}
```

**Rate Limiter** (`rate_limiter.rs`):

```rust
pub struct RateLimiter {
    last_request: Arc<Mutex<Instant>>,
    min_interval: Duration,
}

impl RateLimiter {
    pub async fn wait_if_needed(&self);
}
```

#### 2.2 MusicBrainz Service (`grimoire/src/musicbrainz/service.rs`)

```rust
pub struct MusicBrainzService {
    client: MusicBrainzClient,
    repository: MusicRepository,
}

impl MusicBrainzService {
    // Search workflows
    pub async fn search_for_song(&self, song_id: Uuid) -> Result<Vec<MusicBrainzMatch>>;
    pub async fn search_for_songs(&self, song_ids: Vec<Uuid>) -> Result<Vec<SongSearchResult>>;
    pub async fn search_for_album(&self, song_ids: Vec<Uuid>) -> Result<Vec<AlbumMatch>>;

    // Custom search
    pub async fn custom_search(&self, query: SearchRequest) -> Result<SearchResponse>;

    // Metadata application
    pub async fn preview_metadata_changes(&self, song_id: Uuid, recording_id: Uuid) -> Result<MetadataPreview>;
    pub async fn apply_metadata(&self, updates: Vec<MetadataUpdate>) -> Result<Vec<Song>>;

    // Cover art
    pub async fn fetch_cover_art(&self, release_id: Uuid) -> Result<Vec<String>>; // blob IDs
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MusicBrainzMatch {
    pub recording: Recording,
    pub release: Option<Release>,
    pub confidence_score: f32, // 0.0 - 1.0
    pub match_reasons: Vec<MatchReason>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetadataPreview {
    pub song_id: Uuid,
    pub current_metadata: SongMetadata,
    pub proposed_metadata: SongMetadata,
    pub changes: Vec<MetadataChange>,
    pub cover_art_options: Vec<CoverArt>,
}
```

#### 2.3 Server API Endpoints (`server/src/musicbrainz/`)

**Routes** (`routes.rs`):

```rust
use crate::auth::require_admin;
use axum::{middleware as axum_middleware, routing::{get, post}, Router};

pub fn create_musicbrainz_routes() -> Router {
    Router::new()
        // Public config endpoint (no auth required)
        .route("/api/musicbrainz/config", get(get_config))
        // Admin-only endpoints wrapped in middleware
        .route("/api/musicbrainz/search/song", post(search_song))
        .route("/api/musicbrainz/search/songs", post(search_songs))
        .route("/api/musicbrainz/search/custom", post(custom_search))
        .route("/api/musicbrainz/preview", post(preview_metadata))
        .route("/api/musicbrainz/apply", post(apply_metadata))
        .layer(axum_middleware::from_fn(require_admin))
        .layer(axum_middleware::from_fn(require_musicbrainz_enabled))
}

// Configuration endpoint (public - used by client to determine feature availability)
GET /api/musicbrainz/config
    -> { enabled: bool, user_agent: string, features: string[] }

// Admin-only search endpoints (all require admin middleware)
POST /api/musicbrainz/search/song
    -> SearchRequest { song_id: Uuid, custom_query?: string }
    <- SearchResponse { matches: MusicBrainzMatch[] }

POST /api/musicbrainz/search/songs
    -> BatchSearchRequest { song_ids: Uuid[], search_strategy: "individual" | "album" }
    <- BatchSearchResponse { results: SongSearchResult[] }

POST /api/musicbrainz/search/custom
    -> CustomSearchRequest { query: string, type: "recording" | "release" }
    <- SearchResponse

// Metadata preview (admin-only)
POST /api/musicbrainz/preview
    -> PreviewRequest { song_id: Uuid, recording_id: Uuid, include_cover_art: bool }
    <- MetadataPreview

// Apply changes (admin-only)
POST /api/musicbrainz/apply
    -> ApplyRequest { updates: MetadataUpdate[], download_cover_art: bool }
    <- ApplyResponse { updated_songs: Song[], failed_updates: string[] }
```

**Middleware Chain**:

```rust
use crate::auth::{require_admin, AuthenticatedUser};

// Custom middleware to check MusicBrainz configuration
pub async fn require_musicbrainz_enabled(
    Extension(config): Extension<AppConfig>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if !config.musicbrainz.enabled || config.musicbrainz.user_agent.is_empty() {
        return Err(StatusCode::NOT_FOUND); // Hide endpoints when not configured
    }
    Ok(next.run(request).await)
}

// Middleware stack: require_admin -> require_musicbrainz_enabled -> handler
// This ensures users must be admin AND MusicBrainz must be configured
```

### 3. Frontend Components

#### 3.1 API Client Integration

**Admin API Methods** (`musicbrainz-admin-methods.ts`):

```typescript
import type { ApiClient } from "../api-client.js";
import { musicValidation } from "./validation.js";
import { musicApiUtils } from "./error-handling.js";

/**
 * Admin-only MusicBrainz API methods
 * Following the existing pattern from music/api-admin-methods.ts
 */
export const musicbrainzAdminApiMethods = {
  // Configuration check (public endpoint)
  async getConfig(this: ApiClient): Promise<MusicBrainzConfig> {
    return this.makeRequest("GET", "/api/musicbrainz/config");
  },

  // Search methods (admin-only)
  async searchSong(
    this: ApiClient,
    request: SearchRequest,
  ): Promise<SearchResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<SearchResponse>(
          "POST",
          "/api/musicbrainz/search/song",
          {
            data: request,
            headers: { "Content-Type": "application/json" },
          },
        );
        return response;
      },
      "/api/musicbrainz/search/song",
      "searchSong",
      { songId: request.song_id },
    );
  },

  async searchSongs(
    this: ApiClient,
    request: BatchSearchRequest,
  ): Promise<BatchSearchResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<BatchSearchResponse>(
          "POST",
          "/api/musicbrainz/search/songs",
          {
            data: request,
            headers: { "Content-Type": "application/json" },
          },
        );
        return response;
      },
      "/api/musicbrainz/search/songs",
      "searchSongs",
      { songCount: request.song_ids.length },
    );
  },

  async previewMetadata(
    this: ApiClient,
    request: PreviewRequest,
  ): Promise<MetadataPreview> {
    return musicApiUtils.withErrorHandling(
      async () => {
        return this.makeRequest<MetadataPreview>(
          "POST",
          "/api/musicbrainz/preview",
          {
            data: request,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
      "/api/musicbrainz/preview",
      "previewMetadata",
      { songId: request.song_id },
    );
  },

  async applyMetadata(
    this: ApiClient,
    request: ApplyRequest,
  ): Promise<ApplyResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        return this.makeRequest<ApplyResponse>(
          "POST",
          "/api/musicbrainz/apply",
          {
            data: request,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
      "/api/musicbrainz/apply",
      "applyMetadata",
      { updateCount: request.updates.length },
    );
  },
};
```

**ApiClient Integration** (`api-client.ts` additions):

```typescript
import { musicbrainzAdminApiMethods } from "./musicbrainz/admin-methods.js";

class ApiClient {
  // ... existing methods ...

  // MusicBrainz methods (admin-only, following existing pattern)
  async getMusicBrainzConfig() {
    return musicbrainzAdminApiMethods.getConfig.call(this);
  }

  async searchMusicBrainzSong(request: SearchRequest) {
    return musicbrainzAdminApiMethods.searchSong.call(this, request);
  }

  async searchMusicBrainzSongs(request: BatchSearchRequest) {
    return musicbrainzAdminApiMethods.searchSongs.call(this, request);
  }

  async previewMusicBrainzMetadata(request: PreviewRequest) {
    return musicbrainzAdminApiMethods.previewMetadata.call(this, request);
  }

  async applyMusicBrainzMetadata(request: ApplyRequest) {
    return musicbrainzAdminApiMethods.applyMetadata.call(this, request);
  }
}
```

#### 3.2 Configuration Detection

**Hook** (`useMusicBrainz.ts`):

```typescript
export const useMusicBrainz = () => {
  const [config, setConfig] = createSignal<MusicBrainzConfig | null>(null);
  const [isEnabled, setIsEnabled] = createSignal(false);

  const checkConfiguration = async () => {
    try {
      const response = await apiClient.getMusicBrainzConfig();
      setConfig(response);
      setIsEnabled(response.enabled);
    } catch {
      setIsEnabled(false);
    }
  };

  return { config, isEnabled, checkConfiguration };
};
```

#### 3.3 UI Components

**Main MusicBrainz Modal** (`MusicBrainzModal.tsx`):

```typescript
interface MusicBrainzModalProps {
  isOpen: boolean;
  songs: Song[];
  onClose: () => void;
  onApplyChanges: (updates: MetadataUpdate[]) => void;
}

export function MusicBrainzModal(props: MusicBrainzModalProps) {
  // Main modal containing all MusicBrainz functionality
  // Search interface, results display, preview, and application
  // Completely separate from existing song edit modal
}
```

**Search Results Component** (`MusicBrainzResults.tsx`):

```typescript
export function MusicBrainzResults(props: {
  results: MusicBrainzMatch[];
  songs: Song[];
  onSelectMatch: (songId: string, match: MusicBrainzMatch) => void;
  onPreview: (songId: string, match: MusicBrainzMatch) => void;
}) {
  // Display search results within the main MusicBrainz modal
  // Show confidence scores and match reasons
  // Allow selecting specific matches for each song
  // Provide preview functionality
  // Show cover art options
}
```

**Metadata Preview Modal** (`MetadataPreviewModal.tsx`):

```typescript
export function MetadataPreviewModal(props: {
  preview: MetadataPreview;
  onApply: (includeImages: boolean) => void;
  onCancel: () => void;
}) {
  // Side-by-side comparison of current vs proposed metadata
  // Highlight changes
  // Show cover art options with preview
  // Allow selective application of changes
}
```

**Custom Search Form** (`MusicBrainzCustomSearch.tsx`):

```typescript
export function MusicBrainzCustomSearch(props: {
  initialQuery?: string;
  searchType: "recording" | "release";
  onResults: (results: SearchResponse) => void;
}) {
  // Text input for custom Lucene queries
  // Query builder UI for common fields
  // Search type selector
  // Real-time query validation
}
```

#### 3.4 Integration Points

**Context Menu Integration**:

- Add "Search MusicBrainz" option to song context menus (admin only, when enabled)
- Add bulk "Search MusicBrainz for Album" option for multi-song selections
- Context menu items only visible when user is admin AND MusicBrainz is configured

**Context Menu Conditional Logic**:

```typescript
// In songInteractions.ts or similar context menu logic
const createContextMenuActions = () => {
  const auth = useAuth();
  const musicbrainz = useMusicBrainz();

  // Only show MusicBrainz options if:
  // 1. User is admin
  // 2. MusicBrainz is enabled and configured
  const showMusicBrainzOptions = () => auth.isAdmin && musicbrainz.isEnabled();

  return {
    // ... existing context menu items ...

    ...(showMusicBrainzOptions() && {
      musicbrainzSearch: {
        label: "Search MusicBrainz",
        icon: "🎵",
        action: (songs: Song[]) => openMusicBrainzModal(songs),
        adminOnly: true,
      },

      musicbrainzAlbumSearch: {
        label: "Search MusicBrainz for Album",
        icon: "💿",
        action: (songs: Song[]) =>
          openMusicBrainzModal(songs, { mode: "album" }),
        adminOnly: true,
        showOnMultiSelect: true,
      },
    }),
  };
};
```

**Separate MusicBrainz Modal**:

- Dedicated `MusicBrainzModal` component (separate from existing song edit modal)
- Launched from context menu, not integrated into existing song forms
- Keeps existing song editing workflow completely untouched

### 4. Search Strategies

#### 4.1 Single Song Search

1. **Initial Query**: Use existing metadata (artist, title, album, duration)
2. **Fuzzy Matching**: Score results based on similarity
3. **User Refinement**: Allow custom query modification
4. **Result Selection**: Present top matches with confidence scores

#### 4.2 Album Search

1. **Album Detection**: Group songs by album metadata
2. **Release Search**: Search for MusicBrainz releases matching album
3. **Track Matching**: Match individual songs to release tracks
4. **Bulk Application**: Apply consistent metadata across album

#### 4.3 Custom Search

1. **Query Builder**: GUI for building Lucene queries
2. **Advanced Options**: Direct query string editing
3. **Multi-Type Search**: Search recordings, releases, and artists
4. **Result Filtering**: Filter by confidence, date, country, etc.

### 5. Data Flow

#### 5.1 Search Workflow

```
User Selection -> Search Strategy -> MusicBrainz Query -> Results Processing -> User Review -> Metadata Application
```

#### 5.2 Metadata Mapping

```rust
// Map MusicBrainz data to Tomb song fields
impl From<Recording> for SongMetadata {
    fn from(recording: Recording) -> Self {
        SongMetadata {
            title: recording.title,
            artist: recording.artist_credit.primary_artist(),
            album_artist: recording.releases.first().and_then(|r| r.artist_credit.primary_artist()),
            // ... additional field mappings
        }
    }
}
```

#### 5.3 MusicBrainz Metadata Tracking

When applying MusicBrainz metadata to songs, the system tracks this information in the song's JSON metadata field:

```json
{
  "musicbrainz": {
    "recording_id": "uuid-here",
    "release_id": "uuid-here",
    "updated_at": "2024-01-15T10:30:00Z",
    "confidence_scores": {
      "title": 90.0,
      "artist": 95.0,
      "album": 85.0
    },
    "fields_updated": ["title", "artist", "album", "year"],
    "source": "musicbrainz_integration_v1"
  }
}
```

This enables:

- Tracking which songs have been enriched with MusicBrainz data
- Storing MusicBrainz IDs for future lookups and cross-referencing
- Recording confidence scores for each field update
- Audit trail of what was changed and when
- Avoiding re-processing songs that are already matched
- Rollback capability for incorrect updates

#### 5.4 Cover Art Workflow

```
MusicBrainz Release -> Cover Art Archive -> Download Images -> Upload to Blob Storage -> Update Song Records
```

### 6. Rate Limiting & Caching

#### 6.1 Rate Limiting

- Implement client-side request queuing
- Respect MusicBrainz 1 request/second limit
- Show progress indicators for bulk operations
- Handle rate limit errors gracefully

#### 6.2 Caching Strategy

- Cache MusicBrainz responses in Redis/database
- Cache cover art blob IDs to avoid re-downloads
- Implement cache invalidation for metadata updates
- Consider user-specific vs. global caching

### 7. Error Handling

#### 7.1 Network Errors

- Retry logic with exponential backoff
- Graceful degradation when MusicBrainz is unavailable
- Clear error messages for users

#### 7.2 Data Quality Issues

- Handle missing/incomplete MusicBrainz data
- Validate metadata before application
- Provide fallback strategies for poor matches

#### 7.3 Rate Limit Handling

- Queue requests when rate limited
- Show estimated wait times
- Allow users to cancel long-running operations

### 8. User Experience Considerations

#### 8.1 Progressive Enhancement

- Core functionality works without MusicBrainz
- Additional features appear when properly configured
- Seamless integration with existing workflows

#### 8.2 Feedback & Progress

- Real-time search progress indicators
- Confidence scores and match explanations
- Preview before applying changes
- Undo functionality for recent changes

#### 8.3 Bulk Operations

- Batch processing for album updates
- Progress tracking for large operations
- Ability to pause/resume bulk operations

### 9. Security & Privacy

#### 9.1 Configuration Management

- Store user agent string in server configuration
- Ensure user agent follows MusicBrainz guidelines
- No sensitive API keys to manage

#### 9.2 Data Privacy

- Only send necessary metadata to MusicBrainz
- Don't leak sensitive user information in queries
- Respect user preferences for external API usage

### 10. Testing Strategy

#### 10.1 Unit Tests

- MusicBrainz client functionality
- Query builder logic
- Metadata mapping accuracy
- Rate limiting behavior

#### 10.2 Integration Tests

- End-to-end search workflows
- Cover art download processes
- Error handling scenarios
- Configuration validation

#### 10.3 Manual Testing

- Real-world search scenarios
- Various music genres and languages
- Edge cases (missing metadata, multiple artists)
- Performance with large song collections

### 11. Implementation Phases

#### Phase 1: Grimoire Core Components ✅ COMPLETED

- [x] MusicBrainz client implementation (`grimoire/src/musicbrainz/client.rs`)
- [x] Basic data models (`grimoire/src/musicbrainz/models.rs`)
- [x] Query builder (`grimoire/src/musicbrainz/queries.rs`)
- [x] Rate limiter (`grimoire/src/musicbrainz/rate_limiter.rs`)
- [x] Service layer (`grimoire/src/musicbrainz/service.rs`)
- [x] Configuration management with serde defaults
- [x] Error types and handling
- [x] MusicBrainz metadata tracking in song JSON field
- [x] Integration with existing BulkSongUpdates system

#### Phase 2: CLI Testing & Validation 🔄 IN PROGRESS

- [x] CLI command for single song MusicBrainz search (`music musicbrainz search-song`)
- [x] CLI command for flexible search (optional title/artist/album/duration)
- [ ] CLI command for album/release search (`music musicbrainz search-album`) - **PARTIALLY IMPLEMENTED**
- [x] CLI command for database song search with confidence scoring
- [x] CLI command for metadata preview and application
- [x] CLI command for direct metadata application (test helper)
- [x] CLI command for configuration testing
- [x] Integration with existing song repository and BulkSongUpdates
- [x] Validate rate limiting and error handling (1 second between requests)
- [x] Test various search strategies and edge cases

**CURRENT STATUS**: Mid-testing phase. All core CLI commands implemented and tested with live MusicBrainz API. Discovered important UX considerations around live vs studio recordings and metadata accuracy.

**KEY FINDINGS**:

- MusicBrainz API integration working correctly
- Rate limiting properly implemented (1s between requests)
- Configuration system working (enabled/disabled states)
- Query building and result parsing functional
- Confidence scoring needs refinement for live recordings
- Need album-focused search for finding specific live performances
- Metadata application workflow needs careful review to avoid corrupting good existing data

**TEST RESULTS**:

- ✅ Basic API connectivity and authentication
- ✅ Song search with various artists (Nirvana, Lizzo, deadmau5, Amy Winehouse)
- ✅ Flexible search parameters (title, artist, album, duration optional)
- ✅ Rate limiting compliance
- ✅ JSON parsing and data model handling
- ✅ Configuration validation and defaults
- 🔄 Album search for "live at north sea jazz festival" recordings
- 🔄 Confidence scoring accuracy for live vs studio versions
- 🔄 Metadata preview and application workflow

#### Phase 3: Server API Layer ⏳ PENDING

- [ ] Server API endpoints with admin middleware
- [ ] Request/response schemas
- [ ] Route configuration and middleware setup
- [ ] Integration with grimoire service layer
- [ ] API error handling and validation

**DEPENDENCIES**: Waiting for CLI testing completion to finalize API surface

#### Phase 4: Frontend Integration ⏳ PENDING

- [ ] MusicBrainz admin API methods (following existing pattern)
- [ ] Configuration detection hooks
- [ ] Main MusicBrainz modal component
- [ ] Context menu integration (admin + enabled check)
- [ ] Search results and metadata preview UI

**DEPENDENCIES**: Requires Phase 3 API completion

#### Phase 5: Advanced Features & Polish ⏳ PENDING

- [ ] Custom search queries and query builder UI
- [ ] Cover art integration with existing image system
- [ ] Bulk operations and progress tracking
- [ ] Caching and performance optimization
- [ ] Comprehensive error handling and UX improvements
- [ ] Documentation and deployment guides

## 🎯 NEXT STEPS (for continuation)

### Immediate Tasks:

1. **Complete CLI album search** - Finish implementing `search-album` command to find "live at north sea jazz festival"
2. **Test complete metadata workflow** - Find correct Amy Winehouse live album and test full update process
3. **Refine confidence scoring** - Improve matching algorithm to handle live vs studio recordings better
4. **Document metadata safety guidelines** - Create guidelines for when to apply vs skip metadata updates

### Key Questions to Resolve:

1. **Metadata Safety**: How to avoid corrupting good existing data with incorrect MusicBrainz matches?
2. **Live Recording Handling**: Should live recordings be treated differently in matching algorithm?
3. **Selective Updates**: Which metadata fields should be updateable vs preserved (e.g., preserve album names for live recordings)?
4. **User Workflow**: What's the ideal UX for reviewing and approving metadata changes?

### Testing Priorities:

1. Find Amy Winehouse "Live at North Sea Jazz Festival" in MusicBrainz
2. Test metadata preview and application with correct live recording
3. Validate MusicBrainz metadata tracking in JSON field
4. Test cover art retrieval functionality
5. Validate confidence scoring improvements

### Configuration Status:

- ✅ App config integration complete
- ✅ Serde defaults implemented
- ✅ Enabled/disabled states working
- ✅ Config files updated (main + example)

### Current Test Database:

- Amy Winehouse live jazz festival recordings (need MusicBrainz enrichment)
- CONTAINER/YACKER album (already has good metadata - skip)
- Connection: `postgresql://postgres:supersecret@localhost:5432/webauthn_db`

### 12. Configuration Examples

#### Development Configuration

```json
{
  "musicbrainz": {
    "enabled": true,
    "user_agent": "tomb-music-dev/1.0.0 (dev@localhost)",
    "rate_limit_ms": 2000,
    "cache_ttl_hours": 24
  }
}
```

#### Production Configuration

```json
{
  "musicbrainz": {
    "enabled": true,
    "user_agent": "tomb-music-app/1.0.0 (contact@yourapp.com)",
    "rate_limit_ms": 1000,
    "cache_ttl_hours": 168,
    "max_concurrent_requests": 1
  }
}
```

This plan provides a comprehensive foundation for integrating MusicBrainz services while maintaining modularity, user control, and respect for API limitations. The phased approach allows for incremental development and testing of each component.
