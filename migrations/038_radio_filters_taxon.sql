-- migration 038: generalize radio station filters across taxon kinds.
--
-- before: `radio_station_filterz` had a `genre_id` column (FK -> taxonz)
-- and the `filter_type` literal `'genre'`. that limited the wizard to
-- genre seeds even though every taxon kind (label, mood, era, region,
-- ...) lives in the same table.
--
-- after: `genre_id` is renamed to `taxon_id` and `'genre'` becomes
-- `'taxon'`. resolution still works because `album_taxonz` is already
-- kind-agnostic; the CHECK constraint and indexes are rebuilt around
-- the new names. legacy 'genre' rows are mapped to 'taxon' in-place.
--
-- views referencing this table are dropped up front (recreated on
-- next app boot via run_migrations_internal -> views::ALL).

PRAGMA foreign_keys = OFF;

-- ---- step 0: drop dependent views ----
DROP VIEW IF EXISTS feed_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;

-- ---- step 1: rebuild radio_station_filterz with taxon_id ----
ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old_038;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'taxon' | 'tag' | 'track' | 'playlist'
    filter_type TEXT NOT NULL,
    -- 'include' | 'exclude'
    mode        TEXT NOT NULL DEFAULT 'include',
    -- exactly one of these is non-null per row, matching `filter_type`.
    -- enforced by the CHECK constraint below.
    artist_id   TEXT,
    album_id    TEXT,
    taxon_id    TEXT,                                     -- references taxonz(id), any kind
    tag_id      TEXT,
    song_id     TEXT,
    playlist_id TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (station_id)  REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)   REFERENCES artistz(id)        ON DELETE CASCADE,
    FOREIGN KEY (album_id)    REFERENCES albumz(id)         ON DELETE CASCADE,
    FOREIGN KEY (taxon_id)    REFERENCES taxonz(id)         ON DELETE CASCADE,
    FOREIGN KEY (tag_id)      REFERENCES tagz(id)           ON DELETE CASCADE,
    FOREIGN KEY (song_id)     REFERENCES songz(id)          ON DELETE CASCADE,
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id)      ON DELETE CASCADE,

    CHECK (mode IN ('include', 'exclude')),
    CHECK (
        (filter_type = 'artist'   AND artist_id   IS NOT NULL
            AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id   IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'album'    AND album_id    IS NOT NULL
            AND artist_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'taxon'    AND taxon_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'tag'      AND tag_id      IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND taxon_id  IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'track'    AND song_id     IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND taxon_id  IS NULL AND tag_id   IS NULL AND playlist_id IS NULL)
     OR (filter_type = 'playlist' AND playlist_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL
            AND taxon_id  IS NULL AND tag_id   IS NULL AND song_id     IS NULL)
    )
);

-- copy every row across, mapping the old 'genre' filter_type -> 'taxon'
-- and the old genre_id column -> taxon_id. genre_id values were already
-- valid taxon ids (preserved through migrations 034/036).
INSERT INTO radio_station_filterz
    (id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, created_at)
SELECT
     id, station_id,
     CASE WHEN filter_type = 'genre' THEN 'taxon' ELSE filter_type END,
     mode,
     artist_id, album_id, genre_id, tag_id, song_id, playlist_id, created_at
FROM radio_station_filterz_old_038;

DROP TABLE radio_station_filterz_old_038;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_taxon    ON radio_station_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;

PRAGMA foreign_keys = ON;
