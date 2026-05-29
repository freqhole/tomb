-- taxonomy refactor: phase 2, taxon-aware FTS rebuild.
--
-- before this migration:
--   songz_fts(.., genre_name, sub_genre_names, ..)
--   albumz_fts(.., genre_name, sub_genre_names)
--   artistz_fts(.., genre_names)
--   genrez_fts(genre_id, name)
--   sub_genrez_fts(..)  -- unused, dead since 009
-- after:
--   songz_fts(.., taxon_labels, ..)        -- single column, every kind
--   albumz_fts(.., taxon_labels)
--   artistz_fts(.., taxon_labels)
--   taxonz_fts(taxon_id, kind_slug, label) -- replaces genrez_fts; cross-kind autocomplete
--   sub_genrez_fts dropped
--   triggers read from album_taxonz JOIN taxonz instead of album_genrez JOIN genrez
--   new triggers on taxonz / album_taxonz keep things in sync
--
-- sqlite fts5 has no `ALTER TABLE ... DROP/RENAME COLUMN`, so the
-- search tables are dropped and recreated. all rows are backfilled
-- at the bottom from albumz / songz / artistz / taxonz.

-- ---- drop old triggers ----

DROP TRIGGER IF EXISTS artistz_fts_insert;
DROP TRIGGER IF EXISTS artistz_fts_update;
DROP TRIGGER IF EXISTS artistz_fts_delete;
DROP TRIGGER IF EXISTS songz_fts_insert;
DROP TRIGGER IF EXISTS songz_fts_update;
DROP TRIGGER IF EXISTS songz_fts_delete;
DROP TRIGGER IF EXISTS albumz_fts_insert;
DROP TRIGGER IF EXISTS albumz_fts_update;
DROP TRIGGER IF EXISTS albumz_fts_delete;
DROP TRIGGER IF EXISTS genrez_fts_insert;
DROP TRIGGER IF EXISTS genrez_fts_update;
DROP TRIGGER IF EXISTS genrez_fts_delete;

-- ---- drop old fts tables ----

DROP TABLE IF EXISTS sub_genrez_fts;
DROP TABLE IF EXISTS genrez_fts;
DROP TABLE IF EXISTS songz_fts;
DROP TABLE IF EXISTS albumz_fts;
DROP TABLE IF EXISTS artistz_fts;

-- ---- recreate, taxon-aware ----

CREATE VIRTUAL TABLE songz_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist_name,
    album_name,
    taxon_labels,        -- every linked taxon (genre, mood, era, ...) for the album
    filename,
    lyrics,
    metadata_text,
    tokenize = 'porter unicode61'
);

CREATE VIRTUAL TABLE albumz_fts USING fts5(
    album_id UNINDEXED,
    title,
    artist_name,
    taxon_labels,
    tokenize = 'porter unicode61'
);

CREATE VIRTUAL TABLE artistz_fts USING fts5(
    artist_id UNINDEXED,
    name,
    taxon_labels,        -- aggregated across the artist's albums
    tokenize = 'porter unicode61'
);

-- generic taxon autocomplete; filter by `kind_slug` for genre-only / mood-only / etc.
CREATE VIRTUAL TABLE taxonz_fts USING fts5(
    taxon_id UNINDEXED,
    kind_slug,
    label,
    tokenize = 'porter unicode61'
);

-- ---- triggers: artists ----

CREATE TRIGGER artistz_fts_insert AFTER INSERT ON artistz
BEGIN
    INSERT INTO artistz_fts(artist_id, name, taxon_labels)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN album_taxonz at ON at.album_id = als.album_id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE ars.artist_id = NEW.id AND t.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_update AFTER UPDATE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
    INSERT INTO artistz_fts(artist_id, name, taxon_labels)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN album_taxonz at ON at.album_id = als.album_id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE ars.artist_id = NEW.id AND t.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_delete AFTER DELETE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
END;

-- ---- triggers: songs ----

CREATE TRIGGER songz_fts_insert AFTER INSERT ON songz
BEGIN
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, taxon_labels,
        filename, lyrics, metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_songz als
                JOIN albumz a ON als.album_id = a.id
                JOIN album_taxonz at ON at.album_id = a.id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE als.song_id = NEW.id
                  AND a.deleted_at IS NULL
                  AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_update AFTER UPDATE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, taxon_labels,
        filename, lyrics, metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_songz als
                JOIN albumz a ON als.album_id = a.id
                JOIN album_taxonz at ON at.album_id = a.id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE als.song_id = NEW.id
                  AND a.deleted_at IS NULL
                  AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_delete AFTER DELETE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
