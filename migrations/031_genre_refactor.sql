-- genre refactor: remove sub-genres, allow albums to have multiple genres
-- albums now have many-to-many relationship with genres via album_genrez
-- NOTE: this migration assumes a clean db reset, no data migration

-- drop views first (they reference the tables we're about to drop)
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS genre_query_view;

-- drop triggers that reference sub_genrez/album_sub_genrez
DROP TRIGGER IF EXISTS sub_genrez_fts_insert;
DROP TRIGGER IF EXISTS sub_genrez_fts_update;
DROP TRIGGER IF EXISTS sub_genrez_fts_delete;
DROP TRIGGER IF EXISTS albumz_fts_insert;
DROP TRIGGER IF EXISTS albumz_fts_update;
DROP TRIGGER IF EXISTS albumz_fts_delete;
DROP TRIGGER IF EXISTS songz_fts_insert;
DROP TRIGGER IF EXISTS songz_fts_update;
DROP TRIGGER IF EXISTS songz_fts_delete;
DROP TRIGGER IF EXISTS genrez_fts_insert;
DROP TRIGGER IF EXISTS genrez_fts_update;
DROP TRIGGER IF EXISTS genrez_fts_delete;
DROP TRIGGER IF EXISTS playlistz_fts_insert;
DROP TRIGGER IF EXISTS playlistz_fts_update;
DROP TRIGGER IF EXISTS playlistz_fts_delete;

-- drop old sub-genre tables
DROP TABLE IF EXISTS album_sub_genrez;
DROP TABLE IF EXISTS sub_genrez;

-- remove genre_id column from albumz by recreating table
DROP TABLE IF EXISTS albumz;

CREATE TABLE albumz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  album_type TEXT DEFAULT 'album',
  release_date TEXT,
  release_date_precision TEXT,
  label TEXT,
  song_count INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  CHECK (album_type IN ('album', 'single', 'compilation'))
);

CREATE INDEX idx_albumz_title ON albumz(title);
CREATE INDEX idx_albumz_deleted_at ON albumz(deleted_at);

-- create junction table for album-genre many-to-many
CREATE TABLE IF NOT EXISTS album_genrez (
  album_id TEXT NOT NULL,
  genre_id TEXT NOT NULL,
  UNIQUE(album_id, genre_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (genre_id) REFERENCES genrez(id)
);

CREATE INDEX IF NOT EXISTS idx_album_genrez_album_id ON album_genrez(album_id);
CREATE INDEX IF NOT EXISTS idx_album_genrez_genre_id ON album_genrez(genre_id);

-- recreate album_query_view with genres array

CREATE VIEW album_query_view AS
SELECT
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genres as JSON array: ["rock", "indie", ...]
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- genre IDs as JSON array: ["id1", "id2", ...]
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1, "blob_type": "..."}, ...]
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- album tags as JSON array of tag names
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- primary artist (first alphabetically for consistency)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- user favorites and ratings (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM albumz al
LEFT JOIN artist_albumz aa ON al.id = aa.album_id
LEFT JOIN artistz ar ON aa.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'album' AND uf.target_id = al.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'album' AND ur.target_id = al.id
WHERE al.deleted_at IS NULL
AND al.song_count > 0
-- get primary artist (first one alphabetically for deterministic results)
AND (ar.id IS NULL OR ar.id = (
    SELECT aa2.artist_id
    FROM artist_albumz aa2
    JOIN artistz ar2 ON aa2.artist_id = ar2.id AND ar2.deleted_at IS NULL
    WHERE aa2.album_id = al.id
    ORDER BY ar2.name ASC
    LIMIT 1
));

-- step 3: recreate song_query_view with genres array
DROP VIEW IF EXISTS song_query_view;

CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        (SELECT media_blob_id FROM song_imagez WHERE song_id = s.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.year as song_year,
    s.bpm as song_bpm,
    s.key_signature as song_key_signature,
    s.metadata as song_metadata,
    s.lyrics as song_lyrics,
    s.processing_status as song_processing_status,
    s.processing_notes as song_processing_notes,
    s.created_at as song_created_at,
    s.updated_at as song_updated_at,
    s.deleted_at as song_deleted_at,
    s.deleted_by as song_deleted_by,
    s.created_by as song_created_by,
    s.updated_by as song_updated_by,

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1, "blob_type": "..."}, ...]
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si
         JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = s.id),
        '[]'
    ) as song_images,

    -- artist fields (primary artist via artist_songz)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- album genres as JSON array: ["rock", "indie", ...]
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- album genre IDs as JSON array: ["id1", "id2", ...]
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- album tags as JSON array of tag names: ["jazz", "experimental", ...]
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- album images as JSON array: [{"blob_id": "...", "is_primary": 1, "blob_type": "..."}, ...]
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings for songs (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at,

    -- album favorite status (for displaying album favorite in song lists)
    uf_album.id as album_favorite_id,
    uf_album.user_id as album_favorite_user_id,
    uf_album.created_at as album_favorited_at,

    -- album rating status (for displaying album rating in song lists)
    ur_album.user_id as album_rating_user_id,
    ur_album.rating as album_user_rating,
    ur_album.created_at as album_rating_created_at

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL;

-- step 4: recreate playlist_song_query_view with genres array
DROP VIEW IF EXISTS playlist_song_query_view;

CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- full song fields (same as song_query_view)
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        (SELECT media_blob_id FROM song_imagez WHERE song_id = s.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.year as song_year,
    s.bpm as song_bpm,
    s.key_signature as song_key_signature,
    s.metadata as song_metadata,
    s.lyrics as song_lyrics,
    s.processing_status as song_processing_status,
    s.processing_notes as song_processing_notes,
    s.created_at as song_created_at,
    s.updated_at as song_updated_at,
    s.deleted_at as song_deleted_at,
    s.deleted_by as song_deleted_by,
    s.created_by as song_created_by,
    s.updated_by as song_updated_by,

    -- images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si
         JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = s.id),
        '[]'
    ) as song_images,

    -- artist fields
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- album genres as JSON array
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- album genre IDs as JSON array
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- album images as JSON array: [{"blob_id": "...", "is_primary": 1, "blob_type": "..."}, ...]
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at,

    -- album favorite status
    uf_album.id as album_favorite_id,
    uf_album.user_id as album_favorite_user_id,
    uf_album.created_at as album_favorited_at,

    -- album rating status
    ur_album.user_id as album_rating_user_id,
    ur_album.rating as album_user_rating,
    ur_album.created_at as album_rating_created_at

