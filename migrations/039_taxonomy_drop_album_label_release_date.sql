-- taxonomy refactor: phase 3, drop legacy album columns.
--
-- migrates `albumz.release_date` into a new `release_date` taxon kind
-- (mirrors how migration 034 handled `albumz.label`), then drops both
-- columns. also drops the unused `bpm` taxon kind (no albums use it).
--
-- after this migration:
--   * `albumz.label` no longer exists; consumers read it via
--     `album_query_view.album_label` (synthesized from `album_taxonz`
--     under kind=label).
--   * `albumz.release_date` no longer exists; the view synthesizes
--     `album_release_date` the same way under kind=release_date.
--   * the `bpm` taxon kind is removed; song-level bpm still lives in
--     `songz.bpm` and is unaffected.

-- step 0: drop dependent views; they'll be recreated from
-- migrations/views/*.sql at app boot (or `make db-migrate`).
DROP VIEW IF EXISTS feed_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS album_query_view;

-- step 1: seed the `release_date` taxon kind. idempotent on slug.
INSERT INTO taxon_kindz (slug, label, description, color, value_type, unit, display_order, is_user_defined)
SELECT 'release_date', 'release date', 'album release date (year, year-month, or full ISO date)', '#0ea5e9', 'categorical', NULL, 75, 0
WHERE NOT EXISTS (SELECT 1 FROM taxon_kindz WHERE slug = 'release_date');

-- step 2: insert distinct, trimmed, non-empty release_date values as
-- taxons. slug = lowercased value with separators normalized to '-'.
INSERT INTO taxonz (kind_id, slug, label, is_user_defined, created_at, created_by)
SELECT
    (SELECT id FROM taxon_kindz WHERE slug = 'release_date'),
    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(release_date), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')),
    TRIM(release_date),
    0,
    unixepoch(),
    NULL
FROM (
    SELECT DISTINCT TRIM(release_date) AS release_date
    FROM albumz
    WHERE release_date IS NOT NULL
      AND TRIM(release_date) != ''
      AND deleted_at IS NULL
)
WHERE NOT EXISTS (
    SELECT 1 FROM taxonz t
    WHERE t.kind_id = (SELECT id FROM taxon_kindz WHERE slug = 'release_date')
      AND t.label = TRIM(release_date)
);

-- step 3: link each album to its release_date taxon.
INSERT INTO album_taxonz (album_id, taxon_id, origin, confidence, created_at, created_by)
SELECT
    a.id,
    t.id,
    'user',
    NULL,
    unixepoch(),
    NULL
FROM albumz a
JOIN taxonz t
    ON t.kind_id = (SELECT id FROM taxon_kindz WHERE slug = 'release_date')
   AND t.label  = TRIM(a.release_date)
WHERE a.release_date IS NOT NULL
  AND TRIM(a.release_date) != ''
  AND a.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM album_taxonz at
      WHERE at.album_id = a.id
        AND at.taxon_id = t.id
        AND at.origin = 'user'
  );

-- step 4: drop the `bpm` taxon kind. no taxonz rows reference it
-- (verified pre-migration); deleting the kind itself is enough.
DELETE FROM taxon_kindz WHERE slug = 'bpm';

-- step 5: drop the legacy columns from albumz. requires sqlite >= 3.35.
ALTER TABLE albumz DROP COLUMN label;
ALTER TABLE albumz DROP COLUMN release_date;
