# server refactor plan

## current status & next steps

**phase 6+ complete** ✓ - rapid route implementation finished (65 total routes implemented)

- 17 routes from phase 6 (songs, artists, albums, genres, favorites, ratings)
- 6 playlist mutation routes (update, delete, add-songs, remove-songs, reorder, remove-thumbnail)
- 1 playlist query route (get playlist songs with full metadata)
- 7 analytics routes (play tracking, listening history, top songs/artists/albums, feed)
- 8 tags routes (list, query, get, delete, album associations)
- 7 sub-genres routes (list, query, get, create, delete, for-genre, find-or-create)
- 2 musicbrainz routes (search releases, get release by mbid)
- 2 jobs routes (get status, list jobs)
- 1 health check route (public, no auth)
- 1 fetch route (existing)
- 2 blob routes (stream blob with range support, blob metadata)
- 2 upload routes (upload image, upload music)

**next priorities**:

1. job processors - implement ImportMusic job for metadata extraction (stub exists)
2. testing & integration - test all implemented routes with actual requests
3. har recording - capture actual webapp usage patterns
4. migration - cutover from legacy server
5. performance testing - verify blob streaming, large uploads

**reference docs**:

- `docs/HOW_TO_ADD_FEATURE.md` - end-to-end guide for new features
- `docs/server-refactor/GRIMOIRE_TO_SERVER_ROUTES.md` - route checklist

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

1. **foundation first**: create server skeleton, app state, error handling ✓
2. **auth second**: feature-flagged webauthn, api keys, invite codes, viewer role ✓
3. **codegen system**: typescript client generation with inventory-based route registration ✓
4. **establish patterns**: implement sample routes, validate workflow ✓
5. **static files & legacy code**: reuse working code from legacyserver ✓
6. **fetch migration**: move download/fetch_music to grimoire ✓
7. **rapid implementation phase 6+**: playlist mutations, jobs, health check, analytics, musicbrainz ✓
8. **see `GRIMOIRE_TO_SERVER_ROUTES.md` for complete checklist**

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

## phase 3: typescript codegen investigation ✓

### implementation

- using `zod_gen` + `inventory` for route registration
- grimoire types get `#[derive(ZodSchema)]`
- routes register via `inventory::submit!` with metadata
- codegen in `client-codegen/` workspace package
- generates: schema.ts (zod) + routes.ts (config) + hand-written client.ts
- see: `client-codegen/README.md` for details

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

### 4.2: implement sample routes ✓

**completed routes**:

- `POST /api/music/playlists` - create playlist
- `GET /api/music/playlists/:id` - get playlist by id
- `POST /api/music/artists` - create artist

**pattern validated**:

- route paths use domain namespacing (`/api/auth/*`, `/api/music/*`)
- routes reference paths via `all_routes_map()` (single source of truth, domain-namespaced)
- handlers use `grimoire::music::entities::*` for basic crud operations
- types annotated with `#[derive(ZodSchema)]` and registered in `api_registry::type_registry`
- codegen successfully generates typescript client

**architectural decisions made**:

- `grimoire::music::entities` made public (maps to filesystem structure)
- `entities::` = basic crud, `crud::` = high-level workflows
- imports use `grimoire::music::entities::playlists::create_playlist` pattern

**deprecated routes**:

- `list_songs` - use `query_songs` instead (POST /api/songs/query)

## phase 5: grimoire preparation

**note**: can be done in parallel with phase 4 or deferred until needed

### 5.1: move download/fetch_music to grimoire ✓

**complete** - fully functional fetch system with end-to-end workflow

**grimoire**:

- [x] `grimoire/src/music/fetch/` module with models and service
- [x] precheck (metadata extraction), download, deduplication
- [x] integrated with jobs system (FetchMedia job type)
- [x] job spawning: creates ProcessFile jobs for each downloaded file
- [x] metadata storage: fetch provenance stored in media_blob.metadata JSON
- [x] config: `ServerConfig.fetch_music` with enable flag, output_dir, commands
- [x] migration: `011_add_content_id_to_media_blobz.sql`
- [x] supports playlists/collections with best-effort downloading
- [x] organizes downloads by job_id subdirectory

**server**:

