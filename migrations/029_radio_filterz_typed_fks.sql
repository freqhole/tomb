-- 029_radio_filterz_typed_fks.sql
--
-- unify the radio "what plays" data model under a single
-- `radio_station_filterz` table, where every clause is one of:
--   filter_type ∈ {'artist', 'album', 'genre', 'tag', 'track'}
--   mode        ∈ {'include', 'exclude'}
-- and references a real record id via a typed FK column. previously,
-- explicit per-track inclusion lived in its own `radio_station_songz`
-- table and `radio_station_filterz.filter_value` was a free-form string
-- (id-or-name), which made include/exclude logic surprising and made it
-- easy for the picker to fall back to "all songs" when a station had any
-- explicit songs. this migration replaces all of that.
--
-- behavior change: when a station has zero filter rows, the picker falls
-- back to the full library (album mode) or the global random pool
-- (shuffle mode). when there is at least one include-filter row, only
-- the resolved candidate set plays; excludes always subtract.
--
-- data: per the maintainers there is no production data to preserve in
-- `radio_station_songz` or the legacy `radio_station_filterz`, so both
-- tables are dropped and recreated from scratch.

DROP TABLE IF EXISTS radio_station_songz;
DROP TABLE IF EXISTS radio_station_filterz;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'genre' | 'tag' | 'track'
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
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (station_id) REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)  REFERENCES artistz(id)        ON DELETE CASCADE,
    FOREIGN KEY (album_id)   REFERENCES albumz(id)         ON DELETE CASCADE,
    FOREIGN KEY (genre_id)   REFERENCES genrez(id)         ON DELETE CASCADE,
    FOREIGN KEY (tag_id)     REFERENCES tagz(id)           ON DELETE CASCADE,
    FOREIGN KEY (song_id)    REFERENCES songz(id)          ON DELETE CASCADE,

    CHECK (mode IN ('include', 'exclude')),
    CHECK (
        (filter_type = 'artist' AND artist_id IS NOT NULL
            AND album_id IS NULL AND genre_id IS NULL
            AND tag_id   IS NULL AND song_id  IS NULL)
     OR (filter_type = 'album'  AND album_id  IS NOT NULL
            AND artist_id IS NULL AND genre_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL)
     OR (filter_type = 'genre'  AND genre_id  IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL)
     OR (filter_type = 'tag'    AND tag_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND genre_id  IS NULL AND song_id  IS NULL)
     OR (filter_type = 'track'  AND song_id   IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND genre_id  IS NULL AND tag_id   IS NULL)
    )
);

CREATE INDEX idx_radio_station_filterz_station ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist  ON radio_station_filterz(artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album   ON radio_station_filterz(album_id)  WHERE album_id  IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_genre   ON radio_station_filterz(genre_id)  WHERE genre_id  IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag     ON radio_station_filterz(tag_id)    WHERE tag_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song    ON radio_station_filterz(song_id)   WHERE song_id   IS NOT NULL;
