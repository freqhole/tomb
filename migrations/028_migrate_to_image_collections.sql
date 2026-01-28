-- remove singular blob_id fields and use *_imagez tables exclusively
-- clean refactor - no backward compatibility, no data preservation

-- drop triggers first
DROP TRIGGER IF EXISTS trg_songz_updated_at;
DROP TRIGGER IF EXISTS update_album_stats_song_duration;
DROP TRIGGER IF EXISTS songz_fts_insert;
DROP TRIGGER IF EXISTS songz_fts_update;
DROP TRIGGER IF EXISTS songz_fts_delete;
DROP TRIGGER IF EXISTS trg_playlist_songz_auto_append;
DROP TRIGGER IF EXISTS trg_playlist_songz_close_gaps_on_delete;
DROP TRIGGER IF EXISTS trg_playlistz_updated_at;

-- drop and recreate songz without thumbnail_blob_id and waveform_blob_id
DROP TABLE songz;
CREATE TABLE songz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT NOT NULL,
  track_number INTEGER NOT NULL DEFAULT 1,
  disc_number INTEGER NOT NULL DEFAULT 1,
  duration INTEGER,
  year INTEGER,
  bpm INTEGER,
  key_signature TEXT,
  metadata TEXT,
  lyrics TEXT,
  processing_status TEXT DEFAULT 'unprocessed',
  processing_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  CHECK (bpm >= 0 AND bpm <= 999),
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

-- recreate indexes for songz
CREATE INDEX idx_songz_title ON songz(title);
CREATE INDEX idx_songz_media_blob_id ON songz(media_blob_id);
CREATE INDEX idx_songz_processing_status ON songz(processing_status);
CREATE INDEX idx_songz_created_at ON songz(created_at DESC);
CREATE INDEX idx_songz_deleted_at ON songz(deleted_at) WHERE deleted_at IS NOT NULL;

-- recreate songs_fts table (dropped when songz was dropped)
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    id UNINDEXED,
    title,
    lyrics,
    metadata,
    content=songz,
    content_rowid=rowid
);

-- recreate songz triggers
CREATE TRIGGER trg_songz_updated_at
AFTER UPDATE ON songz
FOR EACH ROW
BEGIN
  UPDATE songz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER update_album_stats_song_duration
AFTER UPDATE OF duration ON songz
BEGIN
  UPDATE albumz
  SET total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.id = acs.song_id
    WHERE acs.album_id IN (
      SELECT album_id FROM album_songz WHERE song_id = NEW.id
    )
  )
  WHERE id IN (
    SELECT album_id FROM album_songz WHERE song_id = NEW.id
  );
END;

-- recreate FTS triggers for songz (from migration 014)
CREATE TRIGGER IF NOT EXISTS songz_fts_insert AFTER INSERT ON songz
BEGIN
  INSERT INTO songs_fts (
    rowid, id, title, lyrics, metadata
  ) VALUES (
    NEW.rowid, NEW.id, NEW.title, NEW.lyrics, NEW.metadata
  );
END;

CREATE TRIGGER IF NOT EXISTS songz_fts_update AFTER UPDATE ON songz
BEGIN
  UPDATE songs_fts SET
    id = NEW.id,
    title = NEW.title,
    lyrics = NEW.lyrics,
    metadata = NEW.metadata
  WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER IF NOT EXISTS songz_fts_delete AFTER DELETE ON songz
BEGIN
  DELETE FROM songs_fts WHERE rowid = OLD.rowid;
END;

-- drop and recreate playlistz without thumbnail_blob_id
DROP TABLE playlistz;
CREATE TABLE playlistz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  created_by_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

-- recreate indexes for playlistz
CREATE INDEX idx_playlistz_title ON playlistz(title);
CREATE INDEX idx_playlistz_created_by ON playlistz(created_by_id);
CREATE INDEX idx_playlistz_created_at ON playlistz(created_at DESC);
CREATE INDEX idx_playlistz_public ON playlistz(is_public) WHERE is_public = 1;
CREATE INDEX idx_playlistz_deleted_at ON playlistz(deleted_at) WHERE deleted_at IS NOT NULL;

