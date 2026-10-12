-- 096: videoz.artist_id / videoz.album_id
--
-- music_video and karaoke videos (see 092/095) point at an artist + album,
-- the same way series episodes point at a series. both nullable - only
-- those two content types ever set them, and even for them they're
-- optional (an unattached music video is allowed, e.g. right after import
-- when no artist could be guessed from the title).
--
-- ON DELETE SET NULL: a hard-deleted artist/album (music's
-- hard_delete_old_records) must never fail because a video still points
-- at it.

ALTER TABLE videoz ADD COLUMN artist_id TEXT REFERENCES artistz(id) ON DELETE SET NULL;
ALTER TABLE videoz ADD COLUMN album_id TEXT REFERENCES albumz(id) ON DELETE SET NULL;

CREATE INDEX idx_videoz_artist_id ON videoz(artist_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_videoz_album_id ON videoz(album_id) WHERE deleted_at IS NULL;
