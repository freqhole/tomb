-- distinguishes standalone movies/clips from series episodes. a video
-- with series_id set is implicitly "series" content regardless of this
-- column; it only matters for standalone (series_id IS NULL) videos.
ALTER TABLE videoz ADD COLUMN content_type TEXT NOT NULL DEFAULT 'clip'
  CHECK (content_type IN ('series', 'movie', 'clip'));

UPDATE videoz SET content_type = 'series' WHERE series_id IS NOT NULL;