END;

-- ---- triggers: albums ----

CREATE TRIGGER albumz_fts_insert AFTER INSERT ON albumz
BEGIN
    INSERT INTO albumz_fts(album_id, title, artist_name, taxon_labels)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_taxonz at
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE at.album_id = NEW.id AND t.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER albumz_fts_update AFTER UPDATE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
    INSERT INTO albumz_fts(album_id, title, artist_name, taxon_labels)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_taxonz at
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE at.album_id = NEW.id AND t.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER albumz_fts_delete AFTER DELETE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
END;

-- ---- triggers: taxonz <-> taxonz_fts ----

CREATE TRIGGER taxonz_fts_insert AFTER INSERT ON taxonz
WHEN NEW.deleted_at IS NULL
BEGIN
    INSERT INTO taxonz_fts(taxon_id, kind_slug, label)
    SELECT
        NEW.id,
        (SELECT slug FROM taxon_kindz WHERE id = NEW.kind_id),
        NEW.label;
END;

CREATE TRIGGER taxonz_fts_update AFTER UPDATE ON taxonz
BEGIN
    DELETE FROM taxonz_fts WHERE taxon_id = OLD.id;
    INSERT INTO taxonz_fts(taxon_id, kind_slug, label)
    SELECT
        NEW.id,
        (SELECT slug FROM taxon_kindz WHERE id = NEW.kind_id),
        NEW.label
    WHERE NEW.deleted_at IS NULL;
END;

CREATE TRIGGER taxonz_fts_delete AFTER DELETE ON taxonz
BEGIN
    DELETE FROM taxonz_fts WHERE taxon_id = OLD.id;
END;

-- ---- triggers: album_taxonz changes flip the album/song fts rows ----
--
-- when a link is added/removed/changed, every album/song fts row for
-- that album needs to be re-aggregated. easiest: delete and re-insert
-- via the same logic the album/song triggers use. we delete from fts
-- and re-insert from the source row.

CREATE TRIGGER album_taxonz_fts_after_insert AFTER INSERT ON album_taxonz
BEGIN
    -- bump the album row in albumz_fts
    DELETE FROM albumz_fts WHERE album_id = NEW.album_id;
    INSERT INTO albumz_fts(album_id, title, artist_name, taxon_labels)
    SELECT
        a.id,
        a.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = a.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_taxonz at
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE at.album_id = a.id AND t.deleted_at IS NULL
            )
        ), '')
    FROM albumz a
    WHERE a.id = NEW.album_id AND a.deleted_at IS NULL;

    -- bump every song row whose album just changed taxons
    DELETE FROM songz_fts
    WHERE song_id IN (SELECT song_id FROM album_songz WHERE album_id = NEW.album_id);
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, taxon_labels,
        filename, lyrics, metadata_text
    )
    SELECT
        s.id,
        s.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = s.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = s.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_songz als
                JOIN albumz a ON als.album_id = a.id
                JOIN album_taxonz at ON at.album_id = a.id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE als.song_id = s.id
                  AND a.deleted_at IS NULL
                  AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = s.media_blob_id
        ), ''),
        COALESCE(s.lyrics, ''),
        COALESCE(s.metadata, '{}')
    FROM songz s
    JOIN album_songz als ON als.song_id = s.id
    WHERE als.album_id = NEW.album_id AND s.deleted_at IS NULL;
END;

