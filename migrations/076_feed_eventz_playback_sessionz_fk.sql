-- migration 076: fix feed_eventz.session_id FK + session_type CHECK to
-- match playback_sessionz (073), not the superseded listen_sessionz.
--
-- 073 cut playback session creation over from listen_sessionz to
-- playback_sessionz, but feed_eventz was never updated to match:
--   - session_id still had `REFERENCES listen_sessionz(id)`, so every
--     upsert_session_feed_event() call (now passed a playback_sessionz.id)
--     violated the FK (sqlite error code 787) and silently failed to
--     create/update the feed's "currently listening/watching" card.
--   - session_type's CHECK still only allowed the old listen_sessionz
--     values ('song', 'album', 'artist', 'genre', 'playlist', 'shuffle',
--     'radio'), so any video-shaped session_type ('video', 'video_series',
--     'video_season', 'mixed') or the renamed 'taxon' (037) hit a CHECK
--     failure (sqlite error code 275) instead.
--
-- sqlite cannot ALTER a FK or CHECK constraint, so we rebuild the table
-- again, same as 064/075.

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
        'new_image_song', 'new_image_album', 'new_image_artist', 'new_image_playlist',
        'favorite_video',
        'video_watch',
        'video'
    )),

    song_id TEXT,
    album_id TEXT REFERENCES albumz(id) ON DELETE CASCADE,
    artist_id TEXT REFERENCES artistz(id) ON DELETE CASCADE,
    playlist_id TEXT REFERENCES playlistz(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES playback_sessionz(id) ON DELETE CASCADE,
    video_id TEXT REFERENCES videoz(id) ON DELETE CASCADE,

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

    session_type TEXT CHECK (session_type IS NULL OR session_type IN (
        'song', 'album', 'artist', 'genre', 'taxon', 'playlist', 'shuffle', 'radio',
        'video', 'video_series', 'video_season', 'mixed'
    )),
    session_status TEXT CHECK (session_status IS NULL OR session_status IN ('active', 'paused', 'completed', 'abandoned')),
    progress_percent REAL,
    songs_completed INTEGER,
    total_songs INTEGER,

    entity_id TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- old session-feed-event rows (if any) point at listen_sessionz ids, which
-- won't exist in playback_sessionz - drop them rather than carry rows the
-- new FK can never satisfy going forward (feed_type = 'session' is the only
-- type that ever populates session_id, so this is scoped narrowly).
INSERT INTO feed_eventz_new
SELECT
    id, feed_type, song_id, album_id, artist_id, playlist_id,
    CASE WHEN feed_type = 'session' THEN NULL ELSE session_id END,
    video_id, created_by_user_id, created_by_username, updated_by_user_id,
    updated_by_username, title, subtitle, description, song_ids, images,
    extra_images, collage_images, genres, tags, artist_name, album_title,
    year, song_count, songs_added, total_duration_ms, image_count, urls,
    rating, session_type, session_status, progress_percent, songs_completed,
    total_songs, entity_id, created_at, updated_at
FROM feed_eventz
WHERE feed_type != 'session' OR session_id IS NULL
   OR session_id IN (SELECT id FROM playback_sessionz);

DROP TABLE feed_eventz;
ALTER TABLE feed_eventz_new RENAME TO feed_eventz;

-- recreate all existing indexes
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
CREATE UNIQUE INDEX idx_feed_eventz_favorite_video
    ON feed_eventz(video_id, created_by_user_id)
    WHERE feed_type = 'favorite_video' AND video_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_video_watch
    ON feed_eventz(video_id, created_by_user_id)
    WHERE feed_type = 'video_watch' AND video_id IS NOT NULL;
CREATE UNIQUE INDEX idx_feed_eventz_video
    ON feed_eventz(video_id, created_by_user_id)
    WHERE feed_type = 'video' AND video_id IS NOT NULL;

-- general indexes
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
