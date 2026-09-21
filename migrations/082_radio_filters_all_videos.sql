-- migration 082: add 'all_videos' filter type to both
-- radio_station_filterz and external_storage_filter_set_filterz, and add
-- radio_stationz.content_mode ('audio_only' | 'audio_or_video' |
-- 'video_only').
--
-- content_mode gates whether the picker resolves video_ids at all:
-- 'audio_only' (the default - every pre-existing station lands here via
-- ADD COLUMN's default backfill) never resolves video, full stop,
-- regardless of what filters exist - this is what makes it safe to also
-- let taxon/tag/favorite/rating/play_count/duration/added_days filters
-- start matching video content (a later change) without any risk to
-- existing stations, which simply never look at the video side at all.
-- 'audio_or_video' blends both domains (shuffled together, see
-- playlist.rs). 'video_only' is the mirror image of 'audio_only' - skips
-- song resolution entirely, for a station that's purely a video shuffle.
--
-- 'all_videos' is a no-value marker filter (identical value-shape to the
-- existing 'favorite' type - every FK column and criteria_value stay
-- null) meaning "every playable video in the library". this is the
-- video-domain equivalent of "no explicit source configured" for songs
-- (which already falls back to the full library in album mode / the
-- global random pool in shuffle mode) - videos have no such implicit
-- fallback today, so a station wanting to shuffle across ALL videos
-- needs an explicit marker row instead of an empty filter list.
--
-- radio_stationz.content_mode is a plain ADD COLUMN (sqlite allows a
-- CHECK on a new column as long as the DEFAULT satisfies it for existing
-- rows, which it does here - no table rebuild needed for that part).
--
-- the filter tables still need the rebuild treatment: sqlite can't ALTER
-- a CHECK constraint, so both are rebuilt via the same
-- rename+recreate+copy+drop pattern used in migrations 029/030/038/051/
-- 081. no dependent views on either table (confirmed via grep of
-- migrations/views/). no new filter-table columns - purely widening the
-- 'favorite' CHECK arm's filter_type list.

PRAGMA foreign_keys = OFF;

-- ---- radio_stationz.content_mode ----
ALTER TABLE radio_stationz ADD COLUMN content_mode TEXT NOT NULL DEFAULT 'audio_only'
    CHECK (content_mode IN ('audio_only', 'audio_or_video', 'video_only'));

-- ---- radio_station_filterz ----
ALTER TABLE radio_station_filterz RENAME TO radio_station_filterz_old_082;

CREATE TABLE radio_station_filterz (
    id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    station_id  TEXT NOT NULL,
    -- 'artist' | 'album' | 'taxon' | 'tag' | 'track' | 'playlist'
    -- | 'video' | 'video_series'
    -- | 'favorite' | 'all_videos' | 'rating_gte' | 'rating_lte'
    -- | 'play_count_gte' | 'play_count_lte' | 'duration_gte'
    -- | 'duration_lte' | 'added_days_gte' | 'added_days_lte'
    filter_type TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'include',
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
     OR (filter_type IN ('favorite', 'all_videos')
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
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
     video_id, video_series_id, criteria_value, created_at)
SELECT
     id, station_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
     video_id, video_series_id, criteria_value, created_at
FROM radio_station_filterz_old_082;

DROP TABLE radio_station_filterz_old_082;

CREATE INDEX idx_radio_station_filterz_station  ON radio_station_filterz(station_id);
CREATE INDEX idx_radio_station_filterz_artist   ON radio_station_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_album    ON radio_station_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_taxon    ON radio_station_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_tag      ON radio_station_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_song     ON radio_station_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_playlist ON radio_station_filterz(playlist_id) WHERE playlist_id IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_video    ON radio_station_filterz(video_id)    WHERE video_id    IS NOT NULL;
CREATE INDEX idx_radio_station_filterz_video_series ON radio_station_filterz(video_series_id) WHERE video_series_id IS NOT NULL;

-- ---- external_storage_filter_set_filterz (kept structurally identical) ----
ALTER TABLE external_storage_filter_set_filterz RENAME TO external_storage_filter_set_filterz_old_082;

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
     OR (filter_type IN ('favorite', 'all_videos')
            AND artist_id IS NULL AND album_id IS NULL
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
     video_id, video_series_id, criteria_value, criteria_scope, created_at)
SELECT
     id, filter_set_id, filter_type, mode,
     artist_id, album_id, taxon_id, tag_id, song_id, playlist_id,
     video_id, video_series_id, criteria_value, criteria_scope, created_at
FROM external_storage_filter_set_filterz_old_082;

DROP TABLE external_storage_filter_set_filterz_old_082;

CREATE INDEX idx_external_storage_filter_set_filterz_set ON external_storage_filter_set_filterz(filter_set_id);
CREATE INDEX idx_external_storage_filter_set_filterz_artist   ON external_storage_filter_set_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_album    ON external_storage_filter_set_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_taxon    ON external_storage_filter_set_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_tag      ON external_storage_filter_set_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_song     ON external_storage_filter_set_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_playlist ON external_storage_filter_set_filterz(playlist_id) WHERE playlist_id IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_video    ON external_storage_filter_set_filterz(video_id)    WHERE video_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_video_series ON external_storage_filter_set_filterz(video_series_id) WHERE video_series_id IS NOT NULL;
