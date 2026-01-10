# Grimoire Public API Architecture Plan

## Problem Statement

Grimoire is a library with many public functions, but it's unclear what's public API vs internal implementation. We need to establish clear patterns for:

1. **Visibility** - What's `pub` (public API) vs `pub(crate)` (internal)
2. **Response types** - Consistent return types across all public functions
3. **Import style** - No inline `crate::`, proper imports at top
4. **Organization** - Clear structure so developers immediately understand the codebase

**Goal:** Make grimoire's public API crystal clear through Rust conventions, not documentation.

## Core Principle

Grimoire is a **library**. Its public API should be obvious from the code itself:

- `pub fn` = Public API (anyone can use)
- `pub(crate) fn` = Internal (only grimoire can use)
- Private = Implementation detail (only this module)

## Current State

### What's Working

- Public functions already exist throughout grimoire (e.g., `music::crud::update_songs`)
- Request types exist with proper derives
- Domain logic is well-organized by module
- Functions are in logical files (update.rs, query.rs, etc.)

### What's Broken

- **No visibility distinction** - Everything is `pub`, no `pub(crate)`
- **Inconsistent return types** - Some `Result<T>`, some `CommandOutput<T>`, some print directly
- **Inline `crate::`** - Makes code hard to read, dependencies unclear
- **Unclear boundaries** - Can't tell what's public API vs internal helper
- **No standard response wrapper** - Each function does its own thing

### Example of Current Issues

```rust
// grimoire/src/music/crud/update.rs
use crate::music::crud::models::UpdateSongsRequest; // inline crate::
use crate::error::GrimoireResult;                   // inline crate::

pub async fn update_songs(request: UpdateSongsRequest) -> GrimoireResult<UpdateSongsResult> {
    // ... calls internal helpers that are also pub
    let result = internal_helper().await?; // This is pub but shouldn't be!
    Ok(result)
}

pub async fn internal_helper() -> GrimoireResult<Something> {
    // This is exposed publicly but it's just an implementation detail!
}
```

## Proposed Solution

### 1. Create Standard Response Type

```rust
// grimoire/src/response.rs (NEW FILE)
use serde::{Deserialize, Serialize};

/// Standard response wrapper for all grimoire public APIs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrimoireResponse<T> {
    /// Operation success status
    pub success: bool,
    /// Human-readable message
    pub message: String,
    /// Response data (Some if success, None if failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    /// Error details (empty if success)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ErrorDetail>,
}

impl<T> GrimoireResponse<T> {
    pub fn success(message: impl Into<String>, data: T) -> Self {
        Self {
            success: true,
            message: message.into(),
            data: Some(data),
            errors: vec![],
        }
    }

    pub fn failure(message: impl Into<String>, errors: Vec<ErrorDetail>) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: None,
            errors,
        }
    }
}

/// Error detail (move from cli/utils.rs or keep there and re-export)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorDetail {
    #[serde(rename = "type")]
    pub error_type: String,
    pub title: String,
    pub detail: String,
}
```

### 2. Update Public Functions

```rust
// grimoire/src/music/crud/update.rs (AFTER REFACTOR)
use super::models::UpdateSongsRequest; // Clean imports at top
use crate::response::GrimoireResponse;
use crate::error::GrimoireError;

/// Public API: Update multiple songs
/// This is the public interface - anyone can call this
pub async fn update_songs(request: UpdateSongsRequest) -> GrimoireResponse<UpdateSongsResult> {
    match execute_update(request).await {
        Ok(result) => {
            let message = format!("Updated {} songs", result.updated_count);
            GrimoireResponse::success(message, result)
        }
        Err(err) => {
            GrimoireResponse::failure("Failed to update songs", vec![err.into()])
        }
    }
}

/// Internal helper - only grimoire code can call this
pub(crate) async fn execute_update(request: UpdateSongsRequest) -> Result<UpdateSongsResult, GrimoireError> {
    // Implementation details
    Ok(UpdateSongsResult { /* ... */ })
}

/// Private to this file only
async fn validate_song_ids(ids: &[String]) -> Result<(), GrimoireError> {
    // ...
}
```

### 3. Use Rust Visibility Patterns

```rust
// Public API - External code can use
pub async fn query_songs() -> GrimoireResponse<T>

// Crate-internal - Only grimoire internals
pub(crate) async fn query_songs_internal() -> Result<T, E>
pub(crate) struct InternalHelper;

// Module-internal - Only parent module
pub(super) fn used_by_parent()

// File-private (default)
async fn validate_input()
```

### 4. Clean Import Style

**Before:**

```rust
use crate::music::crud::models::UpdateSongsRequest;
use crate::music::crud::query::query_songs;
use crate::database::connect;
use crate::error::GrimoireError;

pub async fn some_function() {
    let pool = crate::database::connect().await?; // NO!
    crate::music::crud::update_songs(req).await?; // NO!
}
```

**After:**

