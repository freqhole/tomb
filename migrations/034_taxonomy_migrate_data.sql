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

-- step 1: copy genres into taxonz under kind=genre.
--
-- some legacy databases contain distinct genre names that collapse to the
-- same taxonomy slug under the old normalization logic (for example spacing /
-- punctuation variants). pick one canonical legacy genre row per slug,
-- preserve that id, and map all album links to it in step 2.
WITH normalized_genres AS (
    SELECT
        g.id,
        g.name,
        g.created_at,
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(g.name), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')) AS slug
    FROM genrez g
    WHERE g.deleted_at IS NULL
),
canonical_genres AS (
    SELECT slug, MIN(id) AS canonical_id
    FROM normalized_genres
    GROUP BY slug
)
INSERT INTO taxonz (id, kind_id, slug, label, is_user_defined, created_at, created_by)
SELECT
    ng.id,
    (SELECT id FROM taxon_kindz WHERE slug = 'genre'),
    ng.slug,
    ng.name,
    1,
    ng.created_at,
    NULL
FROM normalized_genres ng
JOIN canonical_genres cg ON cg.canonical_id = ng.id;

-- step 2: copy every album <-> genre link into album_taxonz with
-- origin='user' (the only origin we had before this refactor), collapsing
-- duplicate legacy genre ids onto the canonical taxon id for that slug.
WITH normalized_genres AS (
    SELECT
        g.id,
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(g.name), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')) AS slug
    FROM genrez g
    WHERE g.deleted_at IS NULL
),
canonical_genres AS (
    SELECT slug, MIN(id) AS canonical_id
    FROM normalized_genres
    GROUP BY slug
),
genre_mapping AS (
    SELECT ng.id AS legacy_genre_id, cg.canonical_id
    FROM normalized_genres ng
    JOIN canonical_genres cg ON cg.slug = ng.slug
)
INSERT OR IGNORE INTO album_taxonz (album_id, taxon_id, origin, confidence, created_at, created_by)
SELECT
    ag.album_id,
    gm.canonical_id,
    'user',
    NULL,
    unixepoch(),
    NULL
FROM album_genrez ag
JOIN genre_mapping gm ON gm.legacy_genre_id = ag.genre_id
WHERE EXISTS (SELECT 1 FROM taxonz t WHERE t.id = gm.canonical_id);

-- step 3: dedupe `albumz.label` values into taxonz under kind=label,
-- then create one album_taxonz link per album.
--
-- step 3a: insert one canonical label per normalized slug as a label taxon.
INSERT INTO taxonz (kind_id, slug, label, is_user_defined, created_at, created_by)
SELECT
    (SELECT id FROM taxon_kindz WHERE slug = 'label'),
    normalized.slug,
    MIN(normalized.label),
    0,
    unixepoch(),
    NULL
FROM (
    SELECT
        TRIM(label) AS label,
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(label), ' ', '-'), '/', '-'), '&', 'and'), '--', '-')) AS slug
    FROM albumz
    WHERE label IS NOT NULL
      AND TRIM(label) != ''
      AND deleted_at IS NULL
) AS normalized
GROUP BY normalized.slug;

-- step 3b: link each album to its label-taxon by normalized slug so legacy
-- label variants collapse onto the same taxonomy row.
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
    AND t.slug   = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(a.label), ' ', '-'), '/', '-'), '&', 'and'), '--', '-'))
WHERE a.label IS NOT NULL
  AND TRIM(a.label) != ''
  AND a.deleted_at IS NULL;
