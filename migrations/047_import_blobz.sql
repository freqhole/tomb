-- 047_import_blobz.sql
--
-- tracks which audio blobs arrived via an import job session,
-- and records review state per blob.
--
-- keying on media_blob_id (content-addressed) rather than album_id means:
--   - rows survive album renames, merges, and song moves
--   - ownership ("can this member edit?") falls out of media_blobz.created_by
--   - dedup hits (blob already exists) naturally produce no new row
--
-- review state is encoded as a timestamp:
--   reviewed_at IS NULL  -> pending
--   reviewed_at NOT NULL -> reviewed

CREATE TABLE import_blobz (
  media_blob_id TEXT NOT NULL PRIMARY KEY REFERENCES media_blobz(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL REFERENCES job_sessionz(id) ON DELETE CASCADE,
  reviewed_at   INTEGER,
  reviewed_by   TEXT REFERENCES user_accountz(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_import_blobz_session  ON import_blobz(session_id);
CREATE INDEX idx_import_blobz_pending  ON import_blobz(session_id) WHERE reviewed_at IS NULL;
