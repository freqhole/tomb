# server refactor plan

## executive summary

complete rewrite of server package using refactored grimoire library. legacy server has ~60+ routes with mixed concerns (websockets, sync, photos, notifications). new server focuses exclusively on music domain with ~35-40 essential http routes.

**core principles**:

- no sqlx in server - grimoire handles all database operations
- reuse grimoire types directly - no struct duplication
- prefer POST over GET for queries to avoid query param issues
- reuse working legacy code (range requests, static file serving)
- music domain only (no photos, websockets, sync)
- nearly all routes require authenticated user
- breaking changes acceptable for cleaner api

**key decisions**:

- legacyserver becomes reference only (no need to maintain builds)
- har recording recommended early to identify actual webapp usage
- webauthn feature-gated for arm6 compatibility
- session storage in sqlite (not memory/redis)
- admin operations (user mgmt, invite codes) via cli only
- typescript codegen deferred until core functionality complete

**implementation workflow**:

1. **foundation first**: create server skeleton, app state, error handling
2. **auth second**: feature-flagged webauthn, api keys, invite codes, viewer role
3. **codegen investigation**: test codegen approach with 2-3 types before bulk routes
4. **establish patterns**: implement 2-3 sample routes + static file serving for testing
5. **grimoire prep**: move fetch_music, audit APIs (can overlap with patterns)
6. **rapid implementation**: grimoire wrappers should be shallow/simple
7. **see `GRIMOIRE_TO_SERVER_ROUTES.md` for complete checklist**

## overview

move `server/` → `legacyserver/`, create new `server/` package using refactored `grimoire/` library. focus on music domain only. no websockets, no sync, no photos. simple json api with typescript client generation.

## goals

- clean separation: no sqlx in server, all db logic in grimoire
- minimal feature set: only essential music api routes
- simple auth: webauthn (optional), api keys, invite codes
- typescript codegen: generate zod schemas + fetch client (deferred)
- single binary: eventually combine cli + server into `freqhole` binary

## phase 0: preparation & inventory

### 0.1: move legacy server

- [ ] `mv server/ legacyserver/`
- [ ] update `Cargo.toml` workspace members
- [ ] legacyserver is now reference only (no need to maintain builds)

### 0.2: feature inventory from legacy server

#### modules to migrate (music domain only)

- `auth/` - authentication handlers, middleware, routes (4 files)
- `media/` - songs, playlists, filters, genres, search (10 files) - **note: mixed app-wide and music domain, needs separation**
  - **problem**: legacy `media/` conflates app-wide media_blobz with music-specific operations
  - **solution**: new server should have clear separation:
    - `server/src/blobs/` - app-wide blob streaming (reuses grimoire media_blobz)
    - `server/src/music/` - music domain routes only (songs, albums, artists, playlists)
- `musicbrainz/` - musicbrainz lookup api (3 files)
- `static_filez/` - static file serving with range support (3 files) - **reuse existing code**
- `health/` - health check endpoints (3 files)
- `blobs/` - media blob streaming (3 files) - **reuse existing range request code**
- `upload/` - file upload handling (4 files)
- `download/` → move to grimoire as `fetch_music` (4 files) - **no yt-dlp mentions in code**

#### modules to leave behind (out of scope)

- `websocket/` - websocket connection management (3 files) ❌
- `sync/` - device sync protocol (3 files) ❌
- `photos/` - photo domain (2 files) ❌
- `notifications/` - notification infrastructure (5 files) ❌
- `analytics/` - already in grimoire, may need minimal server routes
- `jobs/` - job queue management (5 files) - grimoire has new jobs system
- `maintenance/` - maintenance tasks (2 files) - grimoire has maintenance
- `logging/` - access logging (2 files) - reassess need
- `thumbnails/` - thumbnail generation (3 files) - grimoire has this

#### core infrastructure files

- `main.rs` - binary entry point
- `startup.rs` - app state initialization (444 lines)
- `routes.rs` - route composition
- `error.rs` - error types
- `storage.rs` - storage utilities

#### legacy dependencies to remove

- websocket dependencies (async-tungstenite, etc)
- notification dependencies (postgres, etc)
- sync-specific dependencies
- photo-specific dependencies

### 0.3: enumerate all http routes

extract all routes from legacy server to determine what's actually needed:

#### auth routes (`auth/routes.rs`)

- `POST /login_start/{username}` - start webauthn login
- `POST /login_finish` - finish webauthn login
- `POST /logout` - logout
- `GET /api/whoami` - get current user
- `POST /register_start/{username}` - start webauthn registration (if enabled)
- `POST /register_finish` - finish webauthn registration (if enabled)

#### media routes (`media/songs.rs` - 2588 lines!)