- [x] `server/src/music/fetch.rs` with route handlers
- [x] `POST /api/music/fetch` - create fetch job
- [x] `GET /api/music/fetch/{id}` - get job status and result
- [x] types registered in type_registry for codegen

**cli**:

- [x] `cli/src/plumbing/music/fetch.rs` with commands
- [x] `freqhole music fetch url <url>` - queue fetch job
- [x] `freqhole music fetch status <job_id>` - check job status
- [x] `freqhole music fetch list` - list fetch jobs

**architecture decisions**:

- no filesystem paths in API responses (only job IDs, blob IDs, song IDs)
- custom ZodSchema implementation excludes internal fields from typescript
- config uses absolute paths, validated on server startup
- external command approach (not tied to specific tool)

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

## phase 8: typescript client generation ✓

**implementation complete**:

- `client-codegen/` workspace package with codegen binary
- grimoire types use `#[derive(ZodSchema)]`
- routes register via `inventory::submit!` in handlers
- run: `cd client-codegen && make all`
- output: `freqhole-api-client/src/codegen/`
- hand-written dynamic client in `client.ts`
- 9 routes working (5 auth, 4 music)

**outstanding tasks**:

- [ ] add `api.ts` wrapper functions (optional convenience layer)
- [ ] add `test.ts` integration test harness
- [ ] ci check that verifies generated output is up to date

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

## phase 11: documentation & cleanup

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

### phase 0: preparation ✓

- [x] create refactor plan
- [x] move server → legacyserver
- [x] update workspace config

### phase 1: foundation ✓

- [x] create new server package
- [x] setup dependencies
- [x] app state struct
- [x] error handling
- [x] middleware stack

### phase 2: auth ✓

- [x] auth module structure
- [x] webauthn (feature-gated)
- [x] api key auth
- [x] invite code auth
- [x] middleware
- [x] routes (5 routes with inventory::submit!)

### phase 3: codegen investigation

- [x] codegen system complete (zod_gen + inventory)
- [x] grimoire types annotated with ZodSchema
- [x] client-codegen workspace package created

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

### phase 8: typescript codegen ✓

- [x] codegen system (zod_gen + inventory)
- [x] grimoire types with ZodSchema
- [x] client-codegen workspace package
- [x] generate schemas + routes
- [x] hand-written dynamic client
- [ ] hand-written wrapper functions for each route

**wrapper functions task**:
create `client-codegen/freqhole-api-client/src/api.ts` with typed wrappers:

```typescript
import { createClient } from "./client.js";
import type * as s from "./codegen/schema.js";

export function createApi(baseUrl: string) {
  const client = createClient(baseUrl);

  return {
    auth: {
      whoami: () => client.call<s.WhoAmIResponse>("auth", "whoami"),
      logout: () => client.call("auth", "logout"),
      // etc - one wrapper per route
    },
    music: {
      listPlaylists: (params: s.QueryParams) =>
        client.call<s.PlaylistQueryResult[]>("music", "list_playlists", params),
      // etc
    },
  };
}
```

this provides clean api: `api.auth.whoami()` instead of `client.call('auth', 'whoami')`
wrapper functions are hand-written but follow mechanical pattern (one per route)

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

1. **phase 4: establish patterns (START HERE)**
   - add 2-3 more music routes with inventory::submit!
   - verify shallow wrapper approach works
   - once validated, remaining routes should be mechanical
2. **phase 5: grimoire preparation (can overlap with phase 4)**
   - move fetch_music to grimoire
   - audit existing APIs
   - identify gaps
3. **phase 6: rapid route implementation**
   - see `GRIMOIRE_TO_SERVER_ROUTES.md` for complete checklist
   - shallow grimoire wrappers
   - should go quickly after patterns established
4. iterate through remaining phases (7, 9-11)
   </text>

- **auth first**: start with authentication (feature-flagged webauthn)
- **codegen complete**: client-codegen system ready for new routes

**key insight**: grimoire wrappers should be shallow/simple. establish patterns first, then bulk implementation should be straightforward.

work in small increments, ask about ambiguities before implementing.

## key reminders

- **foundation first**: create server skeleton before auth (phase 1)
- **auth second**: implement authentication with feature-flagged webauthn (phase 2)
- **codegen complete**: client-codegen system ready (phase 3/8 done)
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
