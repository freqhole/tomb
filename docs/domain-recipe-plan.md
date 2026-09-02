# adding new domains (ebooks, photos, raw files): recipe + lessons learned

**status: planning/reference doc only. no ebook/photo/file-specific code exists yet, and
none should be written until explicitly requested.** this doc exists so that when that work
starts, it's a breeze — it's a living document, updated incrementally as the video domain
build-out (the first real domain built after music) surfaces new lessons. see
[video-domain-plan.md](video-domain-plan.md) for the full video-specific plan and status;
this doc only captures what's _generalizable_ from that effort.

## the recipe (steps that apply to any new domain)

every new domain (photos, ebooks, generic files, ...) should be addable via these same
steps — video is the first domain to exercise this end to end, validating the recipe itself:

1. new `grimoire/src/<domain>/` entity models + repositories (own migrations, new tables)
2. register entity_type value(s) in the shared enums/tables: `FavoriteTarget`/`RatingTarget`,
   `entity_taxonz.entity_type`, `playlist_itemz.entity_type`
3. new `grimoire/src/offal/<domain>/` routes + `Domain::<Domain>` variant in
   [`api_registry/mod.rs`](../grimoire/src/api_registry/mod.rs) + type_registry entries
4. register the domain in `offal::all_routes()` / `offal::dispatch()`
   ([`grimoire/src/offal/mod.rs`](../grimoire/src/offal/mod.rs))
5. new `grimoire/src/jobs/<domain>/` processors + new `JobType` variants + `runner.rs` match
   arms (reuse `MediaDomain` for scan/import/fetch generalization rather than forking new
   flat job types — see "what's already generic" below)
6. new `cli/src/plumbing/<domain>/` module
7. new `client-codegen/freqhole-api-client/src/domains/<domain>.ts` (hand-written wrapper,
   regenerate `schema.ts`/`routes.ts`/`admin_commands.ts` via `cd client-codegen && make all`)
8. new `client/spume/src/<domain>/` dir (components/, data/, hooks/, import/, queries/,
   services/, state/, views/) — mirrors `music/`'s full feature-first structure (not
   `storage/`, which is a small unrelated external-device dir — this was an early wrong
   assumption in the video plan, corrected once phase 7 was actually scoped)
9. media blobs, favorites, ratings, taxons, and playlist membership for the new domain all
   flow through the existing shared infra from step 2 — no new tables needed for those
10. optionally: a rathole (TUI) module mirroring `ratcore/app/music.rs`'s `Row`/`State`/
    `Event` pattern + new `Transport` trait methods, if the domain needs TUI/headless CRUD
11. optionally: OPFS (browser-local) storage support mirroring `music/services/opfs/
helpers.ts` + `getOPFSUsage()`, if the domain supports local-only import/offline use

## what's already generic (zero schema/infra changes needed)

confirmed while building the video domain (research pass, 2026-08-24) — most cross-cutting
infra already generalizes with **zero schema changes**, just new enum variants/values:

- `FavoriteTarget`/`RatingTarget` enums — add `Photo`/`Ebook`/`File` variants, the rust
  compiler forces every match to stay exhaustive as new domains are added (this is why
  these were designed as rust enums, not a SQL `CHECK` allowlist — see design principle
  below)
- `entity_taxonz`/`playlist_itemz` — plain `entity_type` TEXT column, no SQL `CHECK`, just
  insert new values, no migration needed
- `media_blobz`/`BlobType` — single shared table, already designed for "audio, video,
  images" per its own doc comment; a new domain's files are just more `MediaBlob` rows
- `user_favoritez`/`user_ratingz` — same enum-driven pattern as `FavoriteTarget` above
- `taxonz`/`taxon_kindz` — open-ended `is_user_defined` kinds, no changes needed
- `playback_progressz` — generic `entity_type` column; essential for ebooks' resume-at-page,
  skippable for photos/files
- `api_registry::Domain` enum + `offal::{domain}::{routes(),dispatch()}` module pattern —
  proven twice now (video, and the `Domain::Entities` cross-cutting split done for
  favorites/ratings)
- `MediaDomain` enum (`grimoire/src/media_domain.rs`) — already used to parameterize
  `ScanDirectoryParams`/`ProcessFileParams` across domains rather than forking
  `ScanVideoDirectory`/`ProcessVideoFile`; extend this enum (not fork new job types) for the
  next domain's scan/import pipeline too

## what's genuinely bespoke per domain

- entity models/schema (obviously domain-specific)
- metadata extraction: exiftool for photos, EPUB/PDF parsing for ebooks, minimal/libmagic
  for generic files (video used ffprobe)
- `MediaDomain`/`JobType` enum variants + job runner match arms for the domain's own
  transcode/processing needs (video: `TranscodeVideo`/`ImportVideo`; photos/ebooks/files
  will need their own, if any processing is needed at all — a generic file domain may need
  none)
- browse/detail UI: gallery/lightbox for photos, reader for ebooks, plain file-browser for
  generic files (video: grid/table + series/season drill-down)
