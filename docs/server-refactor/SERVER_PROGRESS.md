# server refactor progress tracker

quick reference for tracking server refactor work.

**see also**:

- `SERVER_REFACTOR_PLAN.md` - full implementation plan with technical details
- `LEGACY_CODE_REUSE.md` - specific legacy code files to reuse (range requests, static files, etc)
- `GRIMOIRE_TO_SERVER_ROUTES.md` - **complete checklist** of grimoire apis → server routes

## 📊 latest audit findings (completed!)

**what we verified:**

- ✅ CLI API key commands - fully implemented (generate, revoke, show-status)
- ✅ Job processors - all 5 processors complete (scan, process, fetch, convert, import)
- ✅ ImportMusic job - 100+ line implementation with metadata extraction & fallback handling
- ✅ Core CRUD - all query functions working, replaced legacy list functions
- ✅ 73 routes total - way beyond initial ~35-40 target!

**what we found missing:**

- 🔍 **Search functionality** - `legacyserver/src/media/search.rs` (1945 lines!) needs migration
  - full-text search, advanced filters, aggregations, result grouping
  - acknowledged as "too huge! too much shit!" - perfect for refactoring
- 📊 **Filter metadata API** - provides facets for search UI (genres with counts, etc.)
- 🎯 **Scan improvements** - smart rescanning, orphan detection, directory tracking

**added to roadmap:** phase 9 (search) and phase 10 (scan improvements)

## current phase: phase 9 - search & discovery (next priority)

**phase 0 complete**: ✅
**phase 1 complete**: ✅
**phase 2 complete**: ✅ authentication system fully working!

- ✅ session layer working
- ✅ webauthn handlers (register/login flows) tested and working
- ✅ api key generation implemented
- ✅ middleware and auth working
- ✅ database queries refactored to use compile-time checked sqlx patterns

**phase 2.5 complete**: ✅ api key management cli commands + endpoints
**phase 3 complete**: ✅ typescript codegen system with inventory-based registration
**phase 4 complete**: ✅ patterns established with sample routes
**phase 6+ complete**: ✅ rapid route implementation (73 routes total!)
**phase 7 complete**: ✅ supporting features (blobs, uploads, jobs)

**phase 9 next**: search & discovery - migrate search functionality from legacyserver
**phase 10 next**: scan improvements - smart rescanning, validation, directory tracking

**next action: implement search functionality in grimoire + server routes**

## implementation workflow (updated priority)

1. **foundation first** (phase 1) - create server skeleton, app state, error handling
2. **auth second** (phase 2) - feature-flagged webauthn, api keys, invite codes, viewer role
3. **codegen investigation** (phase 3) - test codegen approach with 2-3 types
4. **establish patterns** (phase 4) - implement 2-3 sample routes + static file serving for testing
5. **grimoire prep** (phase 5) - move fetch_music, audit APIs (can overlap with phase 4)
6. **rapid implementation** (phase 6) - shallow grimoire wrappers (should be straightforward)
7. **see checklist** - `GRIMOIRE_TO_SERVER_ROUTES.md` has complete mapping

## quick checklist

### phase 0: preparation & inventory ✅ COMPLETE

- [x] create refactor plan
- [x] move server → legacyserver
- [x] update workspace cargo.toml (removed legacy packages)
- [ ] optional: har recording of legacy webapp (deferred)
- legacyserver is reference only (no need to maintain)

### phase 1: foundation ✅ COMPLETE

- [x] create new server package
- [x] setup cargo.toml with minimal deps and webauthn feature flag
- [x] app state struct (no db pool!)
- [x] error handling (ApiError enum with IntoResponse)
- [x] basic middleware (compression, cors, tracing)
- [x] server.rs with start_server function
- [x] routes.rs (empty router for now)
- [x] main.rs (minimal entry point)
- [x] binary compiles and runs

### phase 2: authentication

**grimoire work** ✅

- [x] add viewer role to UserRole enum
- [x] add api_key field to User model
- [x] add ServerConfig to grimoire config
- [x] update config files (config.jsonc, config.example.jsonc, test-config.jsonc)
- [x] database migration (consolidated into 009_user_system.sql)

**server work** ✅ COMPLETE

