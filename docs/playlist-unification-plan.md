# playlist unification plan

## goal

playlists currently store their contents in two structurally-parallel-but-separate places:
`playlist_songz` (specialized, songs only, full drag-reorder UI) and `playlist_itemz`
(domain-generic via `entity_type`/`entity_id`, currently only exercised for videos, no
drag-reorder UI). the user wants ONE playlist concept — a single ordered list that can mix
songs, videos, and (eventually) other domains (ebooks, photos, etc. — see
[docs/domain-recipe-plan.md](domain-recipe-plan.md)) — with one well-abstracted
implementation on both the rust backend and the spume frontend, not two parallel systems
bolted together. explicit ask: don't shortcut this, the existing playlist code is "kind of a
mess" and should get real tech-debt paydown along the way, since future domains will lean on
this same abstraction.

## current state (confirmed via direct code read, see below for file:line refs)

- **`playlistz`** ([migrations/002_music_entities.sql](../migrations/002_music_entities.sql)):
  the playlist container itself. domain-agnostic already.
- **`playlist_songz`** ([migrations/003_junction_tables.sql](../migrations/003_junction_tables.sql)):
  `(playlist_id, song_id) PK, position, added_at, added_by`. auto-append + gap-close triggers.
  deeply embedded — referenced directly (raw SQL, not through an abstraction) by:
  `music/entities/playlists/repository.rs`, `music/crud/query_playlists.rs`,
  `music/crud/user_prefs.rs`, `music/analytics/feed_events.rs`, `music/crud/create_or_update.rs`,
  `music/crud/delete.rs`, `music/entities/{albums,artists}/repository.rs` (cascade-delete-on-song-delete),
  `maintenance/hard_delete.rs`, `radio/stations/repository.rs`, `search/queries.rs`,
  `search/suggestions.rs`. **~15 files**, all raw `sqlx::query!` against this table.
- **`playlist_itemz`** ([migrations/058_playlist_itemz.sql](../migrations/058_playlist_itemz.sql)):
  `(id, playlist_id, entity_type, entity_id) UNIQUE, position, added_at, added_by`. same
  auto-append/gap-close trigger pattern. entity_type validated via `VideoEntityType`
  (`grimoire/src/video/crud/entity_taxonz.rs`) — **today this enum only covers
  Video/VideoSeries/VideoSeason, "song" is not a legal `playlist_itemz` entity_type at all.**
  only consumer today: `grimoire/src/video/crud/playlist_itemz.rs` + `offal/entities/playlist_items.rs`.
- **frontend**: two entirely separate hook sets (`music/queries/playlists.ts`'s
  `useAddSongsToPlaylistMutation`/etc. vs `video/queries/playlistItems.ts`'s
  `useAddVideoToPlaylistMutation`/etc.), two local IndexedDB stores
  (`music:playlist_songs` vs `music:playlist_video_items`), and `PlaylistsView.tsx` renders two
  visually/behaviorally separate sections (draggable-reorderable songs list, then a plain
  non-reorderable videos list below it).

## the core hard problem: one ordering, two tables

true cross-type drag-reorder needs ONE shared position space. today `playlist_songz` and
`playlist_itemz` each number their own rows 1..N independently — a song at position 2 and a
video at position 2 have no defined relative order. two ways to solve this:

- **option A — full migration**: make `playlist_itemz` the single canonical table for ALL
  playlist contents (songs included). retire `playlist_songz` as a playlist-membership source
  of truth once migrated.