- `GET /api/media/songs` - list songs with filters/pagination
- `GET /api/media/songs/{song_id}` - get single song
- `PUT /api/media/songs/{song_id}` - update song metadata
- `PUT /api/media/songs/{song_id}/preferences` - update user preferences
- `PUT /api/media/songs/preferences/bulk` - bulk update preferences
- `GET /api/media/artists` - list artists
- `POST /api/media/artists` - filter artists
- `GET /api/media/artists/{artist_name}` - get artist by name
- `GET /api/media/artists/{artist}/songs` - get artist songs
- `GET /api/media/playlists` - list playlists
- `POST /api/media/playlists` - create playlist
- `GET /api/media/playlists/{playlist_id}` - get playlist
- `PUT /api/media/playlists/{playlist_id}` - update playlist
- `DELETE /api/media/playlists/{playlist_id}` - delete playlist
- `GET /api/media/playlists/{playlist_id}/songs` - get playlist songs
- `POST /api/media/playlists/{playlist_id}/songs` - add songs to playlist
- `DELETE /api/media/playlists/{playlist_id}/songs` - remove songs
- `PUT /api/media/playlists/{playlist_id}/songs/move` - move song
- `PUT /api/media/playlists/{playlist_id}/reorder` - reorder playlist
- `GET /api/media/playlists/summaries` - get playlist summaries
- `GET /api/media/albums` - get album summaries
- `POST /api/media/albums` - filter albums
- `POST /api/media/albums/tracks` - get album tracks (post)
- `GET /api/media/albums/{album}/tracks` - get album tracks
- `POST /api/media/albums/{album}/create-playlist` - create playlist from album
- `POST /api/media/albums/favorite` - bulk favorite album
- `GET /api/media/albums/{album}/favorite-status` - album favorite status
- `POST /api/media/playlists/{playlist_id}/favorite-songs` - bulk favorite playlist

#### playlist preference routes (`media/playlists.rs`)

- `PATCH /api/media/playlists/{playlist_id}/preferences` - update playlist preference
- `GET /api/media/playlists/preferences` - get user playlist preferences
- `GET /api/media/playlists/user-context` - get playlists with user context
- `PUT /api/media/playlists/{playlist_id}/ownership` - set playlist owner
- `POST /api/media/playlists/{playlist_id}/ownership/transfer` - transfer ownership

#### music search/filter routes (`media/search.rs`, `media/filters.rs`, `media/genres.rs`)

- `GET /api/music/search` - search songs
- `GET /api/music/filters/tags` - get all tags
- `GET /api/music/filters/genres` - get all genres
- `GET /api/music/filters/albums` - get all albums
- `GET /api/music/filters/artists` - get all artists
- `GET /api/music/filters/years` - get all years
- `GET /api/music/genres` - list genres with stats
- `GET /api/music/genres/{genre_id}` - get genre by id

#### musicbrainz routes (`musicbrainz/routes.rs`)

- `GET /api/musicbrainz/search/release` - search musicbrainz releases
- `GET /api/musicbrainz/release/{mbid}` - get release by mbid

#### blob routes (`blobs/routes.rs`)

- `GET /api/blobs/{blob_id}` - stream media blob
- `HEAD /api/blobs/{blob_id}` - get blob metadata

#### upload routes (`upload/routes.rs`)

- `POST /api/upload/media` - upload media file

#### download/fetch routes (`download/routes.rs`)

- `POST /api/download/urls` - download from url (yt-dlp)
- `GET /api/download-job-status/{job_id}` - get download job status

#### health routes (`health/routes.rs`)

- `GET /health` - basic health check
- `GET /health/ready` - readiness check
- `GET /health/live` - liveness check

#### static file routes (`static_filez/`)

- `GET /*path` - serve static files with range support

#### analytics routes (if needed)

- assess which analytics routes are actually needed vs handled in grimoire

#### route count summary

- ~60+ routes in legacy server
- many are half-baked or redundant
- need to reduce to essential set (~30-40 routes)

## phase 1: new server foundation

### 1.1: create new server package

```
server/
├── Cargo.toml
├── src/
│   ├── main.rs           # binary entry, arg parsing
│   ├── lib.rs            # library exports
│   ├── server.rs         # server startup/shutdown
│   ├── state.rs          # app state
│   ├── error.rs          # error types
│   └── routes.rs         # route composition
```

#### dependencies (minimal)

- axum - web framework
- tokio - async runtime
- tower-http - middleware (cors, compression, tracing)
- serde/serde_json - serialization
- grimoire - domain logic
- webauthn-rs - auth (feature-gated)
- time - timestamps
- tracing/tracing-subscriber - logging

#### features

```toml
[features]
default = ["webauthn"]
webauthn = ["dep:webauthn-rs"]
```

### 1.2: app state design

```rust
pub struct AppState {
    // no db pool! grimoire handles connections
    config: Arc<GrimoireConfig>,
    webauthn: Option<Arc<Webauthn>>, // if feature enabled
    session_store: Arc<SessionStore>,
}
```

### 1.3: error handling

