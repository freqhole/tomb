-- migration 051: add scalar/boolean "criteria" filter types to radio
-- station seed filters, alongside the existing FK-reference types.
--
-- before: every `radio_station_filterz` row referenced a real record via
-- exactly one FK column (artist_id/album_id/taxon_id/tag_id/song_id/
-- playlist_id), enforced by a CHECK constraint tied to `filter_type`.
--
-- after: nine new filter_type values are added that carry a plain
-- numeric threshold (or no value at all, for `favorite`) instead of an
-- FK id:
--   - 'favorite'          — no value; include/exclude a favorited entity
--   - 'rating_gte'/'rating_lte'
--   - 'play_count_gte'/'play_count_lte'
--   - 'duration_gte'/'duration_lte'   (seconds)
--   - 'added_days_gte'/'added_days_lte'  (days-ago; see repository.rs for
--     the "gte on days-ago = older" inversion this implies)
--
-- these live in a new nullable `criteria_value` column. sqlite can't
-- ALTER a CHECK constraint, so this is a full rebuild, same pattern as
-- migrations 029/030/038.
--
-- views referencing this table are dropped up front (recreated on next
-- app boot via run_migrations_internal -> views::ALL).

PRAGMA foreign_keys = OFF;

-- ---- step 0: drop dependent views ----
DROP VIEW IF EXISTS feed_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;

-- ---- step 1: rebuild radio_station_filterz with criteria_value ----
ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old_051;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'taxon' | 'tag' | 'track' | 'playlist'
    -- | 'favorite' | 'rating_gte' | 'rating_lte' | 'play_count_gte'
    -- | 'play_count_lte' | 'duration_gte' | 'duration_lte'
    -- | 'added_days_gte' | 'added_days_lte'
    filter_type TEXT NOT NULL,
    -- 'include' | 'exclude'
    mode        TEXT NOT NULL DEFAULT 'include',
    -- for the six FK-reference types, exactly one of these is non-null,
    -- matching `filter_type`, and criteria_value is null. for 'favorite'
    -- every FK column and criteria_value are null (mode alone is the
    -- whole filter). for the numeric criteria types, criteria_value is
    -- non-null and every FK column is null. enforced by the CHECK below.
    artist_id      TEXT,
    album_id       TEXT,
    taxon_id       TEXT,
    tag_id         TEXT,
    song_id        TEXT,
    playlist_id    TEXT,
    criteria_value INTEGER,
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
            AND album_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id  IS NULL AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'album'    AND album_id    IS NOT NULL
            AND artist_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'taxon'    AND taxon_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'tag'      AND tag_id      IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'track'    AND song_id     IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'playlist' AND playlist_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'favorite'
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND criteria_value IS NULL)
     OR (filter_type IN (
            'rating_gte', 'rating_lte',
            'play_count_gte', 'play_count_lte',
            'duration_gte', 'duration_lte',
            'added_days_gte', 'added_days_lte'
         )
            AND criteria_value IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL)
    )
);

INSERT INTO radio_station_filterz
    (id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, created_at)
SELECT
     id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, created_at
FROM radio_station_filterz_old_051;

DROP TABLE radio_station_filterz_old_051;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_taxon    ON radio_station_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;

PRAGMA foreign_keys = ON;
