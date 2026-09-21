-- migration 081: add 'video' and 'video_series' reference filter types to
-- both radio_station_filterz and external_storage_filter_set_filterz.
--
-- these are the video-domain equivalents of the existing 'track' (a
-- single song) and 'album' (a whole release) reference types - 'video'
-- references one videoz row directly, 'video_series' references a whole
-- video_seriez (every video in the series, across every season).
--
-- deliberately NOT touching the semantics of any EXISTING filter_type
-- ('artist'/'album'/'taxon'/'tag'/'track'/'playlist'/the nine criteria
-- types) - those all stay song-only for now, exactly as they behave
-- today. this migration only adds two new, purely additive reference
-- types; it does not change what any pre-existing station's filters
-- resolve to. whether/how 'taxon'/'tag'/'playlist'/criteria filters
-- should ALSO start matching video content (so e.g. "taxon=electronic"
-- pulls in tagged videos too, not just songs) is an open design
-- question - see docs/radio-audio-video-unification-plan.md - deferred
-- to a later, explicit decision rather than silently bundled in here.
--
-- sqlite can't ALTER a CHECK constraint, so both tables are rebuilt via
-- the same rename+recreate+copy+drop pattern used in migrations
-- 029/030/038/051. no dependent views on either table (confirmed via
-- grep of migrations/views/).

PRAGMA foreign_keys = OFF;

-- ---- radio_station_filterz ----
ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old_081;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'taxon' | 'tag' | 'track' | 'playlist'
    -- | 'video' | 'video_series'
    -- | 'favorite' | 'rating_gte' | 'rating_lte' | 'play_count_gte'
    -- | 'play_count_lte' | 'duration_gte' | 'duration_lte'
    -- | 'added_days_gte' | 'added_days_lte'
    filter_type TEXT NOT NULL,
    -- 'include' | 'exclude'
    mode        TEXT NOT NULL DEFAULT 'include',
    -- for reference types, exactly one of these (including the two new
    -- video columns) is non-null, matching `filter_type`, and
    -- criteria_value is null. for 'favorite' every FK column and
    -- criteria_value are null. for numeric criteria types,
    -- criteria_value is non-null and every FK column is null. enforced
    -- by the CHECK below.
    artist_id       TEXT,
    album_id        TEXT,
    taxon_id        TEXT,
    tag_id          TEXT,
    song_id         TEXT,
    playlist_id     TEXT,
    video_id        TEXT,
    video_series_id TEXT,
    criteria_value  INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (station_id)      REFERENCES radio_stationz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)       REFERENCES artistz(id)        ON DELETE CASCADE,
    FOREIGN KEY (album_id)        REFERENCES albumz(id)         ON DELETE CASCADE,
    FOREIGN KEY (taxon_id)        REFERENCES taxonz(id)         ON DELETE CASCADE,
    FOREIGN KEY (tag_id)          REFERENCES tagz(id)           ON DELETE CASCADE,
    FOREIGN KEY (song_id)         REFERENCES songz(id)          ON DELETE CASCADE,
    FOREIGN KEY (playlist_id)     REFERENCES playlistz(id)      ON DELETE CASCADE,
    FOREIGN KEY (video_id)        REFERENCES videoz(id)         ON DELETE CASCADE,
    FOREIGN KEY (video_series_id) REFERENCES video_seriez(id)   ON DELETE CASCADE,

    CHECK (mode IN ('include', 'exclude')),
    CHECK (
        (filter_type = 'artist'   AND artist_id   IS NOT NULL
            AND album_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'album'    AND album_id    IS NOT NULL
            AND artist_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'taxon'    AND taxon_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'tag'      AND tag_id      IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'track'    AND song_id     IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'playlist' AND playlist_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'video'    AND video_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'video_series' AND video_series_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'favorite'
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type IN (
            'rating_gte', 'rating_lte',
            'play_count_gte', 'play_count_lte',
            'duration_gte', 'duration_lte',
            'added_days_gte', 'added_days_lte'
         )
            AND criteria_value IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL)
    )
);

INSERT INTO radio_station_filterz
    (id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value, created_at)
SELECT
     id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id, criteria_value, created_at
FROM radio_station_filterz_old_081;

DROP TABLE radio_station_filterz_old_081;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_taxon    ON radio_station_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_video    ON radio_station_filterz(video_id)    WHERE video_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_video_series ON radio_station_filterz(video_series_id) WHERE video_series_id IS NOT NULL;

