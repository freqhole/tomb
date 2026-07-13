-- 049: denormalize songz's blob-streaming fields onto the song row itself.
--
-- a song's own media blob is content-addressed and immutable once created
-- (songz.media_blob_id is unique and never repointed after insert), so it's
-- safe to copy sha256/blake3/mime/size onto songz directly instead of
-- joining media_blobz on every read. this keeps song_query_view and
-- playlist_song_query_view working with a single-database query instead of
-- a live join, and lets the hot song-lookup-by-hash paths read a plain
-- indexed column instead of joining another table.
--
-- nullable for now: rows created before this migration are backfilled
-- below; new rows populate these columns at insert time going forward.

ALTER TABLE songz ADD COLUMN media_blob_sha256 TEXT;
ALTER TABLE songz ADD COLUMN media_blob_blake3 TEXT;
ALTER TABLE songz ADD COLUMN media_blob_mime TEXT;
ALTER TABLE songz ADD COLUMN media_blob_size INTEGER;

CREATE INDEX idx_songz_media_blob_sha256 ON songz(media_blob_sha256);
CREATE INDEX idx_songz_media_blob_blake3 ON songz(media_blob_blake3);

-- backfill every existing row from its current media_blobz join.
UPDATE songz
SET
    media_blob_sha256 = (SELECT sha256 FROM media_blobz WHERE media_blobz.id = songz.media_blob_id),
    media_blob_blake3 = (SELECT blake3 FROM media_blobz WHERE media_blobz.id = songz.media_blob_id),
    media_blob_mime = (SELECT mime FROM media_blobz WHERE media_blobz.id = songz.media_blob_id),
    media_blob_size = (SELECT size FROM media_blobz WHERE media_blobz.id = songz.media_blob_id)
WHERE media_blob_sha256 IS NULL;
