-- taxonomy refactor: phase 3d, drop the legacy genre tables and rebuild
-- the one table that referenced them by foreign key.
--
-- preconditions (handled by earlier migrations and the rust rewrite):
--   * 034 copied every genrez row into taxonz under kind=genre, preserving
--     the original id, so any cached or in-memory id reference still
--     resolves against taxonz.
--   * 034 copied every album_genrez link into album_taxonz with
--     origin='user'.
--   * 035 dropped the genrez_fts virtual table and rebuilt all fts
--     triggers to source from album_taxonz / taxonz.
--   * the rust call sites in grimoire (radio, analytics, sync, jobs,
--     maintenance, crud, the legacy genres entity, the genre_query_view
--     view definition) have all been switched to taxonz / album_taxonz.
--
-- this migration:
--   1. rebuilds radio_station_filterz so its genre_id fk points at
--      taxonz(id) instead of genrez(id). same column, same rows, same
--      data — only the fk target table changes. requires a table
--      rebuild because sqlite cannot retarget a foreign key in place.
--   2. drops album_genrez (now redundant with album_taxonz).
--   3. drops genrez (now redundant with taxonz/kind=genre).
--
-- not done here (deferred): dropping the `albumz.label` text column.
-- the data has been migrated into album_taxonz/kind=label, but the
-- column is still read/written by several rust call sites (album
-- repository, mb detail processor, album merge). dropping it requires
-- a coordinated rust + sql change which lives in a later phase.

PRAGMA foreign_keys = OFF;

-- ---- step 1: rebuild radio_station_filterz with fk -> taxonz(id) ----
ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old_036;

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
    genre_id    TEXT,                                     -- references taxonz(id) (kind=genre)
    tag_id      TEXT,
    song_id     TEXT,
    playlist_id TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (station_id)  REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)   REFERENCES artistz(id)        ON DELETE CASCADE,
    FOREIGN KEY (album_id)    REFERENCES albumz(id)         ON DELETE CASCADE,
    FOREIGN KEY (genre_id)    REFERENCES taxonz(id)         ON DELETE CASCADE,
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

-- copy every row across. genre_id values were preserved when migration 034
-- inserted into taxonz, so they are still valid as taxon ids.
INSERT INTO radio_station_filterz
    (id, station_id, filter_type, mode,
     artist_id, album_id, genre_id, tag_id, song_id, playlist_id, created_at)
SELECT
     id, station_id, filter_type, mode,
     artist_id, album_id, genre_id, tag_id, song_id, playlist_id, created_at
FROM radio_station_filterz_old_036;

DROP TABLE radio_station_filterz_old_036;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_genre    ON radio_station_filterz(genre_id)    WHERE genre_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;

-- ---- step 2: drop the legacy genrez tables ----
-- album_genrez first because of its fk into genrez(id)
DROP TABLE IF EXISTS album_genrez;
DROP TABLE IF EXISTS genrez;

PRAGMA foreign_keys = ON;
