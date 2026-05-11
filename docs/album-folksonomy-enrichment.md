# library view + album metadata enrichment

a plan for building a new top-level **library** view in spume that surfaces every album in the library as an editable, filterable, airtable-style table — with batch musicbrainz enrichment as a first-class workflow — in service of an eventual album-graph discovery viz.

> **scope of this doc:** the library view shell, the albums data table, inline editing, the multi-remote story, the musicbrainz batch-lookup job system, and persistence of folksonomy metadata. the **graph viz itself is out of scope** and will get its own doc once the metadata story is real.

---

## current state (verified against db + code)

- **421 albums (404 active), 2522 songs, 390 standard albums + 14 compilations** — small, manageable scale
- **zero MBIDs anywhere** — no `musicbrainz_*` keys exist in any `songz.metadata`; we are starting from scratch on matching
- album titles are noisy in real cases (`mp3`, `Unknown Album`, `best of (1)`, `Make Them Die Slowly 1989 (full album).`, `Megaliths (CSR334CD)`) — direct title queries to MB will miss often. **decision:** the library table makes manual cleanup cheap (inline cell edit), so we don't try to silently auto-derive cleaner queries from song id3 tags
- `albumz` has **no metadata column today** (only `songz` does); this needs a migration
- existing musicbrainz client at [grimoire/src/music/musicbrainz/](../grimoire/src/music/musicbrainz/) is a thin pass-through with a 1 req/sec rate limiter, no automated matching
- album release lookup currently includes `+genres` but **omits `+tags`** ([client.rs](../grimoire/src/music/musicbrainz/client.rs)) — opportunistic fix
- existing job system ([grimoire/src/jobs/](../grimoire/src/jobs/)) is db-backed (`jobz`, `job_sessionz`); progress is emitted as `GrimoireEvent::JobProgress` via an in-process `tokio::sync::broadcast` ([grimoire/src/events.rs](../grimoire/src/events.rs))
- **events delivery to clients is tauri-only today** — there is no websocket / SSE on the HTTP server; browser-mode HTTP remotes have to poll `list_jobs`. P2P transport supports bidi comms and is the strategic path for live progress to non-tauri clients. **the table must work with both live and polled progress.**
- `QueryParams.filters` ([grimoire/src/music/crud/models.rs](../grimoire/src/music/crud/models.rs)) is already a free-form `HashMap<String, JsonValue>` — adding metadata-aware filters requires no request-type change, only repo handling
- `album_query_view` ([migrations/views/album_query_view.sql](../migrations/views/album_query_view.sql)) is a single sql view, easy to extend with new columns
- multi-row selection on the songs view uses a global singleton store ([client/spume/src/music/hooks/songSelection.ts](../client/spume/src/music/hooks/songSelection.ts)) — clean pattern to mirror for albums
- **no reusable `RemotePicker` exists** — it's inlined in [AggregateFeedView.tsx](../client/spume/src/music/views/AggregateFeedView.tsx); needs extraction
- `AlbumAutocomplete` / `ArtistAutocomplete` use `@kobalte/core/combobox`; the kludgy free-text-input flow is documented but **we try them as-is in the table first** and only refactor if they actively block us

## design principles

