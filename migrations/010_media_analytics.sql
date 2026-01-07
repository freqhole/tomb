-- Media Analytics Tables
-- Tracks user interactions with media for analytics, feeds, and insights

-- Domain-agnostic media events table
-- Tracks all types of interactions: play, pause, seek, rate, favorite, etc.
CREATE TABLE media_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_blob_id TEXT NOT NULL,
    user_id TEXT, -- nullable - no anonymous tracking planned but don't enforce
    event_type TEXT NOT NULL,
    event_data TEXT, -- JSON: position, progress, quality, playlist_id, rating, etc.
    session_id TEXT DEFAULT (lower(hex(randomblob(8)))), -- auto-generate or client provides
    user_agent TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    client_timestamp INTEGER, -- unix timestamp from client

    FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)

    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop',
        'rate', 'favorite', 'unfavorite', 'skip',
        'add' -- for tracking when songs/albums added to library
    ))
) STRICT;

-- Music-specific play events table (denormalized for query performance)
-- Duplicates song/album/artist IDs for fast analytics queries without complex joins
CREATE TABLE music_play_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    album_id TEXT,
    artist_id TEXT, -- primary artist
    playlist_id TEXT, -- if played from playlist
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (media_event_id) REFERENCES media_eventz(id),
    FOREIGN KEY (song_id) REFERENCES songz(id),
    FOREIGN KEY (album_id) REFERENCES albumz(id),
    FOREIGN KEY (artist_id) REFERENCES artistz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

-- Indexes for media_eventz
CREATE INDEX idx_media_eventz_blob ON media_eventz(media_blob_id);
CREATE INDEX idx_media_eventz_user ON media_eventz(user_id);
CREATE INDEX idx_media_eventz_type ON media_eventz(event_type);
CREATE INDEX idx_media_eventz_created ON media_eventz(created_at DESC);
CREATE INDEX idx_media_eventz_session ON media_eventz(session_id);
CREATE INDEX idx_media_eventz_user_created ON media_eventz(user_id, created_at DESC);
CREATE INDEX idx_media_eventz_blob_type ON media_eventz(media_blob_id, event_type);

-- Indexes for music_play_eventz
CREATE INDEX idx_music_play_eventz_song ON music_play_eventz(song_id);
CREATE INDEX idx_music_play_eventz_album ON music_play_eventz(album_id);
CREATE INDEX idx_music_play_eventz_artist ON music_play_eventz(artist_id);
CREATE INDEX idx_music_play_eventz_playlist ON music_play_eventz(playlist_id);
CREATE INDEX idx_music_play_eventz_user ON music_play_eventz(user_id);
CREATE INDEX idx_music_play_eventz_session ON music_play_eventz(session_id);
CREATE INDEX idx_music_play_eventz_created ON music_play_eventz(created_at DESC);
CREATE INDEX idx_music_play_eventz_song_created ON music_play_eventz(song_id, created_at DESC);
CREATE INDEX idx_music_play_eventz_user_created ON music_play_eventz(user_id, created_at DESC);

-- Triggers for automatic timestamp updates
CREATE TRIGGER trg_media_eventz_updated_at
AFTER UPDATE ON media_eventz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE media_eventz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