-- ---- external_storage_filter_set_filterz (kept structurally identical -
-- see migrations/053's own doc comment; shares parse_filter_clause with
-- radio_station_filterz, so this table's shape must track it in lockstep
-- even though removable-storage sync doesn't resolve video candidates
-- yet - a 'video'/'video_series' row here just resolves to nothing until
-- that catches up, same as any filter_type external_storage doesn't
-- consult would today) ----
ALTER TABLE external_storage_filter_set_filterz RENAME TO external_storage_filter_set_filterz_old_081;

CREATE TABLE external_storage_filter_set_filterz (
    id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    filter_set_id  TEXT NOT NULL,
    filter_type    TEXT NOT NULL,
    mode           TEXT NOT NULL DEFAULT 'include',
    artist_id      TEXT,
    album_id       TEXT,
    taxon_id       TEXT,
    tag_id         TEXT,
    song_id        TEXT,
    playlist_id    TEXT,
    video_id        TEXT,
    video_series_id TEXT,
    criteria_value INTEGER,
    criteria_scope INTEGER,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (filter_set_id)   REFERENCES external_storage_filter_setz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)       REFERENCES artistz(id)   ON DELETE CASCADE,
    FOREIGN KEY (album_id)        REFERENCES albumz(id)    ON DELETE CASCADE,
    FOREIGN KEY (taxon_id)        REFERENCES taxonz(id)    ON DELETE CASCADE,
    FOREIGN KEY (tag_id)          REFERENCES tagz(id)      ON DELETE CASCADE,
    FOREIGN KEY (song_id)         REFERENCES songz(id)     ON DELETE CASCADE,
    FOREIGN KEY (playlist_id)     REFERENCES playlistz(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id)        REFERENCES videoz(id)         ON DELETE CASCADE,
    FOREIGN KEY (video_series_id) REFERENCES video_seriez(id)   ON DELETE CASCADE,

    CHECK (mode IN ('include', 'exclude')),
    CHECK (
        (filter_type = 'artist'   AND artist_id   IS NOT NULL
            AND album_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'album'    AND album_id    IS NOT NULL
            AND artist_id IS NULL AND taxon_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'taxon'    AND taxon_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND tag_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'tag'      AND tag_id      IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND song_id   IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'track'    AND song_id     IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'playlist' AND playlist_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id IS NULL
            AND video_id  IS NULL AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'video'    AND video_id    IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_series_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'video_series' AND video_series_id IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id    IS NULL AND song_id  IS NULL AND playlist_id IS NULL
            AND video_id  IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'favorite' AND artist_id IS NULL AND album_id IS NULL
            AND taxon_id IS NULL AND tag_id IS NULL AND song_id IS NULL
            AND playlist_id IS NULL AND video_id IS NULL AND video_series_id IS NULL
            AND criteria_value IS NULL)
     OR (filter_type IN (
            'rating_gte', 'rating_lte', 'play_count_gte', 'play_count_lte',
            'duration_gte', 'duration_lte', 'added_days_gte', 'added_days_lte'
         )
         AND criteria_value IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id IS NULL AND song_id IS NULL AND playlist_id IS NULL
            AND video_id IS NULL AND video_series_id IS NULL)
    )
);

INSERT INTO external_storage_filter_set_filterz
    (id, filter_set_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
     criteria_value, criteria_scope, created_at)
SELECT
     id, filter_set_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
     criteria_value, criteria_scope, created_at
FROM external_storage_filter_set_filterz_old_081;

DROP TABLE external_storage_filter_set_filterz_old_081;

CREATE INDEX idx_external_storage_filter_set_filterz_set ON external_storage_filter_set_filterz(filter_set_id);
CREATE INDEX idx_external_storage_filter_set_filterz_artist   ON external_storage_filter_set_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_album    ON external_storage_filter_set_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_taxon    ON external_storage_filter_set_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_tag      ON external_storage_filter_set_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_song     ON external_storage_filter_set_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_playlist ON external_storage_filter_set_filterz(playlist_id) WHERE playlist_id IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_video    ON external_storage_filter_set_filterz(video_id)    WHERE video_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_video_series ON external_storage_filter_set_filterz(video_series_id) WHERE video_series_id IS NOT NULL;
