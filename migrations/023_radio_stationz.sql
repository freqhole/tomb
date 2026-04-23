-- 023: radio stations + sources + play history
--
-- per-station configuration moves out of `freqhole-config.toml` and into
-- the database so the ui can manage any number of radio "channels"
-- without restarting the server. the toml only owns master `enabled`
-- and the default ffmpeg `encode_args` template.
--
-- a station's effective playlist is the union of:
--   * explicit songs in radio_station_songz
--   * songs matching the AND-of-include-clauses minus
--     OR-of-exclude-clauses from radio_station_filterz
--
-- play history is recorded as tracks start so the ui can render
-- "recently played" and the picker can avoid recent repeats.

CREATE TABLE radio_stationz (
    id              TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),           -- uuid v4 (text)
    name            TEXT NOT NULL,
    description     TEXT,
    -- 0 = peer-list gated (when phase 2d auth lands), 1 = anyone with node id
    is_public       INTEGER NOT NULL DEFAULT 0,
    -- toggle without deleting; broadcaster skips disabled stations on startup
    is_enabled      INTEGER NOT NULL DEFAULT 1,
    -- optional per-station ffmpeg override; null = use toml `[radio].encode_args`
    encode_args     TEXT,
    -- mse codec string for clients (must match what encode_args produces)
    codec           TEXT NOT NULL DEFAULT 'audio/mp4; codecs="mp4a.40.2"',
    -- 'shuffle' | 'sequential'
    play_mode       TEXT NOT NULL DEFAULT 'shuffle',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- explicit per-song inclusion. always plays regardless of filter clauses.
CREATE TABLE radio_station_songz (
    station_id  TEXT NOT NULL,
    song_id     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (station_id, song_id),
    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id)    REFERENCES songz(id)          ON DELETE CASCADE
);
CREATE INDEX idx_radio_station_songz_song ON radio_station_songz(song_id);

-- query-based source. each row is one filter clause; effective playlist =
-- AND of include clauses minus OR of exclude clauses.
--   filter_type: 'tag' | 'genre' | 'artist' | 'album' | 'year_range'
--                | 'rating_min' | 'rating_max' | ...
--   filter_value: tag name / artist id / "1990-1999" / "4" etc.
--   mode: 'include' | 'exclude'
CREATE TABLE radio_station_filterz (
    id              TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id      TEXT NOT NULL,
    filter_type     TEXT NOT NULL,
    filter_value    TEXT NOT NULL,
    mode            TEXT NOT NULL DEFAULT 'include',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE
);
CREATE INDEX idx_radio_station_filterz_station ON radio_station_filterz(station_id);

-- play history per station. drives "recently played" + recent-repeat
-- avoidance in the picker.
CREATE TABLE radio_play_historyz (
    id              TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id      TEXT NOT NULL,
    song_id         TEXT NOT NULL,
    started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    -- filled when the track ends (null while playing)
    duration_ms     INTEGER,
    -- snapshot of listener_count at track start
    listener_count  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id)    REFERENCES songz(id)          ON DELETE SET NULL
);
CREATE INDEX idx_radio_play_history_station_started
    ON radio_play_historyz(station_id, started_at DESC);