CREATE TRIGGER album_taxonz_fts_after_delete AFTER DELETE ON album_taxonz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.album_id;
    INSERT INTO albumz_fts(album_id, title, artist_name, taxon_labels)
    SELECT
        a.id,
        a.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = a.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_taxonz at
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE at.album_id = a.id AND t.deleted_at IS NULL
            )
        ), '')
    FROM albumz a
    WHERE a.id = OLD.album_id AND a.deleted_at IS NULL;

    DELETE FROM songz_fts
    WHERE song_id IN (SELECT song_id FROM album_songz WHERE album_id = OLD.album_id);
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, taxon_labels,
        filename, lyrics, metadata_text
    )
    SELECT
        s.id,
        s.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = s.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = s.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM album_songz als
                JOIN albumz a ON als.album_id = a.id
                JOIN album_taxonz at ON at.album_id = a.id
                JOIN taxonz t ON t.id = at.taxon_id
                WHERE als.song_id = s.id
                  AND a.deleted_at IS NULL
                  AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = s.media_blob_id
        ), ''),
        COALESCE(s.lyrics, ''),
        COALESCE(s.metadata, '{}')
    FROM songz s
    JOIN album_songz als ON als.song_id = s.id
    WHERE als.album_id = OLD.album_id AND s.deleted_at IS NULL;
END;

-- ---- backfill ----

-- taxonz_fts: every non-deleted taxon
INSERT INTO taxonz_fts(taxon_id, kind_slug, label)
SELECT t.id, k.slug, t.label
FROM taxonz t
JOIN taxon_kindz k ON k.id = t.kind_id
WHERE t.deleted_at IS NULL;

-- albumz_fts: every non-deleted album
INSERT INTO albumz_fts(album_id, title, artist_name, taxon_labels)
SELECT
    a.id,
    a.title,
    COALESCE((
        SELECT GROUP_CONCAT(artist_name, ', ')
        FROM (
            SELECT DISTINCT artist.name as artist_name
            FROM album_songz
            JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
            JOIN artistz artist ON artist_songz.artist_id = artist.id
            WHERE album_songz.album_id = a.id AND artist.deleted_at IS NULL
        )
    ), ''),
    COALESCE((
        SELECT GROUP_CONCAT(label, ', ')
        FROM (
            SELECT DISTINCT t.label as label
            FROM album_taxonz at
            JOIN taxonz t ON t.id = at.taxon_id
            WHERE at.album_id = a.id AND t.deleted_at IS NULL
        )
    ), '')
FROM albumz a
WHERE a.deleted_at IS NULL;

-- songz_fts: every non-deleted song
INSERT INTO songz_fts(
    song_id, title, artist_name, album_name, taxon_labels,
    filename, lyrics, metadata_text
)
SELECT
    s.id,
    s.title,
    COALESCE((
        SELECT GROUP_CONCAT(artist_name, ', ')
        FROM (
            SELECT DISTINCT artist.name as artist_name
            FROM artist_songz
            JOIN artistz artist ON artist_songz.artist_id = artist.id
            WHERE artist_songz.song_id = s.id AND artist.deleted_at IS NULL
        )
    ), ''),
    COALESCE((
        SELECT album.title
        FROM album_songz
        JOIN albumz album ON album_songz.album_id = album.id
        WHERE album_songz.song_id = s.id AND album.deleted_at IS NULL
        LIMIT 1
    ), ''),
    COALESCE((
        SELECT GROUP_CONCAT(label, ', ')
        FROM (
            SELECT DISTINCT t.label as label
            FROM album_songz als
            JOIN albumz a ON als.album_id = a.id
            JOIN album_taxonz at ON at.album_id = a.id
            JOIN taxonz t ON t.id = at.taxon_id
            WHERE als.song_id = s.id
              AND a.deleted_at IS NULL
              AND t.deleted_at IS NULL
        )
    ), ''),
    COALESCE((
        SELECT media_blob.filename
        FROM media_blobz media_blob
        WHERE media_blob.id = s.media_blob_id
    ), ''),
    COALESCE(s.lyrics, ''),
    COALESCE(s.metadata, '{}')
FROM songz s
WHERE s.deleted_at IS NULL;

-- artistz_fts: every non-deleted artist
INSERT INTO artistz_fts(artist_id, name, taxon_labels)
SELECT
    ar.id,
    ar.name,
    COALESCE((
        SELECT GROUP_CONCAT(label, ', ')
        FROM (
            SELECT DISTINCT t.label as label
            FROM artist_songz ars
            JOIN album_songz als ON ars.song_id = als.song_id
            JOIN album_taxonz at ON at.album_id = als.album_id
            JOIN taxonz t ON t.id = at.taxon_id
            WHERE ars.artist_id = ar.id AND t.deleted_at IS NULL
        )
    ), '')
FROM artistz ar
WHERE ar.deleted_at IS NULL;