- simple error enum
- map grimoire errors to http status codes
- consistent json error responses

### 1.4: middleware stack

- request logging
- authentication middleware (require_auth)
- compression
- cors (configurable)

## phase 2: authentication system

### 2.1: auth module structure

```
server/src/auth/
├── mod.rs          # public api
├── handlers.rs     # route handlers
├── middleware.rs   # auth middleware
├── session.rs      # session management
└── webauthn.rs     # webauthn logic (if feature enabled)
```

### 2.2: authentication methods

#### method 1: webauthn (feature-gated)

- start registration → finish registration
- start authentication → finish authentication
- session cookie on success

#### method 2: api key

- `Authorization: Bearer <api_key>` header
- stored in grimoire users table
- validate via grimoire
- **note: needs db migration for api_key column**
- respects user role permissions

#### method 3: invite code cookie

- `POST /auth/invite` with code in body
- validates invite code via grimoire
- if webauthn disabled: issue session cookie directly
- if webauthn enabled: require passkey registration
- **note: webauthn-rs with sqlite (not postgres) - needs migration strategy**

### 2.3: user roles

extend grimoire user roles to support permissions:

**existing roles**:

- admin - full access to everything
- user - standard user access

**new role to add**:

- viewer - read-only access
  - can browse/search/play music
  - can favorite/rate music
  - **cannot** upload/fetch music
  - **cannot** edit music metadata
  - **cannot** create/edit playlists (maybe can favorite existing playlists?)

**implementation**:

- add to grimoire `UserRole` enum
- middleware checks role for mutation routes
- query routes generally available to all roles

### 2.4: auth routes

- `POST /auth/invite` - redeem invite code
- `POST /auth/register/start` - start webauthn registration (if enabled)
- `POST /auth/register/finish` - finish webauthn registration (if enabled)
- `POST /auth/login/start` - start webauthn login (if enabled)
- `POST /auth/login/finish` - finish webauthn login (if enabled)
- `POST /auth/logout` - logout
- `GET /auth/whoami` - current user info (includes role)

## phase 3: typescript codegen investigation

**important**: investigate codegen approach early to avoid structural pain later

### 3.1: early investigation (do during/after auth phase)

- evaluate crates: `ts-rs`, `typeshare`, `specta`
- determine: does codegen affect how we structure types?
- test with 2-3 example types from grimoire
- understand: can we use grimoire types directly or need wrapper types?
- document findings before implementing many routes

**questions to answer**:

- do grimoire types need #[derive(TypeScript)] annotations?
- can we generate from grimoire types or only server types?
- how does it handle nested/generic types?
- what's the impact on existing grimoire code?

**workflow**:

- investigate during/after auth implementation (phase 2)
- test with sample types before phase 6 (bulk routes)
- if codegen needs wrapper types, establish pattern early
- if codegen works with grimoire types directly, proceed as planned

### 3.2: document findings

- create small test to validate approach
- document which crate to use and why
- document type annotation strategy
- establish wrapper pattern if needed
- defer full implementation to phase 8

## phase 4: establish patterns with sample routes

### 4.1: music module structure

clear separation of concerns:

```
server/src/
├── blobs/          # app-wide blob operations (not music-specific)
│   ├── mod.rs
│   ├── handlers.rs # stream handler
│   └── range.rs    # range request support
└── music/          # music domain only
    ├── mod.rs
    ├── songs.rs    # song crud, query, search
    ├── albums.rs   # album summaries, tracks
    ├── artists.rs  # artist list, artist songs
    ├── playlists.rs # playlist crud, songs, reorder
    ├── search.rs   # unified music search
    └── filters.rs  # filter/facet endpoints
```

**key principle**: `blobs/` is domain-agnostic (works for any blob - music, future photos, etc).
`music/` is strictly music domain operations that happen to reference blobs.

### 4.2: implement 2-3 sample routes

- `POST /api/songs/query` - query songs (uses grimoire::music::crud::query_songs)
- `POST /api/playlists/create` - create playlist (uses grimoire::music::crud::create_playlist)
- `POST /api/favorites/set` - set favorite (uses grimoire::music::users::FavoritesService)

### 4.3: verify patterns

- handlers reuse grimoire request/response types directly
- error handling maps grimoire errors to HTTP responses consistently
- auth middleware injects user and enforces roles
- CLI plumbing for these grimoire calls exists and works
- codegen approach works (if investigated in phase 3)

### 4.4: static file serving (for testing)

**important**: implement early to enable testing with simple HTML pages

```
server/src/static_filez/
├── mod.rs
└── handlers.rs
```

- serve static HTML/JS/CSS files for testing routes
- basic mime type detection
- configurable enable/disable flag
- configurable directory path
- **reuse legacy static file handler** (see `LEGACY_CODE_REUSE.md`)
- range request support NOT needed yet (defer to phase 7 if needed)

routes:

- `GET /*path` - serve static files (only if enabled in config)

