-- Fix thumbnail_jobs schema to match trigger expectations
-- This migration adds the columns that the notify_thumbnail_job_change() trigger expects

-- Add missing columns to thumbnail_jobs table
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS media_blob_id UUID;
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS priority VARCHAR(20);
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE thumbnail_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add foreign key constraint for media_blob_id
ALTER TABLE thumbnail_jobs ADD CONSTRAINT fk_thumbnail_jobs_media_blob_id
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_media_blob_id ON thumbnail_jobs(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_status ON thumbnail_jobs(status);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_priority ON thumbnail_jobs(priority);

-- Add check constraints for valid values
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_status
    CHECK (status IS NULL OR status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_priority
    CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent'));

-- Add check constraints for dimensions
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_width
    CHECK (width IS NULL OR width > 0);

ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_height
    CHECK (height IS NULL OR height > 0);

-- Add comments for documentation
COMMENT ON COLUMN thumbnail_jobs.media_blob_id IS 'ID of the media blob this thumbnail job is for';
COMMENT ON COLUMN thumbnail_jobs.status IS 'Current status of the thumbnail generation job';
COMMENT ON COLUMN thumbnail_jobs.priority IS 'Processing priority of the job';
COMMENT ON COLUMN thumbnail_jobs.width IS 'Target width for the generated thumbnail';
COMMENT ON COLUMN thumbnail_jobs.height IS 'Target height for the generated thumbnail';
COMMENT ON COLUMN thumbnail_jobs.started_at IS 'Timestamp when job processing started';
COMMENT ON COLUMN thumbnail_jobs.completed_at IS 'Timestamp when job processing completed';

-- Update any existing jobs to populate the new columns from metadata
-- This handles the case where there might be existing jobs with data in metadata
UPDATE thumbnail_jobs SET
    media_blob_id = (metadata->>'media_blob_id')::UUID,
    status = COALESCE(metadata->>'status', 'pending'),
    priority = COALESCE(metadata->>'priority', 'normal'),
    width = (metadata->'target_dimensions'->>'width')::INTEGER,
    height = (metadata->'target_dimensions'->>'height')::INTEGER
WHERE media_blob_id IS NULL
AND metadata->>'media_blob_id' IS NOT NULL;

-- Create a view that combines both old and new approaches for transition period
CREATE OR REPLACE VIEW thumbnail_jobs_enhanced AS
SELECT
    id,
    COALESCE(media_blob_id, (metadata->>'media_blob_id')::UUID) as media_blob_id,
    COALESCE(status, metadata->>'status', 'pending') as status,
    COALESCE(priority, metadata->>'priority', 'normal') as priority,
    COALESCE(width, (metadata->'target_dimensions'->>'width')::INTEGER) as width,
    COALESCE(height, (metadata->'target_dimensions'->>'height')::INTEGER) as height,
    started_at,
    completed_at,
    error_message,
    state,
    task_type,
    uniq_hash,
    retries,
    scheduled_at,
    created_at,
    updated_at,
    metadata
FROM thumbnail_jobs;

COMMENT ON VIEW thumbnail_jobs_enhanced IS 'Enhanced view that handles both column-based and metadata-based job data during schema transition';
