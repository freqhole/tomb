-- play count tracking groundwork:
--   1. allow `radio` as a listen_sessionz session_type (table rebuild required
--      since sqlite has no ALTER for CHECK constraints)
--   2. relax music_play_eventz: song_id and media_event_id become nullable
--      (so we can store playlist-initiated marker rows + radio-only / podcast
--      marker rows that have no song to credit), and add radio_station_id
--      column for broadcaster-side play crediting. table rebuild required
--      since sqlite has no ALTER for relaxing NOT NULL.
--
-- views (song_query_view, playlist_query_view, feed_query_view) live in
-- migrations/views/*.sql and are dropped + recreated on every startup
-- (see database.rs::run_migrations_internal), so this migration does not
-- touch them. sqlite allows DROP TABLE while dependent views exist; the
-- views simply become invalid until the next startup recreates them.

-- ============================================================================
-- 1. listen_sessionz: add 'radio' to session_type CHECK
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE listen_sessionz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    session_type TEXT NOT NULL CHECK (session_type IN ('song', 'album', 'artist', 'genre', 'playlist', 'shuffle', 'radio')),
    entity_id TEXT,
    label TEXT NOT NULL,
    song_ids TEXT NOT NULL DEFAULT '[]',
    total_songs INTEGER NOT NULL DEFAULT 0,
    songs_completed INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    listened_duration_ms INTEGER NOT NULL DEFAULT 0,
    current_song_index INTEGER NOT NULL DEFAULT 0,
    current_song_position_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO listen_sessionz_new
SELECT id, user_id, session_type, entity_id, label, song_ids,
       total_songs, songs_completed, total_duration_ms, listened_duration_ms,
       current_song_index, current_song_position_ms, status,
       created_at, updated_at
FROM listen_sessionz;

DROP TABLE listen_sessionz;
ALTER TABLE listen_sessionz_new RENAME TO listen_sessionz;

CREATE INDEX idx_listen_sessionz_user ON listen_sessionz(user_id);
CREATE INDEX idx_listen_sessionz_status ON listen_sessionz(status);
CREATE INDEX idx_listen_sessionz_created ON listen_sessionz(created_at DESC);
CREATE INDEX idx_listen_sessionz_user_status ON listen_sessionz(user_id, status);
CREATE INDEX idx_listen_sessionz_user_entity ON listen_sessionz(user_id, entity_id);
CREATE INDEX idx_listen_sessionz_updated ON listen_sessionz(updated_at DESC);

CREATE TRIGGER trigger_listen_sessionz_updated_at
    AFTER UPDATE ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE listen_sessionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER trigger_listen_sessionz_auto_complete_on_status
    AFTER UPDATE OF status ON listen_sessionz
    FOR EACH ROW
    WHEN NEW.status = 'active'
      AND NEW.songs_completed >= NEW.total_songs
      AND NEW.total_songs > 0
BEGIN
    UPDATE listen_sessionz SET status = 'completed' WHERE id = NEW.id;
END;

-- ============================================================================
-- 2. music_play_eventz: song_id + media_event_id nullable, add radio_station_id
-- ============================================================================

CREATE TABLE music_play_eventz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT,
    song_id TEXT,
    album_id TEXT,
    artist_id TEXT,
    playlist_id TEXT,
    radio_station_id TEXT,
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (media_event_id) REFERENCES media_eventz(id),
    FOREIGN KEY (song_id) REFERENCES songz(id),
    FOREIGN KEY (album_id) REFERENCES albumz(id),
    FOREIGN KEY (artist_id) REFERENCES artistz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (radio_station_id) REFERENCES radio_stationz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

INSERT INTO music_play_eventz_new (
    id, media_event_id, song_id, album_id, artist_id, playlist_id,
    user_id, session_id, created_at
)
SELECT id, media_event_id, song_id, album_id, artist_id, playlist_id,
       user_id, session_id, created_at
FROM music_play_eventz;

DROP TABLE music_play_eventz;
ALTER TABLE music_play_eventz_new RENAME TO music_play_eventz;

CREATE INDEX idx_music_play_eventz_song ON music_play_eventz(song_id);
CREATE INDEX idx_music_play_eventz_album ON music_play_eventz(album_id);
CREATE INDEX idx_music_play_eventz_artist ON music_play_eventz(artist_id);
CREATE INDEX idx_music_play_eventz_playlist ON music_play_eventz(playlist_id);
CREATE INDEX idx_music_play_eventz_radio_station ON music_play_eventz(radio_station_id);
CREATE INDEX idx_music_play_eventz_user ON music_play_eventz(user_id);
CREATE INDEX idx_music_play_eventz_session ON music_play_eventz(session_id);
CREATE INDEX idx_music_play_eventz_created ON music_play_eventz(created_at DESC);
CREATE INDEX idx_music_play_eventz_song_created ON music_play_eventz(song_id, created_at DESC);
CREATE INDEX idx_music_play_eventz_user_created ON music_play_eventz(user_id, created_at DESC);

PRAGMA foreign_keys = ON;
