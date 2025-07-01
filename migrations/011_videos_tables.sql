-- Videos Domain Tables
-- This migration creates the core videos domain table for video metadata and organization

-- Create videos table for video domain
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id VARCHAR(16) NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id VARCHAR(16) REFERENCES media_blobs(id) ON DELETE SET NULL,
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

-- Create table for video chapters/bookmarks
CREATE TABLE video_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time INTERVAL NOT NULL,
    end_time INTERVAL,
    description TEXT,
    thumbnail_blob_id VARCHAR(16) REFERENCES media_blobs(id) ON DELETE SET NULL,
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
