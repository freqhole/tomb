-- media_blobz.db - metadata only, no raw data
CREATE TABLE media_blobz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),            -- 7-16 char hash
  sha256 TEXT UNIQUE NOT NULL,    -- 64 char full hash
  size INTEGER,
  mime TEXT,
  source_client_id TEXT,
  local_path TEXT,
  metadata TEXT,                  -- json using sqlite json1 extension
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),     -- unix timestamp UTC
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),     -- unix timestamp UTC
  parent_blob_id TEXT,
  blob_type TEXT NOT NULL DEFAULT 'original',
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  -- constraints
  CHECK (length(id) >= 7 AND length(id) <= 16),
  CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  CHECK (blob_type IN ('original', 'thumbnail', 'waveform', 'preview')),
  CHECK ((blob_type = 'original' AND parent_blob_id IS NULL) OR (blob_type != 'original' AND parent_blob_id IS NOT NULL))
);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_media_blobz_updated_at
AFTER UPDATE ON media_blobz
FOR EACH ROW
BEGIN
  UPDATE media_blobz SET updated_at = unixepoch() WHERE rowid = NEW.rowid;
END;

-- indexes
CREATE UNIQUE INDEX idx_media_blobz_sha256 ON media_blobz(sha256);
CREATE INDEX idx_media_blobz_blob_type ON media_blobz(blob_type);
CREATE INDEX idx_media_blobz_created_at ON media_blobz(created_at DESC);
CREATE INDEX idx_media_blobz_deleted_at ON media_blobz(deleted_at) WHERE deleted_at IS NOT NULL;
