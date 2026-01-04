-- Videos Domain Functions and Views
-- This migration creates views, functions, triggers, and utilities for the videos domain

-- Create triggers for updated_at timestamp
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_video_chapters_updated_at
    BEFORE UPDATE ON video_chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for active videos
CREATE VIEW active_videos AS
SELECT * FROM videos WHERE deleted_at IS NULL;

-- Create view for videos with file information
CREATE VIEW videos_with_files AS
SELECT
    v.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM videos v
JOIN media_blobs mb ON v.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON v.thumbnail_blob_id = thumb.id
WHERE v.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Function to calculate video aspect ratio
CREATE OR REPLACE FUNCTION video_aspect_ratio(width INTEGER, height INTEGER)
RETURNS DECIMAL(10,6) AS $$
BEGIN
    IF height = 0 OR height IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN width::DECIMAL / height::DECIMAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to categorize video quality
CREATE OR REPLACE FUNCTION video_quality_category(width INTEGER, height INTEGER)
RETURNS TEXT AS $$
BEGIN
    IF width IS NULL OR height IS NULL THEN
        RETURN 'unknown';
    END IF;

    -- Standard definitions based on height
    IF height >= 2160 THEN
        RETURN '4K';
    ELSIF height >= 1440 THEN
        RETURN '1440p';
    ELSIF height >= 1080 THEN
        RETURN '1080p';
    ELSIF height >= 720 THEN
        RETURN '720p';
    ELSIF height >= 480 THEN
        RETURN '480p';
    ELSE
        RETURN 'SD';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to format video technical info
CREATE OR REPLACE FUNCTION format_video_info(
    width INTEGER,
    height INTEGER,
    fps DECIMAL,
    codec TEXT,
    container TEXT
)
RETURNS TEXT AS $$
BEGIN
    RETURN TRIM(CONCAT_WS(' ',
        CASE
            WHEN width IS NOT NULL AND height IS NOT NULL
            THEN CONCAT(width, 'x', height)
        END,
        CASE
            WHEN fps IS NOT NULL
            THEN CONCAT(fps, 'fps')
        END,
        codec,
        CASE
            WHEN container IS NOT NULL
            THEN CONCAT('(', container, ')')
        END
    ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate watch progress percentage
CREATE OR REPLACE FUNCTION video_progress_percentage(progress INTERVAL, total_duration INTERVAL)
RETURNS DECIMAL(5,2) AS $$
BEGIN
    IF total_duration IS NULL OR total_duration = INTERVAL '0 seconds' THEN
        RETURN 0;
    END IF;

    RETURN (EXTRACT(EPOCH FROM progress) / EXTRACT(EPOCH FROM total_duration) * 100)::DECIMAL(5,2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to find videos by quality and codec
CREATE OR REPLACE FUNCTION find_videos_by_specs(
    min_width INTEGER DEFAULT NULL,
    min_height INTEGER DEFAULT NULL,
    codec_filter TEXT DEFAULT NULL,
    container_filter TEXT DEFAULT NULL,
    max_results INTEGER DEFAULT 100
)
RETURNS TABLE (
    video_id UUID,
    title TEXT,
    width_px INTEGER,
    height_px INTEGER,
    video_codec TEXT,
    container_format TEXT,
    quality_category TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id,
        v.title,
        v.width_px,
        v.height_px,
        v.video_codec,
        v.container_format,
        video_quality_category(v.width_px, v.height_px)
    FROM videos v
    WHERE v.deleted_at IS NULL
    AND (min_width IS NULL OR v.width_px >= min_width)
    AND (min_height IS NULL OR v.height_px >= min_height)
    AND (codec_filter IS NULL OR v.video_codec ILIKE '%' || codec_filter || '%')
    AND (container_filter IS NULL OR v.container_format ILIKE '%' || container_filter || '%')
    ORDER BY v.width_px DESC, v.height_px DESC, v.created_at DESC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Function to get video chapters in order
CREATE OR REPLACE FUNCTION get_video_chapters(video_uuid UUID)
RETURNS TABLE (
    chapter_id UUID,
    title TEXT,
    start_time INTERVAL,
    end_time INTERVAL,
    description TEXT,
    chapter_type VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vc.id,
        vc.title,
        vc.start_time,
        vc.end_time,
        vc.description,
        vc.chapter_type
    FROM video_chapters vc
    WHERE vc.video_id = video_uuid
    ORDER BY vc.start_time;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for video statistics (refresh as needed)
CREATE MATERIALIZED VIEW video_statistics AS
SELECT
    COUNT(*) as total_videos,
    COUNT(*) FILTER (WHERE duration IS NOT NULL) as videos_with_duration,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) as rated_videos,
    COUNT(*) FILTER (WHERE is_favorite = true) as favorite_videos,
    COUNT(*) FILTER (WHERE is_hdr = true) as hdr_videos,
    COUNT(*) FILTER (WHERE subtitles_available = true) as videos_with_subtitles,
    COUNT(*) FILTER (WHERE watch_progress > INTERVAL '0 seconds') as videos_with_progress,
    COUNT(DISTINCT video_codec) as unique_video_codecs,
    COUNT(DISTINCT container_format) as unique_container_formats,
    AVG(rating) as average_rating,
    SUM(EXTRACT(EPOCH FROM duration)) as total_duration_seconds,
    AVG(width_px * height_px) as average_resolution,
    MIN(width_px) as min_width,
    MAX(width_px) as max_width,
    MIN(height_px) as min_height,
    MAX(height_px) as max_height
FROM active_videos;

-- Create index on materialized view
CREATE UNIQUE INDEX idx_video_statistics_singleton ON video_statistics(total_videos);
