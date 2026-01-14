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

## database migrations

when adding new columns or tables, create a migration file:

```bash
# create migration file
touch migrations/011_add_content_id_to_media_blobz.sql
```

```sql
-- migrations/011_add_content_id_to_media_blobz.sql
ALTER TABLE media_blobz ADD COLUMN content_id TEXT;

-- index for fast lookups
CREATE INDEX idx_media_blobz_content_id ON media_blobz(content_id)
WHERE content_id IS NOT NULL;
```

**run migrations**:

```bash
make db-migrate
```

this must be done before `cargo check` will succeed (sqlx validates queries at compile time).

## sqlx query macros

always use sqlx macros (`query!` or `query_as!`) for compile-time validation:

```rust
// ✓ good - compile-time checked
let row = sqlx::query!(
    r#"SELECT id as "id!", title FROM songs WHERE id = ?"#,
    song_id
)
.fetch_one(&pool)
.await?;

// ✗ bad - runtime only, no type safety
let row = sqlx::query("SELECT id, title FROM songs WHERE id = ?")
    .bind(song_id)
    .fetch_one(&pool)
    .await?;
```

**NOT NULL hints**: use `as "column_name!"` to tell sqlx a column is NOT NULL:

```rust
// returns String, not Option<String>
r#"SELECT id as "id!" FROM table WHERE ..."#
```

**import at top**: avoid inline `crate::` - import at top of file:

```rust
// ✓ good
use crate::database;
use crate::config::get_config;

fn my_function() {
    let pool = database::connect().await?;
    let config = get_config();
}

// ✗ bad
fn my_function() {
    let pool = crate::database::connect().await?;
    let config = crate::config::get_config();
}
```

## job system patterns

the grimoire job system provides unified background task processing with retry logic and session support.

### job types

jobs are defined in `grimoire/src/jobs/models.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ZodSchema)]
pub enum JobType {
    ScanDirectory,
    ProcessFile,
    ExtractMetadata,
    GenerateThumbnail,
    GenerateWaveform,
    FetchMedia,  // your custom job type
}
```

### creating a job

jobs use `CreateJobRequest` with JSON parameters:

```rust
use grimoire::jobs::{create_job, CreateJobRequest, JobType};
use serde_json::json;

let job_request = CreateJobRequest {
    job_type: JobType::FetchMedia,
    session_id: None,  // or Some(session_id) for batch operations
    parameters: json!({
        "url": "https://example.com/media",
        "user_id": user.id,
    }),
    max_retries: Some(3),
    scheduled_at: None,  // None = immediate, Some(timestamp) = scheduled
    created_by: Some("cli".to_string()),
};

let response = create_job(job_request).await;
```

### job parameters

define strongly-typed parameters:

```rust
// grimoire/src/jobs/models.rs or your domain module
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchMediaParams {
    pub url: String,
    pub user_id: Option<String>,
}
```

### processing jobs

implement job processor in `grimoire/src/jobs/service.rs`:

```rust
async fn process_fetch_media_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing fetch media job: {}", job.id);

    // parse parameters
    let params: FetchMediaParams = serde_json::from_str(&job.parameters)
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("invalid parameters: {}", e),
        })?;

    // get config
    let config = get_config();

    // do work
    let result = fetch_media(params, &job.id, config).await;

    if !result.success {
        return Err(JobError::ProcessingFailed {
            reason: result.message,
        });
    }

    // return result as JSON
    Ok(Some(serde_json::to_value(result.data)?))
}
```

### spawning child jobs

jobs can spawn other jobs (e.g., after downloading multiple files, create ProcessFile jobs):

```rust
// inside job processor
for downloaded_file in &downloaded_files {
    let process_params = ProcessFileParams {
        file_path: downloaded_file.path.clone(),
        extract_metadata: true,
        generate_thumbnail: true,
        generate_waveform: true,
    };

    let job_request = CreateJobRequest {
        job_type: JobType::ProcessFile,
        session_id: job.session_id.clone(),  // inherit session
        parameters: serde_json::to_value(&process_params)?,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: job.created_by.clone(),
    };

    let response = create_job(job_request).await;
    if !response.success {
        warn!("failed to create child job: {}", response.message);
    }
}
```

### job results

return structured results that can be queried later:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FetchMediaResult {
    pub items_requested: u32,
    pub items_downloaded: u32,
    pub items_failed: u32,
    pub media_blob_ids: Vec<String>,
    pub song_ids: Vec<String>,
    pub errors: Vec<String>,
}
```

results are stored in the `result` column as JSON and can be accessed via API.

### logging in jobs

use tracing macros (configured via config.jsonc `logging.level`):

```rust
use tracing::{debug, error, info, warn};

info!("starting job: {}", job.id);
debug!("processing item: {}", item.id);
warn!("non-fatal error: {}", err);
error!("fatal error: {}", err);
```

### job lifecycle

1. **pending** - job created, waiting to be picked up
2. **running** - job processor has started working on it
3. **completed** - job finished successfully (result stored)
4. **failed** - job failed after all retries (error_message stored)
5. **cancelled** - job was manually cancelled

### retry behavior

jobs automatically retry on failure with exponential backoff:

- `retry_count` increments on each failure
- `scheduled_at` is updated with backoff delay
- after `max_retries`, job moves to **failed** status
- use `max_retries: 0` to disable retries

### organizing downloads by job

when downloading multiple files, organize them in job-specific subdirectories:

```rust
let base_output_dir = config.fetch_music.output_dir;
let job_output_dir = format!("{}/{}", base_output_dir, job.id);

tokio::fs::create_dir_all(&job_output_dir).await?;

// pass job_output_dir to external command via --paths or similar
```

this keeps all files from one job together and prevents filename collisions.
