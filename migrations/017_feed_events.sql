-- 017: feed events - denormalized activity feed for fast querying
-- replaces the slow feed_query_view with a write-time computed table

CREATE TABLE IF NOT EXISTS feed_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    
    -- activity type - determines what entity/action this represents
    feed_type TEXT NOT NULL CHECK (feed_type IN (
        'album',      -- album activity (user added music, images, etc.)
        'artist',     -- artist activity (user added images)
        'playlist',   -- playlist activity (created, updated, images)
        'session',    -- listening session
        'favorite_song', 'favorite_album', 'favorite_artist', 'favorite_playlist',
        'rating_song', 'rating_album', 'rating_artist',
        'new_image_song', 'new_image_album', 'new_image_artist', 'new_image_playlist'
    )),
    
    -- explicit entity references (populated based on feed_type)
    song_id TEXT,
    album_id TEXT REFERENCES albumz(id) ON DELETE CASCADE,
    artist_id TEXT REFERENCES artistz(id) ON DELETE CASCADE,
    playlist_id TEXT REFERENCES playlistz(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES listen_sessionz(id) ON DELETE CASCADE,
    
    -- user attribution (denormalized for fast reads)
    created_by_user_id TEXT NOT NULL REFERENCES user_accountz(id),
    created_by_username TEXT NOT NULL,
    updated_by_user_id TEXT REFERENCES user_accountz(id),
    updated_by_username TEXT,
    
    -- display text
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,  -- playlist description
    
    -- JSON arrays for rendering
    song_ids TEXT DEFAULT '[]',           -- string[] for queue/play interaction
    images TEXT DEFAULT '[]',             -- ImageMetadata[] for primary display
    extra_images TEXT DEFAULT '[]',       -- ImageMetadata[] for non-primary (gallery view)
    collage_images TEXT,                  -- ImageMetadata[] for multi-album sessions
    genres TEXT DEFAULT '[]',             -- [{id, name}, ...] for genre badges + linking
    tags TEXT DEFAULT '[]',               -- [{id, name}, ...] for tag badges + linking
    
    -- denormalized entity metadata
    artist_name TEXT,
    album_title TEXT,
    year INTEGER,
    song_count INTEGER,
    songs_added INTEGER DEFAULT 1,         -- delta: how many songs added in this action
    total_duration_ms INTEGER,
    image_count INTEGER DEFAULT 0,
    urls TEXT DEFAULT '[]',               -- [{id, name, url}, ...] from entity_urlz
    
    -- rating value (for rating_* feed types)
    rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    
    -- session progress (denormalized from listen_sessionz, updated on session update)
    session_type TEXT CHECK (session_type IS NULL OR session_type IN ('song', 'album', 'artist', 'genre', 'playlist', 'shuffle')),
    session_status TEXT CHECK (session_status IS NULL OR session_status IN ('active', 'paused', 'completed', 'abandoned')),
    progress_percent REAL,
    songs_completed INTEGER,
    total_songs INTEGER,
    
    -- timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- unique constraints for upsert behavior (one feed entry per entity+user combo)
-- album: one entry per album per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_album 
    ON feed_eventz(album_id, created_by_user_id) 
    WHERE feed_type = 'album' AND album_id IS NOT NULL;

-- artist: one entry per artist per user  
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_artist 
    ON feed_eventz(artist_id, created_by_user_id) 
    WHERE feed_type = 'artist' AND artist_id IS NOT NULL;

-- playlist: one entry per playlist (any user can update)
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_playlist 
    ON feed_eventz(playlist_id) 
    WHERE feed_type = 'playlist' AND playlist_id IS NOT NULL;

-- session: one entry per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_session 
    ON feed_eventz(session_id) 
    WHERE feed_type = 'session' AND session_id IS NOT NULL;

-- favorites: one entry per entity+user
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_favorite_song 
    ON feed_eventz(song_id, created_by_user_id) 
    WHERE feed_type = 'favorite_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_favorite_album 
    ON feed_eventz(album_id, created_by_user_id) 
    WHERE feed_type = 'favorite_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_favorite_artist 
    ON feed_eventz(artist_id, created_by_user_id) 
    WHERE feed_type = 'favorite_artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_favorite_playlist 
    ON feed_eventz(playlist_id, created_by_user_id) 
    WHERE feed_type = 'favorite_playlist' AND playlist_id IS NOT NULL;

-- ratings: one entry per entity+user
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_rating_song 
    ON feed_eventz(song_id, created_by_user_id) 
    WHERE feed_type = 'rating_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_rating_album 
    ON feed_eventz(album_id, created_by_user_id) 
    WHERE feed_type = 'rating_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_rating_artist 
    ON feed_eventz(artist_id, created_by_user_id) 
    WHERE feed_type = 'rating_artist' AND artist_id IS NOT NULL;

-- new_image_*: one entry per entity+user (aggregates all images added by that user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_image_song 
    ON feed_eventz(song_id, created_by_user_id) 
    WHERE feed_type = 'new_image_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_image_album 
    ON feed_eventz(album_id, created_by_user_id) 
    WHERE feed_type = 'new_image_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_image_artist 
    ON feed_eventz(artist_id, created_by_user_id) 
    WHERE feed_type = 'new_image_artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_eventz_image_playlist 
    ON feed_eventz(playlist_id, created_by_user_id) 
    WHERE feed_type = 'new_image_playlist' AND playlist_id IS NOT NULL;

-- fast feed ordering (the main query pattern)
CREATE INDEX IF NOT EXISTS idx_feed_eventz_updated_at ON feed_eventz(updated_at DESC);

-- filter by user
CREATE INDEX IF NOT EXISTS idx_feed_eventz_user ON feed_eventz(created_by_user_id);

-- filter by feed_type
CREATE INDEX IF NOT EXISTS idx_feed_eventz_type ON feed_eventz(feed_type);

-- auto-update updated_at on any update
CREATE TRIGGER IF NOT EXISTS trg_feed_eventz_updated_at
AFTER UPDATE ON feed_eventz
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE feed_eventz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
