-- playlist query views for sea-query integration

-- playlist query view with aggregated stats
CREATE VIEW playlist_query_view AS
SELECT
    pl.id as playlist_id,
    pl.title as playlist_title,
    pl.description as playlist_description,
    pl.is_public as playlist_is_public,
    pl.thumbnail_blob_id as playlist_thumbnail_blob_id,
    pl.created_by_id as playlist_created_by_id,
    pl.created_at as playlist_created_at,
    pl.updated_at as playlist_updated_at,
    pl.deleted_at as playlist_deleted_at,

    -- aggregated stats
    COUNT(ps.song_id) as playlist_song_count,
    COALESCE(SUM(s.duration), 0) as playlist_total_duration,

    -- user favorites (no ratings for playlists)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM playlistz pl
LEFT JOIN playlist_songz ps ON pl.id = ps.playlist_id
LEFT JOIN songz s ON ps.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'playlist' AND uf.target_id = pl.id
WHERE pl.deleted_at IS NULL
GROUP BY pl.id, pl.title, pl.description, pl.is_public, pl.thumbnail_blob_id,
         pl.created_by_id, pl.created_at, pl.updated_at, pl.deleted_at, uf.id, uf.user_id, uf.created_at;

-- playlist songs view with position-based ordering and full song metadata
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- full song fields (same as song_query_view)
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

    -- user favorites and ratings for songs in playlists
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM playlist_songz ps
JOIN playlistz pl ON ps.playlist_id = pl.id AND pl.deleted_at IS NULL
JOIN songz s ON ps.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id;

-- indexes for playlist views
CREATE INDEX idx_playlist_query_view_title ON playlistz(title, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_created_at ON playlistz(created_at DESC, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_updated_at ON playlistz(updated_at DESC, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlist_query_view_public ON playlistz(is_public, deleted_at) WHERE deleted_at IS NULL AND is_public = 1;
CREATE INDEX idx_playlist_song_query_view_playlist ON playlist_songz(playlist_id, position);
CREATE INDEX idx_playlist_song_query_view_position ON playlist_songz(position);
