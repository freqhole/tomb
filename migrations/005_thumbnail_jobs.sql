-- Thumbnail Job Queue System
-- This migration sets up the thumbnail job queue tables for asynchronous processing

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the main thumbnail_jobs table for job queue
CREATE TABLE thumbnail_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metadata JSONB NOT NULL,
    error_message TEXT,
    state VARCHAR(10) NOT NULL DEFAULT 'new',
    task_type VARCHAR(255) NOT NULL DEFAULT 'common',
    uniq_hash CHAR(64),
    retries INTEGER NOT NULL DEFAULT 0,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE thumbnail_jobs IS 'Thumbnail job queue for asynchronous task processing';
COMMENT ON COLUMN thumbnail_jobs.metadata IS 'JSON payload containing job data and parameters';
COMMENT ON COLUMN thumbnail_jobs.state IS 'Job state: new, in_progress, finished, failed, retried';
COMMENT ON COLUMN thumbnail_jobs.task_type IS 'Type of task: thumbnail_generation, media_processing, etc.';
COMMENT ON COLUMN thumbnail_jobs.uniq_hash IS 'SHA-256 hash for deduplication of identical jobs';
COMMENT ON COLUMN thumbnail_jobs.retries IS 'Number of retry attempts for failed jobs';
COMMENT ON COLUMN thumbnail_jobs.scheduled_at IS 'When this job should be processed';

-- Create indexes for efficient job queue operations
CREATE INDEX idx_thumbnail_jobs_state ON thumbnail_jobs(state);
CREATE INDEX idx_thumbnail_jobs_type ON thumbnail_jobs(task_type);
CREATE INDEX idx_thumbnail_jobs_scheduled_at ON thumbnail_jobs(scheduled_at);
CREATE INDEX idx_thumbnail_jobs_created_at ON thumbnail_jobs(created_at);
CREATE INDEX idx_thumbnail_jobs_updated_at ON thumbnail_jobs(updated_at);

-- Index for finding jobs ready to process
CREATE INDEX idx_thumbnail_jobs_ready ON thumbnail_jobs(scheduled_at, state)
    WHERE state = 'new' OR state = 'retried';

-- Index for job deduplication
CREATE UNIQUE INDEX idx_thumbnail_jobs_uniq_hash ON thumbnail_jobs(uniq_hash)
    WHERE uniq_hash IS NOT NULL AND state IN ('new', 'in_progress', 'retried');

-- Index for monitoring failed jobs
CREATE INDEX idx_thumbnail_jobs_failed ON thumbnail_jobs(task_type, created_at)
    WHERE state = 'failed';

-- Add constraint for valid states
ALTER TABLE thumbnail_jobs ADD CONSTRAINT chk_thumbnail_job_state
    CHECK (state IN ('new', 'in_progress', 'finished', 'failed', 'retried'));

-- Create trigger to update updated_at timestamp
-- Add trigger to automatically update updated_at on row changes
CREATE TRIGGER trigger_thumbnail_jobs_updated_at
    BEFORE UPDATE ON thumbnail_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create table for tracking job execution history/metrics
CREATE TABLE job_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES thumbnail_jobs(id) ON DELETE CASCADE,
    worker_id TEXT,
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
CREATE INDEX idx_job_execution_log_task_id ON job_execution_log(task_id);
CREATE INDEX idx_job_execution_log_started_at ON job_execution_log(started_at);
CREATE INDEX idx_job_execution_log_worker_id ON job_execution_log(worker_id);
CREATE INDEX idx_job_execution_log_success ON job_execution_log(success, started_at);

-- Create view for job queue monitoring
CREATE VIEW job_queue_status AS
SELECT
    task_type,
    state,
    COUNT(*) as count,
    AVG(retries) as avg_retries,
    MIN(created_at) as oldest_job,
    MAX(created_at) as newest_job
FROM thumbnail_jobs
GROUP BY task_type, state;

-- Create view for job performance metrics
CREATE VIEW job_performance_metrics AS
SELECT
    ft.task_type,
    COUNT(jel.id) as total_executions,
    AVG(jel.duration_ms) as avg_duration_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY jel.duration_ms) as median_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY jel.duration_ms) as p95_duration_ms,
    COUNT(*) FILTER (WHERE jel.success = true) as successful_count,
    COUNT(*) FILTER (WHERE jel.success = false) as failed_count,
    (COUNT(*) FILTER (WHERE jel.success = true) * 100.0 / COUNT(*))::DECIMAL(5,2) as success_rate_percent
FROM thumbnail_jobs ft
LEFT JOIN job_execution_log jel ON ft.id = jel.task_id
WHERE jel.completed_at IS NOT NULL
GROUP BY ft.task_type;

-- Function to clean up old completed jobs (can be called by cron or maintenance tasks)
CREATE OR REPLACE FUNCTION cleanup_old_jobs(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete completed jobs older than specified days
    DELETE FROM thumbnail_jobs
    WHERE state IN ('finished', 'failed')
    AND updated_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to retry failed jobs
CREATE OR REPLACE FUNCTION retry_failed_jobs(task_type_filter TEXT DEFAULT NULL, max_retries INTEGER DEFAULT 3)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE thumbnail_jobs
    SET
        state = 'retried',
        retries = retries + 1,
        scheduled_at = NOW(),
        updated_at = NOW()
    WHERE state = 'failed'
    AND retries < max_retries
    AND (task_type_filter IS NULL OR task_type = task_type_filter);

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;
