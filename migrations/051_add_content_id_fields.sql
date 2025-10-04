-- Add content_id fields for duplicate detection and tracking

-- Add content_id to download_jobs table for job coordination
ALTER TABLE download_jobs ADD COLUMN content_id TEXT;

-- Add index on content_id for efficient lookups
CREATE INDEX idx_download_jobs_content_id ON download_jobs(content_id);

-- Add content_id to media_blobs table for duplicate detection
ALTER TABLE media_blobs ADD COLUMN content_id TEXT;

-- Add unique index on content_id to prevent duplicate content
CREATE UNIQUE INDEX idx_media_blobs_content_id ON media_blobs(content_id) WHERE content_id IS NOT NULL;

-- Add index for efficient content_id lookups
CREATE INDEX idx_media_blobs_content_id_lookup ON media_blobs(content_id);
