# Grimoire Public API Refactor - Work Plan

> **Status:** Ready to start Phase 1
>
> **Goal:** Make grimoire's public API crystal clear through consistent patterns:
>
> - `pub` functions return `GrimoireResponse<T>`
> - `pub(crate)` for internal implementation
> - No inline `crate::` usage
> - Clean, discoverable API

**Background & decisions:** See [public-api-background.md](./public-api-background.md)

## Quick Reference

**What's public API?** → Look at `grimoire/src/cli/` - everything CLI calls is public

**Current structure that's working:**

- `music/crud/mod.rs` - Perfect facade pattern (re-exports everything)
- `service.rs` files - Contain public functions (need GrimoireResponse)
- `entities/*/repository.rs` - Internal DB access (mark `pub(crate)`)

**Key decision: Users domain split (CONFIRMED)**

```
users/         → App accounts only (register, login, invites)
music/users/   → Music-specific (favorites, ratings) - MOVE from users/
```

## Phase 1: Foundation ✅

- [x] Add `ErrorDetail` to `grimoire/src/error.rs`
  - Move from `cli/utils.rs` or add new
  - Implement `From<GrimoireError>` for `ErrorDetail`
- [x] Create `grimoire/src/response.rs`
  - Define `GrimoireResponse<T>` with success, message, data, errors
  - Import `ErrorDetail` from error module
- [x] Update `grimoire/src/lib.rs`
  - Export response module
  - Export error module publicly
- [x] Update `cli/utils.rs` to re-export `ErrorDetail` for CLI compatibility
- [x] Add `CommandOutput::from_grimoire_response()` helper for future CLI migration

- [x] Test: Ensure everything compiles

## Phase 2: Users Module (Reference Implementation) ✅ / ❌

**Why first?** Hardest module - establishes all patterns for 95 files

### Step 1: Domain Split ✅

- [x] Create `grimoire/src/music/users/` directory
- [x] Move `users/favorites.rs` → `music/users/favorites.rs`
- [x] Move `users/ratings.rs` → `music/users/ratings.rs`
- [x] Create `music/users/models.rs` - move UserFavorite, UserRating types
- [x] Create `music/users/mod.rs` - re-export favorites, ratings
- [x] Update `music/mod.rs` - add `pub mod users;`
- [x] Update `users/models.rs` - keep only app types (User, Role, InviteCode)
- [x] Update imports in favorites.rs and ratings.rs to use new module structure
- [x] Add re-exports in users/mod.rs for backwards compatibility

### Step 2: Update Visibility

- [ ] `users/repository.rs` → mark as `pub(crate)`
- [ ] Review `users/service.rs` - identify public functions

### Step 3: Update Return Types (service.rs)

For each public function in `users/service.rs`:

- [ ] `register_user()` → `GrimoireResponse<UserCreatedResponse>`
- [ ] `list_users()` → `GrimoireResponse<UserListResponse>`
- [ ] `update_user()` → `GrimoireResponse<User>`
- [ ] `delete_user()` → `GrimoireResponse<()>`
- [ ] `generate_invite_codes()` → `GrimoireResponse<InviteCodesGeneratedResponse>`
- [ ] `list_invite_codes()` → `GrimoireResponse<Vec<InviteCode>>`
- [ ] `deactivate_invite_code()` → `GrimoireResponse<()>`

Pattern for each:

```rust
pub async fn register_user(request: CreateUserRequest) -> GrimoireResponse<UserCreatedResponse> {
    // Do work inline
    let user = match create_user_in_db(request).await {
        Ok(user) => user,
        Err(err) => return GrimoireResponse::failure("Failed to create user", vec![err.into()]),
    };

    let response = UserCreatedResponse { /* ... */ };
    GrimoireResponse::success("User created", response)
}
```

### Step 4: Update music/users/ Functions

- [ ] `favorites.rs` functions → `GrimoireResponse<T>`
- [ ] `ratings.rs` functions → `GrimoireResponse<T>`

### Step 5: Clean Imports

- [ ] Remove all inline `crate::` usage in users/
- [ ] Remove all inline `crate::` usage in music/users/
- [ ] Add proper imports at top of files

### Step 6: Update mod.rs

- [ ] `users/mod.rs` - clean exports (app domain only)
- [ ] `music/users/mod.rs` - clean exports

### Step 7: Test & Document

- [ ] Compile grimoire library
- [ ] Document pattern used (save to `docs/completed/users-refactor.md`)
- [ ] Note any edge cases discovered

**Checkpoint:** Users done = template established for all other modules

## Phase 3: Apply Pattern to All Modules ✅ / ❌

**Use users as template. For each module:**

### Music Domain (51 files)

**Music CRUD (8 files)** - Already well-organized

