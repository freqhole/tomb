-- 008: scanning and caching - directory scanning, scan cache

-- scanned directories (for library scanning)
CREATE TABLE scanned_directories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  path TEXT NOT NULL UNIQUE,
  recursive INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (length(id) >= 7 AND length(id) <= 16)
);

CREATE UNIQUE INDEX idx_scanned_directories_path ON scanned_directories(path);
CREATE INDEX idx_scanned_directories_last_scanned ON scanned_directories(last_scanned_at DESC);

CREATE TRIGGER trg_scanned_directories_updated_at
AFTER UPDATE ON scanned_directories
FOR EACH ROW
BEGIN
  UPDATE scanned_directories SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- scan cache (for deduplication during scans)
CREATE TABLE scan_cache (
  session_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  cache_value TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, cache_key)
);

CREATE INDEX idx_scan_cache_session ON scan_cache(session_id);
CREATE INDEX idx_scan_cache_created_at ON scan_cache(created_at);
