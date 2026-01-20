-- scan cache table for temporary session data during scans
-- used to share data between independent job executions in the same scan session

CREATE TABLE scan_cache (
  session_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  cache_value TEXT NOT NULL,  -- json data
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, cache_key)
);

-- index for cleanup by session
CREATE INDEX idx_scan_cache_session ON scan_cache(session_id);

-- index for timestamp-based cleanup (delete old sessions)
CREATE INDEX idx_scan_cache_created_at ON scan_cache(created_at);
