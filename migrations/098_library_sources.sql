-- removable library roots are independent of portable-device sync destinations.
-- historical paths protect media while a volume is absent or remounted elsewhere.
CREATE TABLE library_sourcez (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    volume_key TEXT NOT NULL,
    volume_uuid TEXT,
    partition_uuid TEXT,
    label TEXT,
    relative_path TEXT NOT NULL,
    last_known_path TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'both' CHECK (domain IN ('both', 'music', 'video')),
    generate_renditions INTEGER NOT NULL DEFAULT 1 CHECK (generate_renditions IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (volume_key, relative_path)
);

CREATE TABLE library_source_pathz (
    source_id TEXT NOT NULL REFERENCES library_sourcez(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    PRIMARY KEY (source_id, path)
);

-- unknown is distinct from offline: a failed probe must not hide a source.
CREATE TABLE library_source_statez (
    source_id TEXT PRIMARY KEY REFERENCES library_sourcez(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('unknown', 'online', 'offline')),
    missing_since INTEGER,
    checked_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    CHECK (missing_since IS NULL OR missing_since <= checked_at)
);

CREATE INDEX idx_library_source_statez_status ON library_source_statez(status, source_id);

-- desktop sync registrations are mirrored here for shared library discovery.
CREATE TABLE storage_sync_targetz (
    owner TEXT NOT NULL,
    device_id TEXT NOT NULL,
    volume_uuid TEXT,
    path TEXT NOT NULL,
    PRIMARY KEY (owner, device_id)
);

CREATE INDEX idx_storage_sync_targetz_uuid ON storage_sync_targetz(volume_uuid);

-- index file ownership once on writes, not by walking paths during browsing.
-- the views loader supplies library_source_blob_path_view before app writes.
CREATE TABLE library_source_mediaz (
    blob_id TEXT NOT NULL REFERENCES media_blobz(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES library_sourcez(id) ON DELETE CASCADE,
    PRIMARY KEY (blob_id, source_id)
) WITHOUT ROWID;

CREATE INDEX idx_library_source_mediaz_source ON library_source_mediaz(source_id, blob_id);

CREATE TRIGGER trg_library_source_media_blob_insert
AFTER INSERT ON media_blobz
BEGIN
    INSERT OR IGNORE INTO library_source_mediaz (blob_id, source_id)
    SELECT blob_id, source_id FROM library_source_blob_path_view WHERE blob_id = NEW.id;
END;

CREATE TRIGGER trg_library_source_media_blob_path_update
AFTER UPDATE OF local_path ON media_blobz
WHEN OLD.local_path IS NOT NEW.local_path
BEGIN
    DELETE FROM library_source_mediaz WHERE blob_id = NEW.id;
    INSERT INTO library_source_mediaz (blob_id, source_id)
    SELECT blob_id, source_id FROM library_source_blob_path_view WHERE blob_id = NEW.id;
END;

CREATE TRIGGER trg_library_source_media_path_insert
AFTER INSERT ON library_source_pathz
BEGIN
    INSERT OR IGNORE INTO library_source_mediaz (blob_id, source_id)
    SELECT blob_id, source_id FROM library_source_blob_path_view WHERE source_id = NEW.source_id;
END;

CREATE TRIGGER trg_library_source_media_path_delete
AFTER DELETE ON library_source_pathz
BEGIN
    DELETE FROM library_source_mediaz WHERE source_id = OLD.source_id;
    INSERT INTO library_source_mediaz (blob_id, source_id)
    SELECT blob_id, source_id FROM library_source_blob_path_view WHERE source_id = OLD.source_id;
END;

CREATE TRIGGER trg_library_source_media_path_update
AFTER UPDATE OF source_id, path ON library_source_pathz
BEGIN
    DELETE FROM library_source_mediaz WHERE source_id IN (OLD.source_id, NEW.source_id);
    INSERT INTO library_source_mediaz (blob_id, source_id)
    SELECT blob_id, source_id FROM library_source_blob_path_view
    WHERE source_id IN (OLD.source_id, NEW.source_id);
END;
