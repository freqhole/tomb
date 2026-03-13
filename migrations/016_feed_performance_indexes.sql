-- 016: feed performance indexes
-- add indexes to speed up feed_query_view correlated subqueries

-- artist_songz: enable fast lookup by song_id (PK is artist_id, song_id)
CREATE INDEX idx_artist_songz_song_id ON artist_songz(song_id);

-- album_songz: enable fast lookup by song_id (PK is album_id, song_id)
CREATE INDEX idx_album_songz_song_id ON album_songz(song_id);

-- user_ratingz: enable fast lookup by created_at for feed ordering
CREATE INDEX IF NOT EXISTS idx_user_ratingz_created_at ON user_ratingz(created_at DESC);

-- media_blobz: enable fast lookup by created_at for new_image feed items
CREATE INDEX IF NOT EXISTS idx_media_blobz_created_at ON media_blobz(created_at DESC);

-- listen_sessionz: enable fast lookup by created_at for feed ordering
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_created_at ON listen_sessionz(created_at DESC);
