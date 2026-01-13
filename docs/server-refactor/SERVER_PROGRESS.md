# server refactor progress tracker

quick reference for tracking server refactor work.

**see also**:

- `SERVER_REFACTOR_PLAN.md` - full implementation plan with technical details
- `LEGACY_CODE_REUSE.md` - specific legacy code files to reuse (range requests, static files, etc)
- `GRIMOIRE_TO_SERVER_ROUTES.md` - **complete checklist** of grimoire apis → server routes

## current phase: phase 2.5 - api key management (in progress)

**phase 0 complete**: ✅
**phase 1 complete**: ✅
**phase 2 complete**: ✅ authentication system fully working!

- ✅ session layer working
- ✅ webauthn handlers (register/login flows) tested and working
- ✅ api key generation implemented
- ✅ middleware and auth working
- ✅ database queries refactored to use compile-time checked sqlx patterns

**phase 2.5 in progress**: api key management cli commands + endpoints

**next action: implement api key management commands and endpoints**

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

### phase 2.5: api key management (in progress)

**cli commands**

- [ ] `freqhole user api-key generate <username>` - generate api key for existing user
- [ ] `freqhole user api-key revoke <username>` - revoke/clear api key
- [ ] `freqhole user list --show-api-keys` - list users with api key status

**api endpoints**

- [ ] `POST /auth/api-key/regenerate` - authenticated user regenerates their own key
- [ ] `GET /auth/api-key/status` - check if current user has an api key

**grimoire support** (already done!)

- [x] `UserRepository::set_api_key()` - update user's api key
- [x] `UserService::generate_api_key()` - generate secure random key
- [x] setup command generates api key for root user

### phase 3: typescript codegen investigation

- [ ] **do this after auth, before bulk routes**
- [ ] test ts-rs, typeshare, or specta with 2-3 sample types
- [ ] determine: wrapper types or annotate grimoire types?
- [ ] document findings and establish pattern
- [ ] defer full implementation to phase 8

### phase 4: establish patterns with sample routes

- [ ] **implement 2-3 routes first to validate approach**
  - [ ] `POST /api/songs/query` - query songs (uses grimoire::music::crud::query_songs)
  - [ ] `POST /api/playlists/create` - create playlist (uses grimoire::music::crud::create_playlist)
  - [ ] `POST /api/favorites/set` - set favorite (uses grimoire::music::users::FavoritesService)
- [ ] **implement static file serving for testing**
  - [ ] add `static_files_enabled` + `static_files_dir` to config
  - [ ] basic static file handler (reuse legacy code, no range requests yet)
  - [ ] serve simple HTML test pages
- [ ] verify patterns:
  - [ ] shallow wrappers work well
  - [ ] grimoire types reused directly (or codegen wrapper approach)
  - [ ] error handling consistent
  - [ ] auth middleware works
  - [ ] role-based permissions work (viewer can't create playlist)
  - [ ] static file serving works for testing
- [ ] **once validated, proceed to phase 6 for bulk implementation**

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

### phase 6: rapid route implementation

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

### phase 7: supporting features

- [ ] blob streaming with range support (reuse legacy code)
- [ ] file upload
- [ ] musicbrainz proxy
- [ ] fetch music routes (generic external command)
- [ ] static file range requests (optional - only if needed for large static media)
- [ ] health checks
- [ ] jobs status routes (for async job tracking)

### phase 8: typescript client implementation (deferred)

**note: investigation done in phase 3, full implementation deferred**

- [ ] setup ts-rs or specta
- [ ] annotate request/response types
- [ ] generate zod schemas
- [ ] generate fetch client
- [ ] ci verification

### phase 9: configuration & deployment

- [ ] extend grimoire config for server
- [ ] merge cli + server binary
- [ ] deployment docs

### phase 10: testing & migration

- [ ] minimal smoke tests (lean on cli tests)
- [ ] har analysis (if not done earlier)
- [ ] webapp compatibility testing
- [ ] breaking changes acceptable

### phase 11: cleanup & documentation

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
