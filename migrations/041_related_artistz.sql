-- phase 13h — related artists cross-ref + bandcamp persistence.
--
-- the lastfm/audiodb/mb processors already capture related-artist
-- payloads in their per-source metadata blobs, but those blobs are
-- write-only as far as the rest of the app is concerned. this table
-- promotes those payloads into queryable rows so we can:
--   1. show "in your library" badges on related artists (FK join).
--   2. accumulate up to ~25 related artists per (source_artist,
--      source) without bloating artistz.metadata with thousands of
--      duplicate name strings.
--   3. persist bandcamp links for related artists' albums so the
--      "discover related" surface can deep-link out to bandcamp
--      even when the related artist isn't in our local db.
--
-- name normalization (`related_name_key`) is computed in rust:
--   lowercase + nfkd decompose + strip non-alphanumeric + collapse ws
-- so "Sigur Rós" and "sigur ros" share a key. used as a soft join
-- when no mbid is available on either side.
--
-- intentional shape choices:
--   - separate row per (source_artist, related, source) so we can
--     attribute and dedup per source without losing the per-source
--     match_score. cross-source dedup is a read-time concern.
--   - related_artist_id starts NULL; a backfill helper sets it when
--     a matching local artistz row is found (by mbid or name_key).
--   - bandcamp_album_urlz is a small json array of {title, url}; we
--     don't normalize that into a full albumz/songz join because
--     these are *external* artists' albums (we may never have them).

CREATE TABLE related_artistz (
  id TEXT PRIMARY KEY,
  -- the local artist this relation hangs off of.
  source_artist_id TEXT NOT NULL REFERENCES artistz(id),
  -- when the related artist exists in our library, this points at
  -- the local row. NULL for external-only relations.
  related_artist_id TEXT REFERENCES artistz(id),
  -- raw display name as returned by the source api.
  related_name TEXT NOT NULL,
  -- normalized name (see header comment) for soft cross-ref joins.
  related_name_key TEXT NOT NULL,
  -- musicbrainz artist mbid when the source provides one.
  related_mbid TEXT,
  -- 'lastfm' | 'audiodb' | 'mb'
  source TEXT NOT NULL,
  -- source-specific similarity score where available
  -- (lastfm 0..1; audiodb / mb usually NULL).
  match_score REAL,
  -- canonical bandcamp artist URL when extracted from a bio/links payload.
  bandcamp_url TEXT,
  -- json array of {"title": "...", "url": "..."} entries for the
  -- related artist's albums on bandcamp. capped at ~25 in repo code.
  bandcamp_album_urlz TEXT,
  -- thumbnail URL (no media_blobz ingest yet; that's a stretch).
  image_url TEXT,
  -- json array of {"name": "spotify"|"discogs"|..., "url": "..."}.
  external_urlz TEXT,
  fetched_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  -- one row per (source_artist, related_name_key, source). dedup at
  -- write time so repeated processor runs upsert in place rather
  -- than appending duplicates.
  UNIQUE (source_artist_id, related_name_key, source)
);

-- forward lookup: "what's related to artist X?"
CREATE INDEX idx_related_artistz_source_artist
  ON related_artistz(source_artist_id)
  WHERE deleted_at IS NULL;

-- reverse lookup: "which local artists list X as related?"
CREATE INDEX idx_related_artistz_related_artist
  ON related_artistz(related_artist_id)
  WHERE related_artist_id IS NOT NULL AND deleted_at IS NULL;

-- backfill cross-ref by mbid when a new local artist lands
CREATE INDEX idx_related_artistz_mbid
  ON related_artistz(related_mbid)
  WHERE related_mbid IS NOT NULL AND deleted_at IS NULL;

-- backfill cross-ref by normalized name when no mbid is present
CREATE INDEX idx_related_artistz_name_key
  ON related_artistz(related_name_key)
  WHERE deleted_at IS NULL;
