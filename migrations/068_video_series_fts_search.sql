-- 068: video series full-text search - video_seriez_fts and sync triggers
--
-- mirrors 063's videoz_fts pattern (itself mirroring songz_fts/albumz_fts
-- from 009/035): a single fts5 table per domain entity, kept in sync via
-- insert/update/delete triggers on the source table plus a resync
-- trigger on the taxon link table.
--
-- taxon_labels is sourced from the generalized entity_taxonz table
-- (entity_type = 'video_series'), same as videoz_fts does for
-- entity_type = 'video'.

CREATE VIRTUAL TABLE video_seriez_fts USING fts5(
    series_id UNINDEXED,
    title,
    taxon_labels,
    description,
    tokenize = 'porter unicode61'
);

-- ---- triggers: video_seriez <-> video_seriez_fts ----

CREATE TRIGGER video_seriez_fts_insert AFTER INSERT ON video_seriez
BEGIN
    INSERT INTO video_seriez_fts(series_id, title, taxon_labels, description)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video_series' AND et.entity_id = NEW.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(NEW.description, '');
END;

CREATE TRIGGER video_seriez_fts_update AFTER UPDATE ON video_seriez
BEGIN
    DELETE FROM video_seriez_fts WHERE series_id = OLD.id;
    INSERT INTO video_seriez_fts(series_id, title, taxon_labels, description)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video_series' AND et.entity_id = NEW.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(NEW.description, '');
END;

CREATE TRIGGER video_seriez_fts_delete AFTER DELETE ON video_seriez
BEGIN
    DELETE FROM video_seriez_fts WHERE series_id = OLD.id;
END;

-- ---- triggers: entity_taxonz (video_series rows only) <-> video_seriez_fts ----
--
-- when a series' taxon links change, re-derive that one series' fts row.

CREATE TRIGGER entity_taxonz_video_series_fts_after_insert AFTER INSERT ON entity_taxonz
WHEN NEW.entity_type = 'video_series'
BEGIN
    DELETE FROM video_seriez_fts WHERE series_id = NEW.entity_id;
    INSERT INTO video_seriez_fts(series_id, title, taxon_labels, description)
    SELECT
        s.id,
        s.title,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video_series' AND et.entity_id = s.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(s.description, '')
    FROM video_seriez s
    WHERE s.id = NEW.entity_id AND s.deleted_at IS NULL;
END;

CREATE TRIGGER entity_taxonz_video_series_fts_after_delete AFTER DELETE ON entity_taxonz
WHEN OLD.entity_type = 'video_series'
BEGIN
    DELETE FROM video_seriez_fts WHERE series_id = OLD.entity_id;
    INSERT INTO video_seriez_fts(series_id, title, taxon_labels, description)
    SELECT
        s.id,
        s.title,
        COALESCE((
            SELECT GROUP_CONCAT(label, ', ')
            FROM (
                SELECT DISTINCT t.label as label
                FROM entity_taxonz et
                JOIN taxonz t ON t.id = et.taxon_id
                WHERE et.entity_type = 'video_series' AND et.entity_id = s.id AND t.deleted_at IS NULL
            )
        ), ''),
        COALESCE(s.description, '')
    FROM video_seriez s
    WHERE s.id = OLD.entity_id AND s.deleted_at IS NULL;
END;

-- ---- backfill existing rows ----

INSERT INTO video_seriez_fts(series_id, title, taxon_labels, description)
SELECT
    s.id,
    s.title,
    COALESCE((
        SELECT GROUP_CONCAT(label, ', ')
        FROM (
            SELECT DISTINCT t.label as label
            FROM entity_taxonz et
            JOIN taxonz t ON t.id = et.taxon_id
            WHERE et.entity_type = 'video_series' AND et.entity_id = s.id AND t.deleted_at IS NULL
        )
    ), ''),
    COALESCE(s.description, '')
FROM video_seriez s
WHERE s.deleted_at IS NULL;
