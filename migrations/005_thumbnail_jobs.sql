-- Thumbnail Job Queue System (Consolidated)
-- This migration sets up the thumbnail job queue tables for asynchronous processing
-- with proper schema design to prevent race conditions and infinite loops

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing thumbnail_jobs table if it exists (for clean slate)
DROP TABLE IF EXISTS job_execution_log CASCADE;
DROP TABLE IF EXISTS thumbnail_jobs CASCADE;
DROP VIEW IF EXISTS job_queue_status CASCADE;
DROP VIEW IF EXISTS job_performance_metrics CASCADE;
DROP VIEW IF EXISTS thumbnail_jobs_enhanced CASCADE;

-- Create the main thumbnail_jobs table with proper schema
CREATE TABLE thumbnail_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core job identification
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL,

    -- Job status and processing
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    worker_id TEXT,

    -- Job parameters
    target_width INTEGER,
    target_height INTEGER,

    -- Timing and retries
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,

    -- Error handling
    error_message TEXT,

    -- Deduplication
    job_hash CHAR(64) GENERATED ALWAYS AS (
        encode(sha256((media_blob_id::text || ':' || job_type)::bytea), 'hex')
    ) STORED,

    -- Additional metadata (for extensibility)
    metadata JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE thumbnail_jobs IS 'Thumbnail job queue for asynchronous task processing with race condition prevention';
COMMENT ON COLUMN thumbnail_jobs.media_blob_id IS 'ID of the media blob this thumbnail job is for';
COMMENT ON COLUMN thumbnail_jobs.job_type IS 'Type of thumbnail: image_thumbnail, video_preview, video_thumbnail, audio_waveform';
COMMENT ON COLUMN thumbnail_jobs.status IS 'Job status: pending, in_progress, completed, failed, failed_permanently, cancelled';
COMMENT ON COLUMN thumbnail_jobs.priority IS 'Processing priority: low, normal, high, critical';
COMMENT ON COLUMN thumbnail_jobs.worker_id IS 'ID of the worker currently processing this job';
COMMENT ON COLUMN thumbnail_jobs.job_hash IS 'SHA-256 hash for deduplication based on media_blob_id:job_type';
COMMENT ON COLUMN thumbnail_jobs.scheduled_at IS 'When this job should be processed';
COMMENT ON COLUMN thumbnail_jobs.started_at IS 'When job processing actually started';
COMMENT ON COLUMN thumbnail_jobs.completed_at IS 'When job processing completed';

-- Create indexes for efficient job queue operations
CREATE INDEX idx_thumbnail_jobs_media_blob_id ON thumbnail_jobs(media_blob_id);
CREATE INDEX idx_thumbnail_jobs_job_type ON thumbnail_jobs(job_type);
CREATE INDEX idx_thumbnail_jobs_status ON thumbnail_jobs(status);
CREATE INDEX idx_thumbnail_jobs_priority ON thumbnail_jobs(priority);
CREATE INDEX idx_thumbnail_jobs_scheduled_at ON thumbnail_jobs(scheduled_at);
CREATE INDEX idx_thumbnail_jobs_created_at ON thumbnail_jobs(created_at);
CREATE INDEX idx_thumbnail_jobs_updated_at ON thumbnail_jobs(updated_at);
CREATE INDEX idx_thumbnail_jobs_worker_id ON thumbnail_jobs(worker_id) WHERE worker_id IS NOT NULL;

-- Index for finding jobs ready to process with proper locking
CREATE INDEX idx_thumbnail_jobs_ready ON thumbnail_jobs(priority DESC, scheduled_at ASC)
    WHERE status = 'pending';

-- Unique index for job deduplication - prevents duplicate jobs for same blob+type
CREATE UNIQUE INDEX idx_thumbnail_jobs_dedup ON thumbnail_jobs(media_blob_id, job_type)
    WHERE status IN ('pending', 'in_progress');

-- Index for monitoring failed jobs
CREATE INDEX idx_thumbnail_jobs_failed ON thumbnail_jobs(job_type, created_at)
    WHERE status IN ('failed', 'failed_permanently');

