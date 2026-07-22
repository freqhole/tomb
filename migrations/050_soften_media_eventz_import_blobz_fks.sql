-- 050: soften media_eventz/import_blobz's foreign keys to media_blobz and
-- user_accountz into logical (non-enforced) references.
--
-- both tables live in this database, but the rows they point at (blobs,
-- user accounts) are moving to library-owned storage. once those tables
-- are no longer guaranteed to live in this same database file, an enforced
-- sqlite foreign key to them can't be validated - so these become soft
-- references by convention (still stored as plain ids, no longer checked
-- or cascaded by sqlite). consistency going forward is a cleanup-job
-- concern rather than a constraint the database enforces.
--
-- import_blobz's fk to job_sessionz is untouched - that table stays in
-- this database, so the real, enforced constraint is kept.
--
-- sqlite can't drop a foreign key in place, so tables are rebuilt. sqlite
-- treats dropping a table as an implicit delete of all its rows, and with
-- foreign keys enabled that delete is checked against every table that
-- currently holds a foreign key pointing at it - music_play_eventz holds
-- one on media_event_id, referencing media_eventz. rebuilding media_eventz
-- with that reference still in place fails the check (or, if checks are
-- deferred, still fails at commit - sqlite doesn't reconcile a deferred
-- violation just because a same-named replacement table shows up later).
-- toggling `PRAGMA foreign_keys` off for the rebuild isn't an option
-- either: sqlite silently ignores that pragma while a transaction is open,
-- and sqlx always runs a migration file inside one.
--
-- so music_play_eventz is rebuilt twice: once first, temporarily dropping
-- its media_event_id reference (so media_eventz's own rebuild has nothing
-- pointing at it and is a plain, unchecked drop), then again afterward,
-- restoring that reference against the newly rebuilt media_eventz (whose
-- rows already match, so the restored foreign key is satisfied
-- immediately, no deferral needed).

-- ============================================================================
-- 1. music_play_eventz: temporarily drop the fk to media_eventz(id) so
--    media_eventz can be rebuilt without tripping a foreign key check
-- ============================================================================

CREATE TABLE music_play_eventz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT,
    song_id TEXT,
    album_id TEXT,
    artist_id TEXT,
    playlist_id TEXT,
    radio_station_id TEXT,
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (song_id) REFERENCES songz(id),
    FOREIGN KEY (album_id) REFERENCES albumz(id),
    FOREIGN KEY (artist_id) REFERENCES artistz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (radio_station_id) REFERENCES radio_stationz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

INSERT INTO music_play_eventz_new
SELECT id, media_event_id, song_id, album_id, artist_id, playlist_id,
       radio_station_id, user_id, session_id, created_at
FROM music_play_eventz;

DROP TABLE music_play_eventz;
ALTER TABLE music_play_eventz_new RENAME TO music_play_eventz;

CREATE INDEX idx_music_play_eventz_song ON music_play_eventz(song_id);
CREATE INDEX idx_music_play_eventz_album ON music_play_eventz(album_id);
CREATE INDEX idx_music_play_eventz_artist ON music_play_eventz(artist_id);
CREATE INDEX idx_music_play_eventz_playlist ON music_play_eventz(playlist_id);
CREATE INDEX idx_music_play_eventz_radio_station ON music_play_eventz(radio_station_id);
CREATE INDEX idx_music_play_eventz_user ON music_play_eventz(user_id);
CREATE INDEX idx_music_play_eventz_session ON music_play_eventz(session_id);
CREATE INDEX idx_music_play_eventz_created ON music_play_eventz(created_at DESC);
CREATE INDEX idx_music_play_eventz_song_created ON music_play_eventz(song_id, created_at DESC);
CREATE INDEX idx_music_play_eventz_user_created ON music_play_eventz(user_id, created_at DESC);

-- ============================================================================
-- 2. media_eventz: drop fks to media_blobz(id) and user_accountz(id)
-- ============================================================================

