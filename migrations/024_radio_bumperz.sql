-- 024: station bumpers (DJ drops / station IDs)
--
-- bumpers are short audio clips a station plays between regular songs.
-- they reference rows in `songz` directly so the existing upload +
-- transcoding + metadata + art pipeline produces them without a
-- second flow. operators just upload a bumper as a normal song,
-- then attach it here (typically tagged with something like "bumper"
-- or kept in a private artist).
--
-- the broadcaster picks a bumper between songs when the per-station
-- `bumper_frequency_seconds` interval has elapsed since the last
-- bumper play. weight controls how often each bumper is chosen.

CREATE TABLE radio_bumperz (
    id              TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id      TEXT NOT NULL,
    song_id         TEXT NOT NULL,
    label           TEXT NOT NULL,
    -- weighted random selection. higher = picked more often.
    weight          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id)    REFERENCES songz(id)          ON DELETE CASCADE
);
CREATE INDEX idx_radio_bumperz_station ON radio_bumperz(station_id);

-- per-station bumper cadence. null = bumpers off for this station.
ALTER TABLE radio_stationz
    ADD COLUMN bumper_frequency_seconds INTEGER;
