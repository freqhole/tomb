-- 037: rename 'genre' -> 'taxon' in listen_sessionz.session_type and
-- user_favoritez.target_type CHECK constraints (and the existing data).
--
-- after the taxonomy refactor, "favorite a genre" / "listen-session by genre"
-- are just one specialization of "favorite a taxon" / "listen-session by taxon"
-- (kind = genre is the only one materialized today; others may follow without
-- requiring more enum churn).
--
-- both columns have CHECK constraints, so sqlite requires a table rebuild.
--
-- user_ratingz.target_type only allows 'song'/'artist'/'album' — it has no
-- 'genre' value to rename, so it's left alone.

PRAGMA foreign_keys = OFF;

-- drop any views that depend on listen_sessionz / user_favoritez. these are
-- recreated unconditionally by `run_migrations_internal` on app startup
-- (database.rs runs the embedded view scripts after sqlx migrate). dropping
-- here lets the table rebuild proceed when this migration runs via the bare
-- `sqlx migrate` cli (which doesn't know about our view layer).
DROP VIEW IF EXISTS feed_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;

-- ============================================================================
-- 1. listen_sessionz: session_type CHECK 'genre' -> 'taxon'
-- ============================================================================

CREATE TABLE listen_sessionz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    session_type TEXT NOT NULL CHECK (session_type IN ('song', 'album', 'artist', 'taxon', 'playlist', 'shuffle', 'radio')),
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
SELECT id, user_id,
       CASE WHEN session_type = 'genre' THEN 'taxon' ELSE session_type END,
       entity_id, label, song_ids,
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
-- 2. user_favoritez: target_type CHECK 'genre' -> 'taxon'
-- ============================================================================

CREATE TABLE user_favoritez_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('song', 'artist', 'album', 'taxon', 'playlist')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, target_type, target_id)
);

INSERT INTO user_favoritez_new (id, user_id, target_type, target_id, created_at)
SELECT id, user_id,
       CASE WHEN target_type = 'genre' THEN 'taxon' ELSE target_type END,
       target_id, created_at
FROM user_favoritez;

DROP TABLE user_favoritez;
ALTER TABLE user_favoritez_new RENAME TO user_favoritez;

CREATE INDEX idx_user_favoritez_user_id ON user_favoritez(user_id);
CREATE INDEX idx_user_favoritez_target ON user_favoritez(target_type, target_id);
CREATE INDEX idx_user_favoritez_created ON user_favoritez(created_at DESC);
CREATE INDEX idx_user_favoritez_user_type ON user_favoritez(user_id, target_type);

PRAGMA foreign_keys = ON;
