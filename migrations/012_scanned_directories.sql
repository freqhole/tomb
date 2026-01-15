-- scanned_directories table
-- tracks which directories have been scanned for music files
-- used for rescan operations to know what to check

CREATE TABLE scanned_directories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  path TEXT NOT NULL UNIQUE,       -- absolute directory path
  recursive INTEGER NOT NULL DEFAULT 1,  -- always recursive (0/1 boolean)
  last_scanned_at INTEGER NOT NULL,      -- unix timestamp UTC
  file_count INTEGER NOT NULL DEFAULT 0, -- files found in last scan
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  CHECK (length(id) >= 7 AND length(id) <= 16)
);

-- trigger for automatic updated_at
CREATE TRIGGER trg_scanned_directories_updated_at
AFTER UPDATE ON scanned_directories
FOR EACH ROW
BEGIN
  UPDATE scanned_directories SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- indexes
CREATE UNIQUE INDEX idx_scanned_directories_path ON scanned_directories(path);
CREATE INDEX idx_scanned_directories_last_scanned ON scanned_directories(last_scanned_at DESC);
