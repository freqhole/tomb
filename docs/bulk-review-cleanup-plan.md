# bulk review cleanup plan

tracking the multi-session refactor of the bulk enrichment review flow

- library view header so we don't lose context across turns.

## status legend

- [x] done in code
- [~] partial / needs follow-up
- [ ] not started

## items

### ui-only (no schema/codegen needed)

- [x] library: trim `MB_LOOKUP_STATUSES` filter list — drop
      `queued`, `searching`, `fetching_detail`; relabel `enriched` →
      `done` at the label level (`mbLookupStatusLabel` helper)
- [x] library: remove `conf >` / `gap >` numeric inputs from the
      header; auto-confirm button instead opens a modal containing
      those inputs, a stats summary (# albums affected, # at
      threshold, current threshold values), and a confirm button
- [x] library: row actions column — keep only an "album page" link
      to the album detail in the remote, plus a "review" button that
      opens the bulk review modal pre-pointed at that album. drop
      inline last.fm / audiodb peek buttons (move them into the
      bulk modal instead).
- [x] bulk modal: stash last.fm + audiodb raw-data peek buttons
      inside the modal (header strip near the source-status badges
      is the most natural spot)
- [x] bulk modal: footer — drop `dismiss`, `minimize`, `exit`
      buttons. only `skip` and `save & next` remain. fix the
      "N selected" counter (currently mis-counts because it reads
      a single panel's selection rather than the union).
- [x] bulk modal: move "compare tracks" out of the requery panel
      and into a top-level section that renders **after** the artist
      images. single mb release picker (dropdown of candidate
      releases) drives the comparison instead of per-candidate
      buttons.
- [x] bulk modal: merge any mbids surfaced by last.fm + audiodb
      into the mb candidates list when they're not already there
      (via `meta.lastfm.album.musicbrainz_release_id`,
      `meta.lastfm.album.musicbrainz_release_group_id`,
      `meta.audiodb.album.musicbrainz_release_group_id`,
      `meta.audiodb.album.musicbrainz_artist_id`)
- [x] bulk modal: on save success, also set
      `mb_lookup_status = "enriched"` (in addition to the existing
      `review_status = "complete"`) so the library filter chip
      reflects the user's done-ness immediately
      _(done in 044 cleanup — `set_album_review_status` route was
      removed entirely; bulk save now writes `mb_lookup_status='enriched'`
      via the new `set_mb_lookup_status` route)_

### schema / backend (done in this turn)

- [x] new migration `044_drop_album_review_status.sql` that drops
      `albumz.review_status`, `albumz.reviewed_at`, the index, and
      every dependent view (so bootstrap recreates them without
      those columns).
- [x] remove `set_album_review_status` offal route + grimoire
      handler + all client/server callers
- [x] add `Skipped` variant to `MbLookupStatus` enum + label
- [x] regenerate codegen (`cd client-codegen && make all`)
- [x] add `set_mb_lookup_status` route (POST
      `/api/albums/set-mb-lookup-status`) so the bulk modal save/skip
      can write it
- [x] bulk modal footer skip button writes
      `mb_lookup_status='skipped'` then advances
- [x] add `skipped` to the trimmed filter chip list

## cross-turn notes

- `MbLookupStatus` enum lives in
  [grimoire/src/music/entities/albums/metadata.rs](../grimoire/src/music/entities/albums/metadata.rs)
  (~line 24); 11 variants today.
- Filter list: [client/spume/src/library/data/albumMetadata.ts](../client/spume/src/library/data/albumMetadata.ts)
  `MB_LOOKUP_STATUSES`.
- Bulk modal: [client/spume/src/library/review/BulkEnrichmentReviewModal.tsx](../client/spume/src/library/review/BulkEnrichmentReviewModal.tsx)
  (1318 lines; footer ~1030-1085, applyAndAdvance ~760-915).
- Library table: [client/spume/src/library/components/AlbumsTable.tsx](../client/spume/src/library/components/AlbumsTable.tsx)
  (filter chips ~357-385, conf/gap inputs ~321-332, row actions
  ~615-668).
- Bulk modal is too big — eventual decompose into per-section
  components (taxon / bio / related / urls / images / requery /
  compare-tracks). track separately.
