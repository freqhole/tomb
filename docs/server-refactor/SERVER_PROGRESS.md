# server refactor progress tracker

quick reference for tracking server refactor work.

**see also**:

- `SERVER_REFACTOR_PLAN.md` - full implementation plan with technical details
- `LEGACY_CODE_REUSE.md` - specific legacy code files to reuse (range requests, static files, etc)
- `GRIMOIRE_TO_SERVER_ROUTES.md` - **complete checklist** of grimoire apis → server routes

## current phase: phase 0 - preparation

**next action: optional har recording, then move server to legacyserver**

## implementation workflow (updated priority)

1. **auth first** (phase 3) - feature-flagged webauthn, api keys, invite codes
2. **establish patterns** - implement 2-3 sample routes to validate approach
3. **rapid implementation** - shallow grimoire wrappers (should be straightforward)
4. **see checklist** - `GRIMOIRE_TO_SERVER_ROUTES.md` has complete mapping

## quick checklist

### phase 0: preparation & inventory

- [x] create refactor plan
- [ ] optional: har recording of legacy webapp (recommended)
- [ ] move server → legacyserver
- [ ] update workspace cargo.toml
- legacyserver is reference only (no need to maintain)

### phase 1: grimoire preparation

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

### phase 2: foundation

- [ ] create new server package
- [ ] setup cargo.toml with minimal deps
- [ ] app state struct (no db pool)
- [ ] error handling
- [ ] basic middleware

### phase 3: authentication ⭐ START HERE - TOP PRIORITY

- [ ] auth module structure
- [ ] webauthn support (feature-gated)
  - [ ] feature flag in Cargo.toml
  - [ ] config validation (panic if enabled without feature)
  - [ ] figure out sqlite migration from postgres
- [ ] api key auth (needs db migration)
- [ ] invite code auth
- [ ] **add viewer role to grimoire**
  - [ ] extend UserRole enum (admin, user, viewer)
  - [ ] viewer = read-only (browse/play/favorite, no upload/edit/fetch)
  - [ ] middleware checks role for mutation routes
- [ ] auth middleware (nearly all routes require auth)
- [ ] session storage in sqlite
- [ ] auth routes (~7 routes)
- [ ] **investigate typescript codegen during this phase**
  - [ ] test ts-rs, typeshare, or specta
  - [ ] determine: wrapper types or annotate grimoire types?
  - [ ] understand structural impact before phase 5
- [ ] **goal: establish server foundation before route implementation**

### phase 4: establish patterns with sample routes

- [ ] **implement 2-3 routes first to validate approach**
  - [ ] `POST /api/songs/query` - query songs (uses grimoire::music::crud::query_songs)
  - [ ] `POST /api/playlists/create` - create playlist (uses grimoire::music::crud::create_playlist)
  - [ ] `POST /api/favorites/set` - set favorite (uses grimoire::music::users::FavoritesService)
- [ ] verify patterns:
  - [ ] shallow wrappers work well
  - [ ] grimoire types reused directly (or codegen wrapper approach)
  - [ ] error handling consistent
  - [ ] auth middleware works
  - [ ] role-based permissions work (viewer can't create playlist)
- [ ] **once validated, proceed to phase 5 for bulk implementation**

### phase 5: rapid route implementation

- [ ] **see `GRIMOIRE_TO_SERVER_ROUTES.md` for complete checklist**
- [ ] songs routes (3-4 routes)
- [ ] albums routes (2-3 routes)
- [ ] artists routes (2-3 routes)
- [ ] playlists routes (remaining 7-8 routes)
- [ ] favorites routes (remaining 1-2 routes)
- [ ] ratings routes (2-3 routes)
- [ ] analytics/history routes (2-3 routes)
- [ ] **note: should be mechanical/straightforward after patterns established**
- [ ] **important: verify query functions can replace list functions**
  - [ ] confirm query_songs replaces list_songs ✓ (known)
  - [ ] verify query_artists, query_albums, query_playlists (investigate each)
  - [ ] only remove list functions after verification
- [ ] after routes built: har analysis to identify gaps

### phase 5: supporting features

- [ ] blob streaming with range support (reuse legacy code)
- [ ] file upload
- [ ] musicbrainz proxy
- [ ] fetch music routes (generic external command)
- [ ] static files handler (reuse legacy code)
- [ ] health checks
- [ ] jobs status routes (for async job tracking)

### phase 6: typescript client (defer to later)

- [ ] setup ts-rs or specta
- [ ] annotate request/response types
- [ ] generate zod schemas
- [ ] generate fetch client
- [ ] ci verification

**note: not immediate priority, focus on core functionality first**

### phase 7: configuration

- [ ] extend grimoire config for server
- [ ] merge cli + server binary
- [ ] deployment docs

### phase 8: testing & migration

- [ ] minimal smoke tests (lean on cli tests)
- [ ] har analysis (if not done earlier)
- [ ] webapp compatibility testing
- [ ] breaking changes acceptable

### phase 9: cleanup

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

- **auth first**: start with authentication system (feature-flagged webauthn)
- **add viewer role**: read-only user (browse/play/favorite, no upload/edit)
- **investigate codegen early**: test approach during phase 3 to avoid pain later
- **verify query vs list**: confirm query functions fully replace list before removing
- **establish patterns**: implement 2-3 routes to validate approach
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

## open questions

- webauthn-rs sqlite migration strategy?
- which grimoire types need http extensions?
- when to do har analysis (before or after phase 4)?
- verify query functions fully replace list for all entities (not just songs)
- viewer role: can they favorite existing playlists or fully read-only?
- codegen: wrapper types or annotate grimoire types directly?

## implementation reminders

- **auth first, then patterns, then bulk routes**
- **investigate codegen during phase 3** (before too much route code)
- **add viewer role to grimoire** during phase 3
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