- [ ] `music/crud/query.rs` - public functions → GrimoireResponse
- [ ] `music/crud/query_playlists.rs` - public functions → GrimoireResponse
- [ ] `music/crud/update.rs` - public functions → GrimoireResponse
- [ ] `music/crud/create_or_update.rs` - public functions → GrimoireResponse
- [ ] `music/crud/delete.rs` - public functions → GrimoireResponse
- [ ] `music/crud/deduplication.rs` - public utils (keep as-is or pub(crate))
- [ ] Clean imports in all files
- [ ] `music/crud/mod.rs` - already perfect facade, no changes needed

**Music Entities (20 files)** - Mostly internal

- [ ] All `repository.rs` → mark `pub(crate)`
- [ ] All `models.rs` → public types (already re-exported by crud)
- [ ] Public functions called by crud → update return types if needed
- [ ] `playlists/thumbnail_helpers.rs` → `pub(crate)`
- [ ] Clean imports

**Music Scanner (5 files)**

- [ ] `scanner/directory.rs` - public functions → GrimoireResponse
- [ ] `scanner/service.rs` → `pub(crate)` or split
- [ ] `scanner/import.rs` - determine public vs internal
- [ ] Clean imports

**Music Analytics (6 files)**

- [ ] `analytics/events.rs` - public functions → GrimoireResponse
- [ ] `analytics/queries.rs` - public functions → GrimoireResponse
- [ ] `analytics/admin.rs` - public functions → GrimoireResponse
- [ ] `analytics/feed.rs` - public functions → GrimoireResponse
- [ ] Clean imports

**Music MusicBrainz (6 files)**

- [ ] `musicbrainz/client.rs` - public functions → GrimoireResponse
- [ ] `musicbrainz/queries.rs` - public functions → GrimoireResponse
- [ ] `musicbrainz/rate_limiter.rs` → `pub(crate)`
- [ ] Clean imports

**Music Root**

- [ ] `music/mod.rs` - ensure clean exports

### Application Domain (20 files)

**Jobs (3 files)**

- [ ] `jobs/service.rs` - public functions → GrimoireResponse
- [ ] Clean imports

**Wordlist (3 files)**

- [ ] `wordlist/management.rs` - public functions → GrimoireResponse
- [ ] `wordlist/service.rs` → `pub(crate)` or merge
- [ ] Clean imports

**Analytics (3 files)**

- [ ] `analytics/events.rs` - public functions → GrimoireResponse
- [ ] Clean imports

**Maintenance (3 files)**

- [ ] `maintenance/orphaned.rs` - public functions → GrimoireResponse
- [ ] `maintenance/hard_delete.rs` - public functions → GrimoireResponse
- [ ] Clean imports

**Blob Storage (8 files)**

- [ ] Determine public API surface
- [ ] `media_blobz/service.rs` - public functions → GrimoireResponse
- [ ] Mark helpers as `pub(crate)`
- [ ] Clean imports

### Core (4 files)

- [ ] `config.rs` - review public types
- [ ] `database.rs` → `pub(crate)`
- [ ] `lib.rs` - review all exports
- [ ] Clean imports

**Total: 95 files**

## Phase 4: Verify Public API ✅ / ❌

- [ ] Run `cargo doc --no-deps`
- [ ] Review generated documentation
- [ ] Ensure only intended items are public
- [ ] Create `docs/public-api-summary.md` with all public functions

## Phase 5: Update CLI ✅ / ❌

**Now that library is clean, update CLI to use GrimoireResponse**

- [ ] Add `CommandOutput::from_grimoire_response()` in `cli/utils.rs`
- [ ] Add `utils::print_output()` for single print point
- [ ] Update `cli/users.rs` - call new public API
- [ ] Update `cli/music/*` - call new public API
- [ ] Update `cli/jobs.rs` - call new public API
- [ ] Update all other CLI handlers
- [ ] Simplify `cli/mod.rs` router - use single print function
- [ ] Clean imports in all CLI files

## Phase 6: Testing & Cleanup ✅ / ❌

- [ ] Run all 55 integration tests
- [ ] Fix any failures
- [ ] Run `cargo clippy` and fix warnings
- [ ] Run `cargo fmt`
- [ ] Update main README with public API examples

## Progress Tracking

**Completed work:** Move to `docs/completed/`

- Phase X completion notes
- Edge cases discovered
- Pattern variations used

**Current status:**

```
Phase 1: [x] Complete
Phase 2: [ ] Not started
Phase 3: [ ] Not started
Phase 4: [ ] Not started
Phase 5: [ ] Not started
Phase 6: [ ] Not started
```

## Quick Commands

```bash
# Compile library only
cargo build -p grimoire --lib

# Run integration tests
cargo test -p grimoire --test mod

# Generate docs
cargo doc --no-deps --open

# Run clippy
cargo clippy -p grimoire
```

## Notes / Issues

Use this section to track blockers, questions, or deviations from plan:

### Phase 1 Notes

- ✅ Decided to keep `error_type` field name instead of renaming to `type` - clearer and simpler
- ✅ Added `PartialEq` to `ErrorDetail` for testing support
- ✅ Added helper methods to `CommandOutput` for future CLI migration
- ✅ All foundation types compile and pass tests
