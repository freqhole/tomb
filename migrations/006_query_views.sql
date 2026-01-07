-- query views for simplified song queries with proper track ordering

-- main song query view with all related data pre-joined
CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    s.thumbnail_blob_id as song_thumbnail_blob_id,
    s.waveform_blob_id as song_waveform_blob_id,
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

    -- artist fields (primary artist via artist_songz)
    ar.id as artist_id,
    ar.name as artist_name,
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

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
WHERE s.deleted_at IS NULL;

-- artist query view with aggregated song/album stats
CREATE VIEW artist_query_view AS
SELECT
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- aggregated stats
    COUNT(DISTINCT ars.song_rowid) as song_count,
    COUNT(DISTINCT aa.album_rowid) as album_count,
    COALESCE(SUM(s.duration), 0) as total_duration

FROM artistz ar
LEFT JOIN artist_songz ars ON ar.id = ars.artist_id
LEFT JOIN songz s ON ars.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN artist_albumz aa ON ar.id = aa.artist_id
LEFT JOIN albumz al ON aa.album_id = al.id AND al.deleted_at IS NULL
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.created_at, ar.updated_at, ar.deleted_at, ar.deleted_by, ar.created_by, ar.updated_by;

-- album query view with aggregated stats and primary artist
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

    -- primary artist (first alphabetically for consistency)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at

FROM albumz al
LEFT JOIN artist_albumz aa ON al.id = aa.album_id
LEFT JOIN artistz ar ON aa.artist_id = ar.id AND ar.deleted_at IS NULL
WHERE al.deleted_at IS NULL
-- get primary artist (first one alphabetically for deterministic results)
AND (ar.id IS NULL OR ar.id = (
    SELECT aa2.artist_id
    FROM artist_albumz aa2
    JOIN artistz ar2 ON aa2.artist_id = ar2.id AND ar2.deleted_at IS NULL
    WHERE aa2.album_id = al.id
    ORDER BY ar2.name ASC
    LIMIT 1
));

-- genre query view (simple, no complex joins needed)
CREATE VIEW genre_query_view AS
SELECT
    id as genre_id,
    name as genre_name,
    created_at as genre_created_at
FROM genrez;

-- indexes for view performance
CREATE INDEX idx_song_query_view_search ON songz(title, created_at DESC);
CREATE INDEX idx_song_query_view_album_tracks ON songz(deleted_at, disc_number, track_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_artist_query_view_name ON artistz(name, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_album_query_view_title ON albumz(title, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_album_query_view_release_date ON albumz(release_date DESC, deleted_at) WHERE deleted_at IS NULL;
