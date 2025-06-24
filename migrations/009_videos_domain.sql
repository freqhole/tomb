-- Videos Domain Table
-- This migration creates the videos domain table for video metadata and organization

-- Create videos table for video domain
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    duration INTERVAL,
    width_px INTEGER CHECK (width_px > 0),
    height_px INTEGER CHECK (height_px > 0),
    fps DECIMAL(5,2) CHECK (fps > 0),
    bitrate INTEGER CHECK (bitrate > 0),
    video_codec TEXT,
    audio_codec TEXT,
    container_format TEXT,
    is_hdr BOOLEAN DEFAULT false,
    color_profile TEXT,
    audio_channels INTEGER CHECK (audio_channels > 0),
    audio_sample_rate INTEGER CHECK (audio_sample_rate > 0),
    subtitles_available BOOLEAN DEFAULT false,
    watch_progress INTERVAL DEFAULT INTERVAL '0 seconds',
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_favorite BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for videos table
COMMENT ON TABLE videos IS 'Videos domain: video metadata, technical specifications, and playback info';
COMMENT ON COLUMN videos.media_blob_id IS 'Reference to the actual video file blob';
COMMENT ON COLUMN videos.thumbnail_blob_id IS 'Reference to video thumbnail/poster frame blob';
COMMENT ON COLUMN videos.duration IS 'Video duration as interval';
COMMENT ON COLUMN videos.width_px IS 'Video width in pixels';
COMMENT ON COLUMN videos.height_px IS 'Video height in pixels';
COMMENT ON COLUMN videos.fps IS 'Frame rate (frames per second)';
COMMENT ON COLUMN videos.bitrate IS 'Video bitrate in kbps';
COMMENT ON COLUMN videos.video_codec IS 'Video codec (H.264, H.265, VP9, AV1, etc.)';
COMMENT ON COLUMN videos.audio_codec IS 'Audio codec (AAC, MP3, Opus, etc.)';
COMMENT ON COLUMN videos.container_format IS 'Container format (mp4, mkv, webm, avi, etc.)';
COMMENT ON COLUMN videos.is_hdr IS 'Whether video contains HDR content';
COMMENT ON COLUMN videos.color_profile IS 'Color profile/space (Rec. 709, Rec. 2020, etc.)';
COMMENT ON COLUMN videos.audio_channels IS 'Number of audio channels (2=stereo, 6=5.1, 8=7.1, etc.)';
COMMENT ON COLUMN videos.audio_sample_rate IS 'Audio sample rate in Hz (44100, 48000, etc.)';
COMMENT ON COLUMN videos.subtitles_available IS 'Whether video has embedded or external subtitles';
COMMENT ON COLUMN videos.watch_progress IS 'How far user has watched through the video';
COMMENT ON COLUMN videos.tags IS 'User-defined tags for organization';
COMMENT ON COLUMN videos.metadata IS 'Extended metadata (chapters, subtitles, streams info, etc.)';

-- Create indexes for videos table
CREATE INDEX idx_videos_media_blob_id ON videos(media_blob_id);
CREATE INDEX idx_videos_title ON videos(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_duration ON videos(duration) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_video_codec ON videos(video_codec) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_container_format ON videos(container_format) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_rating ON videos(rating) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_is_favorite ON videos(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_is_hdr ON videos(is_hdr) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_deleted_at ON videos(deleted_at);
CREATE INDEX idx_videos_active ON videos(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_version ON videos(version);
CREATE INDEX idx_videos_created_at ON videos(created_at) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_videos_dimensions ON videos(width_px, height_px) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_technical ON videos(video_codec, container_format) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_audio_info ON videos(audio_codec, audio_channels, audio_sample_rate) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_quality ON videos(width_px, height_px, bitrate) WHERE deleted_at IS NULL;

-- Index for finding videos with progress
CREATE INDEX idx_videos_in_progress ON videos(watch_progress, updated_at)
    WHERE watch_progress > INTERVAL '0 seconds' AND deleted_at IS NULL;

-- GIN index for tags array
CREATE INDEX idx_videos_tags ON videos USING GIN(tags) WHERE deleted_at IS NULL;

-- GIN index for metadata JSONB
CREATE INDEX idx_videos_metadata ON videos USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create view for active videos
CREATE VIEW active_videos AS
SELECT * FROM videos WHERE deleted_at IS NULL;

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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

-- Create table for video chapters/bookmarks
CREATE TABLE video_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time INTERVAL NOT NULL,
    end_time INTERVAL,
    description TEXT,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    chapter_type VARCHAR(20) DEFAULT 'user' CHECK (chapter_type IN ('user', 'auto', 'imported')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for video_chapters table
COMMENT ON TABLE video_chapters IS 'Video chapters and bookmarks for navigation';
COMMENT ON COLUMN video_chapters.start_time IS 'Chapter start time from beginning of video';
COMMENT ON COLUMN video_chapters.end_time IS 'Chapter end time (NULL for auto-determined)';
COMMENT ON COLUMN video_chapters.chapter_type IS 'Source of chapter: user-created, auto-generated, or imported';

-- Create indexes for video_chapters
CREATE INDEX idx_video_chapters_video_id ON video_chapters(video_id);
CREATE INDEX idx_video_chapters_start_time ON video_chapters(video_id, start_time);
CREATE INDEX idx_video_chapters_type ON video_chapters(chapter_type);

-- Create trigger for video_chapters updated_at
CREATE TRIGGER update_video_chapters_updated_at
    BEFORE UPDATE ON video_chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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
