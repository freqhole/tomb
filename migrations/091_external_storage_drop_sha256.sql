-- 091: drop external_storage_synced_songz.sha256 (unused legacy hash)
--
-- blake3 is the real content identity now - `SyncedSong::matches_content`
-- already prefers it, falling back to sha256 only when a side lacks a
-- blake3. this column is a plain, non-unique, non-view-referenced column
-- with no dependents, so a plain `ALTER TABLE ... DROP COLUMN` is safe
-- directly, no writable_schema trick or view-drop dance needed.

ALTER TABLE external_storage_synced_songz DROP COLUMN sha256;