FROM playlist_songz ps
LEFT JOIN songz s ON ps.song_id = s.id
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN playlistz pl ON ps.playlist_id = pl.id
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL AND pl.deleted_at IS NULL
ORDER BY ps.position;

-- step 5: update genre_query_view to use album_genrez junction
-- only include genres that have at least one album with songs
DROP VIEW IF EXISTS genre_query_view;

CREATE VIEW genre_query_view AS
SELECT
    g.id as genre_id,
    g.name as genre_name,
    g.created_at as genre_created_at,
    
    -- count albums with this genre (only albums with songs)
    (SELECT COUNT(DISTINCT ag.album_id)
     FROM album_genrez ag
     INNER JOIN albumz a ON ag.album_id = a.id
     WHERE ag.genre_id = g.id AND a.deleted_at IS NULL AND a.song_count > 0) as album_count,
    
    -- count songs in albums with this genre
    (SELECT COUNT(DISTINCT als.song_id)
     FROM album_genrez ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.genre_id = g.id AND s.deleted_at IS NULL) as song_count,
    
    -- total duration of all songs in albums with this genre
    (SELECT COALESCE(SUM(s.duration), 0)
     FROM album_genrez ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.genre_id = g.id AND s.deleted_at IS NULL) as total_duration,
    
    -- user favorites (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM genrez g
LEFT JOIN user_favoritez uf ON uf.target_type = 'genre' AND uf.target_id = g.id
WHERE g.deleted_at IS NULL
-- only include genres that have at least one song via album relationship
AND EXISTS (
    SELECT 1 FROM album_genrez ag
    INNER JOIN album_songz als ON ag.album_id = als.album_id
    INNER JOIN songz s ON als.song_id = s.id
    WHERE ag.genre_id = g.id AND s.deleted_at IS NULL
);

-- step 5b: recreate artist_query_view to filter out artists with no songs
DROP VIEW IF EXISTS artist_query_view;

CREATE VIEW artist_query_view AS
SELECT
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- images as JSON array with blob_type
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- aggregated stats (only count non-deleted songs)
    COUNT(DISTINCT ars.song_id) as song_count,
    -- album count: only count albums that have at least one song
    (SELECT COUNT(DISTINCT aa2.album_id)
     FROM artist_albumz aa2
     JOIN albumz al ON aa2.album_id = al.id
     WHERE aa2.artist_id = ar.id AND al.deleted_at IS NULL AND al.song_count > 0) as album_count,
    COALESCE(SUM(s.duration), 0) as total_duration,

    -- user favorites and ratings (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM artistz ar
LEFT JOIN artist_songz ars ON ar.id = ars.artist_id
LEFT JOIN songz s ON ars.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'artist' AND uf.target_id = ar.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'artist' AND ur.target_id = ar.id
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.bio, ar.created_at, ar.updated_at, ar.deleted_at,
         ar.deleted_by, ar.created_by, ar.updated_by, uf.id, uf.user_id, uf.created_at,
         ur.user_id, ur.rating, ur.created_at
-- only include artists that have at least one song
HAVING COUNT(DISTINCT ars.song_id) > 0;

-- step 6: recreate simple FTS triggers (without sub-genre complexity)
-- NOTE: songs_fts table from migration 028 only indexes title/lyrics/metadata, not genre/artist

-- drop old artistz FTS triggers that reference album.genre_id
DROP TRIGGER IF EXISTS artistz_fts_insert;
DROP TRIGGER IF EXISTS artistz_fts_update;
DROP TRIGGER IF EXISTS artistz_fts_delete;

-- recreate artistz FTS triggers using album_genrez junction table
CREATE TRIGGER artistz_fts_insert AFTER INSERT ON artistz
BEGIN
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN albumz a ON als.album_id = a.id
                JOIN album_genrez ag ON a.id = ag.album_id
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ars.artist_id = NEW.id AND g.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_update AFTER UPDATE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN albumz a ON als.album_id = a.id
                JOIN album_genrez ag ON a.id = ag.album_id
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ars.artist_id = NEW.id AND g.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_delete AFTER DELETE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
END;

-- recreate songz FTS triggers using album_genrez junction table
CREATE TRIGGER songz_fts_insert AFTER INSERT ON songz
BEGIN
    INSERT INTO songz_fts(
        song_id,
        title,
        artist_name,
        album_name,
        genre_name,
        sub_genre_names,
        filename,
        lyrics,
        metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT g.name
            FROM album_songz als
            JOIN albumz a ON als.album_id = a.id
            JOIN album_genrez ag ON a.id = ag.album_id
            JOIN genrez g ON ag.genre_id = g.id
            WHERE als.song_id = NEW.id AND a.deleted_at IS NULL AND g.deleted_at IS NULL
            LIMIT 1
        ), ''),
        '', -- sub_genre_names deprecated
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_update AFTER UPDATE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
    INSERT INTO songz_fts(
        song_id,
        title,
        artist_name,
        album_name,
        genre_name,
        sub_genre_names,
        filename,
        lyrics,
        metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT g.name
            FROM album_songz als
            JOIN albumz a ON als.album_id = a.id
            JOIN album_genrez ag ON a.id = ag.album_id
            JOIN genrez g ON ag.genre_id = g.id
            WHERE als.song_id = NEW.id AND a.deleted_at IS NULL AND g.deleted_at IS NULL
            LIMIT 1
        ), ''),
        '', -- sub_genre_names deprecated
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_delete AFTER DELETE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
END;

