-- denormalize a content-hash identity onto playback_progressz, keyed
-- alongside the existing (user_id, entity_type, entity_id) row.
--
-- entity_id is a single database's own row id - two different servers
-- (or a locally-synced copy vs. the remote it came from) never share
-- entity_ids for "the same" video/song, even though the underlying file
-- content is identical. blake3 content-hash IS shared across those
-- copies (videoz.media_blob_blake3 / songz.media_blob_blake3 are both
-- already denormalized onto their own rows - see
-- 084_videoz_denormalize_media_blob_blake3.sql and
-- 049_songz_denormalize_media_blob.sql), so storing it here too lets a
-- client correlate "resume progress for this content" across databases
-- (e.g. a remote's own progress plus a locally-synced copy's progress
-- for the same underlying file) by blake3 instead of by entity_id,
-- which is exactly what a cross-library "continue watching" lookup
-- needs.
--
-- nullable: a non-content entity_type (video_series/video_season, which
-- represent a collection rather than one piece of content) has no
-- single blake3 and always leaves this NULL. rows created before this
-- migration are backfilled below; new rows populate this column at
-- upsert time going forward (see playback_progress.rs's
-- `resolve_blake3`).

ALTER TABLE playback_progressz ADD COLUMN blake3 TEXT;

CREATE INDEX idx_playback_progressz_user_blake3 ON playback_progressz(user_id, blake3);

UPDATE playback_progressz
SET blake3 = (SELECT media_blob_blake3 FROM videoz WHERE videoz.id = playback_progressz.entity_id)
WHERE entity_type = 'video' AND blake3 IS NULL;

-- no 'song' rows exist yet as of this migration (nothing wrote them
-- before this change), but this keeps the backfill symmetric/future-
-- proof at zero cost if that's ever not true.
UPDATE playback_progressz
SET blake3 = (SELECT media_blob_blake3 FROM songz WHERE songz.id = playback_progressz.entity_id)
WHERE entity_type = 'song' AND blake3 IS NULL;
