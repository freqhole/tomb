-- Fix get_popular_songs_by_period function to work with new song_play_summary schema

CREATE OR REPLACE FUNCTION public.get_popular_songs_by_period(
    period_hours integer,
    limit_count integer,
    min_plays integer
) RETURNS TABLE(
    media_blob_id text,
    domain_ids text[],
    play_count bigint,
    unique_users bigint,
    completion_rate double precision,
    momentum_score double precision,
    first_play_at timestamp with time zone,
    latest_play_at timestamp with time zone,
    song_id uuid,
    title text,
    artist text,
    album text,
    duration integer,
    year integer,
    genre text,
    sub_genres text[],
    file_size bigint,
    sample_rate integer,
    bit_rate integer,
    channels integer,
    codec text,
    created_at timestamp with time zone
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        sps.media_blob_id::text,
        ARRAY[sps.media_blob_id]::text[] as domain_ids,
        sps.total_plays as play_count,
        sps.unique_users,
        sps.avg_completion_rate::double precision as completion_rate,
        0.0::double precision as momentum_score,
        sps.first_play_at,
        sps.latest_play_at,
        sps.song_id,
        sps.title,
        sps.artist,
        sps.album,
        EXTRACT(EPOCH FROM sps.duration_seconds)::integer as duration,
        sps.year,
        sps.genre,
        sps.sub_genres,
        0::bigint as file_size,
        0 as sample_rate,
        0 as bit_rate,
        0 as channels,
        ''::text as codec,
        sps.created_at
    FROM song_play_summary sps
    WHERE sps.total_plays >= min_plays
    ORDER BY sps.total_plays DESC
    LIMIT limit_count;
END;
$$;

-- Update function comment
COMMENT ON FUNCTION get_popular_songs_by_period IS 'Returns popular songs by play count from materialized view for analytics dashboard';
