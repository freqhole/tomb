-- taxonomy refactor: phase 2, copy existing data into the new tables.
--
-- this migration is idempotent only because sqlx runs each migration
-- exactly once; it does not handle being re-run on partially-migrated
-- data. if you need to re-run, blow away the new rows first via:
--   DELETE FROM album_taxonz WHERE origin = 'user';
--   DELETE FROM taxonz WHERE kind_id IN (
--     SELECT id FROM taxon_kindz WHERE slug IN ('genre','label')
--   );
--
-- nothing here is dropped - old tables / columns survive until
-- `036_taxonomy_drop_old.sql`.

-- step 1: copy every (non-deleted) genre into taxonz under
-- kind=genre, preserving the original id so any cached references
-- still resolve.
INSERT INTO taxonz (id, kind_id, slug, label, is_user_defined, created_at, created_by)
SELECT
    g.id,
    (SELECT id FROM taxon_kindz WHERE slug = 'genre'),
    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(g.name), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')),
    g.name,
    1,
    g.created_at,
    NULL
FROM genrez g
WHERE g.deleted_at IS NULL;

-- step 2: copy every album <-> genre link into album_taxonz with
-- origin='user' (the only origin we had before this refactor).
INSERT INTO album_taxonz (album_id, taxon_id, origin, confidence, created_at, created_by)
SELECT
    ag.album_id,
    ag.genre_id,
    'user',
    NULL,
    unixepoch(),
    NULL
FROM album_genrez ag
WHERE EXISTS (SELECT 1 FROM taxonz t WHERE t.id = ag.genre_id);

-- step 3: dedupe `albumz.label` values into taxonz under kind=label,
-- then create one album_taxonz link per album.
--
-- step 3a: insert distinct, trimmed, non-empty labels as taxons.
-- slug derivation matches step 1 (lowercase, dashes for separators).
INSERT INTO taxonz (kind_id, slug, label, is_user_defined, created_at, created_by)
SELECT
    (SELECT id FROM taxon_kindz WHERE slug = 'label'),
    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(label), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')),
    TRIM(label),
    0,
    unixepoch(),
    NULL
FROM (
    SELECT DISTINCT TRIM(label) AS label
    FROM albumz
    WHERE label IS NOT NULL
      AND TRIM(label) != ''
      AND deleted_at IS NULL
);

-- step 3b: link each album to its label-taxon.
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
    ON t.kind_id = (SELECT id FROM taxon_kindz WHERE slug = 'label')
   AND t.label  = TRIM(a.label)
WHERE a.label IS NOT NULL
  AND TRIM(a.label) != ''
  AND a.deleted_at IS NULL;