- [x] auth module structure (stubs created)
- [x] config validation in AppState
- [x] session store initialization (grimoire::sessions::init_session_store)
- [x] SessionManagerLayer added to router (fixed session extraction)
- [x] session helpers (save_session, load_session, delete_session)
- [x] auth middleware (require_auth with session + api key support)
- [x] validate_origin middleware (checks Origin header against config)
- [x] API key validation via grimoire (find_user_by_api_key)
- [x] API key generation (generate_api_key in UserService)
- [x] auth handlers implemented (whoami, invite redemption, logout)
- [x] auth routes wired up (3 public + protected routes)
- [x] AppState added as Extension for middleware access
- [x] **webauthn handlers COMPLETE**
  - [x] `POST /auth/webauthn/register/start` - begin passkey registration
  - [x] `POST /auth/webauthn/register/finish` - complete passkey registration
  - [x] `POST /auth/webauthn/login/start` - begin passkey authentication
  - [x] `POST /auth/webauthn/login/finish` - complete passkey authentication
  - [x] implemented in `server/src/auth/freq_webauthn.rs` (webauthn-rs isolated here)
  - [x] uses `ValidatedOrigin` from middleware for multi-origin support
  - [x] feature-gated with runtime config check
  - [x] **tested and working via browser!**

**database improvements** ✅

- [x] refactored `list_users` from string concatenation to compile-time checked query
- [x] uses `sqlx::query_as!` with static SQL and NULL handling pattern
- [x] added non-null assertions (!) for required columns

### phase 2.5: api key management ✅ COMPLETE

**cli commands** ✅

- [x] `freqhole user api-key generate <username>` - generate api key for existing user
- [x] `freqhole user api-key revoke <username>` - revoke/clear api key
- [x] `freqhole user api-key show-status <username>` - show api key status with masked preview

**api endpoints** ✅

- [x] `POST /auth/api-key/regenerate` - authenticated user regenerates their own key
- [x] `GET /auth/api-key/status` - check if current user has an api key

**grimoire support** (already done!)

- [x] `UserRepository::set_api_key()` - update user's api key
- [x] `UserService::generate_api_key()` - generate secure random key
- [x] setup command generates api key for root user

### phase 3: typescript codegen ✅ COMPLETE

- [x] inventory-based route registration system
- [x] zod schema generation from rust types
- [x] type-safe client with runtime validation
- [x] enum handling fixed (lowercase literal unions)
- [x] path parameter handling working
- [x] 65+ routes with full typescript client coverage

### phase 4: establish patterns ✅ COMPLETE

- [x] multiple routes implemented and validated
- [x] shallow grimoire wrappers work well
- [x] grimoire types reused directly
- [x] error handling consistent
- [x] auth middleware works
- [x] static file serving implemented
- [x] patterns validated, ready for bulk implementation

### phase 5: grimoire preparation

**note: can be done in parallel with phase 4 or deferred until needed**

- [ ] move download to grimoire as fetch_music
  - [ ] rename to generic "fetch from url" (no yt-dlp mentions)
  - [ ] add config: enabled, output_dir, precheck_command, fetch_command
  - [ ] integrate with grimoire jobs system
  - [ ] add CLI plumbing: fetch url, fetch status, fetch list
- [ ] **audit existing grimoire apis first** - avoid duplication!
  - [ ] music::crud has query_songs, query_artists, query_albums, search_songs ✓
  - [ ] music::users has FavoritesService, RatingsService ✓
  - [ ] music::analytics has listening_history, feed, play_analytics ✓
  - [ ] identify redundant functions (list vs query - prefer query!)
- [ ] identify actual gaps (minimal additions only)
  - [ ] check grimoire api against server route needs
  - [ ] only add if genuinely missing
  - [ ] **rule: every new grimoire public api needs cli plumbing wrapper**

### phase 6: rapid route implementation ✅ COMPLETE

- [x] **73 total routes implemented!** (way beyond ~35-40 target)
- [x] songs, albums, artists, genres routes
- [x] playlists routes (full CRUD + mutations)
- [x] favorites & ratings routes
- [x] analytics routes (play tracking, history, top songs/artists/albums, feed)
- [x] tags routes (full CRUD + album associations)
- [x] sub-genres routes (complete management)
- [x] musicbrainz routes (search & lookup)
- [x] jobs routes (status, list)
- [x] query functions verified to replace list functions

### phase 7: supporting features ✅ COMPLETE

- [x] blob streaming with range support
- [x] file upload (image & music)
- [x] musicbrainz proxy
- [x] fetch music routes (generic external command)
- [x] health checks
- [x] jobs status routes (for async job tracking)
- [x] all 5 job processors implemented (scan, process, fetch, convert, import)

### phase 8: typescript client implementation ✅ COMPLETE

- [x] inventory-based route registration
- [x] zod schema generation working
- [x] type-safe fetch client with wrappers
- [x] runtime validation on requests/responses
- [x] URL helper utilities for blobs/uploads
- [x] integration tests with 230+ test cases

### phase 9: search & discovery (HIGH PRIORITY - NEXT)

**background**: legacy search functionality in `legacyserver/src/media/search.rs` (1945 lines!)
needs to be refactored and migrated to grimoire. acknowledged as "too huge! too much shit!"