CREATE TABLE media_eventz_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_blob_id TEXT NOT NULL,
    user_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT,
    session_id TEXT DEFAULT (lower(hex(randomblob(8)))),
    user_agent TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    client_timestamp INTEGER,
    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop',
        'rate', 'favorite', 'unfavorite', 'skip', 'add'
    ))
) STRICT;

INSERT INTO media_eventz_new
SELECT id, media_blob_id, user_id, event_type, event_data, session_id,
       user_agent, client_id, created_at, updated_at, client_timestamp
FROM media_eventz;

DROP TABLE media_eventz;
ALTER TABLE media_eventz_new RENAME TO media_eventz;

CREATE INDEX idx_media_eventz_blob ON media_eventz(media_blob_id);
CREATE INDEX idx_media_eventz_user ON media_eventz(user_id);
CREATE INDEX idx_media_eventz_type ON media_eventz(event_type);
CREATE INDEX idx_media_eventz_created ON media_eventz(created_at DESC);
CREATE INDEX idx_media_eventz_session ON media_eventz(session_id);
CREATE INDEX idx_media_eventz_user_created ON media_eventz(user_id, created_at DESC);
CREATE INDEX idx_media_eventz_blob_type ON media_eventz(media_blob_id, event_type);

CREATE TRIGGER trg_media_eventz_updated_at
AFTER UPDATE ON media_eventz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE media_eventz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- ============================================================================
-- 3. music_play_eventz: restore the fk to media_eventz(id), now pointing
--    at the rebuilt table - all rows already match, so this is satisfied
--    immediately with no deferred check needed
-- ============================================================================

CREATE TABLE music_play_eventz_final (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT,
    song_id TEXT,
    album_id TEXT,
    artist_id TEXT,
    playlist_id TEXT,
    radio_station_id TEXT,
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (media_event_id) REFERENCES media_eventz(id),
    FOREIGN KEY (song_id) REFERENCES songz(id),
    FOREIGN KEY (album_id) REFERENCES albumz(id),
    FOREIGN KEY (artist_id) REFERENCES artistz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (radio_station_id) REFERENCES radio_stationz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

INSERT INTO music_play_eventz_final
SELECT id, media_event_id, song_id, album_id, artist_id, playlist_id,
       radio_station_id, user_id, session_id, created_at
FROM music_play_eventz;

DROP TABLE music_play_eventz;
ALTER TABLE music_play_eventz_final RENAME TO music_play_eventz;

CREATE INDEX idx_music_play_eventz_song ON music_play_eventz(song_id);
CREATE INDEX idx_music_play_eventz_album ON music_play_eventz(album_id);
CREATE INDEX idx_music_play_eventz_artist ON music_play_eventz(artist_id);
CREATE INDEX idx_music_play_eventz_playlist ON music_play_eventz(playlist_id);
CREATE INDEX idx_music_play_eventz_radio_station ON music_play_eventz(radio_station_id);
CREATE INDEX idx_music_play_eventz_user ON music_play_eventz(user_id);
CREATE INDEX idx_music_play_eventz_session ON music_play_eventz(session_id);
CREATE INDEX idx_music_play_eventz_created ON music_play_eventz(created_at DESC);
CREATE INDEX idx_music_play_eventz_song_created ON music_play_eventz(song_id, created_at DESC);
CREATE INDEX idx_music_play_eventz_user_created ON music_play_eventz(user_id, created_at DESC);

-- ============================================================================
-- 4. import_blobz: drop fks to media_blobz(id) and user_accountz(id);
--    keep the real fk to job_sessionz(id)
-- ============================================================================

CREATE TABLE import_blobz_new (
  media_blob_id TEXT NOT NULL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES job_sessionz(id) ON DELETE CASCADE,
  reviewed_at   INTEGER,
  reviewed_by   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO import_blobz_new
SELECT media_blob_id, session_id, reviewed_at, reviewed_by, created_at
FROM import_blobz;

DROP TABLE import_blobz;
ALTER TABLE import_blobz_new RENAME TO import_blobz;

CREATE INDEX idx_import_blobz_session  ON import_blobz(session_id);
CREATE INDEX idx_import_blobz_pending  ON import_blobz(session_id) WHERE reviewed_at IS NULL;
