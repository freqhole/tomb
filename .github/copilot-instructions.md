# freqhole Development Guide

## Project Overview

freqhole is a SQLite-backed music library application with a Rust backend and TypeScript/SolidJS frontend. The project uses a monorepo structure with two main executables: `freqhole` (CLI + server), `server` (standalone Axum web server), and the shared `grimoire` library containing all business logic.

## Architecture

### Workspace Structure

```
grimoire/        # Shared business logic library (SQLite, domain models)
├── src/
│   ├── music/          # Music entities (songs, albums, artists, playlists)
│   ├── users/          # Auth, roles, favorites, ratings
│   ├── api_registry/   # Route metadata for codegen
│   ├── media_blobz/    # Blob storage
│   └── database.rs     # Single SQLite connection pool
server/          # Axum HTTP/WebSocket server
cli/             # Command-line interface (binary: freqhole)
client/spume/       # TypeScript client + SolidJS UI
client-codegen/  # TypeScript API client generator (Zod schemas)
├── freqhole-api-client/src/codegen/  # Generated TypeScript types + route config (do not edit schema.ts or routes.ts!)
migrations/      # SQLite migrations (managed by sqlx)
```

### Core Design Patterns

**1. Grimoire-First Development**: All domain logic lives in `grimoire`. Server and CLI are thin wrappers that call grimoire functions. Never put business logic in route handlers.

```rust
// ❌ WRONG: Business logic in server handler
pub async fn create_playlist_handler(Json(req): Json<CreatePlaylistRequest>) -> Result<Json<Playlist>> {
    let pool = database::connect().await?;
    // ... SQL queries here ...
}

// ✅ CORRECT: Handler delegates to grimoire
pub async fn create_playlist_handler(Json(req): Json<CreatePlaylistRequest>) -> Result<Json<Playlist>> {
    let response = grimoire::music::entities::playlists::create_playlist(req).await;
    response.data.ok_or_else(|| ApiError::Internal(response.message)).map(Json)
}
```

**2. Single Database Pattern**: One SQLite database (`data/grimoire.db`), managed through `grimoire::database::connect()`. All modules call this function to get a connection pool—no shared global pool.

**3. Offal Dispatch System**: Routes are defined in `grimoire/src/offal/` with metadata (path, method, auth level) and handlers in the same place. The server's `routes.rs` iterates `offal::all_routes()` to generate the router. TypeScript client codegen also uses `offal::all_routes()`.

```rust
// grimoire/src/offal/music/playlists.rs
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "get_playlist_by_id",
        path: "/api/music/playlists/{id}",  // Use {param}, not :param
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Playlist",
        auth: RouteAuth::Authenticated,
    },
];

pub async fn get(caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    // handler implementation
}
```

**4. Zod-Driven API Contracts**: Public API types derive `ZodSchema` (via `zod_gen_derive`). Register types in `grimoire/src/api_registry/type_registry.rs` for codegen.

```rust
use zod_gen_derive::ZodSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreatePlaylistRequest {
    pub title: Option<String>,
    pub description: Option<String>,
}
```

**5. CLI Plumbing Pattern**: CLI mirrors grimoire's public API structure. Commands in `cli/src/plumbing/` directly call grimoire functions and output JSON or formatted results.

## Development Workflows

### Building & Running

```bash
# Build everything for current platform
make build

# Build for Raspberry Pi (Docker-based cross-compile)
make build-pi

# Run server (requires config at freqhole-config.toml)
cargo run --bin server

# Run CLI
cargo run --bin freqhole -- music list-songs --json-output
```

### Database Management

```bash
# Reset database and run migrations (ask for confirmation)
make db-reset

# Run migrations only
make db-migrate

# Prepare sqlx query cache (only required for docker builds, local dev should be able to use the "online" sqlx feature; so never need to run db-prepare)
make db-prepare
```

### Testing

```bash
# Run all CLI integration tests (uses test DB snapshot)
make test-cli

# Run specific test pattern
make test-cli TEST=playlist

# Generate coverage report
make test-cli-coverage

# List all available tests
make test-cli-list
```