1. **ui-first, automation-second** — the library table is the primary surface. batch MB enrichment is a feature _of_ the table, not a separate cli pipeline. cli wrappers can come later for headless ops if useful.
2. **never block on architectural cleanliness** — ship a working single-remote, single-user-fixes-titles path first; extract abstractions (remote picker, metadata field registry) only when their absence becomes painful.
3. **multi-remote is a constraint, not a feature** — design every server-side change so it doesn't preclude multi-remote aggregation later, but ship single-remote first. specifically: every album row carries its `remote_id`; per-row admin affordances are gated on per-remote role; the table can be backed by 1..N remote queries identically.
4. **progress is sacred** — every long-running operation reports per-item progress via the existing job event channel from day one. nothing fire-and-forget. the table renders pending/loading/error state per row + a global progress strip.
5. **collect → review → confirm → fetch-detail** — keep these as four distinct steps so we never burn rate-limited detail fetches on bad matches and the user always has a chance to override.
6. **schema evolution over hardcoding** — `albumz.metadata` is a free-form json blob; we add a few typed tracking columns (`mb_lookup_status`, `mb_lookup_at`, `mb_lookup_by`) **without DB-level CHECK constraints** so the values can evolve. const-enums live in rust+ts code only.
7. **transport agnostic via offal** — every new server endpoint is an offal route handler and goes through the existing codegen → ts client pipeline. no http-specific assumptions.
8. **single source of truth for metadata shape** — every field, path, default, status enum value, and accessor for `albumz.metadata` lives in **one rust module** (`grimoire/src/music/entities/albums/metadata.rs`) and **one generated ts module** (codegen output). callers _never_ hand-roll `json_extract('$.musicbrainz.…')` strings, never spell out a status string literal, never reach into the blob with `obj.musicbrainz.candidates[0]` directly. all access goes through typed helpers + path constants exported from the central module. when we evolve the shape, exactly one file changes on each side.

## architecture sketch

```
            ┌──────────────────────────────────────────────────────┐
            │  /library  (new top-level route in spume)            │
            │  ┌─────────────────────────────────────────────────┐ │
            │  │  view switcher: [ graph ] [ table ]             │ │
            │  │  remote picker (reused across both subviews)    │ │
            │  └─────────────────────────────────────────────────┘ │
            │  ┌─────────────────┐   ┌─────────────────────────┐   │
            │  │  graph subview  │   │  albums table subview    │  │
            │  │  (placeholder)  │   │  controls / filters      │  │
            │  └─────────────────┘   │  selection + bulk actions│  │
            │                        │  infinite-scroll rows    │  │
            │                        │  per-row inline edit +   │  │
            │                        │  per-row mb lookup state │  │
            │                        └─────────────────────────┘   │
            └──────────────────────────────────────────────────────┘
                          │                          │
                          │ codegen'd offal client   │
                          ▼                          ▼
       ┌─────────────────────────────────────────────────────────┐
       │  offal routes (all transports)                          │
       │  - query_albums (extended w/ metadata filters)          │
       │  - update_album (already exists)                        │
       │  - enqueue_mb_enrichment_job (new)                      │
       │  - confirm_mb_match / reject_mb_match (new)             │
       │  - list_jobs / job_session events (existing)            │
       └─────────────────────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────────────────────┐
       │  grimoire jobs runner                                   │
       │  - JobType::MbAlbumSearch    (per album, cheap)         │
       │  - JobType::MbAlbumDetail    (per confirmed album)      │
       │  emits GrimoireEvent::JobProgress per item              │
       └─────────────────────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────────────────────┐
       │  tauri client : direct event listener (instant)         │
       │  http  client : poll list_jobs + session counts (~1s)   │
       │  p2p   client : bidi event subscription (future)        │
       └─────────────────────────────────────────────────────────┘
```

## data model

### schema additions (migration `031_album_metadata_and_mb_tracking.sql`)

```sql
ALTER TABLE albumz ADD COLUMN metadata TEXT;                -- free-form json blob, nullable
ALTER TABLE albumz ADD COLUMN mb_lookup_status TEXT;        -- nullable, no CHECK constraint, see enum below
ALTER TABLE albumz ADD COLUMN mb_lookup_at INTEGER;         -- unix epoch
ALTER TABLE albumz ADD COLUMN mb_lookup_by TEXT;            -- user_id; null = automated
-- index for the most common filter
CREATE INDEX IF NOT EXISTS idx_albumz_mb_lookup_status ON albumz(mb_lookup_status) WHERE deleted_at IS NULL;
```