-- recreate albumz FTS triggers using album_genrez junction table
CREATE TRIGGER albumz_fts_insert AFTER INSERT ON albumz
BEGIN
    INSERT INTO albumz_fts(album_id, title, artist_name, genre_name, sub_genre_names)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM album_genrez ag
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ag.album_id = NEW.id AND g.deleted_at IS NULL
            )
        ), ''),
        ''; -- sub_genre_names deprecated
END;

CREATE TRIGGER albumz_fts_update AFTER UPDATE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
    INSERT INTO albumz_fts(album_id, title, artist_name, genre_name, sub_genre_names)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM album_genrez ag
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ag.album_id = NEW.id AND g.deleted_at IS NULL
            )
        ), ''),
        ''; -- sub_genre_names deprecated
END;

CREATE TRIGGER albumz_fts_delete AFTER DELETE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
END;

-- recreate genrez FTS triggers
CREATE TRIGGER genrez_fts_insert AFTER INSERT ON genrez
BEGIN
    INSERT INTO genrez_fts(genre_id, name)
    VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER genrez_fts_update AFTER UPDATE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
    INSERT INTO genrez_fts(genre_id, name)
    VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER genrez_fts_delete AFTER DELETE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
END;

-- recreate playlistz FTS triggers
CREATE TRIGGER playlistz_fts_insert AFTER INSERT ON playlistz
BEGIN
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER playlistz_fts_update AFTER UPDATE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER playlistz_fts_delete AFTER DELETE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
END;

