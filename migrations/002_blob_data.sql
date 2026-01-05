-- blob_data.db - pure key/value store for raw data
CREATE TABLE blob_data (
  id TEXT PRIMARY KEY,            -- matches media_blobz.id
  data BLOB NOT NULL              -- raw bytes (thumbnails, etc.)
);

-- blob_data indexes (minimal - just primary key lookup)
-- no additional indexes needed for pure key/value store
