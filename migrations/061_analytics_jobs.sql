-- Analytics Jobs Table for Background Job Processing
-- This migration creates the analytics_jobs table for managing background analytics tasks

-- Create analytics_jobs table
CREATE TABLE analytics_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 5,
    job_data JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms BIGINT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3
);

-- Add comments for analytics_jobs table
COMMENT ON TABLE analytics_jobs IS 'Background job queue for analytics processing tasks';
COMMENT ON COLUMN analytics_jobs.id IS 'Unique job identifier';
COMMENT ON COLUMN analytics_jobs.job_type IS 'Type of analytics job: refresh_materialized_views, daily_rollup, weekly_trend_analysis, cleanup_old_events, analytics_milestones';
COMMENT ON COLUMN analytics_jobs.priority IS 'Job priority (lower number = higher priority)';
COMMENT ON COLUMN analytics_jobs.job_data IS 'Job-specific configuration and parameters';
COMMENT ON COLUMN analytics_jobs.status IS 'Job status: pending, processing, completed, failed';
COMMENT ON COLUMN analytics_jobs.scheduled_for IS 'When the job should be executed';
COMMENT ON COLUMN analytics_jobs.started_at IS 'When job processing began';
COMMENT ON COLUMN analytics_jobs.completed_at IS 'When job processing finished';
COMMENT ON COLUMN analytics_jobs.duration_ms IS 'Job execution time in milliseconds';
COMMENT ON COLUMN analytics_jobs.error_message IS 'Error details if job failed';
COMMENT ON COLUMN analytics_jobs.retry_count IS 'Number of times this job has been retried';
COMMENT ON COLUMN analytics_jobs.max_retries IS 'Maximum retry attempts allowed';

-- Create indexes for efficient job processing
CREATE INDEX idx_analytics_jobs_queue ON analytics_jobs(status, priority ASC, created_at ASC)
    WHERE status = 'pending';

CREATE INDEX idx_analytics_jobs_scheduled ON analytics_jobs(scheduled_for)
    WHERE status = 'pending';

CREATE INDEX idx_analytics_jobs_type ON analytics_jobs(job_type);

CREATE INDEX idx_analytics_jobs_status ON analytics_jobs(status);

CREATE INDEX idx_analytics_jobs_created_at ON analytics_jobs(created_at);

-- Partial index for active jobs
CREATE INDEX idx_analytics_jobs_active ON analytics_jobs(id, status, updated_at)
    WHERE status IN ('pending', 'processing');

-- Add constraint for valid job types
ALTER TABLE analytics_jobs ADD CONSTRAINT chk_analytics_job_type
    CHECK (job_type IN (
        'refresh_materialized_views',
        'daily_rollup',
        'weekly_trend_analysis',
        'cleanup_old_events',
        'analytics_milestones'
    ));

-- Add constraint for valid status values
ALTER TABLE analytics_jobs ADD CONSTRAINT chk_analytics_job_status
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- Add constraint for priority range
ALTER TABLE analytics_jobs ADD CONSTRAINT chk_analytics_job_priority
    CHECK (priority >= 1 AND priority <= 10);

-- Add constraint for retry logic
ALTER TABLE analytics_jobs ADD CONSTRAINT chk_analytics_job_retries
    CHECK (retry_count >= 0 AND retry_count <= max_retries);

