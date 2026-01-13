# api client codegen spike

generates type-safe typescript api clients from rust route definitions with runtime validation.

## quick start

```bash
make all      # generate client + typecheck
make server   # start axum server
make test     # run integration tests
make clean    # remove generated files
```

## architecture

### data flow

```
rust handler (handlers.rs)
  + inventory::submit! metadata
  |
  +---> axum router (mod.rs)
  |
  +---> codegen (generator.rs)
          |
          v
        generated typescript
          - schema.ts (zod schemas)
          - routes.ts (route config)
          |
          v
        hand-written client (client.ts)
          - dynamic fetch wrapper
```

### generation strategy

instead of generating fetch functions for each route:

1. generate data (route config + zod schemas)
2. write one dynamic client that handles all routes
3. get full type safety via typescript generics

## project structure

```
codegen-spike/
├── src/
│   ├── types/
│   │   ├── music.rs          # domain types (playlist, song, album)
│   │   ├── users.rs          # user domain types
│   │   └── mod.rs            # manual type registry
│   ├── server/
│   │   ├── handlers.rs       # handlers + inventory::submit! blocks
│   │   ├── route_def.rs      # routeinfo struct + inventory collection
│   │   └── mod.rs            # router builder
│   ├── codegen/
│   │   ├── generator.rs      # generates schema.ts + routes.ts
│   │   └── mod.rs
│   └── main.rs
│
├── freqhole-api-client/
│   ├── src/
│   │   ├── client.ts         # hand-written dynamic client
│   │   └── codegen/          # generated (don't edit)
│   │       ├── schema.ts
│   │       └── routes.ts
│   ├── test.ts               # integration tests + usage examples
│   ├── package.json
│   └── tsconfig.json
│
├── Makefile
└── README.md
```

## adding a new route

example: endpoint to add songs to a playlist

### 1. define types (src/types/music.rs)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongPosition {
    pub song_id: String,
    pub position: u32,
    pub added_by: String,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddSongsToPlaylistRequest {
    pub playlist_id: String,
    pub songs: Vec<SongPosition>,
    pub replace_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistUpdateResult {
    pub playlist_id: String,
    pub total_songs: u32,
    pub songs_added: u32,
    pub songs_skipped: u32,
    pub updated_at: i64,
}
```

### 2. register types (src/types/mod.rs)

```rust
pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
    // ... existing types ...

    gen.add_schema::<SongPosition>("SongPosition");
    registered.insert("SongPosition".to_string());

    gen.add_schema::<AddSongsToPlaylistRequest>("AddSongsToPlaylistRequest");
    registered.insert("AddSongsToPlaylistRequest".to_string());

    gen.add_schema::<PlaylistUpdateResult>("PlaylistUpdateResult");
    registered.insert("PlaylistUpdateResult".to_string());
}
```

### 3. add handler (src/server/handlers.rs)

```rust
pub async fn add_songs_to_playlist(
    Json(req): Json<AddSongsToPlaylistRequest>,
) -> Json<PlaylistUpdateResult> {
    // implementation
    Json(result)
}

inventory::submit! {
    RouteInfo {
        name: "add_songs_to_playlist",
        path: "/api/music/playlists/add-songs",
        method: Method::POST,
        request_type: "AddSongsToPlaylistRequest",
        response_type: "PlaylistUpdateResult",
    }
}
```

### 4. register route (src/server/mod.rs)

```rust
Router::new()
    // ... existing routes ...
    .route(r["add_songs_to_playlist"].path, post(handlers::add_songs_to_playlist))
```

### 5. add test (freqhole-api-client/test.ts)

```typescript
await test("add_songs_to_playlist - add songs with metadata", async () => {
  const result = await client.call<PlaylistUpdateResult>(
    "add_songs_to_playlist",
    {
      playlist_id: "my-playlist",
      songs: [
        {
          song_id: "song-1",
          position: 0,
          added_by: "user",
          added_at: 1704067200,
        },
        {
          song_id: "song-2",
          position: 1,
          added_by: "user",
          added_at: 1704067200,
        },
      ],
      replace_existing: false,
    },
  );

  if (!result.success) {
    throw new Error(`validation failed: ${result.error.message}`);
  }

  // full type safety on result.data
  console.log(`added ${result.data.songs_added} songs`);
});
```

### 6. regenerate

```bash
make all
```

typescript client now has the new endpoint with full type safety and runtime validation.

## implementation details

### route registration

handlers register metadata via inventory::submit!:

```rust
pub async fn get_playlist(Path(id): Path<String>) -> Json<Playlist> {
    Json(Playlist { id, title: "my playlist".to_string(), description: None })
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist",
        path: "/api/music/playlists/{id}",
        method: Method::GET,
        request_type: "String",
        response_type: "Playlist",
    }
}
```

inventory crate collects these at compile time across all modules.

### type registry

manual registry in src/types/mod.rs:

```rust
pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
    gen.add_schema::<Playlist>("Playlist");
    registered.insert("Playlist".to_string());

    gen.add_schema::<Song>("Song");
    registered.insert("Song".to_string());
    // etc
}
```

generator validates all route types are registered and fails fast with clear errors.

### code generation

outputs two files:

**schema.ts** - zod schemas from rust types:

```typescript
export const PlaylistSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;
```

**routes.ts** - route configuration:

```typescript
export const routes = {
  get_playlist: {
    method: "GET",
    path: "/api/music/playlists/{id}",
    req: null,
    resp: s.PlaylistSchema,
  },
  // ... all other routes
};
```

### dynamic client

single hand-written function handles all routes:

```typescript
async function call<T>(
  baseUrl: string,
  routeName: keyof typeof routes,
  params?: any,
): Promise<SafeParseResult<T>> {
  const route = routes[routeName];

  // validate request
  if (route.req && params) {
    const validated = route.req.safeParse(params);
    if (!validated.success) return { success: false, error: validated.error };
  }

  // interpolate path params
  let url = baseUrl + route.path.replace(/\{(\w+)\}/g, (_, key) => params[key]);

  // fetch
  const response = await fetch(url, { method: route.method, ... });
  const data = await response.json();

  // validate response
  return route.resp.safeParse(data);
}
```

## commands

```bash
make          # clean + codegen + typecheck
make server   # start axum server on :3000
make test     # start server + run integration tests
make clean    # remove generated files
```

## example usage

```typescript
import { createClient } from "./src/client.js";
import type { Playlist, PlaylistUpdateResult } from "./src/codegen/schema.js";

const client = createClient("http://localhost:3000");

// get playlist
const playlist = await client.call<Playlist>("get_playlist", {
  id: "playlist-123",
});

if (playlist.success) {
  console.log(playlist.data.title); // full type safety
}

// add songs
const result = await client.call<PlaylistUpdateResult>(
  "add_songs_to_playlist",
  {
    playlist_id: "my-playlist",
    songs: [
      {
        song_id: "song-1",
        position: 0,
        added_by: "user",
        added_at: Date.now(),
      },
    ],
    replace_existing: false,
  },
);

if (!result.success) {
  console.error("validation failed:", result.error.issues);
} else {
  console.log(`added ${result.data.songs_added} songs`);
}
```
