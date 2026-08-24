-- 063: video full-text search - videoz_fts and sync triggers
--
-- mirrors the songz_fts/albumz_fts pattern from 009/035: a single fts5
-- table per domain entity, kept in sync via insert/update/delete triggers
-- on the source table plus a resync trigger on the taxon link table.
--
-- taxon_labels is sourced from the generalized entity_taxonz table
-- (entity_type = 'video'), since video taxon links don't have their own
-- dedicated junction table the way album_taxonz does for albums.

CREATE VIRTUAL TABLE videoz_fts USING fts5(
    video_id UNINDEXED,
    title,
    series_name,
    taxon_labels,
    description,
    filename,
    tokenize = 'porter unicode61'
);

-- ---- triggers: videoz <-> videoz_fts ----

CREATE TRIGGER videoz_fts_insert AFTER INSERT ON videoz
BEGIN
    INSERT INTO videoz_fts(video_id, title, series_name, taxon_labels, description, filename)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT series.title FROM video_seriez series
            WHERE series.id = NEW.series_id AND series.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video' AND et.entity_id = NEW.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(NEW.description, ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), '');
END;

CREATE TRIGGER videoz_fts_update AFTER UPDATE ON videoz
BEGIN
    DELETE FROM videoz_fts WHERE video_id = OLD.id;
    INSERT INTO videoz_fts(video_id, title, series_name, taxon_labels, description, filename)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT series.title FROM video_seriez series
            WHERE series.id = NEW.series_id AND series.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video' AND et.entity_id = NEW.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(NEW.description, ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), '');
END;

CREATE TRIGGER videoz_fts_delete AFTER DELETE ON videoz
BEGIN
    DELETE FROM videoz_fts WHERE video_id = OLD.id;
END;

-- ---- triggers: entity_taxonz (video rows only) <-> videoz_fts ----
--
-- when a video's taxon links change, re-derive that one video's fts row.

CREATE TRIGGER entity_taxonz_video_fts_after_insert AFTER INSERT ON entity_taxonz
WHEN NEW.entity_type = 'video'
BEGIN
    DELETE FROM videoz_fts WHERE video_id = NEW.entity_id;
    INSERT INTO videoz_fts(video_id, title, series_name, taxon_labels, description, filename)
    SELECT
        v.id,
        v.title,
        COALESCE((
            SELECT series.title FROM video_seriez series
            WHERE series.id = v.series_id AND series.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video' AND et.entity_id = v.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(v.description, ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = v.media_blob_id
        ), '')
    FROM videoz v
    WHERE v.id = NEW.entity_id AND v.deleted_at IS NULL;
END;

CREATE TRIGGER entity_taxonz_video_fts_after_delete AFTER DELETE ON entity_taxonz
WHEN OLD.entity_type = 'video'
BEGIN
    DELETE FROM videoz_fts WHERE video_id = OLD.entity_id;
    INSERT INTO videoz_fts(video_id, title, series_name, taxon_labels, description, filename)
    SELECT
        v.id,
        v.title,
        COALESCE((
            SELECT series.title FROM video_seriez series
            WHERE series.id = v.series_id AND series.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video' AND et.entity_id = v.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(v.description, ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = v.media_blob_id
        ), '')
    FROM videoz v
    WHERE v.id = OLD.entity_id AND v.deleted_at IS NULL;
END;

-- ---- backfill existing rows ----

INSERT INTO videoz_fts(video_id, title, series_name, taxon_labels, description, filename)
SELECT
    v.id,
    v.title,
    COALESCE((
        SELECT series.title FROM video_seriez series
        WHERE series.id = v.series_id AND series.deleted_at IS NULL
    ), ''),
    COALESCE((
        SELECT GROUP_CONCAT(label, ', ')
        FROM (
            SELECT DISTINCT t.label as label
            FROM entity_taxonz et
            JOIN taxonz t ON t.id = et.taxon_id
            WHERE et.entity_type = 'video' AND et.entity_id = v.id AND t.deleted_at IS NULL
        )
    ), ''),
    COALESCE(v.description, ''),
    COALESCE((
        SELECT media_blob.filename
        FROM media_blobz media_blob
        WHERE media_blob.id = v.media_blob_id
    ), '')
FROM videoz v
WHERE v.deleted_at IS NULL;