`album_query_view` is rebuilt to include `metadata`, `mb_lookup_status`, `mb_lookup_at`, `mb_lookup_by`.

### tracking enum (rust + ts only, db is free-form text)

```
not_attempted   — default (null also treated as this)
queued          — job enqueued but not yet run
searching       — search call in flight
candidates      — search returned candidates, awaiting decision
confirmed       — a candidate has been chosen (manual or auto)
rejected        — user explicitly rejected all candidates
no_match        — search returned zero
needs_review    — borderline confidence, flagged
fetching_detail — detail call in flight after confirm
enriched        — detail fetched, folksonomy persisted
error           — last attempt failed; retry-able
```

### `albumz.metadata` json shape (illustrative, evolving)

```json
{
  "version": 1,
  "musicbrainz": {
    "release_id": "…",
    "release_group_id": "…",
    "match_confirmed_at": 1746000000,
    "match_confirmed_by": "user_id",
    "candidates": [
      {
        "release_group_id": "…",
        "release_id": "…",
        "title": "…",
        "artist": "…",
        "first_release_date": "1995",
        "track_count": 12,
        "country": "GB",
        "primary_type": "Album",
        "secondary_types": ["Live"],
        "mb_score": 100,
        "local_confidence": 0.87
      }
    ],
    "last_query": { "artist": "…", "release": "…", "tracks": 12 }
  },
  "folksonomy": {
    "musicbrainz": {
      "release_genres": [{ "name": "post-punk", "count": 5 }],
      "release_tags": [{ "name": "moody", "count": 3 }],
      "release_group_genres": [],
      "release_group_tags": [],
      "fetched_at": 1746000000
    }
  },
  "log": [
    { "at": 1746000000, "step": "search", "result": "5 candidates" },
    { "at": 1746000100, "step": "fetch_detail", "release_id": "…" }
  ]
}
```

**dynamic schema (deferred):** the long-term shape is driven by what musicbrainz returns + (eventually) what users care about. for now we hardcode a default field set in rust types with `serde(default)` so partial blobs deserialize. when a "metadata field registry" pattern is needed (admin-defined columns visible in the table), it slots in as a new `metadata_fieldz` table that the client reads to drive column rendering — the underlying json shape stays the same. **explicitly punted to phase 11.**

### query path (server-side json1 filters)

extend `query_albums` repository ([grimoire/src/music/entities/albums/repository.rs](../grimoire/src/music/entities/albums/repository.rs)) to recognise these `filters` keys:

| filter key            | sql translation                                                             |
| --------------------- | --------------------------------------------------------------------------- |
| `mb_lookup_status`    | `albumz.mb_lookup_status = ?`                                               |
| `mb_lookup_status_in` | `albumz.mb_lookup_status IN (?, ?, …)`                                      |
| `has_metadata`        | `metadata IS NOT NULL AND metadata != ''`                                   |
| `has_mb_release_id`   | `json_extract(metadata, '$.musicbrainz.release_id') IS NOT NULL`            |
| `has_folksonomy`      | `json_extract(metadata, '$.folksonomy.musicbrainz.fetched_at') IS NOT NULL` |
| `metadata_path_eq`    | `json_extract(metadata, ?) = ?` (for power-user filters)                    |

`sort_by` accepts the same paths via `json_extract` with a small allow-list.

---

## phases

each phase is independently shippable. mark items checked as you go. don't proceed to the next until the previous is in user hands.

### phase 0 — schema + types + view extension