-- =============================================================================
-- step 7: repopulate FTS tables with existing data
-- triggers only fire on INSERT, so existing data needs manual population
-- =============================================================================

-- clear and repopulate songz_fts
DELETE FROM songz_fts;
INSERT INTO songz_fts(song_id, title, artist_name, album_name, genre_name, sub_genre_names, filename, lyrics, metadata_text)
SELECT
    song.id,
    song.title,
    COALESCE((
        SELECT GROUP_CONCAT(artist_name, ', ')
        FROM (
            SELECT DISTINCT artist.name as artist_name
            FROM artist_songz
            JOIN artistz artist ON artist_songz.artist_id = artist.id
            WHERE artist_songz.song_id = song.id AND artist.deleted_at IS NULL
        )
    ), ''),
    COALESCE((
        SELECT album.title
        FROM album_songz
        JOIN albumz album ON album_songz.album_id = album.id
        WHERE album_songz.song_id = song.id AND album.deleted_at IS NULL
        LIMIT 1
    ), ''),
    COALESCE((
        SELECT g.name
        FROM album_songz als
        JOIN albumz a ON als.album_id = a.id
        JOIN album_genrez ag ON a.id = ag.album_id
        JOIN genrez g ON ag.genre_id = g.id
        WHERE als.song_id = song.id AND a.deleted_at IS NULL AND g.deleted_at IS NULL
        LIMIT 1
    ), ''),
    '', -- sub_genre_names deprecated
    COALESCE((SELECT mb.filename FROM media_blobz mb WHERE mb.id = song.media_blob_id), ''),
    COALESCE(song.lyrics, ''),
    COALESCE(song.metadata, '')
FROM songz song
WHERE song.deleted_at IS NULL;

-- clear and repopulate albumz_fts
DELETE FROM albumz_fts;
INSERT INTO albumz_fts(album_id, title, artist_name, genre_name, sub_genre_names)
SELECT
    album.id,
    album.title,
    COALESCE((
        SELECT GROUP_CONCAT(artist_name, ', ')
        FROM (
            SELECT DISTINCT artist.name as artist_name
            FROM album_songz als
            JOIN artist_songz ars ON als.song_id = ars.song_id
            JOIN artistz artist ON ars.artist_id = artist.id
            WHERE als.album_id = album.id AND artist.deleted_at IS NULL
        )
    ), ''),
    COALESCE((
        SELECT GROUP_CONCAT(genre_name, ', ')
        FROM (
            SELECT DISTINCT g.name as genre_name
            FROM album_genrez ag
            JOIN genrez g ON ag.genre_id = g.id
            WHERE ag.album_id = album.id AND g.deleted_at IS NULL
        )
    ), ''),
    '' -- sub_genre_names deprecated
FROM albumz album
WHERE album.deleted_at IS NULL;

-- clear and repopulate playlistz_fts
DELETE FROM playlistz_fts;
INSERT INTO playlistz_fts(playlist_id, title, description)
SELECT id, title, COALESCE(description, '')
FROM playlistz
WHERE deleted_at IS NULL;

-- clear and repopulate genrez_fts (already done in triggers but ensure complete)
DELETE FROM genrez_fts;
INSERT INTO genrez_fts(genre_id, name)
SELECT id, name
FROM genrez
WHERE deleted_at IS NULL;

-- artistz_fts should be populated already via triggers, but ensure complete
DELETE FROM artistz_fts;
INSERT INTO artistz_fts(artist_id, name, genre_names)
SELECT
    artist.id,
    artist.name,
    COALESCE((
        SELECT GROUP_CONCAT(genre_name, ', ')
        FROM (
            SELECT DISTINCT g.name as genre_name
            FROM artist_songz ars
            JOIN album_songz als ON ars.song_id = als.song_id
            JOIN albumz a ON als.album_id = a.id
            JOIN album_genrez ag ON a.id = ag.album_id
            JOIN genrez g ON ag.genre_id = g.id
            WHERE ars.artist_id = artist.id AND g.deleted_at IS NULL
        )
    ), '')
FROM artistz artist
WHERE artist.deleted_at IS NULL;