- **option B — abstraction-only**: keep both physical tables, but give them a shared,
  comparable ordering key (e.g. a `global_position` column added to both, fractional/sparse
  so reordering doesn't require renumbering everything) and hide the two-table split entirely
  behind one backend service + one frontend data layer. call sites never see two tables.

**recommendation: option A, staged.** option B still leaves two tables with two trigger sets
to keep in sync forever, and doesn't reduce tech debt — it just paints over it, which
contradicts the explicit "work down tech debt" ask. option A is more work up front but is the
actual fix: one table, one trigger pair, one position space, and it's what
`playlist_itemz`/`entity_type` was already designed for (extending to new domains needs zero
new tables). staged rather than a single big-bang change because ~15 unrelated files read
`playlist_songz` directly for non-playlist-reordering purposes (search ranking, feed events,
cascade-deletes, radio recs) and need their own careful, mechanical migration to querying
`playlist_itemz WHERE entity_type='song'` instead — that's real work, not something to wave
away.

## resolved design decisions

1. **new enum, not a bigger `VideoEntityType`.** add a domain-wide `PlaylistEntityType`
   (song, video, video_series?, video_season?, ...) in `grimoire/src/entities/mod.rs` alongside
   (or replacing) `TaggableEntity` — check whether `TaggableEntity` can just be reused directly,
   since it already lists `Song`/`Video`/etc. for `entity_taxonz`. avoid a THIRD entity-type
   enum if one of the two existing ones (`TaggableEntity`, `VideoEntityType`) can be widened
   instead.
2. **new migration file** (never edit `003_junction_tables.sql` or `058_playlist_itemz.sql`):
   adds a data backfill (`INSERT INTO playlist_itemz (...) SELECT ... FROM playlist_songz`,
   entity_type='song') — does NOT drop `playlist_songz` in this same migration. dropping it is
   a separate, later migration once every read-site is confirmed migrated and this has soaked.
3. **new playlist writes for ALL types (including songs) go through `playlist_itemz`**
   once the backend repository is unified — `playlist_songz` becomes read-only/legacy from
   that point on, kept only until its ~15 external readers are individually migrated.
4. **one backend "playlist contents" module** (new `grimoire/src/music/entities/playlists/contents.rs`
   or similar) replacing both `add_songs_to_playlist`/`remove_songs_from_playlist`/
   `set_playlist_songs` (in `playlists/repository.rs`) and `add_playlist_item`/
   `remove_playlist_item`/`reorder_playlist_items` (in `video/crud/playlist_itemz.rs`) with one
   set of entity-type-agnostic functions. one set of offal routes replacing the current
   `offal/music/playlists.rs` song-specific routes + `offal/entities/playlist_items.rs`.
5. **one frontend data layer**: single `usePlaylistContentsQuery`/`useAddPlaylistItemMutation`/
   `useRemovePlaylistItemMutation`/`useReorderPlaylistItemsMutation` hook set (new
   `client/spume/src/music/queries/playlistContents.ts`?) replacing the song-specific mutations
   in `music/queries/playlists.ts` AND all of `video/queries/playlistItems.ts`. single local
   IndexedDB store replacing `music:playlist_songs` + `music:playlist_video_items` (another
   `MUSIC_DB_VERSION` bump + migration of existing local rows).
6. **one `PlaylistContentRow` UI component** in `PlaylistsView.tsx`, generalizing the existing
   song `DraggableRow` to render either a song or a video (discriminated by `entity_type`,
   same shape as the existing `MediaItem` union from queue code — reuse that pattern) with
   drag-reorder working across the whole merged, position-ordered list.

## open questions for the user (need an answer before starting phase 1)

- confirm option A (full migration to `playlist_itemz`, staged) over option B — is the ~15-file
  mechanical migration of unrelated `playlist_songz` readers (search/feed/cascade-delete/radio)
  acceptable as part of this effort, or should that be split into its own separate follow-up
  effort after the playlist UI/UX work lands?
- is it OK for this to span multiple sessions (this is genuinely a multi-day-scale backend +
  frontend migration, not a single-sitting change), with phase 1 (schema + backend contents
  module) landing and being validated before phase 2 (frontend) starts?

## phases

- [ ] **phase 1 — backend schema + repository unification**
  - [ ] add/widen entity-type enum to include `song` as a legal `playlist_itemz` entity_type
  - [ ] new migration: backfill `playlist_itemz` from `playlist_songz` (entity_type='song')
  - [ ] new unified `playlist contents` repository module (list/add/remove/reorder, entity-type
        agnostic), single global position space
  - [ ] new unified offal routes; keep old song-specific routes working (deprecated, not
        deleted yet) until frontend cuts over, to avoid a lockstep frontend+backend deploy
  - [ ] regenerate client-codegen TS client
- [ ] **phase 2 — frontend data layer unification**
  - [ ] new unified query/mutation hook set for playlist contents (songs + videos, generic)
  - [ ] new unified local IndexedDB store + `MUSIC_DB_VERSION` bump + one-time local migration
        of existing `playlist_songs`/`playlist_video_items` rows into it
  - [ ] `PlaylistSelectorModal`/`playlistSelectorState.ts` generalized off the
        `songIds[] | videoIds[]` mutually-exclusive shape to one generic `items[]` shape
- [ ] **phase 3 — frontend UI unification**
  - [ ] `PlaylistsView.tsx`: single interleaved, position-ordered list; existing song
        `DraggableRow` generalized to a `PlaylistContentRow` handling both kinds; drag-reorder
        works across the whole list, not just within songs
  - [ ] single "add to playlist" flow regardless of item kind
- [ ] **phase 4 — cleanup / tech-debt paydown**
  - [ ] migrate the ~15 external `playlist_songz` readers (search, feed events, hard-delete
        cascades, radio recs, artist/album cascade-delete) to read `playlist_itemz` instead
  - [ ] drop `playlist_songz` table in a dedicated final migration once nothing reads it
  - [ ] remove now-dead song-specific routes/hooks/components

## parallelization notes

phase 1 is backend-only and self-contained (safe to do solo). phase 2/3 depend on phase 1's
routes existing but are otherwise independent of phase 4, which is backend-only cleanup that
can happen anytime after phase 1's backfill lands and has soaked — it does not block phase 2/3.
