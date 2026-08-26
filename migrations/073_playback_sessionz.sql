-- playback_sessionz: generalized playback session tracking - one session
-- model for song, video, and genuinely mixed song+video queue-plays.
-- supersedes listen_sessionz (song-only). per project decision: full
-- cutover, backfilled below - listen_sessionz is left in place (never
-- dropped/edited per this repo's migration rules) but is no longer written
-- to by any new code.
--
-- `items` replaces `song_ids`: an ordered JSON array of
-- {entity_type: "song"|"video", entity_id} objects, the same shape
-- philosophy as playlist_itemz/MediaItem - this is what lets one session
-- represent a pure-song, pure-video, or interleaved mixed queue-play with
-- no fork. `session_type` gets new video-shaped values (video, video_series,
-- video_season) plus an explicit `mixed` value for sessions whose items
-- contain both kinds.

CREATE TABLE playback_sessionz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    session_type TEXT NOT NULL CHECK (session_type IN (
        'song', 'album', 'artist', 'taxon', 'playlist', 'shuffle', 'radio',
        'video', 'video_series', 'video_season', 'mixed'
    )),
    -- the entity being played (album_id, artist_id, taxon id, playlist_id,
    -- video series/season id; null for single song/video plays or shuffles)
    entity_id TEXT,
    -- display label for the session, e.g. "KMFDM - Angst" or "Voyager S1E1"
    label TEXT NOT NULL,
    -- ordered JSON array of {entity_type, entity_id} objects
    items TEXT NOT NULL DEFAULT '[]',
    -- total number of items in the session
    total_items INTEGER NOT NULL DEFAULT 0,
    -- number of items where >= 90% was played/watched
    items_completed INTEGER NOT NULL DEFAULT 0,
    -- total duration of all items in milliseconds
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    -- total time played/watched in milliseconds
    played_duration_ms INTEGER NOT NULL DEFAULT 0,
    -- current position: which item index
    current_item_index INTEGER NOT NULL DEFAULT 0,
    -- current position: ms into the current item
    current_item_position_ms INTEGER NOT NULL DEFAULT 0,
    -- session lifecycle
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_playback_sessionz_user ON playback_sessionz(user_id);
CREATE INDEX idx_playback_sessionz_status ON playback_sessionz(status);
CREATE INDEX idx_playback_sessionz_created ON playback_sessionz(created_at DESC);
CREATE INDEX idx_playback_sessionz_user_status ON playback_sessionz(user_id, status);
CREATE INDEX idx_playback_sessionz_user_entity ON playback_sessionz(user_id, entity_id);
CREATE INDEX idx_playback_sessionz_updated ON playback_sessionz(updated_at DESC);

CREATE TRIGGER trigger_playback_sessionz_updated_at
    AFTER UPDATE ON playback_sessionz
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE playback_sessionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- auto-complete: mark session as completed once every item has been played
CREATE TRIGGER trigger_playback_sessionz_auto_complete
    AFTER UPDATE OF items_completed, total_items ON playback_sessionz
    FOR EACH ROW
    WHEN NEW.status IN ('active', 'paused')
      AND NEW.items_completed >= NEW.total_items
      AND NEW.total_items > 0
BEGIN
    UPDATE playback_sessionz SET status = 'completed' WHERE id = NEW.id;
END;

-- auto-complete on status resurrection: if a session is set to 'active' but
-- already 100% complete, immediately mark it as completed (e.g. resuming a
-- completed session from feed UI shouldn't create a zombie active session).
CREATE TRIGGER trigger_playback_sessionz_auto_complete_on_status
    AFTER UPDATE OF status ON playback_sessionz
    FOR EACH ROW
    WHEN NEW.status = 'active'
      AND NEW.items_completed >= NEW.total_items
      AND NEW.total_items > 0
BEGIN
    UPDATE playback_sessionz SET status = 'completed' WHERE id = NEW.id;
END;

-- auto-pause: when a new session is created, pause any other active
-- sessions for that user (only one active session per user at a time)
CREATE TRIGGER trigger_playback_sessionz_auto_pause
    AFTER INSERT ON playback_sessionz
    FOR EACH ROW
BEGIN
    UPDATE playback_sessionz
    SET status = 'paused'
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND status = 'active';
END;

-- clamp: if total_items shrinks below items_completed, clamp items_completed
-- down (may chain into the auto-complete trigger if the clamped value
-- matches the new total_items)
CREATE TRIGGER trigger_playback_sessionz_clamp_completed
    AFTER UPDATE OF total_items ON playback_sessionz
    FOR EACH ROW
    WHEN NEW.items_completed > NEW.total_items
BEGIN
    UPDATE playback_sessionz
    SET items_completed = NEW.total_items
    WHERE id = NEW.id;
END;

-- backfill historical listen_sessionz rows (song-only sessions), converting
-- song_ids (JSON array of song id strings) into the generic items shape
-- (JSON array of {entity_type, entity_id} objects).
INSERT INTO playback_sessionz (
    id, user_id, session_type, entity_id, label, items, total_items,
    items_completed, total_duration_ms, played_duration_ms,
    current_item_index, current_item_position_ms, status, created_at, updated_at
)
SELECT
    ls.id, ls.user_id, ls.session_type, ls.entity_id, ls.label,
    COALESCE(
        (SELECT json_group_array(json_object('entity_type', 'song', 'entity_id', je.value))
           FROM json_each(ls.song_ids) je),
        '[]'
    ),
    ls.total_songs, ls.songs_completed, ls.total_duration_ms, ls.listened_duration_ms,
    ls.current_song_index, ls.current_song_position_ms, ls.status, ls.created_at, ls.updated_at
FROM listen_sessionz ls;