- [ ] migration `031_album_metadata_and_mb_tracking.sql` per shape above
- [ ] update [migrations/views/album_query_view.sql](../migrations/views/album_query_view.sql) to expose new columns; bump migration that creates the view (or add a separate `032_album_query_view_v2.sql`)
- [ ] new module `grimoire/src/music/entities/albums/metadata.rs` defining `AlbumMetadata` (versioned, all `serde(default)`)
- [ ] new const enum `MbLookupStatus` in same module + corresponding zod schema for codegen
- [ ] add `metadata: Option<sqlx::types::Json<AlbumMetadata>>` and the three tracking columns to the `Album` struct + repository read paths
- [ ] repository helpers in `grimoire/src/music/entities/albums/`: `read_album_metadata(id)`, `merge_album_metadata(id, patch)` (deep-merge so concurrent writers from different jobs don't clobber), `update_mb_lookup_status(id, status, user_id?)`
- [ ] regenerate ts client (`cd client-codegen && make all`)

### phase 1 — library route shell + view switcher

- [ ] new top-level route `/library` in [client/spume/src/app/routes/index.tsx](../client/spume/src/app/routes/index.tsx) (sibling of `/feed`, `/radio`, `/shared`)
- [ ] new view at `client/spume/src/library/views/LibraryView.tsx` — header row (accounting for the floating top-left topnav offset), view-switcher (`graph` | `table`), placeholder for both subviews
- [ ] graph subview = simple "graph viz coming soon" placeholder
- [ ] table subview = empty `<div>` for now
- [ ] add nav entry wherever the other top-level views are listed

### phase 2 — reusable RemotePicker + library remote selection

- [ ] extract the remote-toggle strip from [AggregateFeedView.tsx](../client/spume/src/music/views/AggregateFeedView.tsx) into `client/spume/src/components/forms/RemotePicker.tsx`. props: `value: Set<string>`, `onChange`, `mode?: "single" | "multi"`, `requireAdmin?: boolean` (greys out non-admin remotes when set)
- [ ] swap the original AggregateFeedView usage to the extracted component (validate behaviour parity)
- [ ] add `RemotePicker` to LibraryView header in `single` mode initially. wire its value into a `selectedRemoteId` signal that the table subview reads
- [ ] remote-role helper hook: `useRemoteAdminRole(remoteId)` returning `boolean` — used by the table to gate edit affordances per row

### phase 3 — albums table v0 (read-only, single remote)

- [ ] new component `client/spume/src/library/components/AlbumsTable.tsx`
- [ ] queries `query_albums` against the selected remote; uses the same infinite-scroll pattern as the songs view
- [ ] **no sortable header row** (per your call) — controls section _above_ the table:
  - search input (debounced; targets `q` + `search_fields`)
  - status filter chips driven by `MbLookupStatus` (`needs_review`, `not_attempted`, `confirmed`, `enriched`, `no_match`, …)
  - sort: column dropdown + the existing 3-phase asc/desc/none toggle component
  - results count + active-filter summary
- [ ] columns (initial set, hardcoded): cover, title, artist, release_date, song_count, genres, mb_lookup_status, mb_lookup_at, actions
- [ ] each row carries `remote_id`; admin-only action affordances are conditional on `useRemoteAdminRole(row.remote_id)`
- [ ] respect the floating topnav layout constraint (no input rendered under it; scrolling layout handles it)

### phase 4 — selection store + bulk action bar

- [ ] new `client/spume/src/library/hooks/albumSelection.ts` mirroring [songSelection.ts](../client/spume/src/music/hooks/songSelection.ts) (range, ctrl/cmd, shift, clear-on-nav)
- [ ] global ctrl/cmd-A handler (when table focused) → select all currently-loaded rows
- [ ] selection action bar appears when count > 0; initially with one button: "lookup musicbrainz for N selected"
- [ ] also add a global control in the table header: "lookup musicbrainz for all matching current filter" — uses the same job machinery, just with no-selection semantics

### phase 5 — MB search job + per-item progress plumbing

- [ ] new `JobType::MbAlbumSearch` variant in [grimoire/src/jobs/models.rs](../grimoire/src/jobs/models.rs); job parameters json: `{ album_id, remote_initiator? }`
- [ ] processor in `grimoire/src/jobs/music/mb_search.rs`:
  - reads the album row (title + joined artist + track count + year)
  - calls `MusicBrainzClient::search_release_groups` with derived query (artist + title)
  - computes `local_confidence` per candidate (artist Jaro-Winkler, title Jaro-Winkler, track-count delta, year delta — weights start equal, tunable)
  - merges results into `albumz.metadata.musicbrainz.candidates` and sets `mb_lookup_status` to `candidates` / `no_match` / `needs_review` (based on confidence)
  - emits `GrimoireEvent::JobProgress` after every album (existing pattern)
- [ ] new offal route `enqueue_mb_album_search` ([grimoire/src/offal/music/enrichment.rs](../grimoire/src/offal/music/enrichment.rs)) accepting `{ album_ids: Vec<String> }` or `{ filter: QueryParams }` (latter resolves to ids server-side); creates a `JobSession` and enqueues one job per album; returns `session_id`
- [ ] respects existing 1 req/sec rate limit (the runner already serialises within one job at a time; if we want concurrency we'd need a per-mb-domain semaphore — defer)
- [ ] codegen ts client

### phase 6 — client-side progress wiring (works in both tauri + http)

- [ ] new client hook `client/spume/src/library/hooks/useJobSession.ts`:
  - in tauri/charnel mode: subscribes to existing `onJobProgress` / `onJobSessionComplete` ([client/spume/src/app/services/charnel/events.ts](../client/spume/src/app/services/charnel/events.ts)) filtered by `session_id`
  - in http mode: polls `list_jobs` every ~1s while session is active, derives counts client-side, stops on completion
  - returns: `{ pending, running, completed, failed, total, percent, latestPerAlbum: Map<albumId, JobStatus> }`
- [ ] global progress strip in LibraryView header showing aggregate session progress whenever an MB job is running
- [ ] per-row progress badge in AlbumsTable: each row shows `mb_lookup_status`; if a job is in flight for that album, overlay a spinner; on completion the row's data is refreshed (ideally without a full table reload — invalidate just that row)
- [ ] **p2p note:** capture in code/comments that the http poll path is a stopgap; once p2p has a stable bidi event channel, the hook gains a third backend. don't design the hook in a way that prevents this.

### phase 7 — review surface: candidates inline

- [ ] when an album row's `mb_lookup_status` is `candidates` or `needs_review`, the row expands (or opens a side drawer) showing the stored `metadata.musicbrainz.candidates` ranked by `local_confidence` desc
- [ ] each candidate row: cover thumb (cover-art-archive lazy fetch), title, artist, year, track count, primary type, mb_score, local_confidence, [confirm] [open in musicbrainz.org]
- [ ] one global action: [reject all]
- [ ] new offal routes:
  - `confirm_mb_match { album_id, release_group_id, release_id }` → sets status to `confirmed`, records user, enqueues a `JobType::MbAlbumDetail` job
  - `reject_mb_match { album_id }` → sets status to `rejected`
- [ ] **auto-confirm option** in the controls bar: "auto-confirm where local_confidence ≥ 0.9 and gap to #2 ≥ 0.15" — runs server-side, batched, per filter

### phase 8 — detail fetch + folksonomy persistence

- [ ] `JobType::MbAlbumDetail` processor in `grimoire/src/jobs/music/mb_detail.rs`:
  - fetches release-group with `+genres+tags+artist-credits+url-rels`
  - fetches release with `+genres+tags+recordings+labels` (**fix the missing `+tags` on the existing release lookup helper at the same time**)
  - merges into `albumz.metadata.folksonomy.musicbrainz.*` and a top-K `folksonomy_summary` for cheap consumption later
  - sets `mb_lookup_status = enriched`
- [ ] expose `folksonomy_summary` as a column in the table (renders top 5 tag chips)
- [ ] re-enrich action: per-row "re-fetch from musicbrainz" + global "re-fetch all enriched older than N days" (uses same job type with `--force` semantics)

### phase 9 — inline cell editing (admin only, per remote)

- [ ] editable cells gated on `useRemoteAdminRole(row.remote_id)`
- [ ] simple text fields (title, release_date, label) — direct inline edit, optimistic update, calls existing `update_album` route
- [ ] artist cell: uses existing `ArtistAutocomplete` as-is. on save, apply this resolution logic per your spec:
  - if user clicked an autocomplete option → use that artist id
  - else (user typed and didn't pick): server checks for an exact name match in `artistz` (`name = ? AND deleted_at IS NULL`)
    - exactly 1 match → reuse that id
    - 0 or 2+ matches → create a new artist
  - the album's artist link is _reassigned_, never an in-place rename of an existing artist row
- [ ] album-title rename: same logic via `AlbumAutocomplete` if you want cross-row reassignment, but for the common case of just fixing typos this is plain text edit on the title column
- [ ] genres cell: uses existing `GenreAutocomplete`, multi-select (already supported)
- [ ] **autocomplete refactor escape hatch:** if either of the existing autocomplete components proves too fragile for inline-table use, stop and refactor them (strip kobalte combobox, replace with plain `<input>` + flyout menu) before continuing — captured as a checkpoint, not a separate phase

### phase 10 — acceptance + cleanup

- [ ] documentation pass: a short admin guide on the library workflow (in `docs/`)
- [ ] coverage report: how many albums confirmed / enriched / no_match / needs_review across the library; top 50 folksonomy tags surfaced
- [ ] hand off to the **viz** doc with a concrete data shape

### phase 11 — deferred / stretch

these are intentionally not in the initial implementation; capture them now so they don't get lost.

- [ ] **multi-remote aggregation** — table reads from N remotes concurrently and merges; per-row `remote_id` already in the data model so this is mostly a client-side fan-out. RemotePicker switches to `mode="multi"`.
- [ ] **dynamic metadata field registry** — `metadata_fieldz` table; admin UI to add/hide/reorder columns. swap into AlbumsTable column rendering.
- [ ] **last.fm folksonomy** — free api with key. extends `metadata.folksonomy.lastfm.*`. richer mood/style data.
- [ ] **discogs styles** — free api with token. extends `metadata.folksonomy.discogs.*`. strong on subgenres/era.
- [ ] **artist-level enrichment** — same approach but for `artistz`; useful as a graph dimension.
- [ ] **materialise top folksonomy tags into `album_tagz`** — needs `tagz` schema extension (`source`, `count`); useful when graph viz needs cheap edge queries.
- [ ] **p2p bidi progress channel** — once stable, third backend for `useJobSession`.
- [ ] **autocomplete refactor (kobalte → plain input + flyout)** — only if phase 9 forces it.
- [ ] **headless cli wrapper** — thin `freqhole library enrich-all` etc. for ops use; everything it'd call already exists as offal routes.
- [ ] **fix unused `MusicBrainzMatch` scaffolding** in [grimoire/src/music/musicbrainz/models.rs](../grimoire/src/music/musicbrainz/models.rs) — either repurpose for our scoring or delete.
- [ ] **add `+tags` to the existing release lookup helper** — opportunistic fix done as part of phase 8.

---

## implementation tracking

- [ ] phase 0 — schema + types + view extension
- [ ] phase 1 — library route shell + view switcher
- [ ] phase 2 — reusable RemotePicker + library remote selection
- [ ] phase 3 — albums table v0 (read-only, single remote)
- [ ] phase 4 — selection store + bulk action bar
- [ ] phase 5 — MB search job + per-item progress plumbing
- [ ] phase 6 — client-side progress wiring
- [ ] phase 7 — review surface: candidates inline
- [ ] phase 8 — detail fetch + folksonomy persistence
- [ ] phase 9 — inline cell editing
- [ ] phase 10 — acceptance + cleanup
- [ ] phase 11 — deferred / stretch