**Testing pattern**: CLI tests use `TestContext::from_snapshot()`, which points at the shared snapshot db `data/test.db` directly (no per-test copy - tests share and mutate it) and provides `run_cli()` / `run_json()` helpers. `from_snapshot()` holds a process-wide lock for its lifetime, so tests serialize safely under cargo's default multi-threaded test runner - `--test-threads=1` is no longer required, just a harmless extra safety belt if you want it. see [cli/tests/README.md](../cli/tests/README.md) for how to regenerate the snapshot or fix a poisoned migration checksum.

### Client Development

```bash
cd client/spume

# Development server with hot reload
npm run dev:freqhole

# Build production bundle
npm run build:freqhole

# Run tests
npm test

# Generate TypeScript API client
cd ../client-codegen && make all
```

**Client architecture**: SolidJS-based SPA with IndexedDB for offline storage, Tailwind for styling. Located in `client/spume/src/views/freqhole/`. Uses generated API client from `client-codegen/freqhole-api-client/`.

## Adding New Features

Follow this order (see [docs/HOW_TO_ADD_FEATURES.md](docs/HOW_TO_ADD_FEATURES.md) for full examples):

1. **Define types in grimoire** (`grimoire/src/music/entities/*/models.rs`)
2. **Implement repository function** (`grimoire/src/music/entities/*/repository.rs`)
3. **Register types for codegen** (`grimoire/src/api_registry/type_registry.rs`)
4. **Add CLI plumbing command** (`cli/src/plumbing/*.rs`)
5. **Create server route handler** (`server/src/music/*.rs`)
6. **Register route** (`server/src/routes.rs`)
7. **Generate TypeScript client** (`cd client-codegen && make all`)

## Configuration

**Location**: `freqhole-config.toml` (TOML format with comments)

**Key settings**:

- `data_dir`: Base directory for all data (default: `data/`)
- `database.filename`: SQLite database file (default: `grimoire.db`)
- `server.host` / `server.port`: Server bind address (CLI doesn't need this)

**Environment**: `.env` file supported via `dotenvy` crate. Makefile automatically includes it.

## Common Patterns

### Error Handling

use `GrimoireResult<T>` and `GrimoireResponse<T>` from grimoire. server converts to HTTP responses via `ApiError`.

**ErrorDetail** is the standard error structure (RFC 9457 style):

- `error_type`: snake_case identifier for programmatic handling (e.g., `"duplicate_song"`)
- `title`: human-readable summary
- `detail`: specific error message

**DO: use specific error types** - add variants to `GrimoireError` for distinct conditions:

```rust
// good: specific error type that client can detect
return Err(GrimoireError::DuplicateSong { blob_id: id.to_string() });
```

**DON'T: encode error info in strings**:

```rust
// bad: error type hidden in message string
return Err(GrimoireError::ProcessingFailed {
    message: "[DUPLICATE_SONG] already exists".to_string(),
});
```

**client-side: check error_type, not strings**:

```typescript
// good: check structured error_type
if (errors?.some(e => e.error_type === "duplicate_song")) { ... }

// bad: fragile string matching
if (errorMessage?.includes("duplicate")) { ... }
```

**known issues (avoid propagating)**:

- `GrimoireError::ProcessingFailed` is overused (~69 places) - prefer specific variants
- `ApiError::BadRequest(String)` loses structured typing (~42 places) - future refactor target
- `GrimoireResponse::failure("...", vec![])` with empty errors loses error_type (~54 places)

see [docs/error-handling.md](docs/error-handling.md) for full error handling guide and audit findings.

### Route Path Parameters

Axum 0.8+ uses `{param}` syntax, not `:param`:

```rust
// ✅ CORRECT
path: "/api/music/playlists/{id}"

// ❌ WRONG
path: "/api/music/playlists/:id"
```

### SQLite Best Practices

- Always use WAL mode (automatic via `database::connect()`)
- Prefer `query_as!` macro for compile-time checked queries
- Use `?` placeholders for parameters (not `$1` like PostgreSQL)
- Foreign keys are enabled by default
- **Never edit an already-existing migration file** (in this repo or any sibling repo's own
  migrations directory - haruspex, reliquary, skein) **unless there's a specific, deliberate
  reason to.** sqlx stores a checksum of each migration file's content in `_sqlx_migrations`
  the first time it's applied to a database; editing the file afterward changes that checksum
  and breaks every database that already applied it with `"migration N was previously applied
but has been modified"` errors. this applies even to comment-only changes and even to files
  that "look old"/unused - if a migration needs a note (e.g. marking tables as superseded and
  pending a future drop), put that note in `CUTOVER_BACKLOG.md` or a regular source-code comment
  near where the table is used, never inside the migration file itself. genuine schema fixes to
  an already-applied migration require the explicit checksum-repair procedure in
  `cli/tests/README.md#fixing-migration-n-was-previously-applied-but-has-been-modified` - never
  just silently re-edit and move on.

## Code Style

### Lowercase Prose Preference

Write comments, documentation, and user-facing messages in lowercase conversational style.

**Keep uppercase for:**

- Acronyms: API, HTTP, JSON, SQL, CRUD, REST, CLI
- Proper nouns: Rust, TypeScript, GitHub, SQLite, PostgreSQL
- Code identifiers: function names, type names, constants
- Special markers: TODO, FIXME, NOTE, WARNING

**Use lowercase for:**

- Regular comments explaining logic
- Documentation/docstrings
- Error messages and user-facing strings
- Log messages

**Examples:**

```rust
// ✅ GOOD
// extract album metadata from file tags
let metadata = parse_tags(&file)?;

return Err(GrimoireError::NotFound("playlist not found".to_string()));

// TODO: add support for batch operations
```

```rust
// ❌ AVOID
// Extract Album Metadata From File Tags
let metadata = parse_tags(&file)?;

return Err(GrimoireError::NotFound("Playlist Not Found".to_string()));

// Todo: Add Support For Batch Operations
```

### No Emojis in Code

Avoid emojis in comments, error messages, or any code. Use them only in markdown documentation if appropriate.

## Conventions

- **Naming**: Use `snake_case` for Rust and TypeScript (tho `camelCase` is used)
- **File organization**: Group by feature/entity, not by layer (e.g., `music/entities/playlists/` contains models + repository)
- **Binary names**: CLI binary is `freqhole` (includes `serve`, `http`, `p2p` commands), standalone server binary is `server`
- **Documentation**: AI-generated docs live in `docs/`, with `docs/INDEX.md` as the entry point
- **Migrations**: Numbered sequentially (`001_*.sql`), use descriptive names

## Key Files to Reference

- [Makefile](Makefile) - Build targets, test commands, database management
- [docs/HOW_TO_ADD_FEATURES.md](docs/HOW_TO_ADD_FEATURES.md) - Complete feature implementation guide
- [grimoire/src/lib.rs](grimoire/src/lib.rs) - Public API surface of grimoire library
- [server/src/routes.rs](server/src/routes.rs) - All HTTP route registrations
- [cli/src/main.rs](cli/src/main.rs) - CLI command structure
- [client/spume/package.json](client/spume/package.json) - Frontend build scripts

## Quirks & Gotchas

- **This is mostly AI-generated code** - Expect unconventional patterns and over-documentation
- **Legacy artifacts**: `legacycli/`, `legacylib/`, `legacyserver/` are deprecated, ignore them
- **Config must be initialized first**: Call `grimoire::config::init_config()` before any database operations
- **Docker builds for cross-compilation**: Native cross-compilation is fragile; use `make build-pi` or `make build-linux`

## Never use git mutation commands without explicit permission

Do not run `git stash`, `git checkout -- <file>`, `git reset`, `git restore`, `git clean`, or any
other command that discards or rewrites working-tree/history state - including as a "temporary"
step (e.g. to check whether a test fails against the pre-fix version of a file, or to quickly
undo an edit). This applies even when the intent is to immediately restore the change afterward

- a crash, tool failure, or mistake mid-sequence can lose uncommitted work with no way to recover
  it, and the user may have other uncommitted changes sitting in the same working tree.

Instead:

- To check a test against "before the fix": use the edit tool to manually revert the specific
  change, run the test, then use the edit tool again to re-apply the fix. Never use git for this.
- To undo an edit you just made: use the edit tool to change it back, don't `git checkout`/
  `git restore` the file.
- Read-only git commands (`git status`, `git diff`, `git log`, `git show`) are fine.