```rust
use super::models::UpdateSongsRequest;  // Same module
use super::query::query_songs;          // Same parent
use crate::database;                    // Top-level
use crate::error::GrimoireError;

pub async fn some_function() {
    let pool = database::connect().await?;  // Clean!
    query_songs(req).await?;                // Clean!
}
```

### 5. Module Organization Pattern

```
music/crud/
├── mod.rs           # Re-exports public API
├── models.rs        # Public types
├── update.rs        # Public: update_songs()
├── query.rs         # Public: query_songs()
├── import.rs        # Public: import_songs()
└── helpers.rs       # pub(crate): shared internal code
```

```rust
// grimoire/src/music/crud/mod.rs
pub mod models;  // All request/response types

// Public API functions
mod update;
mod query;
mod import;

pub use update::update_songs;
pub use query::{query_songs, list_recent_songs};
pub use import::import_song;

// Internal helpers
pub(crate) mod helpers;
```

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Step 1: Create response type**

- [ ] Create `grimoire/src/response.rs`
- [ ] Define `GrimoireResponse<T>`
- [ ] Move or re-export `ErrorDetail`
- [ ] Implement `From<GrimoireError>` for `ErrorDetail`
- [ ] Add to `grimoire/src/lib.rs`

**Step 2: Document visibility patterns**

- [ ] Create doc comment templates for `pub` functions
- [ ] Create doc comment templates for `pub(crate)` functions
- [ ] Document when to use each visibility level

### Phase 2: Audit Existing Code (Week 1-2)

**Step 1: Map the public API**

- [ ] List all functions currently called by CLI
- [ ] List all functions that should be public
- [ ] Identify functions that should be `pub(crate)`
- [ ] Document in a spreadsheet/table

**Step 2: Identify patterns**

- [ ] How many different return types exist?
- [ ] Which modules need the most work?
- [ ] Are there common helper functions to extract?

### Phase 3: Refactor One Module (Reference Implementation)

**Pick: `grimoire/src/users/` (smallest, most self-contained)**

**Step 1: Update visibility**

- [ ] Mark internal functions as `pub(crate)`
- [ ] Keep public API as `pub`
- [ ] Update mod.rs to clearly show what's exported

**Step 2: Update return types**

- [ ] Change public functions to return `GrimoireResponse<T>`
- [ ] Keep internal functions returning `Result<T, E>`
- [ ] Handle error conversion in public function

**Step 3: Clean imports**

- [ ] Remove all inline `crate::` usage
- [ ] Add proper imports at top of files
- [ ] Group imports logically (super, crate, std)

**Step 4: Test**

- [ ] Ensure existing code still compiles
- [ ] Update any calling code
- [ ] Document the pattern

**Example PR/Commit:**

```
Refactor users module to use GrimoireResponse and visibility

- Public API (pub): register_user, list_users, etc.
- Internal (pub(crate)): UserService, UserRepository
- Return GrimoireResponse<T> from all public functions
- Clean imports, no inline crate::
```

### Phase 4: Apply Pattern to All Modules

For each module in priority order:

1. `grimoire/src/jobs/`
2. `grimoire/src/analytics/`
3. `grimoire/src/wordlist/`
4. `grimoire/src/music/crud/`
5. `grimoire/src/music/scanner/`
6. `grimoire/src/music/entities/`

**For each module:**

- [ ] Update visibility (`pub` vs `pub(crate)`)
- [ ] Change public functions to return `GrimoireResponse<T>`
- [ ] Clean up imports
- [ ] Update mod.rs to show clear exports
- [ ] Test compilation
- [ ] Document changes

### Phase 5: Verify Public API

**Step 1: Generate documentation**

- [ ] Run `cargo doc --no-deps`
- [ ] Review public API documentation
- [ ] Ensure only intended items are public
- [ ] Add missing doc comments

**Step 2: Create public API summary**

- [ ] Document all public modules
- [ ] Document all public functions
- [ ] Create usage examples
- [ ] Add to main README

### Phase 6: CLI Refactor (After Library is Clean)

NOW that the library is clean with clear public APIs, update CLI:

**Step 1: Update CLI to use GrimoireResponse**

- [ ] Add conversion: `GrimoireResponse<T>` → `CommandOutput<T>`
- [ ] Update CLI handlers to call public API
- [ ] Remove any direct service/repository calls
- [ ] Simplify CLI router

**Step 2: Simplify CLI handlers**

- [ ] Each handler just calls public API
- [ ] Convert response
- [ ] No business logic in CLI

**Step 3: Test CLI**

- [ ] Run all 55 integration tests
- [ ] Fix any failures
- [ ] Verify JSON output
- [ ] Verify error handling

### Phase 7: Final Cleanup

- [ ] Remove any unused `pub` items
- [ ] Run `cargo clippy` and fix warnings
- [ ] Run `cargo fmt`
- [ ] Update all documentation
- [ ] Create ARCHITECTURE.md with patterns

## File Structure (After Refactor)

