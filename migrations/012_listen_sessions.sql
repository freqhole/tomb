-- listen sessions: tracks user progress through entities (albums, playlists, artists, genres, songs, shuffles)
-- each session is a single "i'm listening to X" that gets updated as progress is made

CREATE TABLE IF NOT EXISTS listen_sessionz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    -- what kind of entity is being listened to
    session_type TEXT NOT NULL CHECK (session_type IN ('song', 'album', 'artist', 'genre', 'playlist', 'shuffle')),
    -- the entity being listened to (album_id, artist_id, genre name, playlist_id; null for single songs)
    entity_id TEXT,
    -- display label for the session, e.g. "KMFDM - Angst"
    label TEXT NOT NULL,
    -- ordered JSON array of song IDs in this session
    song_ids TEXT NOT NULL DEFAULT '[]',
    -- total number of songs in the session
    total_songs INTEGER NOT NULL DEFAULT 0,
    -- number of songs where >= 90% was listened
    songs_completed INTEGER NOT NULL DEFAULT 0,
    -- total duration of all songs in milliseconds
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    -- total time listened in milliseconds
    listened_duration_ms INTEGER NOT NULL DEFAULT 0,
    -- current position: which song index
    current_song_index INTEGER NOT NULL DEFAULT 0,
    -- current position: seconds into the current song
    current_song_position_ms INTEGER NOT NULL DEFAULT 0,
    -- session lifecycle
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_listen_sessionz_user ON listen_sessionz(user_id);
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_status ON listen_sessionz(status);
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_created ON listen_sessionz(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_user_status ON listen_sessionz(user_id, status);
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_user_entity ON listen_sessionz(user_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_listen_sessionz_updated ON listen_sessionz(updated_at DESC);

-- auto-update updated_at
CREATE TRIGGER IF NOT EXISTS trigger_listen_sessionz_updated_at
    AFTER UPDATE ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE listen_sessionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
