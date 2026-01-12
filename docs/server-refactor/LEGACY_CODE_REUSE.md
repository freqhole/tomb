# legacy code reuse reference

this document identifies specific legacy server code that should be reused in the new server implementation. these implementations already work well and solve complex problems - no need to reimplement.

## files to reuse

### range request support

**location**: `legacyserver/src/static_filez/range_handler.rs`

**what it does**: handles http range requests for audio/video seeking

**key features**:
- parses `Range: bytes=X-Y` headers
- returns `206 Partial Content` responses
- handles multi-range requests
- content-range header generation
- critical for browser audio player seeking

**reuse in**: `server/src/blobs/range.rs` and `server/src/static_filez/range.rs`

**notes**:
- already handles edge cases (invalid ranges, out of bounds, etc)
- tested with various browsers and audio players
- essential for smooth audio playback experience

---

### static file serving

**location**: `legacyserver/src/static_filez/enhanced.rs`

**what it does**: serves static files with proper mime types, caching, compression

**key features**:
- mime type detection via mime_guess
- etag generation and validation
- conditional requests (if-none-match, if-modified-since)
- gzip/brotli compression negotiation
- cache-control headers
- range request integration

**reuse in**: `server/src/static_filez/handlers.rs`

**notes**:
- handles web app files (index.html, js, css, etc)
- proper cache headers for assets vs html
- integrates with range_handler for media files
- already handles spa routing (fallback to index.html)

---

### blob streaming

**location**: `legacyserver/src/blobs/handlers.rs`

**what it does**: streams media blobs from database with range support

**key features**:
- streams blob data efficiently (no full load to memory)
- integrates range request support
- proper content-type headers
- handles missing blobs gracefully

**reuse in**: `server/src/blobs/handlers.rs`

**notes**:
- critical for audio playback
- works with grimoire media_blobz
- already optimized for large files

---

### webauthn implementation

**location**: `legacyserver/src/auth/handlers.rs`

**what it does**: webauthn registration and authentication flows

**key features**:
- passkey registration (start/finish)
- authentication challenge (start/finish)
- credential storage and verification
- session management integration

**reuse in**: `server/src/auth/webauthn.rs` (if feature enabled)

**notes**:
- uses webauthn-rs crate
- **important**: legacy uses postgres, need to adapt for sqlite
- session storage strategy needs review
- feature-gate this for arm6 builds

---

### session middleware

**location**: `legacyserver/src/auth/middleware.rs`

**what it does**: authentication middleware for protected routes

**key features**:
- validates session cookies
- extracts authenticated user
- injects user into request extensions
- handles unauthorized responses

**reuse in**: `server/src/auth/middleware.rs`

**notes**:
- clean separation of concerns
- works with axum extractors
- adaptable to multiple auth methods (not just webauthn)

---

### upload handler

**location**: `legacyserver/src/upload/handlers.rs`

**what it does**: multipart file upload handling

**key features**:
- streams file uploads (no full load to memory)
- validates mime types
- generates sha256 checksums
- stores in grimoire media_blobz
- integrates with music metadata extraction

**reuse in**: `server/src/upload/handlers.rs`

**notes**:
- handles large file uploads efficiently
- already integrated with music scanner
- deduplication via sha256

---

### musicbrainz proxy

**location**: `legacyserver/src/musicbrainz/handlers.rs`

**what it does**: proxies musicbrainz api requests

**key features**:
- search releases
- get release details by mbid
- rate limiting compliance
- response caching

**reuse in**: `server/src/musicbrainz/handlers.rs`

**notes**:
- respects musicbrainz rate limits
- caching reduces api calls
- already works with grimoire musicbrainz module

---

## code patterns to reuse

### error handling pattern

**location**: `legacyserver/src/error.rs`

**pattern**: axum-compatible error responses with status codes

```rust
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            // map errors to status codes
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

---

### pagination pattern

**location**: throughout `legacyserver/src/media/`

**pattern**: consistent pagination for list endpoints

```rust
pub struct PaginationParams {
    page: Option<u32>,
    page_size: Option<u32>,
}

pub struct PaginatedResponse<T> {
    items: Vec<T>,
    total: u64,
    page: u32,
    page_size: u32,
    has_next: bool,
    has_prev: bool,
}
```

---

### auth extractor pattern

**location**: `legacyserver/src/auth/middleware.rs`

**pattern**: axum extractor for authenticated user

```rust
pub struct AuthenticatedUser(pub User);

#[async_trait]
impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
{
    type Rejection = ApiError;
    
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // extract from session or api key
    }
}
```

---

## what NOT to reuse

### do not reuse (out of scope)

- `legacyserver/src/websocket/` - no websockets in new server
- `legacyserver/src/sync/` - no sync protocol
- `legacyserver/src/photos/` - music domain only
- `legacyserver/src/notifications/` - no notification system
- `legacyserver/src/jobs/` - grimoire has new jobs system
- `legacyserver/src/maintenance/` - cli only, not http
- `legacyserver/src/analytics/` - grimoire analytics module instead
- `legacyserver/src/thumbnails/` - grimoire has thumbnail support
- `legacyserver/src/logging/access_log.rs` - reassess need

### do not reuse (anti-patterns)

- direct sqlx usage - use grimoire apis instead
- complex trait hierarchies - keep it simple
- struct duplication - reuse grimoire types
- overly abstract service layers - direct grimoire calls
- half-baked features - only essential functionality

---

## reuse strategy

1. **copy and adapt**: copy working code files to new server structure
2. **simplify**: remove unnecessary abstractions while keeping core logic
3. **integrate grimoire**: replace direct db calls with grimoire api calls
4. **preserve tests**: if legacy has tests for the code, adapt them
5. **document assumptions**: note any edge cases or quirks in comments

---

## migration checklist

- [ ] range request handler copied and tested
- [ ] static file serving copied and tested
- [ ] blob streaming copied and tested
- [ ] webauthn flows adapted for sqlite
- [ ] session middleware adapted for multiple auth methods
- [ ] upload handler adapted for grimoire
- [ ] musicbrainz proxy adapted for grimoire
- [ ] error handling pattern adapted
- [ ] pagination pattern standardized
- [ ] auth extractor pattern implemented

---

## notes

- legacy code represents months of debugging and edge case discovery
- reusing proven implementations saves time and reduces bugs
- adaptation is fine, rewriting from scratch is wasteful
- when in doubt, copy the working code and simplify later
- document any changes from legacy in commit messages