-- Add constraints for valid values
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'failed_permanently', 'cancelled'));

ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_priority
    CHECK (priority IN ('low', 'normal', 'high', 'critical'));

-- Add constraints for dimensions
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_target_width
    CHECK (target_width IS NULL OR target_width > 0);

ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_target_height
    CHECK (target_height IS NULL OR target_height > 0);

-- Add constraint for retry logic
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_jobs_retry_count
    CHECK (retry_count >= 0 AND retry_count <= max_retries);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER trigger_thumbnail_jobs_updated_at
    BEFORE UPDATE ON thumbnail_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create table for tracking job execution history/metrics
CREATE TABLE job_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES thumbnail_jobs(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    retry_attempt INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for job execution log
COMMENT ON TABLE job_execution_log IS 'Execution history and performance metrics for jobs';
COMMENT ON COLUMN job_execution_log.worker_id IS 'Identifier of the worker that processed this job';
COMMENT ON COLUMN job_execution_log.duration_ms IS 'Job execution time in milliseconds';
COMMENT ON COLUMN job_execution_log.retry_attempt IS 'Which retry attempt this execution represents';

-- Create indexes for job execution log
CREATE INDEX idx_job_execution_log_job_id ON job_execution_log(job_id);
CREATE INDEX idx_job_execution_log_started_at ON job_execution_log(started_at);
CREATE INDEX idx_job_execution_log_worker_id ON job_execution_log(worker_id);
CREATE INDEX idx_job_execution_log_success ON job_execution_log(success, started_at);

-- Function to atomically claim jobs for processing (prevents race conditions)
CREATE OR REPLACE FUNCTION claim_thumbnail_jobs(worker_id_param TEXT, limit_param INTEGER DEFAULT 1)
RETURNS TABLE (
    id UUID,
    media_blob_id UUID,
    job_type VARCHAR,
    target_width INTEGER,
    target_height INTEGER,
    retry_count INTEGER,
    max_retries INTEGER,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    UPDATE thumbnail_jobs
    SET
        status = 'in_progress',
        worker_id = worker_id_param,
        started_at = NOW(),
        updated_at = NOW()
    WHERE thumbnail_jobs.id IN (
        SELECT tj.id
        FROM thumbnail_jobs tj
        WHERE tj.status = 'pending'
        AND tj.scheduled_at <= NOW()
        ORDER BY tj.priority DESC, tj.scheduled_at ASC
        LIMIT limit_param
        FOR UPDATE SKIP LOCKED
    )
    RETURNING
        thumbnail_jobs.id,
        thumbnail_jobs.media_blob_id,
        thumbnail_jobs.job_type,
        thumbnail_jobs.target_width,
        thumbnail_jobs.target_height,
        thumbnail_jobs.retry_count,
        thumbnail_jobs.max_retries,
        thumbnail_jobs.metadata,
        thumbnail_jobs.created_at,
        thumbnail_jobs.scheduled_at;
END;
$$ LANGUAGE plpgsql;

-- Function to check if a job exists for a given media blob and job type
-- Checks both active jobs AND existing thumbnails to prevent duplicates
CREATE OR REPLACE FUNCTION job_exists_for_blob(blob_id UUID, job_type_param VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    -- First check if there are active jobs for this blob+type
    IF EXISTS(
        SELECT 1 FROM thumbnail_jobs
        WHERE media_blob_id = blob_id
        AND job_type = job_type_param
        AND status IN ('pending', 'in_progress')
    ) THEN
        RETURN TRUE;
    END IF;

    -- Then check if thumbnails already exist for this blob+type
    -- Map job types to blob types for thumbnail existence check
    CASE job_type_param
        WHEN 'image_thumbnail' THEN
            RETURN EXISTS(
                SELECT 1 FROM media_blobs
                WHERE parent_blob_id = blob_id
                AND blob_type = 'thumbnail'
            );
        WHEN 'video_thumbnail' THEN
            RETURN EXISTS(
                SELECT 1 FROM media_blobs
                WHERE parent_blob_id = blob_id
                AND blob_type = 'thumbnail'
            );
        WHEN 'video_preview' THEN
            RETURN EXISTS(
                SELECT 1 FROM media_blobs
                WHERE parent_blob_id = blob_id
                AND blob_type = 'preview'
            );
        WHEN 'audio_waveform' THEN
            RETURN EXISTS(
                SELECT 1 FROM media_blobs
                WHERE parent_blob_id = blob_id
                AND blob_type = 'waveform'
            );
        ELSE
            -- Unknown job type, check for any thumbnail
            RETURN EXISTS(
                SELECT 1 FROM media_blobs
                WHERE parent_blob_id = blob_id
                AND blob_type IN ('thumbnail', 'preview', 'waveform')
            );
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Create view for job queue monitoring
CREATE VIEW job_queue_status AS
SELECT
    job_type,
    status,
    COUNT(*) as count,
    AVG(retry_count) as avg_retries,
    MIN(created_at) as oldest_job,
    MAX(created_at) as newest_job
FROM thumbnail_jobs
GROUP BY job_type, status;

-- Create view for job performance metrics
CREATE VIEW job_performance_metrics AS
SELECT
    tj.job_type,
    COUNT(jel.id) as total_executions,
    AVG(jel.duration_ms) as avg_duration_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY jel.duration_ms) as median_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY jel.duration_ms) as p95_duration_ms,
    COUNT(*) FILTER (WHERE jel.success = true) as successful_count,
    COUNT(*) FILTER (WHERE jel.success = false) as failed_count,
    (COUNT(*) FILTER (WHERE jel.success = true) * 100.0 / NULLIF(COUNT(*), 0))::DECIMAL(5,2) as success_rate_percent
FROM thumbnail_jobs tj
LEFT JOIN job_execution_log jel ON tj.id = jel.job_id
WHERE jel.completed_at IS NOT NULL
GROUP BY tj.job_type;

-- Function to clean up old completed jobs (can be called by cron or maintenance tasks)
CREATE OR REPLACE FUNCTION cleanup_old_jobs(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete completed jobs older than specified days
    DELETE FROM thumbnail_jobs
    WHERE status IN ('completed', 'failed_permanently', 'cancelled')
    AND updated_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to retry failed jobs
CREATE OR REPLACE FUNCTION retry_failed_jobs(job_type_filter VARCHAR DEFAULT NULL, max_retries_param INTEGER DEFAULT 3)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE thumbnail_jobs
    SET
        status = 'pending',
        retry_count = retry_count + 1,
        scheduled_at = NOW() + INTERVAL '1 minute' * POWER(2, retry_count), -- Exponential backoff
        worker_id = NULL,
        started_at = NULL,
        error_message = NULL,
        updated_at = NOW()
    WHERE status = 'failed'
    AND retry_count < max_retries_param
    AND (job_type_filter IS NULL OR job_type = job_type_filter);

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to cancel stale in_progress jobs (jobs that have been processing too long)
CREATE OR REPLACE FUNCTION cancel_stale_jobs(timeout_minutes INTEGER DEFAULT 60)
RETURNS INTEGER AS $$
DECLARE
    cancelled_count INTEGER;
BEGIN
    UPDATE thumbnail_jobs
    SET
        status = 'failed',
        error_message = 'Job timed out after ' || timeout_minutes || ' minutes',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE status = 'in_progress'
    AND started_at < NOW() - INTERVAL '1 minute' * timeout_minutes;

    GET DIAGNOSTICS cancelled_count = ROW_COUNT;

    RETURN cancelled_count;
END;
$$ LANGUAGE plpgsql;

-- Add some sample data validation
-- Ensure we don't have any orphaned jobs
-- This would be in the application, but documenting here for reference
/*
Expected job_type values:
- 'image_thumbnail'
- 'video_thumbnail'
- 'video_preview'
- 'audio_waveform'
*/
