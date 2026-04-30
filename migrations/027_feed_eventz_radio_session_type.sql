-- migration 027: allow 'radio' in feed_eventz.session_type CHECK constraint
--
-- the existing CHECK on feed_eventz.session_type only permits the original
-- session types (song/album/artist/genre/playlist/shuffle). when a radio
-- listen session triggered upsert_session_feed_event, the INSERT failed
-- with a CHECK constraint violation and the error was silently discarded.
--
-- sqlite cannot ALTER a CHECK constraint, so we rebuild the table.
-- the only structural change is the expanded session_type CHECK; everything
-- else (columns, defaults, foreign keys, other CHECKs) is preserved.

PRAGMA foreign_keys = OFF;

CREATE TABLE feed_eventz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),

    feed_type TEXT NOT NULL CHECK (feed_type IN (
        'album',
        'artist',
        'playlist',
        'session',
        'favorite_song', 'favorite_album', 'favorite_artist', 'favorite_playlist',
        'rating_song', 'rating_album', 'rating_artist',
        'new_image_song', 'new_image_album', 'new_image_artist', 'new_image_playlist'
    )),

    song_id TEXT,
    album_id TEXT REFERENCES albumz(id) ON DELETE CASCADE,
    artist_id TEXT REFERENCES artistz(id) ON DELETE CASCADE,
    playlist_id TEXT REFERENCES playlistz(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES listen_sessionz(id) ON DELETE CASCADE,

    created_by_user_id TEXT NOT NULL REFERENCES user_accountz(id),
    created_by_username TEXT NOT NULL,
    updated_by_user_id TEXT REFERENCES user_accountz(id),
    updated_by_username TEXT,

    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,

    song_ids TEXT DEFAULT '[]',
    images TEXT DEFAULT '[]',
    extra_images TEXT DEFAULT '[]',
    collage_images TEXT,
    genres TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',

    artist_name TEXT,
    album_title TEXT,
    year INTEGER,
    song_count INTEGER,
    songs_added INTEGER DEFAULT 1,
    total_duration_ms INTEGER,
    image_count INTEGER DEFAULT 0,
    urls TEXT DEFAULT '[]',

    rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),

    -- expanded to include 'radio'
    session_type TEXT CHECK (session_type IS NULL OR session_type IN ('song', 'album', 'artist', 'genre', 'playlist', 'shuffle', 'radio')),
    session_status TEXT CHECK (session_status IS NULL OR session_status IN ('active', 'paused', 'completed', 'abandoned')),
    progress_percent REAL,
    songs_completed INTEGER,
    total_songs INTEGER,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO feed_eventz_new SELECT * FROM feed_eventz;

DROP TABLE feed_eventz;
ALTER TABLE feed_eventz_new RENAME TO feed_eventz;

-- recreate indexes
CREATE UNIQUE INDEX idx_feed_eventz_album
    ON feed_eventz(album_id, created_by_user_id)
    WHERE feed_type = 'album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_artist
    ON feed_eventz(artist_id, created_by_user_id)
    WHERE feed_type = 'artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_playlist
    ON feed_eventz(playlist_id)
    WHERE feed_type = 'playlist' AND playlist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_session
    ON feed_eventz(session_id)
    WHERE feed_type = 'session' AND session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_favorite_song
    ON feed_eventz(song_id, created_by_user_id)
    WHERE feed_type = 'favorite_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_favorite_album
    ON feed_eventz(album_id, created_by_user_id)
    WHERE feed_type = 'favorite_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_favorite_artist
    ON feed_eventz(artist_id, created_by_user_id)
    WHERE feed_type = 'favorite_artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_favorite_playlist
    ON feed_eventz(playlist_id, created_by_user_id)
    WHERE feed_type = 'favorite_playlist' AND playlist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_rating_song
    ON feed_eventz(song_id, created_by_user_id)
    WHERE feed_type = 'rating_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_rating_album
    ON feed_eventz(album_id, created_by_user_id)
    WHERE feed_type = 'rating_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_rating_artist
    ON feed_eventz(artist_id, created_by_user_id)
    WHERE feed_type = 'rating_artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_image_song
    ON feed_eventz(song_id, created_by_user_id)
    WHERE feed_type = 'new_image_song' AND song_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_image_album
    ON feed_eventz(album_id, created_by_user_id)
    WHERE feed_type = 'new_image_album' AND album_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_image_artist
    ON feed_eventz(artist_id, created_by_user_id)
    WHERE feed_type = 'new_image_artist' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_image_playlist
    ON feed_eventz(playlist_id, created_by_user_id)
    WHERE feed_type = 'new_image_playlist' AND playlist_id IS NOT NULL;
CREATE INDEX idx_feed_eventz_updated_at ON feed_eventz(updated_at DESC);
CREATE INDEX idx_feed_eventz_user ON feed_eventz(created_by_user_id);
CREATE INDEX idx_feed_eventz_type ON feed_eventz(feed_type);

-- recreate trigger
CREATE TRIGGER trg_feed_eventz_updated_at
AFTER UPDATE ON feed_eventz
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE feed_eventz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

PRAGMA foreign_keys = ON;