**search functionality** 🔍

- [ ] migrate SearchService from legacylib to grimoire
  - [ ] refactor and simplify (break down monolithic search)
  - [ ] full-text search with postgres text search / websearch
  - [ ] advanced filters (tags, year ranges, ratings, boolean combos)
  - [ ] multiple search types (websearch, phrase, prefix, fuzzy)
  - [ ] search field selection (title, artist, album, genre, etc.)
  - [ ] result grouping and aggregations (genres, playlists)
  - [ ] sort options with multiple fields
  - [ ] pagination with metadata (has_next, has_prev, total_pages)
  - [ ] query performance tracking
- [ ] implement search server routes
  - [ ] `POST /api/search` - unified search endpoint
  - [ ] OR consider focused endpoints: `/api/search/songs`, `/api/search/artists`, etc.
- [ ] cli plumbing wrapper
  - [ ] `freqhole music search --query "text" [filters]`

**filter metadata endpoints** (for search UI facets)

- [ ] move filter metadata queries from legacyserver to grimoire
  - [ ] genre filters with counts
  - [ ] artist filters with counts
  - [ ] album filters with counts
  - [ ] year range metadata (min/max available)
  - [ ] tag filters with counts
- [ ] implement server routes
  - [ ] `GET /api/filters/genres` - available genres with song counts
  - [ ] `GET /api/filters/artists` - available artists with song counts
  - [ ] `GET /api/filters/albums` - available albums with song counts
  - [ ] `GET /api/filters/years` - year range metadata
  - [ ] `GET /api/filters/tags` - available tags with counts
- [ ] cli plumbing wrappers
  - [ ] `freqhole music filters [--type genre|artist|album|year|tag]`

**notes**:

- search is core functionality for music discovery
- current implementation acknowledged as needing refactoring
- opportunity to simplify and modernize
- filter metadata goes hand-in-hand with search (faceted search)

### phase 10: scan improvements (NEXT)

**smart rescanning & validation**

improve music scanning to avoid redundant processing and maintain data integrity

**1. smart rescan (skip unchanged files)**

- [ ] grimoire: check db for existing local_path before processing
- [ ] grimoire: store file metadata (created_at, modified_at) in media_blobz table
  - [ ] add `file_created_at` timestamp field (UTC)
  - [ ] add `file_modified_at` timestamp field (UTC)
  - [ ] database migration for new fields
- [ ] grimoire: compare file timestamps during scan
  - [ ] if timestamps match, skip processing (file unchanged)
  - [ ] if timestamps differ, update db records
  - [ ] log skipped vs processed files
- [ ] cli: add flag for force rescan: `freqhole music scan --force [path]`

**2. orphan detection (validate files still exist)**

- [ ] grimoire: new job type `ValidateBlobs`
- [ ] grimoire: scan all media_blobz with local_path set
  - [ ] check if file exists on disk
  - [ ] if missing, soft delete (set deleted_at)
  - [ ] optionally cascade to songs/albums (or leave orphaned)
  - [ ] report: deleted count, orphaned entities count
- [ ] cli: `freqhole music validate-files [--fix]`
  - [ ] without --fix: report only (dry run)
  - [ ] with --fix: actually soft delete missing files
- [ ] server route: `POST /api/jobs/validate-files` (admin/root only)

**3. directory tracking (persist scan locations)**

- [ ] grimoire: new table `scanned_directories`
  - [ ] `id` - primary key
  - [ ] `path` - absolute directory path
  - [ ] `recursive` - boolean (was it scanned recursively?)
  - [ ] `last_scanned_at` - timestamp UTC
  - [ ] `file_count` - number of files found in last scan
  - [ ] `created_by` - user who initiated scan
  - [ ] `created_at` - when first scanned
- [ ] grimoire: record directory after successful scan job
- [ ] grimoire: new job type `RescanDirectories`
  - [ ] query all tracked directories
  - [ ] rescan each to find new/removed/changed files
  - [ ] update directory metadata (last_scanned_at, file_count)
- [ ] cli: `freqhole music directories list` - show tracked directories
- [ ] cli: `freqhole music directories rescan [--dir <path>]` - rescan tracked dirs
  - [ ] without --dir: rescan all tracked directories
  - [ ] with --dir: rescan specific directory only
- [ ] cli: `freqhole music directories remove <path>` - stop tracking directory

**4. server api for rescanning (optional, admin only)**

- [ ] config: add `server.scans.allow_rescan_api` boolean (default: false)
- [ ] server route: `POST /api/scans/rescan` (root/admin only)
  - [ ] only enabled if config allows
  - [ ] only rescans already-tracked directories (no new paths via API)
  - [ ] returns job_id for tracking