```
grimoire/src/
├── lib.rs                    # Re-exports public modules
├── response.rs               # NEW: GrimoireResponse<T>
├── error.rs                  # GrimoireError + ErrorDetail
├── config.rs                 # Public config types
├── database.rs               # pub(crate) - internal
│
├── users/
│   ├── mod.rs               # Re-exports public API clearly
│   ├── models.rs            # PUBLIC: Request/Response types
│   ├── register.rs          # PUBLIC: register_user()
│   ├── list.rs              # PUBLIC: list_users()
│   ├── service.rs           # pub(crate): Business logic
│   ├── repository.rs        # pub(crate): Database
│   ├── favorites.rs         # pub(crate) or private
│   └── ratings.rs           # pub(crate) or private
│
├── jobs/
│   ├── mod.rs               # Re-exports public API
│   ├── models.rs            # PUBLIC
│   ├── queue.rs             # PUBLIC: list_jobs(), run_job()
│   ├── service.rs           # pub(crate)
│   └── ...
│
├── music/
│   ├── mod.rs
│   ├── models.rs            # PUBLIC: Common types
│   ├── crud/
│   │   ├── mod.rs          # Re-exports public CRUD functions
│   │   ├── models.rs       # PUBLIC: Request/Response
│   │   ├── update.rs       # PUBLIC: update_songs()
│   │   ├── query.rs        # PUBLIC: query_songs()
│   │   ├── import.rs       # PUBLIC: import_song()
│   │   └── helpers.rs      # pub(crate): Internal helpers
│   ├── scanner/
│   │   ├── mod.rs
│   │   ├── scan.rs         # PUBLIC: scan_directory()
│   │   └── processor.rs    # pub(crate)
│   └── entities/
│       ├── songs/
│       ├── artists/
│       └── ...
│
├── analytics/
│   ├── mod.rs
│   ├── models.rs            # PUBLIC
│   ├── events.rs            # PUBLIC: record_event()
│   ├── queries.rs           # PUBLIC: get_stats()
│   └── repository.rs        # pub(crate)
│
├── wordlist/
│   ├── mod.rs
│   ├── generate.rs          # PUBLIC: generate_wordlist()
│   └── validate.rs          # PUBLIC: validate_code()
│
└── cli/                      # EXTERNAL - uses public API
    ├── mod.rs               # Router
    ├── users.rs             # Thin wrapper
    ├── jobs.rs              # Thin wrapper
    ├── music/               # Organized by domain
    └── utils.rs             # CLI-specific formatting
```

## Public API Contract (After Refactor)

```rust
// Users
use grimoire::users::{register_user, list_users};
use grimoire::users::models::{CreateUserRequest, UserListResponse};

let response = register_user(request).await;
if response.success {
    let user = response.data.unwrap();
}

// Music
use grimoire::music::crud::{update_songs, query_songs};
use grimoire::music::crud::models::UpdateSongsRequest;

let response = update_songs(request).await;

// Jobs
use grimoire::jobs::{list_jobs, run_processor};

let response = list_jobs(params).await;

// Analytics
use grimoire::analytics::{record_event, get_user_stats};

let response = record_event(event).await;
```

## Benefits

1. **Crystal clear** - `pub` vs `pub(crate)` makes API obvious
2. **Consistent** - All public functions return `GrimoireResponse<T>`
3. **Readable** - Clean imports, no inline `crate::`
4. **Maintainable** - Clear what's public vs internal
5. **Discoverable** - `cargo doc` shows clean public API
6. **Testable** - Can test public API without internal knowledge
7. **Reusable** - Future HTTP server uses same API
8. **Professional** - Follows Rust best practices

## Design Decisions

### Why GrimoireResponse<T>?

- Consistent across all public functions
- Always serializable
- Works for both CLI and future HTTP
- Doesn't require Result enum complexity
- Clear success/failure with details

### Why pub(crate) for services/repositories?

- Makes boundaries explicit
- Prevents external coupling to internals
- Documentation clearly shows public API
- Can refactor internals without breaking API

### Why clean imports?

- Easier to read
- Standard Rust convention
- Makes dependencies explicit
- Easier to refactor

### Why keep existing file organization?

- Don't break what works
- update.rs, query.rs, etc. already make sense
- Just need to clarify visibility
- Add response wrapper

### Why do library refactor before CLI?

- Library is the foundation
- Clean library makes CLI trivial
- Can test library independently
- Patterns become obvious

## Success Criteria

- [ ] All public functions return `GrimoireResponse<T>`
- [ ] All internal code marked `pub(crate)` or private
- [ ] Zero inline `crate::` usage
- [ ] `cargo doc` shows clean public API
- [ ] All CLI tests pass
- [ ] Can call any public function without seeing internals
- [ ] New developers can immediately identify public API

## Next Steps

1. Get approval on this approach
2. Create `grimoire/src/response.rs`
3. Refactor users module as reference
4. Review and iterate on pattern
5. Apply to all other modules
6. Update CLI to use clean API
7. Run full test suite
8. Document public API
