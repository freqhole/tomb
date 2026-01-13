# API Client Codegen Spike

A working prototype for generating type-safe TypeScript API clients from Rust route definitions.

## Current Status: Working Prototype

This spike successfully demonstrates:
- Single source of truth for API routes (`src/server/routes.rs`)
- Type-safe route definitions using Rust types
- Axum server that uses the route registry
- TypeScript client generator with Zod validation
- Clean separation between server and codegen concerns

## Quick Start

```bash
# Generate TypeScript client and typecheck
make all

# Start the server
make server

# Clean generated files
make clean
```

Then open `freqhole-api-client/test.html` in a browser to test the API.

## Project Structure

```
codegen-spike/
├── src/
│   ├── types/              # Domain types (like grimoire)
│   │   ├── music.rs        # Music domain (Playlist, Song, Album)
│   │   └── users.rs        # User domain (User, LoginRequest, etc)
│   ├── server/
│   │   ├── route_def.rs    # Route infrastructure (Method, RouteDefinition, macros)
│   │   ├── routes.rs       # ROUTE REGISTRY - single source of truth!
│   │   ├── handlers.rs     # Axum handlers (mock implementations)
│   │   └── mod.rs          # Router builder
│   ├── codegen/
│   │   ├── generator.rs    # Main codegen orchestration
│   │   ├── templates.rs    # TypeScript r# format! strings
│   │   └── mod.rs
│   └── main.rs             # Entry point (server or codegen mode)
├── freqhole-api-client/
│   ├── package.json        # Static npm config
│   ├── test.html           # Test page
│   └── src/                # Generated code (cleaned on rebuild)
└── Makefile                # One command: make all
```

## Key Design Patterns

### Route Registry (Single Source of Truth)

All routes defined in `src/server/routes.rs`:

```rust
pub mod playlists {
    pub fn routes() -> HashMap<&'static str, RouteDefinition> {
        routes![
            route!(
                "list",                              // Key for HashMap
                "listPlaylists",                     // Function name
                "/api/music/playlists/list",         // Path
                Method::POST,                        // HTTP method
                "music/playlists",                   // Module path for TS
                QueryParams,                         // Request type
                Vec<PlaylistQueryResult>             // Response type
            ),
            route!(
                "get",
                "getPlaylist",
                "/api/music/playlists/{id}",         // Note: {id} not :id
                Method::GET,
                "music/playlists",
                String,
                Playlist
            ),
        ]
    }
}
```

### Server Uses Routes

In `src/server/mod.rs`:

```rust
let playlist_routes = playlists::routes();

Router::new()
    .route(&playlist_routes["list"].path, post(handlers::list_playlists))
    .route(&playlist_routes["get"].path, get(handlers::get_playlist))
```

### Codegen Uses Routes

In `src/codegen/generator.rs`:

```rust
let all_routes = routes::all_routes();
codegen::generate_all(all_routes)?;
```

### TypeScript Templates

Isolated in `src/codegen/templates.rs` for easy editing. All `r#` format strings live here.

## Current Issues to Address

### 1. Import Path Complexity

The generated code has nested directories which makes TypeScript imports complex:

```
src/
├── types.ts
├── config.ts
├── api/
│   ├── music/
│   │   ├── playlists/index.ts  // imports from ../../../types.ts
│   │   ├── songs/index.ts
│   │   └── albums/index.ts
│   └── users/index.ts
└── index.ts
```

**Proposed Solution**: Generate just 2 flat files:
- `schema.ts` - All Zod schemas and types
- `api-client.ts` - All fetch functions in one file with namespace structure

This eliminates import path headaches and makes the generator much simpler.

### 2. Macro Complexity

The `route!` and `routes!` macros work but could be simpler. Consider if plain HashMap construction is more readable.

### 3. Path Parameters

Currently `{id}` in paths like `/api/users/{id}` are handled as `String` params. Need proper path parameter extraction.

## Next Steps

1. **Simplify codegen output to 2 files** (most important!)
   - `schema.ts` - one file with all Zod schemas
   - `api-client.ts` - one file with all fetch functions
   - Use namespace objects like: `api.music.playlists.list()`

2. **Clean up route macro syntax**
   - Maybe remove macro complexity if it's not helping

3. **Add path parameter handling**
   - Parse `{id}` from paths
   - Generate proper TypeScript function signatures

4. **Test with real grimoire types**
   - Apply pattern to actual server routes
   - Verify it scales to 50+ routes

## Running Examples

### Generate and test:
```bash
make all
make server
# Open freqhole-api-client/test.html in browser
```

### Test a route manually:
```bash
curl -X POST http://localhost:3000/api/music/playlists/list \
  -H 'Content-Type: application/json' \
  -d '{"limit": 10}'
```

### Add a new route:
1. Add type to `src/types/music.rs` with `#[derive(ZodSchema)]`
2. Add route to `src/server/routes.rs` in appropriate module
3. Add handler to `src/server/handlers.rs`
4. Wire handler in `src/server/mod.rs`
5. Run `make all` - client auto-updates!

## Important Files

- `src/server/routes.rs` - **THE ROUTE REGISTRY** - edit this to add routes
- `src/codegen/templates.rs` - All TypeScript template strings
- `src/codegen/generator.rs` - Orchestration logic
- `freqhole-api-client/test.html` - Test UI

## Design Philosophy

- **Simplicity over cleverness** - prefer boring code
- **Fewer files = better** - 2 generated files instead of 20
- **No manual sync** - define once, generate everywhere
- **Compiler help** - type-safe route definitions
- **Edit templates easily** - keep r# strings isolated

## Known Working

✅ Type-safe route definitions with `std::any::type_name`
✅ Axum server using route registry
✅ Zod schema generation
✅ Functional fetch wrappers
✅ Test HTML page
✅ Makefile with one command
✅ Clean separation of concerns

## Ready for Next Iteration

The core pattern works! Now simplify the output to 2 files and it's ready to apply to the real codebase.