### 4.5: validation criteria

- shallow wrappers work well
- grimoire types reused directly (or codegen wrapper approach validated)
- error handling consistent
- auth middleware works
- role-based permissions work (viewer can't create playlist)
- static file serving works for testing HTML pages
- **once validated, proceed to phase 6 for bulk implementation**

## phase 5: grimoire preparation

**note**: can be done in parallel with phase 4 or deferred until needed

### 5.1: move download/fetch_music to grimoire

- [ ] create `grimoire/src/music/fetch_music/` module
- [ ] move external command logic from `server/download/jobs.rs`
- [ ] integrate with grimoire jobs system
- [ ] expose public API: `fetch_from_url()`, `get_fetch_job()`, etc
- [ ] remove all sqlx from this code (use grimoire db layer)
- [ ] add config fields:
  - `fetch_music.enabled: bool` - feature toggle
  - `fetch_music.output_dir: PathBuf` - where files are stored
  - `fetch_music.precheck_command: String` - command for validation
  - `fetch_music.fetch_command: String` - command for download
- [ ] **never mention yt-dlp in code - use generic "external command" terminology**
- [ ] **add CLI plumbing commands**: `cli/src/plumbing/fetch_music.rs`
  - `fetch url <url>` - fetch from url
  - `fetch status <job_id>` - check job status
  - `fetch list` - list fetch jobs

### 5.2: audit existing grimoire api (avoid duplication!)

**critical**: grimoire already has most functionality. audit before adding anything new.

existing grimoire apis:

**music::crud** (ALREADY HAS):

- [ ] `query_songs()` - unified query with FTS, filters, pagination ✓
- [ ] `query_artists()` - artist queries with stats ✓
- [ ] `query_albums()` - album queries with metadata ✓
- [ ] `query_genres()` - genre queries ✓
- [ ] `search_songs()` - full-text search ✓
- [ ] `list_songs_by_artist()`, `list_albums_by_artist()`, etc ✓
- [ ] `update_songs()` - bulk song updates ✓
- [ ] playlist crud: create, update, delete, add_songs, remove_songs, reorder ✓
- [ ] **note**: has both `list_songs()` AND `query_songs()` - we only need query! remove list!

**music::users** (ALREADY HAS):

- [ ] `FavoritesService` - set/get favorites for songs, albums, artists, playlists ✓
- [ ] `RatingsService` - set/get ratings with stats ✓

**music::analytics** (ALREADY HAS):

- [ ] `get_user_listening_history()` - listening history ✓
- [ ] `get_combined_feed()` - activity feed ✓
- [ ] `get_recent_listens()`, `get_recent_favorites()`, `get_recent_albums()` ✓
- [ ] `get_song_play_analytics()`, `get_album_play_count()`, etc ✓
- [ ] `get_overview_stats()`, `get_top_songs()`, `get_top_artists()` ✓

**users::UserService** (ALREADY HAS):

- [ ] user crud, invite codes, sessions ✓

**media_blobz** (ALREADY HAS):

- [ ] blob storage and retrieval ✓

**jobs** (ALREADY HAS):

- [ ] job queue system ✓

### 5.3: identify actual gaps (minimal additions only)

only add new apis if genuinely missing:

- [ ] **audit first**: review grimoire public api against server route needs
- [ ] **prefer existing**: use `query_songs()` not `list_songs()` - one api not two!
- [ ] **document duplication**: identify and remove redundant functions (list vs query)
- [ ] **only if needed**: add new apis for genuinely missing functionality
- [ ] **cli plumbing**: for ANY new grimoire api, add cli wrapper immediately
      **important**: for each new grimoire public api function, add corresponding CLI plumbing command.
      this ensures grimoire functionality is testable via CLI and keeps cli/server in sync.

**workflow before adding new code**:

1. check if grimoire already has this functionality
2. if exists, use it - DO NOT create alternative version
3. if missing, add to grimoire with cli plumbing
4. update server to use grimoire api

**rule**: every new grimoire public api needs cli plumbing wrapper to ensure testability

**critical: verify query vs list functions**:

- we know `query_songs()` can replace `list_songs()` ✓
- for other entities (artists, albums, playlists, genres), **verify query functions return same data as list**
- investigate each case before removing list functions
- only remove list functions after confirming query functions are equivalent
- document any differences discovered

## phase 6: rapid route implementation

**note: should be straightforward after patterns established in phase 4**

### 6.1: core song routes

- `POST /api/songs/query` - query/filter/search songs (POST with body, not GET)
- `POST /api/songs/get` - get song by id (or keep GET if simple)
- `PUT /api/songs/{id}` - update song metadata
- `POST /api/songs/delete` - bulk delete songs (POST with body)
- `POST /api/songs/preferences/bulk` - bulk update preferences

**note: prefer POST over GET for all list/query endpoints to avoid query param issues**

### 6.2: artist routes

- `POST /api/artists/query` - query/list artists
- `POST /api/artists/search` - search artists
- `POST /api/artists/get` - get artist by name
- `POST /api/artists/songs` - get artist songs

### 6.3: album routes

- `POST /api/albums/query` - query/list albums
- `POST /api/albums/search` - search albums
- `POST /api/albums/tracks` - get album tracks
- `POST /api/albums/create-playlist` - create playlist from album
- `POST /api/albums/favorite` - bulk favorite album
- `POST /api/albums/favorite-status` - album favorite status

### 6.4: playlist routes

- `POST /api/playlists/query` - query/list playlists
- `POST /api/playlists/create` - create playlist
- `POST /api/playlists/get` - get playlist by id
- `POST /api/playlists/update` - update playlist
- `POST /api/playlists/delete` - delete playlist
- `POST /api/playlists/songs` - get playlist songs
- `POST /api/playlists/add-songs` - add songs
- `POST /api/playlists/remove-songs` - remove songs
- `POST /api/playlists/reorder` - reorder songs
- `POST /api/playlists/preferences` - update preference
- `POST /api/playlists/transfer-ownership` - transfer ownership

### 6.5: search/filter routes

- `POST /api/search` - unified search
- `POST /api/filters/tags` - all tags
- `POST /api/filters/genres` - all genres
- `POST /api/filters/albums` - all albums
- `POST /api/filters/artists` - all artists
- `POST /api/filters/years` - all years

### 6.6: analytics/history routes

- `POST /api/history/listening` - get listening history
- `POST /api/feed/activity` - get activity feed
- `POST /api/analytics/event` - record event (or use grimoire directly)

## phase 7: supporting features

### 7.1: blob streaming

```
server/src/blobs/
├── mod.rs
├── handlers.rs    # stream handler
└── range.rs       # range request support
```

- `GET /api/blobs/{id}` - stream blob
- `HEAD /api/blobs/{id}` - blob metadata
- support range requests for audio seeking
- **reuse existing range request implementation from legacyserver**

### 7.2: file upload

```
server/src/upload/
├── mod.rs
└── handlers.rs
```

- `POST /api/upload` - multipart file upload
- store via grimoire media_blobz
- extract metadata, create song via grimoire

### 7.3: musicbrainz proxy

```
server/src/musicbrainz/
├── mod.rs
└── handlers.rs
```

- `GET /api/musicbrainz/search/release` - search
- `GET /api/musicbrainz/release/{mbid}` - get release
- call grimoire musicbrainz module

### 7.4: fetch music (yt-dlp)

```
server/src/fetch/
├── mod.rs
└── handlers.rs
```

- `POST /api/fetch` - fetch from url
- `GET /api/fetch/jobs/{id}` - job status
- call grimoire fetch_music module

### 7.5: static file range requests (optional)

**note**: basic static file serving implemented in phase 4. this adds range request support if needed.

- add range request support to static_filez (see `LEGACY_CODE_REUSE.md`)
- only needed if serving large static media files
- for HTML/JS/CSS, range requests not required

### 7.6: health checks

```
server/src/health/
├── mod.rs
└── handlers.rs
```

- `GET /health` - basic health
- `GET /health/ready` - readiness (check db)
- `GET /health/live` - liveness

### 7.7: jobs status

```
server/src/jobs/
├── mod.rs
└── handlers.rs
```

- `POST /api/jobs/status` - get job status (for fetch_music, etc)
- `POST /api/jobs/list` - list user's jobs
- async job tracking (not realtime/websocket, just polling)

## phase 8: typescript client generation (deferred)

**note**: full implementation deferred until core functionality complete. Investigation done in phase 3.

### 8.1: setup typescript codegen

- choose crate based on investigation findings
- prefer: derive macros on request/response types
- output: `server/codegen/client.ts`

### 8.2: annotate types

add typescript derive to all request/response types:

```rust
#[derive(Serialize, Deserialize, TypeScriptType)]
pub struct CreateSongRequest { ... }
```

**note**: may need to add annotations to grimoire types if codegen investigation shows that's the best approach

### 8.3: generate zod schemas

- generate zod schemas from rust types
- runtime validation for requests
- type safety for responses

### 8.4: generate fetch client

generate typescript client:

```typescript
export const api = {
  songs: {
    query: (params: SongQueryParams) => fetch(...),
    get: (id: string) => fetch(...),
    // ...
  },
  // ...
}
```

### 8.5: codegen workflow

- `cargo build --features codegen` generates types
- commit generated `client.ts` to repo
- ci verifies generated code is up to date

## phase 9: configuration & deployment

### 9.1: server configuration

extend `GrimoireConfig`:

```jsonc
{
  "server": {
    "host": "127.0.0.1",
    "port": 3000,
    "static_files_enabled": true,
    "static_files_dir": "./static",
    "cors_origins": ["http://localhost:5173"],
  },
  "auth": {
    "webauthn_enabled": true,
    "webauthn_origin": "http://localhost:3000",
    "api_keys_enabled": true,
    "invite_codes_enabled": true,
  },
}
```

**static file config**:

- `static_files_enabled`: bool - enable/disable static file serving (default: true)
- `static_files_dir`: path - directory to serve files from (required if enabled)

### 9.2: cli + server binary

eventually merge into single `freqhole` binary:

```rust
// main.rs
enum Command {
  Server(ServerArgs),
  Music(MusicAction),
  Users(UserAction),
  // ... other cli commands
}
```

### 9.3: deployment artifacts

- single binary: `freqhole`
- `freqhole server` - start server
- `freqhole music scan` - run cli commands

## phase 10: testing & migration

### 10.1: integration tests

**note: lean on cli integration tests, no need for extensive server tests**

- minimal smoke tests only
- auth flow verification
- key route functionality

### 10.2: har recording approach (do this early!)

**important: do this before phase 4 (building routes) to identify priorities**

use browser devtools to capture real webapp usage:

#### recording steps

1. start legacyserver with current web app
2. open browser devtools → network tab
3. click through all webapp features:
   - login/register
   - browse songs, albums, artists
   - play music (check blob streaming)
   - create/edit playlists
   - favorite songs/albums
   - search functionality
   - upload files
   - fetch from url (yt-dlp)
   - user preferences
4. export as har file (right-click → "save all as har")

#### analysis steps

1. parse har file to extract all request urls
2. group by route pattern
3. count frequency of each route
4. identify critical paths (high frequency)
5. identify unused routes (never called)

#### example script

```python
import json
from collections import Counter
from urllib.parse import urlparse

with open('webapp-usage.har') as f:
    har = json.load(f)

routes = []
for entry in har['log']['entries']:
    url = urlparse(entry['request']['url'])
    path = url.path
    method = entry['request']['method']
    routes.append(f"{method} {path}")

# frequency analysis
freq = Counter(routes)
for route, count in freq.most_common():
    print(f"{count:3d}  {route}")
```

#### outcome

- prioritize implementing routes with count > 10
- consider skipping routes with count == 0
- validate assumptions about "essential" routes
- helps identify gaps after implementing grimoire public api routes
- **workflow: implement grimoire-backed routes first, then har analysis to find gaps**

### 10.3: migration checklist

compare legacy vs new implementation:

- [ ] route parity (essential routes only)
- [ ] auth flows working
- [ ] song crud working
- [ ] playlist crud working
- [ ] blob streaming working
- [ ] upload working
- [ ] search/filters working
- [ ] webapp compatibility

### 10.4: migration checklist (duplicate - remove?)

compare legacy vs new implementation:

- [ ] route parity (essential routes only)
- [ ] auth flows working
- [ ] song crud working
- [ ] playlist crud working
- [ ] blob streaming working
- [ ] upload working
- [ ] search/filters working
- [ ] webapp compatibility

**note: breaking changes are acceptable**

## phase 11: cleanup & documentation

### 11.1: remove legacy code

- [ ] delete `legacyserver/` once migration complete
- [ ] delete `legacylib/` once grimoire migration complete
- [ ] delete `legacycli/` once cli migration complete

### 11.2: minimal documentation

- [ ] configuration reference
- [ ] deployment examples (systemd, docker)

## technical details

### request/response patterns

all routes follow consistent patterns:

#### grimoire types - reuse directly in server

```rust
// in grimoire/src/music/crud/songs.rs
#[derive(Serialize, Deserialize)]
pub struct CreateSongRequest { ... }
pub async fn create_song(req: CreateSongRequest) -> GrimoireResult<Song> { ... }
```

#### server handlers - use grimoire types directly

```rust
// in server/src/music/songs.rs
use grimoire::music::CreateSongRequest;

pub async fn create_song(
  State(state): State<AppState>,
  Extension(user): Extension<AuthenticatedUser>,
  Json(req): Json<CreateSongRequest>,  // use grimoire type directly!
) -> Result<Json<Song>, ApiError> {
  let song = grimoire::music::create_song(req).await?;
  Ok(Json(song))
}
```

**important: reuse grimoire request/response types directly - no duplication!**

only create server-specific types when:

- adding http-specific fields (pagination metadata, etc)
- extending grimoire types with additional context

prefer composition over conversion:

```rust
// if you need to extend a grimoire type
#[derive(Serialize)]
pub struct SongWithContext {
  #[serde(flatten)]
  song: Song,  // grimoire type
  user_context: UserContext,  // server addition
}
```

**goal: absolute minimal rust code for type mapping**

### error handling pattern

```rust
// server/src/error.rs
pub enum ApiError {
  Grimoire(GrimoireError),
  Unauthorized,
  NotFound,
  BadRequest(String),
}

impl IntoResponse for ApiError {
  fn into_response(self) -> Response {
    let (status, message) = match self {
      ApiError::Grimoire(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
      ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
      // ...
    };
    (status, Json(json!({ "error": message }))).into_response()
  }
}
```

### auth middleware pattern

```rust
// server/src/auth/middleware.rs
pub async fn require_auth(
  State(state): State<AppState>,
  mut req: Request<Body>,
  next: Next,
) -> Result<Response, ApiError> {
  // check session cookie or api key
  let user = validate_auth(&state, &req).await?;
  req.extensions_mut().insert(AuthenticatedUser(user));
  Ok(next.run(req).await)
}
```

## dependencies audit

### keep (essential)

- axum - web framework
- tokio - async runtime
- tower-http - http middleware
- serde/serde_json - serialization
- grimoire - domain logic (all new grimoire apis must have cli plumbing)
- time - timestamps
- tracing/tracing-subscriber - logging

### conditional (feature-gated)

- webauthn-rs - webauthn auth (behind feature flag)

### add (new)

- ts-rs or specta - typescript codegen
- tower-sessions - session management
- argon2 - password hashing (for api keys)

### remove (from legacy)

- sqlx - no direct db access
- async-tungstenite - no websockets
- testcontainers - reassess need
- all photo/sync/notification deps

## questions answered

- **analytics routes**: listening history + activity feed via http; event recording via grimoire
- **jobs api**: yes, expose job status via http (polling, not websocket) for fetch_music
- **maintenance**: cli only, not http
- **user management**: cli only for admin operations
- **invite codes**: cli only for generation
- **typescript codegen**: defer until later, not immediate priority
- **session storage**: sqlite (needs migration strategy for webauthn-rs)
- **rate limiting**: not needed
- **auth**: nearly all routes require authenticated user (only a few exceptions)

## open questions remaining

- [ ] webauthn-rs migration from postgres to sqlite - how to handle?
- [ ] which grimoire types need http extensions vs direct reuse?
- [ ] har analysis: when exactly to perform (after phase 2? 3? 4?)
- [ ] verify query functions can fully replace list functions for all entities
- [ ] viewer role: can they favorite existing playlists or fully read-only?
- [ ] codegen investigation: wrapper types or annotate grimoire types?

## success criteria

- [ ] no sqlx dependencies in server package
- [ ] all routes use grimoire public api
- [ ] typescript client generated from rust types
- [ ] single `freqhole` binary with server + cli
- [ ] <40 http routes (down from 60+)
- [ ] all integration tests passing
- [ ] webapp works with new server
- [ ] performance comparable to legacy
- [ ] webauthn feature can be disabled
- [ ] simple api key auth works
- [ ] invite code auth works

## implementation notes

### route reduction strategy

legacy server has 60+ routes, many redundant or unused. reduce by:

- combine similar operations (bulk endpoints instead of many singles)
- remove websocket-specific routes
- remove sync-specific routes
- remove photo-specific routes
- remove half-baked analytics routes
- simplify query apis (fewer filter combinations)

### grimoire integration pattern

no direct sqlx usage in server:

```rust
// ❌ bad: direct db access
let pool = state.db_pool();
let song = sqlx::query_as("SELECT * FROM songz WHERE id = ?")
  .fetch_one(pool).await?;

// ✅ good: grimoire api
let song = grimoire::music::get_song(song_id).await?;
```

### auth simplification

three auth methods, all optional:

1. webauthn (feature = "webauthn") - passkey auth
2. api key (always available) - bearer token
3. invite code (always available) - simple cookie

middleware checks all methods in order.

### pagination consistency

all list endpoints use same pagination:

```rust
pub struct PaginationParams {
  page: Option<u32>,      // default: 1
  page_size: Option<u32>, // default: 50, max: 500
}

pub struct PaginatedResponse<T> {
  items: Vec<T>,
  total: u64,
  page: u32,
  page_size: u32,
  has_next: bool,
}
```

### typescript codegen workflow

1. add `#[derive(TypeScriptType)]` to request/response types
2. run `cargo build --features codegen`
3. generates `server/codegen/client.ts` with:
   - typescript interfaces
   - zod schemas
   - typed fetch wrappers
4. commit generated file
5. ci checks generated file is current

### session management

simple session cookie approach:

- cookie name: `freqhole_session`
- storage: sqlite (via grimoire)
- duration: 30 days (configurable)
- secure flag in production
- httponly always

### range request support

critical for audio streaming:

```rust
// handle: Range: bytes=0-1023
// respond: Content-Range: bytes 0-1023/54321
// status: 206 Partial Content
```

required for seek in browser audio players.

## phase checklist

### phase 0: preparation (current)

- [x] create refactor plan
- [ ] **optional: har recording of legacy webapp to identify active routes**
- [ ] move server → legacyserver
- [ ] update workspace config

### phase 1: foundation

- [ ] create new server package
- [ ] setup dependencies
- [ ] app state struct
- [ ] error handling
- [ ] middleware stack

### phase 2: auth

- [ ] auth module structure
- [ ] webauthn (feature-gated)
- [ ] api key auth
- [ ] invite code auth
- [ ] middleware
- [ ] routes

### phase 3: codegen investigation

- [ ] test ts-rs, typeshare, or specta
- [ ] determine wrapper types vs annotate grimoire
- [ ] document findings

### phase 4: establish patterns

- [ ] implement 2-3 sample routes
- [ ] verify shallow wrapper approach
- [ ] validate codegen approach
- [ ] implement static file serving (for testing with HTML)
  - [ ] add static_files_enabled + static_files_dir to config
  - [ ] basic static file handler (no range requests yet)
  - [ ] serve simple HTML test pages

### phase 5: grimoire prep

- [ ] move download to grimoire as fetch_music
- [ ] verify grimoire api coverage
- [ ] add missing grimoire apis

### phase 6: music api routes

- [ ] songs routes
- [ ] albums routes
- [ ] artists routes
- [ ] playlists routes
- [ ] search routes
- [ ] filters routes

### phase 7: supporting features

- [ ] blob streaming
- [ ] file upload
- [ ] musicbrainz proxy
- [ ] fetch music routes
- [ ] static file range requests (optional - only if needed)
- [ ] health checks

### phase 8: typescript codegen (deferred)

- [ ] setup codegen (ts-rs or specta)
- [ ] annotate types
- [ ] generate schemas
- [ ] generate client
- [ ] ci integration

**note: not immediate priority, defer until core functionality complete**

### phase 9: configuration & deployment

- [ ] server config
- [ ] merge cli + server binary
- [ ] deployment artifacts

### phase 10: testing & migration

- [ ] integration tests
- [ ] har recording
- [ ] migration checklist
- [ ] performance testing

### phase 11: cleanup & documentation

- [ ] delete legacy packages
- [ ] minimal documentation
- [ ] deployment examples

## next steps

1. **optional but recommended**: har recording of legacy webapp (phase 0)
2. complete phase 0: move server to legacyserver
3. **phase 1: foundation (START HERE)**
   - create server package skeleton
   - app state, error handling, middleware
4. **phase 2: authentication**
   - feature-flagged webauthn
   - api key auth
   - invite code auth
   - config validation
   - add viewer role to grimoire
5. **phase 3: codegen investigation**
   - test codegen approach with 2-3 types
   - determine wrapper strategy
   - document findings before bulk routes
6. **phase 4: establish patterns with 2-3 sample routes**
   - verify shallow wrapper approach works
   - validate codegen approach
   - once validated, remaining routes should be mechanical
7. **phase 5: grimoire preparation (can overlap with phase 4)**
   - move fetch_music to grimoire
   - audit existing APIs
   - identify gaps
8. **phase 6: rapid route implementation**
   - see `GRIMOIRE_TO_SERVER_ROUTES.md` for complete checklist
   - shallow grimoire wrappers
   - should go quickly after patterns established
9. iterate through remaining phases (7-11)
   </text>

<old_text line=1165>

- **auth first**: start with authentication (feature-flagged webauthn)
- **investigate codegen early**: test approach before implementing many routes

**key insight**: grimoire wrappers should be shallow/simple. establish patterns first, then bulk implementation should be straightforward.

work in small increments, ask about ambiguities before implementing.

## key reminders

- **foundation first**: create server skeleton before auth (phase 1)
- **auth second**: implement authentication with feature-flagged webauthn (phase 2)
- **investigate codegen early**: test approach in phase 3 before bulk routes (phase 6)
- **establish patterns**: implement 2-3 routes in phase 4 to validate approach
- **static files early**: add basic static file serving in phase 4 for testing with HTML
- **grimoire prep flexible**: phase 5 can overlap with phase 4 or be deferred
- **viewer role**: add read-only role during auth phase (no upload/edit/fetch)
- **verify query vs list**: confirm query functions can replace list functions
- **shallow wrappers**: grimoire wrappers should be simple/mechanical
- **see checklist**: `GRIMOIRE_TO_SERVER_ROUTES.md` has complete route mapping
- **audit before adding**: grimoire already has most features - check first!
- **avoid duplication**: prefer `query_*()` over `list_*()` - one api not two
- **reuse existing code**: range requests, static file serving from legacyserver
- **prefer POST**: for all list/query endpoints to avoid query param issues
- **reuse grimoire types**: no duplication, use grimoire request/response types directly
- **no yt-dlp mentions**: use generic "external command" terminology
- **auth required**: nearly all routes need authenticated user
- **breaking changes ok**: prioritize clean api over legacy compatibility
- **cli plumbing for all grimoire apis**: every new grimoire function needs cli wrapper
- **minimal code**: remove redundant functions, keep only what's needed
- **ask when ambiguous**: better to clarify than assume
