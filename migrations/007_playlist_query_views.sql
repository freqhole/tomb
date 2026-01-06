-- playlist query views for sea-query integration

-- playlist query view with aggregated stats
CREATE VIEW playlist_query_view AS
SELECT
    pl.rowid as playlist_rowid,
    pl.id as playlist_id,
    pl.title as playlist_title,
    pl.description as playlist_description,
    pl.is_public as playlist_is_public,
    pl.thumbnail_blob_id as playlist_thumbnail_blob_id,
    pl.created_by_rowid as playlist_created_by_rowid,
    pl.created_at as playlist_created_at,
    pl.updated_at as playlist_updated_at,
    pl.deleted_at as playlist_deleted_at,

    -- aggregated stats
    COUNT(ps.song_rowid) as playlist_song_count,
    COALESCE(SUM(s.duration), 0) as playlist_total_duration

FROM playlistz pl
LEFT JOIN playlist_songz ps ON pl.rowid = ps.playlist_rowid
LEFT JOIN songz s ON ps.song_rowid = s.rowid AND s.deleted_at IS NULL
WHERE pl.deleted_at IS NULL
GROUP BY pl.rowid, pl.id, pl.title, pl.description, pl.is_public, pl.thumbnail_blob_id,
         pl.created_by_rowid, pl.created_at, pl.updated_at, pl.deleted_at;

-- playlist songs view with position-based ordering and full song metadata
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- full song fields (same as song_query_view)
    s.rowid as song_rowid,
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
    ar.rowid as artist_rowid,
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- album fields
    al.rowid as album_rowid,
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_rowid as album_genre_rowid,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by

FROM playlist_songz ps
JOIN playlistz pl ON ps.playlist_rowid = pl.rowid AND pl.deleted_at IS NULL
JOIN songz s ON ps.song_rowid = s.rowid AND s.deleted_at IS NULL
LEFT JOIN artist_songz ars ON s.rowid = ars.song_rowid
LEFT JOIN artistz ar ON ars.artist_rowid = ar.rowid AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.rowid = als.song_rowid
LEFT JOIN albumz al ON als.album_rowid = al.rowid AND al.deleted_at IS NULL;

-- indexes for playlist views
CREATE INDEX idx_playlist_query_view_title ON playlistz(title, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_created_at ON playlistz(created_at DESC, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_updated_at ON playlistz(updated_at DESC, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_public ON playlistz(is_public, deleted_at) WHERE deleted_at IS NULL AND is_public = 1;
CREATE INDEX idx_playlist_song_query_view_playlist ON playlist_songz(playlist_rowid, position);
CREATE INDEX idx_playlist_song_query_view_position ON playlist_songz(position);
