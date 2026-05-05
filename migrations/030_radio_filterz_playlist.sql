-- 030_radio_filterz_playlist.sql
--
-- extend `radio_station_filterz` with a 6th filter type: 'playlist'.
-- a playlist filter resolves at tune time to the current contents of
-- the referenced playlist (via `playlist_songz`), so edits to the
-- playlist propagate to every station seeded by it without any
-- manual re-syncing.
--
-- sqlite can't ALTER a CHECK constraint, so we follow the standard
-- "rename + recreate + copy + drop" pattern. existing rows are
-- preserved (the new schema is a strict superset of the old one).

PRAGMA foreign_keys = OFF;

ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'genre' | 'tag' | 'track' | 'playlist'
    filter_type TEXT NOT NULL,
    -- 'include' | 'exclude'
    mode        TEXT NOT NULL DEFAULT 'include',
    -- exactly one of these is non-null per row, matching `filter_type`.
    -- enforced by the CHECK constraint below.
    artist_id   TEXT,
    album_id    TEXT,
    genre_id    TEXT,
    tag_id      TEXT,
    song_id     TEXT,
    playlist_id TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (station_id)  REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)   REFERENCES artistz(id)        ON DELETE CASCADE,
    FOREIGN KEY (album_id)    REFERENCES albumz(id)         ON DELETE CASCADE,
    FOREIGN KEY (genre_id)    REFERENCES genrez(id)         ON DELETE CASCADE,
    FOREIGN KEY (tag_id)      REFERENCES tagz(id)           ON DELETE CASCADE,
    FOREIGN KEY (song_id)     REFERENCES songz(id)          ON DELETE CASCADE,
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id)      ON DELETE CASCADE,

    CHECK (mode IN ('include', 'exclude')),
    CHECK (
        (filter_type = 'artist'   AND artist_id   IS NOT NULL
            AND album_id IS NULL AND genre_id IS NULL
            AND tag_id   IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'album'    AND album_id    IS NOT NULL
            AND artist_id IS NULL AND genre_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'genre'    AND genre_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'tag'      AND tag_id      IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND genre_id  IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'track'    AND song_id     IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND genre_id  IS NULL AND tag_id   IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'playlist' AND playlist_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND genre_id  IS NULL AND tag_id   IS NULL AND song_id     IS NULL)
    )
);

INSERT INTO radio_station_filterz
    (id, station_id, filter_type, mode,
     artist_id, album_id, genre_id, tag_id, song_id, playlist_id, created_at)
SELECT
     id, station_id, filter_type, mode,
     artist_id, album_id, genre_id, tag_id, song_id, NULL, created_at
FROM radio_station_filterz_old;

DROP TABLE radio_station_filterz_old;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_genre    ON radio_station_filterz(genre_id)    WHERE genre_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;

PRAGMA foreign_keys = ON;