-- recreate playlistz triggers
CREATE TRIGGER trg_playlistz_updated_at
AFTER UPDATE ON playlistz
FOR EACH ROW
BEGIN
  UPDATE playlistz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- recreate playlist_songz triggers (from migration 008)
CREATE TRIGGER trg_playlist_songz_auto_append
AFTER INSERT ON playlist_songz
WHEN NEW.position IS NULL OR NEW.position = 0
BEGIN
  UPDATE playlist_songz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_songz
    WHERE playlist_id = NEW.playlist_id
  )
  WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trg_playlist_songz_close_gaps_on_delete
AFTER DELETE ON playlist_songz
BEGIN
  UPDATE playlist_songz
  SET position = position - 1
  WHERE playlist_id = OLD.playlist_id
    AND position > OLD.position;
END;

-- update query views to remove singular thumbnail/waveform blob_id fields
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;

-- recreate song_query_view without thumbnail_blob_id and waveform_blob_id
CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
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

    -- images as JSON array from song_imagez table
    (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
     FROM song_imagez si
     JOIN media_blobz mb ON si.media_blob_id = mb.id
     WHERE si.song_id = s.id) as song_images,

    -- artist fields (primary artist via artist_songz)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_id as album_genre_id,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- album tags as JSON array
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id
     ORDER BY t.name ASC) as album_tags,

    -- album images as JSON array from album_imagez table
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
     FROM album_imagez ai
     JOIN media_blobz mb ON ai.media_blob_id = mb.id
     WHERE ai.album_id = al.id) as album_images,

    -- song favorites
    (SELECT COUNT(*) FROM user_favoritez uf WHERE uf.target_type = 'song' AND uf.target_id = s.id) as song_is_favorite,

    -- album favorites
    (SELECT COUNT(*) FROM user_favoritez uf WHERE uf.target_type = 'album' AND uf.target_id = al.id) as album_is_favorite,

    -- song ratings
    (SELECT ur.rating FROM user_ratingz ur WHERE ur.target_type = 'song' AND ur.target_id = s.id LIMIT 1) as song_rating,

    -- album ratings
    (SELECT ur.rating FROM user_ratingz ur WHERE ur.target_type = 'album' AND ur.target_id = al.id LIMIT 1) as album_rating

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id
LEFT JOIN genrez g ON al.genre_id = g.id
WHERE s.deleted_at IS NULL;

-- recreate playlist_song_query_view without thumbnail_blob_id and waveform_blob_id
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist_songz fields
    ps.playlist_id,
    ps.song_id,
    ps.position,
    ps.added_at,
    ps.added_by,

    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
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

    -- images as JSON array from song_imagez table
    (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
     FROM song_imagez si
     JOIN media_blobz mb ON si.media_blob_id = mb.id
     WHERE si.song_id = s.id) as song_images,

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

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_id as album_genre_id,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- album tags as JSON array
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id
     ORDER BY t.name ASC) as album_tags,

    -- album images as JSON array
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
     FROM album_imagez ai
     JOIN media_blobz mb ON ai.media_blob_id = mb.id
     WHERE ai.album_id = al.id) as album_images,

    -- song favorites
    (SELECT COUNT(*) FROM user_favoritez uf WHERE uf.target_type = 'song' AND uf.target_id = s.id) as song_is_favorite,

    -- album favorites
    (SELECT COUNT(*) FROM user_favoritez uf WHERE uf.target_type = 'album' AND uf.target_id = al.id) as album_is_favorite,

    -- song ratings
    (SELECT ur.rating FROM user_ratingz ur WHERE ur.target_type = 'song' AND ur.target_id = s.id LIMIT 1) as song_rating,

    -- album ratings
    (SELECT ur.rating FROM user_ratingz ur WHERE ur.target_type = 'album' AND ur.target_id = al.id LIMIT 1) as album_rating