- CRUD/management UI: an edit modal (metadata fields + any domain-specific relationships,
  e.g. video's series/season), a delete flow, and — if the domain produces derived files
  (transcodes, thumbnails, converted formats) — a hard-delete-only-derived-never-original
  pattern (see "hard-delete pattern" below, worked out for video's transcoded renditions)

## the one real blocker: search doesn't scale past a couple domains yet

phase 11 of the video plan flagged this and it's still true: the current `SearchResponse`
shape (one hand-named `Option<Vec<T>>` field per entity type, e.g. `.songs`, `.videos`) works
fine for one more domain but doesn't scale to 3-4 more without the struct growing forever.
**before starting ebook/photo/file search**, do the deferred design pass: a
`domains: Option<Vec<String>>` filter on the search request (omitted = search everything) and
a response reshaped around a generic per-domain result list. each new domain still needs its
own `_fts` FTS5 table + trigger-sync (mirroring `songz_fts`/`videoz_fts`), but the _response
shape_ should be redesigned once, before rolling out to a 3rd/4th domain, not bolted on
per-domain again.

the same class of problem exists for **feed/analytics**
(`grimoire/src/music/analytics/{feed,feed_events}.rs`): still song/album/artist/playlist-only
with no `entity_type` discriminator, flagged during the video build-out but not yet designed
or fixed even for video. whichever domain forces this redesign first (video, or the next one)
should do it as a real `entity_type`-discriminated redesign, not another field bolt-on.

## patterns worth reusing directly (worked out during the video build)

- **status-bulk hydration pattern**: when a grid/table view needs per-item favorite/rating
  state for a domain whose list query doesn't already carry it inline (adding it would
  require `query_as!`-macro column changes), use a dedicated bulk-hydrate route
  (`get_favorite_status_bulk({target_type, target_ids}) -> Vec<{target_id, is_favorite}>`)
  rather than N+1 per-item calls or forcing a schema change.
- **renditions / derived-file hard-delete pattern** (worked out 2026-08-24 for video's
  transcoded renditions, see video-domain-plan.md items 13/15): if a domain generates
  derivative blobs (transcodes, converted formats, thumbnails) that are cheap to regenerate,
  it's reasonable to offer an explicit, immediate **hard**-delete for those specifically
  (distinct from the existing soft-delete-then-GC `delete_media_blob` used for everything
  else), gated so it's structurally impossible to hard-delete anything other than the
  derived blob type (never the user-supplied original). check
  video-domain-plan.md's contract for `delete_video_rendition` once it lands for the exact
  shape to mirror.
- **OPFS local storage usage + purge pattern**: mirror `music/services/opfs/helpers.ts`'s
  `getOPFSUsage()` + per-file delete functions for any domain that supports local
  (browser-only, no server) import — a domain needs its own OPFS directory/path convention
  (video used `video/` and `video-posters/`, mirroring music's own convention) but the
  usage-aggregation + purge-one/purge-all shape should be copied, not reinvented.
- **relationship-assignment-with-inline-create pattern** (video's series/season assignment
  on the edit modal, item 15): when an entity needs to be assigned to a parent/group entity
  that may not exist yet (a video's series, a photo's album, an ebook's series), research
  whatever combobox-with-create-new pattern already exists in the codebase before inventing
  a new one from scratch.

## design principles carried over from the video plan (still apply)

1. **entity CRUD stays fully isolated per domain** — never edit an existing domain's files
   to make room for a new one; every domain gets its own tree under
   `grimoire/src/<domain>/`, `grimoire/src/offal/<domain>/`, `grimoire/src/jobs/<domain>/`,
   `cli/src/plumbing/<domain>/`, `client-codegen/.../domains/<domain>.ts`,
   `client/spume/src/<domain>/`.
2. **cross-cutting infra is already polymorphic — reuse it, don't fork per-domain copies**
   (see "what's already generic" above).
3. **entity-type discriminators are validated in Rust, not SQL** — `target_type`/
   `entity_type` columns drop `CHECK (...)` constraints in favor of a shared Rust enum
   match, which the compiler forces to stay exhaustive as new domains are added.
4. **never touch an already-applied migration file** — all schema changes are new,
   sequentially-numbered migrations, no exceptions, not even comment-only edits (this bit
   the video effort's cutover migrations 060-062; see
   `/memories/repo/skein-rust-string-immutablestring-bug.md`-adjacent cargo-sqlx memory for
   the general version of this rule).
5. **player/queue generalization (if the domain is playable/viewable in a shared UI
   surface) is high-risk, cross-cutting work** — scope it as a careful, tracked refactor
   (video's `MediaItem` discriminated-union introduction touched ~50-100 call sites), not a
   rewrite, and not something to rush just to unblock one domain's browse view.

## open questions to resolve before starting the next domain (not video's job to answer)

- which domain is actually next — photos, ebooks, or generic files? (affects which
  metadata-extraction tooling/dependency gets pulled in first)
- does the next domain need a dedicated viewer surface at all (ebooks: a reader; photos: a
  gallery/lightbox), or is a plain file-browser + external-open sufficient for a first pass?
- does the next domain need transcoding/derived files at all (ebooks: maybe format
  conversion; photos: maybe thumbnail/resize variants; generic files: probably not) — if
  not, most of phase 4's job-pipeline generalization work is already free
- should the search response-shape redesign (see "one real blocker" above) happen as part of
  the next domain's rollout, or as its own standalone effort first? recommendation from the
  video plan: do it as its own short design pass once a 3rd domain is imminent, not bolted on
  ad hoc again

## changelog (updates to this doc)

- **2026-08-24**: doc created, seeded from `video-domain-plan.md`'s phase 13 research notes,
  design principles, and the "add a domain" recipe, plus new lessons from the video CRUD/
  management round (rendition hard-delete pattern, OPFS usage/purge pattern, relationship-
  assignment-with-inline-create pattern). update this section whenever this doc changes.
