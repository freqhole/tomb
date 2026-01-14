# how to add a feature

end-to-end guide for implementing a new feature across the workspace.

## 1. grimoire: add business logic

### create types

```rust
// grimoire/src/music/entities/playlists/models.rs
use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreatePlaylistRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub created_by_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_public: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub song_count: i64,
}
```

### implement repository function

```rust
// grimoire/src/music/entities/playlists/repository.rs
use crate::database;
use crate::response::GrimoireResponse;
use super::models::{CreatePlaylistRequest, Playlist};

pub async fn create_playlist(req: CreatePlaylistRequest) -> GrimoireResponse<Playlist> {
    let pool = database::connect().await?;

    // implementation...

    GrimoireResponse::success("Playlist created", playlist)
}
```

### export from entity module

```rust
// grimoire/src/music/entities/playlists/mod.rs
mod models;
mod repository;

pub use models::{CreatePlaylistRequest, Playlist};
pub use repository::{create_playlist, get_playlist};
```

### register types for codegen

```rust
// grimoire/src/api_registry/mod.rs
pub mod type_registry {
    use crate::music::entities::playlists::{CreatePlaylistRequest, Playlist};

    pub fn register_all_types(gen: &mut ZodGenerator, registered: &mut HashSet<String>) {
        // ... existing types ...

        gen.add_schema::<CreatePlaylistRequest>("CreatePlaylistRequest");
        registered.insert("CreatePlaylistRequest".to_string());

        gen.add_schema::<Playlist>("Playlist");
        registered.insert("Playlist".to_string());
    }
}
```

## 2. cli: add plumbing command

```rust
// cli/src/plumbing/music.rs
use clap::Subcommand;
use grimoire::music::entities::playlists::{create_playlist, CreatePlaylistRequest};

#[derive(Subcommand)]
pub enum MusicAction {
    CreatePlaylist {
        #[arg(long)]
        title: String,
    },
}

pub async fn handle_music_action(action: MusicAction) -> Result<()> {
    match action {
        MusicAction::CreatePlaylist { title } => {
            let req = CreatePlaylistRequest {
                title: Some(title),
                description: None,
                is_public: None,
                created_by_id: None,
            };
            let response = create_playlist(req).await;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
    }
    Ok(())
}
```

## 3. server: add route handler

```rust
// server/src/music/playlists.rs
use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::entities::playlists::{create_playlist, CreatePlaylistRequest, Playlist};
use crate::auth::middleware::AuthenticatedUser;
use crate::error::ApiError;

pub async fn create_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<CreatePlaylistRequest>,
) -> Result<Json<Playlist>, ApiError> {
    req.created_by_id = Some(user.user_id);

    let response = create_playlist(req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_playlist",
        path: "/api/music/playlists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreatePlaylistRequest",
        response_type: "Playlist",
    }
}

// path parameters use {param} syntax (axum v0.7+)
inventory::submit! {
    RouteInfo {
        name: "get_playlist_by_id",
        path: "/api/music/playlists/{id}",  // use {id}, not :id
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Playlist",
    }
}
```

### register route

```rust
// server/src/routes.rs
pub fn build_router() -> Router<AppState> {
    let routes = api_registry::all_routes_map();

    let protected_routes = Router::new()
        .route(
            routes["music"]["create_playlist"].path,
            post(music::playlists::create_playlist_handler),
        )
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // ... rest of router
}
```

## 4. client-codegen: generate typescript

```bash
cd client-codegen
make all
```

### verify output

```typescript
// client-codegen/freqhole-api-client/src/codegen/schema.ts
export const CreatePlaylistRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  is_public: z.boolean().optional(),
  created_by_id: z.string().optional(),
});

export const PlaylistSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  is_public: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
  song_count: z.number(),
});

// client-codegen/freqhole-api-client/src/codegen/routes.ts
export const routes = {
  music: {
    create_playlist: {
      name: "create_playlist",
      path: "/api/music/playlists",
      method: "POST",
      requestSchema: CreatePlaylistRequestSchema,
      responseSchema: PlaylistSchema,
    },
  },
};
```

## checklist

- [ ] types in `grimoire/src/music/entities/*/models.rs` with `#[derive(ZodSchema)]`
- [ ] repository functions in `grimoire/src/music/entities/*/repository.rs`
- [ ] exports in entity `mod.rs`
- [ ] types registered in `grimoire/src/api_registry/mod.rs::type_registry`
- [ ] cli plumbing command in `cli/src/plumbing/`
- [ ] server handler in `server/src/music/` with `inventory::submit!`
- [ ] route registered in `server/src/routes.rs` using `routes[domain][name].path`
- [ ] codegen run: `cd client-codegen && make all`
- [ ] verify generated `schema.ts` and `routes.ts`

## path patterns

```
grimoire::music::entities::playlists::{create_playlist, Playlist}
grimoire::music::entities::artists::{create_artist, Artist}
grimoire::music::crud::{add_song, query_songs}  // workflows only
```

## domain namespacing

all routes use domain prefix:

- `/api/auth/*` - authentication
- `/api/music/*` - music domain
- `/api/app/*` - app-level operations

## path parameters

use `{param}` syntax (axum v0.7+), not `:param`:

- ✓ `/api/music/playlists/{id}`
- ✗ `/api/music/playlists/:id`