FROM playlist_songz ps
INNER JOIN songz s ON ps.song_id = s.id
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id
LEFT JOIN genrez g ON al.genre_id = g.id
WHERE s.deleted_at IS NULL
ORDER BY ps.playlist_id, ps.position;

-- update artist_query_view to include blob_type
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
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
     FROM artist_imagez ai
     JOIN media_blobz mb ON ai.media_blob_id = mb.id
     WHERE ai.artist_id = ar.id) as artist_images,

    -- aggregated stats
    COUNT(DISTINCT ars.song_id) as song_count,
    COUNT(DISTINCT aa.album_id) as album_count,
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
LEFT JOIN artist_albumz aa ON ar.id = aa.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'artist' AND uf.target_id = ar.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'artist' AND ur.target_id = ar.id
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.bio, ar.created_at, ar.updated_at, ar.deleted_at,
         ar.deleted_by, ar.created_by, ar.updated_by, uf.id, uf.user_id, uf.created_at,
         ur.user_id, ur.rating, ur.created_at;

-- update album_query_view to include blob_type
DROP VIEW IF EXISTS album_query_view;

CREATE VIEW album_query_view AS
SELECT
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_id as album_genre_id,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- images as JSON array with blob_type
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
     FROM album_imagez ai
     JOIN media_blobz mb ON ai.media_blob_id = mb.id
     WHERE ai.album_id = al.id) as album_images,

    -- album tags as JSON array
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id AND t.deleted_at IS NULL
     ORDER BY t.name ASC) as album_tags,

    -- primary artist
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- user favorites and ratings
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM albumz al
LEFT JOIN genrez g ON al.genre_id = g.id
LEFT JOIN artist_albumz aa ON al.id = aa.album_id
LEFT JOIN artistz ar ON aa.artist_id = ar.id
LEFT JOIN user_favoritez uf ON uf.target_type = 'album' AND uf.target_id = al.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'album' AND ur.target_id = al.id
WHERE al.deleted_at IS NULL
GROUP BY al.id, al.title, al.album_type, al.release_date, al.release_date_precision,
         al.label, al.genre_id, al.song_count, al.total_duration, al.created_at, al.updated_at,
         al.deleted_at, al.deleted_by, al.created_by, al.updated_by, g.name,
         ar.id, ar.name, ar.created_at, ar.updated_at, ar.deleted_at, ar.deleted_by, ar.created_by, ar.updated_by,
         uf.id, uf.user_id, uf.created_at, ur.user_id, ur.rating, ur.created_at;

-- update playlist_query_view to remove thumbnail_blob_id and use playlist_imagez
DROP VIEW IF EXISTS playlist_query_view;

CREATE VIEW playlist_query_view AS
SELECT
    pl.id as playlist_id,
    pl.title as playlist_title,
    pl.description as playlist_description,
    pl.is_public as playlist_is_public,
    pl.created_by_id as playlist_created_by_id,
    pl.created_at as playlist_created_at,
    pl.updated_at as playlist_updated_at,
    pl.deleted_at as playlist_deleted_at,
    pl.deleted_by as playlist_deleted_by,
    pl.created_by as playlist_created_by,
    pl.updated_by as playlist_updated_by,

    -- images as JSON array with blob_type
    (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
     FROM playlist_imagez pi
     JOIN media_blobz mb ON pi.media_blob_id = mb.id
     WHERE pi.playlist_id = pl.id) as playlist_images,

    -- aggregated stats
    COUNT(ps.song_id) as playlist_song_count,
    COALESCE(SUM(s.duration), 0) as playlist_total_duration,

    -- user favorites
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM playlistz pl
LEFT JOIN playlist_songz ps ON pl.id = ps.playlist_id
LEFT JOIN songz s ON ps.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'playlist' AND uf.target_id = pl.id
WHERE pl.deleted_at IS NULL
GROUP BY pl.id, pl.title, pl.description, pl.is_public, pl.created_by_id,
         pl.created_at, pl.updated_at, pl.deleted_at, uf.id, uf.user_id, uf.created_at;

