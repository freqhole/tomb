-- 079: track which remote (if any) an import review session's reviewed
-- output should ultimately be sent to.
--
-- written once, atomically, at session-creation time (see
-- offal/upload/music.rs's upload_music/import_music_paths) - so any
-- client reading this same local grimoire db (any device, any app
-- restart) sees the same destination, instead of relying on client-side
-- in-memory bookkeeping that a restart or a different device would lose.
--
-- separate from job_sessionz (which is generic across every job type -
-- rescans, enrichment, precheck, etc, not just review-before-send
-- imports) so this stays a narrowly-scoped, optional annotation rather
-- than polluting a shared table.
--
-- target_remote_name is a snapshot at creation time (not a live join to
-- the remotez table) so review still reads sensibly if the remote is
-- later renamed or removed.

CREATE TABLE import_session_send_targetz (
  session_id          TEXT NOT NULL PRIMARY KEY REFERENCES job_sessionz(id) ON DELETE CASCADE,
  target_remote_id    TEXT NOT NULL,
  target_remote_name  TEXT NOT NULL,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);