-- Create function to automatically schedule recurring analytics jobs
CREATE OR REPLACE FUNCTION schedule_recurring_analytics_jobs()
RETURNS VOID AS $$
BEGIN
    -- Schedule daily rollup if not already scheduled for today
    INSERT INTO analytics_jobs (job_type, priority, scheduled_for, job_data)
    SELECT
        'daily_rollup',
        1,
        date_trunc('day', NOW() + INTERVAL '1 day') + INTERVAL '2 hours', -- 2 AM next day
        '{}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM analytics_jobs
        WHERE job_type = 'daily_rollup'
        AND scheduled_for >= date_trunc('day', NOW())
        AND status IN ('pending', 'processing')
    );

    -- Schedule weekly trend analysis if not already scheduled for this week
    INSERT INTO analytics_jobs (job_type, priority, scheduled_for, job_data)
    SELECT
        'weekly_trend_analysis',
        2,
        date_trunc('week', NOW() + INTERVAL '1 week') + INTERVAL '3 hours', -- 3 AM Monday
        '{}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM analytics_jobs
        WHERE job_type = 'weekly_trend_analysis'
        AND scheduled_for >= date_trunc('week', NOW())
        AND status IN ('pending', 'processing')
    );

    -- Schedule materialized view refresh every 6 hours
    INSERT INTO analytics_jobs (job_type, priority, scheduled_for, job_data)
    SELECT
        'refresh_materialized_views',
        3,
        date_trunc('hour', NOW()) + INTERVAL '6 hours',
        '{}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM analytics_jobs
        WHERE job_type = 'refresh_materialized_views'
        AND scheduled_for >= NOW()
        AND status IN ('pending', 'processing')
    );

    -- Schedule monthly cleanup of old events (keep 90 days)
    INSERT INTO analytics_jobs (job_type, priority, scheduled_for, job_data)
    SELECT
        'cleanup_old_events',
        5,
        date_trunc('month', NOW() + INTERVAL '1 month') + INTERVAL '4 hours', -- 4 AM first of month
        '{"days_to_keep": 90}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM analytics_jobs
        WHERE job_type = 'cleanup_old_events'
        AND scheduled_for >= date_trunc('month', NOW())
        AND status IN ('pending', 'processing')
    );

    RAISE NOTICE 'Recurring analytics jobs scheduled at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Create function to get analytics job queue status
CREATE OR REPLACE FUNCTION get_analytics_job_queue_status()
RETURNS TABLE (
    status VARCHAR(20),
    job_count BIGINT,
    avg_duration_ms DECIMAL(10,2),
    oldest_pending TIMESTAMPTZ,
    newest_completed TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        aj.status,
        COUNT(*) as job_count,
        AVG(aj.duration_ms)::DECIMAL(10,2) as avg_duration_ms,
        MIN(aj.created_at) FILTER (WHERE aj.status = 'pending') as oldest_pending,
        MAX(aj.completed_at) FILTER (WHERE aj.status = 'completed') as newest_completed
    FROM analytics_jobs aj
    WHERE aj.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY aj.status
    ORDER BY
        CASE aj.status
            WHEN 'processing' THEN 1
            WHEN 'pending' THEN 2
            WHEN 'completed' THEN 3
            WHEN 'failed' THEN 4
            ELSE 5
        END;
END;
$$ LANGUAGE plpgsql;

-- Create function to retry failed jobs with exponential backoff
CREATE OR REPLACE FUNCTION retry_failed_analytics_jobs(
    max_age_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    job_id UUID,
    job_type VARCHAR(50),
    retry_count INTEGER,
    next_retry TIMESTAMPTZ
) AS $$
BEGIN
    -- Update failed jobs that are eligible for retry
    UPDATE analytics_jobs
    SET
        status = 'pending',
        retry_count = retry_count + 1,
        scheduled_for = NOW() + (INTERVAL '1 minute' * POWER(2, retry_count)), -- exponential backoff
        updated_at = NOW(),
        error_message = error_message || ' [RETRIED]'
    WHERE status = 'failed'
    AND retry_count < max_retries
    AND completed_at >= NOW() - INTERVAL '1 hour' * max_age_hours;

    -- Return information about retried jobs
    RETURN QUERY
    SELECT
        aj.id,
        aj.job_type,
        aj.retry_count,
        aj.scheduled_for
    FROM analytics_jobs aj
    WHERE aj.status = 'pending'
    AND aj.retry_count > 0
    AND aj.updated_at >= NOW() - INTERVAL '1 minute'
    ORDER BY aj.scheduled_for;
END;
$$ LANGUAGE plpgsql;

-- Create function to clean up old completed/failed jobs
CREATE OR REPLACE FUNCTION cleanup_old_analytics_jobs(
    days_to_keep INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM analytics_jobs
    WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RAISE NOTICE 'Cleaned up % old analytics jobs', deleted_count;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments for functions
COMMENT ON FUNCTION schedule_recurring_analytics_jobs() IS 'Schedules recurring analytics jobs (daily rollup, weekly trends, etc.)';
COMMENT ON FUNCTION get_analytics_job_queue_status() IS 'Returns current status of the analytics job queue';
COMMENT ON FUNCTION retry_failed_analytics_jobs(INTEGER) IS 'Retries failed analytics jobs with exponential backoff';
COMMENT ON FUNCTION cleanup_old_analytics_jobs(INTEGER) IS 'Removes old completed/failed analytics jobs';

-- Initialize with first set of recurring jobs
SELECT schedule_recurring_analytics_jobs();
