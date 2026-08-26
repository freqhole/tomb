-- play_eventz: generalized per-entity play event tracking - supersedes
-- music_play_eventz (song-only). full cutover, backfilled below -
-- music_play_eventz is left in place (never dropped/edited per this repo's
-- migration rules) but is no longer written to by any new code.
--
-- `entity_type`/`entity_id` replace `song_id` (mirrors the same generic
-- pair already used by playback_progressz from migration 059). `album_id`/
-- `artist_id` are dropped: grep-confirmed dead columns - no production
-- caller ever populated them (only a unit test did), every real
-- album/artist play-count query already resolves via a join through
-- album_songz/artist_songz on the song id instead.

CREATE TABLE play_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT,
    -- what kind of entity was played (null for context-only marker rows,
    -- e.g. a playlist-initiated play with no specific song/video credited)
    entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('song', 'video')),
    entity_id TEXT,
    playlist_id TEXT,
    radio_station_id TEXT,
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (media_event_id) REFERENCES media_eventz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (radio_station_id) REFERENCES radio_stationz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

CREATE INDEX idx_play_eventz_entity ON play_eventz(entity_type, entity_id);
CREATE INDEX idx_play_eventz_playlist ON play_eventz(playlist_id);
CREATE INDEX idx_play_eventz_radio_station ON play_eventz(radio_station_id);
CREATE INDEX idx_play_eventz_user ON play_eventz(user_id);
CREATE INDEX idx_play_eventz_session ON play_eventz(session_id);
CREATE INDEX idx_play_eventz_created ON play_eventz(created_at DESC);
CREATE INDEX idx_play_eventz_entity_created ON play_eventz(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_play_eventz_user_created ON play_eventz(user_id, created_at DESC);

-- backfill historical music_play_eventz rows (song_id -> entity_type='song')
INSERT INTO play_eventz (
    id, media_event_id, entity_type, entity_id, playlist_id,
    radio_station_id, user_id, session_id, created_at
)
SELECT
    id, media_event_id,
    CASE WHEN song_id IS NOT NULL THEN 'song' ELSE NULL END,
    song_id, playlist_id, radio_station_id, user_id, session_id, created_at
FROM music_play_eventz;
