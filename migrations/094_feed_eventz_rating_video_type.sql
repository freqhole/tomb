-- migration 094: add 'rating_video' feed event type (video rating)
--
-- video ratings (user_ratingz target_type = 'video') were never wired up
-- to emit a feed event at all - upsert_rating_feed_event()'s target_type
-- match only covered 'song'/'album'/'artist', so every call for 'video'
-- silently failed with "invalid target type for rating" (the call site
-- discards the result via `let _ = ...`, so this was never visible).
--
-- mirrors 'favorite_video' (075)/'video_watch' (075) - same video_id-
-- keyed partial unique index pattern as the existing rating_song/
-- rating_album/rating_artist indexes below.
--
-- sqlite cannot ALTER a CHECK constraint, so we rebuild the table again,
-- same as 064/075/076.
--
-- post-release fix: `PRAGMA foreign_keys = OFF` below is a documented
-- sqlite no-op once a transaction is already open (which sqlx's migration
-- runner always does), so the INSERT further down enforces FKs for real.
-- any feed_eventz row left dangling by an older, now-fixed deletion bug
-- (a parent album/artist/playlist/session/video deleted without cascading
-- to its feed_eventz row) aborted this entire migration - and therefore
-- every migration after it, including the ones that (re)create
-- song_query_view/album_query_view/etc. - with "FOREIGN KEY constraint
-- failed". delete those dangling rows first; a DELETE that removes a
-- dangling child row can never itself violate a foreign key, so this is
-- safe regardless of the PRAGMA no-op above.

PRAGMA foreign_keys = OFF;

DELETE FROM feed_eventz WHERE album_id IS NOT NULL AND album_id NOT IN (SELECT id FROM albumz);
DELETE FROM feed_eventz WHERE artist_id IS NOT NULL AND artist_id NOT IN (SELECT id FROM artistz);
DELETE FROM feed_eventz WHERE playlist_id IS NOT NULL AND playlist_id NOT IN (SELECT id FROM playlistz);
DELETE FROM feed_eventz WHERE session_id IS NOT NULL AND session_id NOT IN (SELECT id FROM playback_sessionz);
DELETE FROM feed_eventz WHERE video_id IS NOT NULL AND video_id NOT IN (SELECT id FROM videoz);

CREATE TABLE feed_eventz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),

    feed_type TEXT NOT NULL CHECK (feed_type IN (
        'album',
        'artist',
        'playlist',
        'session',
        'favorite_song', 'favorite_album', 'favorite_artist', 'favorite_playlist',
        'rating_song', 'rating_album', 'rating_artist', 'rating_video',
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

INSERT INTO feed_eventz_new SELECT * FROM feed_eventz;

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
CREATE UNIQUE INDEX idx_feed_eventz_rating_video
    ON feed_eventz(video_id, created_by_user_id)
    WHERE feed_type = 'rating_video' AND video_id IS NOT NULL;
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