- [ ] role check: only UserRole::Root and UserRole::Admin can trigger

**notes**:

- file timestamps in UTC to avoid timezone issues
- soft delete preserves data for recovery
- directory tracking enables "what's new?" workflows
- server api disabled by default for security (filesystem access)
- rescans use existing job system for async processing

### phase 11: configuration & deployment

- [ ] extend grimoire config for server
- [ ] merge cli + server binary
- [ ] deployment docs

### phase 12: testing & migration

- [ ] minimal smoke tests (lean on cli tests)
- [ ] har analysis (if not done earlier)
- [ ] webapp compatibility testing
- [ ] breaking changes acceptable

### phase 13: cleanup & documentation

- [ ] delete legacyserver/
- [ ] delete legacylib/
- [ ] delete legacycli/
- [ ] minimal documentation
- [ ] deployment examples (systemd, docker)

## route count target

- legacy: ~60+ routes
- target: ~35-40 routes (prefer POST over GET)
- current: 0

## key principles

- **foundation first**: create server skeleton (phase 1)
- **auth second**: implement authentication system with feature-flagged webauthn (phase 2)
- **add viewer role**: read-only user during auth phase (browse/play/favorite, no upload/edit)
- **investigate codegen early**: test approach in phase 3 before bulk routes (phase 6)
- **establish patterns**: implement 2-3 routes in phase 4 to validate approach
- **static files early**: add basic static file serving in phase 4 for testing with HTML
- **grimoire prep flexible**: phase 5 can overlap with phase 4 or be deferred
- **verify query vs list**: confirm query functions fully replace list before removing
- **shallow wrappers**: grimoire wrappers should be simple/mechanical
- **see checklist**: `GRIMOIRE_TO_SERVER_ROUTES.md` for complete route mapping
- **audit before adding**: grimoire already has most features - check first!
- **avoid duplication**: prefer query*() over list*() - one api not two
- no sqlx in server (all db in grimoire)
- no websockets, no sync, no photos
- music domain only (separate from app-wide media_blobz)
- simple auth (webauthn optional, nearly all routes require auth)
- reuse grimoire types directly (no duplication!)
- prefer POST over GET for list/query endpoints
- reuse existing code (range requests, static files)
- no yt-dlp mentions (generic "external command")
- typescript codegen deferred until later
- follow coding_principles.md (lowercase, simple, minimal)
- **cli plumbing for all grimoire apis**: every new grimoire function needs cli wrapper
- **minimal code**: remove redundant functions, keep only what's needed

## config files to maintain

when adding new config options, update all three files:

- `assets/config/config.jsonc` - development config
- `assets/config/config.example.jsonc` - example/template config with detailed comments
- `cli/tests/fixtures/test-config.jsonc` - test config (minimal)

## future config sections to implement

the following config sections were stubbed out but need implementation:

- [ ] `server.sessions` - session management settings (max_age, secure, same_site, http_only)
- [ ] `server.auth.webauthn.rp_name` - human-readable name shown during authentication
- [ ] `server.static_files` directory structure - may need public/private/assets distinction

## open questions

- webauthn-rs sqlite migration strategy?
- which grimoire types need http extensions?
- when to do har analysis (before or after phase 4)?
- verify query functions fully replace list for all entities (not just songs)
- viewer role: can they favorite existing playlists or fully read-only?
- codegen: wrapper types or annotate grimoire types directly?

## implementation reminders

- **foundation → auth (COMPLETE with webauthn) → codegen investigation → patterns → bulk routes**
- **complete webauthn in phase 2** - required for authentication system to be functional
- **investigate codegen in phase 3** (after auth fully complete, before bulk routes)
- **✅ viewer role added to grimoire** during phase 2 (auth)
- **✅ API key auth implemented** - grimoire provides find_user_by_api_key
- **🔴 webauthn handlers required** - do not skip, this is primary auth method
- **verify query vs list equivalence** as you implement routes
- har recording recommended (can do before or after initial routes)
- webauthn must be feature-gated for arm6 builds
- config must validate feature flags (panic if webauthn enabled without feature)
- single `freqhole` binary is end goal
- ask about ambiguities before implementing
- **reuse legacy code** - see `LEGACY_CODE_REUSE.md` for specific files:
  - range request handler (audio seeking)
  - static file serving (spa + assets)
  - blob streaming (efficient media delivery)
  - upload handler (multipart streaming)
  - webauthn flows (adapt for sqlite)
  - musicbrainz proxy
- breaking changes are acceptable for cleaner api
- session storage in sqlite (not memory or redis)
- admin operations (user mgmt, invite codes) via cli only
- no yt-dlp mentions in code (use generic "external command")
