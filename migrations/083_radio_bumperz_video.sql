-- migration 083: let a bumper reference a video instead of a song.
--
-- bumpers (station-id/DJ-drop clips) were song-only (`song_id` FK to
-- `songz`, NOT NULL) - a video-capable station couldn't have a video
-- bumper. this adds a nullable `video_id` FK to `videoz` alongside the
-- now-nullable `song_id`, with a CHECK enforcing exactly one is set per
-- row - the same "exactly one reference column populated" shape
-- migration 081 already used for radio_station_filterz's video columns.
--
-- radio_bumperz is a leaf table (nothing references it via FK - grep of
-- migrations/ confirms), so the plain rename+recreate+copy+drop pattern
-- from migrations 029/030/038/051/081 applies directly with no
-- parent-table double-rebuild needed.

PRAGMA foreign_keys = OFF;

ALTER TABLE radio_bumperz RENAME TO radio_bumperz_old_083;

CREATE TABLE radio_bumperz (
    id              TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id      TEXT NOT NULL,
    -- exactly one of these is non-null per row (enforced by the CHECK
    -- below) - which one determines the bumper's kind, same convention
    -- `RadioTrack`/`RadioItemKind` already use elsewhere in the picker.
    song_id         TEXT,
    video_id        TEXT,
    label           TEXT NOT NULL,
    -- weighted random selection. higher = picked more often.
    weight          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id)    REFERENCES songz(id)          ON DELETE CASCADE,
    FOREIGN KEY (video_id)   REFERENCES videoz(id)         ON DELETE CASCADE,
    CHECK (
        (song_id IS NOT NULL AND video_id IS NULL)
     OR (song_id IS NULL AND video_id IS NOT NULL)
    )
);

INSERT INTO radio_bumperz (id, station_id, song_id, video_id, label, weight, created_at)
SELECT id, station_id, song_id, NULL, label, weight, created_at
FROM radio_bumperz_old_083;

DROP TABLE radio_bumperz_old_083;

-- the old table's index isn't renamed by `ALTER TABLE ... RENAME TO`, so
-- it must be recreated AFTER dropping the old table, not before - the
-- old (still same-named) index and this one would otherwise collide.
CREATE INDEX idx_radio_bumperz_station ON radio_bumperz(station_id);

PRAGMA foreign_keys = ON;
