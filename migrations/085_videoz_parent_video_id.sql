-- lets a movie's "extras" (deleted scenes, bloopers, behind-the-scenes,
-- trailers) be grouped under their parent movie without duplicating the
-- series/season two-column model (which is really "album+artist for
-- video" - overkill for a handful of clips hanging off one movie). mirrors
-- the existing `series_id`/`season_id` nullable self-referential-ish FK
-- pattern already on this table.
--
-- validation (parent must be content_type='movie', parent must not itself
-- have a parent_video_id, parent_video_id/series_id are mutually
-- exclusive, parent_video_id must reference a row in THIS SAME database -
-- never a foreign remote's id) lives in application code
-- (grimoire/src/video/entities/videos/repository.rs), matching this
-- table's existing convention-over-constraint style (content_type itself
-- is only convention-validated, not a SQL CHECK either).

ALTER TABLE videoz ADD COLUMN parent_video_id TEXT REFERENCES videoz(id);

-- partial index: every real lookup ("extras for movie X") filters
-- `deleted_at IS NULL` alongside the parent match (same reasoning as
-- migration 084's blake3 index).
CREATE INDEX idx_videoz_parent_video_id ON videoz(parent_video_id) WHERE deleted_at IS NULL;
