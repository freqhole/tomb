-- migration 053: move removable-storage sync state into sqlite, and add
-- a filter-set model for phase-6 rule-based bulk sync selection.
--
-- before: per-device sync bookkeeping (which songs/paths/playlists were
-- already synced) lived in a `.freqhole.db.json` file written onto the
-- removable device itself, and `last_synced_at` lived in charnel's local
-- toml config. after: all of it lives here, alongside the rest of the
-- library's state — a removable device's "known" status is inherently
-- tied to the local install anyway (the device list itself lives in
-- charnel's local config, not on the device), so this doesn't change
-- portability, it just moves bookkeeping to a more durable, queryable
-- place instead of a hand-rolled json file.
--
-- the filter-set tables mirror `radio_station_filterz` (migration 051)
-- exactly, minus the station/broadcast machinery — see
-- `grimoire::external_storage` and `grimoire::radio::stations` for the
-- shared resolution code (`song_ids_for_clause`/`parse_filter_clause`).

CREATE TABLE external_storage_synced_songz (
    device_id     TEXT NOT NULL,
    song_id       TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    blake3        TEXT,
    tag_hash      TEXT NOT NULL,
    synced_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (device_id, song_id)
);
CREATE INDEX idx_external_storage_synced_songz_device ON external_storage_synced_songz(device_id);

-- every relative path ever handed out to a device, kept even after the
-- owning song row above is removed/moved, so a freed-up path is never
-- silently reused for different content (mirrors the old claimed_paths
-- set in the json state file).
CREATE TABLE external_storage_claimed_pathz (
    device_id     TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    claimed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (device_id, relative_path)
);

-- one .m3u8 manifest synced to a device. sync_set_id is an arbitrary id
-- from one of three id-spaces: a real playlistz.id, the literal string
-- 'favorites', or an external_storage_filter_setz.id.
CREATE TABLE external_storage_sync_manifestz (
    device_id    TEXT NOT NULL,
    sync_set_id  TEXT NOT NULL,
    filename     TEXT NOT NULL,
    synced_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (device_id, sync_set_id)
);

-- a named, reusable set of include/exclude filter clauses — "what to
-- sync to removable storage", structurally identical to a radio
-- station's seed filters but with no station/broadcast machinery
-- attached (deliberately not reusing radio_stationz — see
-- docs/removable-storage-sync-plan.md phase 6 for the tradeoff).
CREATE TABLE external_storage_filter_setz (
    id         TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE external_storage_filter_set_filterz (
    id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    filter_set_id  TEXT NOT NULL,
    -- see StationFilterType for the full list of accepted values —
    -- identical set to radio_station_filterz.filter_type.
    filter_type    TEXT NOT NULL,
    -- 'include' | 'exclude'
    mode           TEXT NOT NULL DEFAULT 'include',
    artist_id      TEXT,
    album_id       TEXT,
    taxon_id       TEXT,
    tag_id         TEXT,
    song_id        TEXT,
    playlist_id    TEXT,
    criteria_value INTEGER,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (filter_set_id) REFERENCES external_storage_filter_setz(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id)   REFERENCES artistz(id)   ON DELETE CASCADE,
    FOREIGN KEY (album_id)    REFERENCES albumz(id)    ON DELETE CASCADE,
    FOREIGN KEY (taxon_id)    REFERENCES taxonz(id)    ON DELETE CASCADE,
    FOREIGN KEY (tag_id)      REFERENCES tagz(id)      ON DELETE CASCADE,
    FOREIGN KEY (song_id)     REFERENCES songz(id)     ON DELETE CASCADE,
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id) ON DELETE CASCADE,

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
            AND tag_id    IS NULL AND song_id IS NULL AND criteria_value IS NULL)
     OR (filter_type = 'favorite' AND artist_id IS NULL AND album_id IS NULL
            AND taxon_id IS NULL AND tag_id IS NULL AND song_id IS NULL
            AND playlist_id IS NULL AND criteria_value IS NULL)
     OR (filter_type IN (
            'rating_gte', 'rating_lte', 'play_count_gte', 'play_count_lte',
            'duration_gte', 'duration_lte', 'added_days_gte', 'added_days_lte'
         )
         AND criteria_value IS NOT NULL
            AND artist_id IS NULL AND album_id IS NULL AND taxon_id IS NULL
            AND tag_id IS NULL AND song_id IS NULL AND playlist_id IS NULL)
    )
);
CREATE INDEX idx_external_storage_filter_set_filterz_set ON external_storage_filter_set_filterz(filter_set_id);
CREATE INDEX idx_external_storage_filter_set_filterz_artist   ON external_storage_filter_set_filterz(artist_id)   WHERE artist_id   IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_album    ON external_storage_filter_set_filterz(album_id)    WHERE album_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_taxon    ON external_storage_filter_set_filterz(taxon_id)    WHERE taxon_id    IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_tag      ON external_storage_filter_set_filterz(tag_id)      WHERE tag_id      IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_song     ON external_storage_filter_set_filterz(song_id)     WHERE song_id     IS NOT NULL;
CREATE INDEX idx_external_storage_filter_set_filterz_playlist ON external_storage_filter_set_filterz(playlist_id) WHERE playlist_id IS NOT NULL;

-- per-device stats that used to live in charnel's local toml config.
CREATE TABLE external_storage_device_statz (
    device_id      TEXT NOT NULL PRIMARY KEY,
    last_synced_at INTEGER
);
