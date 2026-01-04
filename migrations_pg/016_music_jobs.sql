-- Music Job Queue System
-- This migration creates the music-specific job queue tables for asynchronous processing
-- of music files including scanning, metadata extraction, thumbnail generation, and waveform creation

-- Create music scan sessions table for tracking directory scan progress
CREATE TABLE music_scan_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scan identification and target
    base_path TEXT NOT NULL,
    session_name TEXT,

    -- Progress tracking
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    total_files INTEGER,
    processed_files INTEGER NOT NULL DEFAULT 0,
    last_processed_path TEXT,

    -- Statistics
    songs_added INTEGER NOT NULL DEFAULT 0,
    songs_updated INTEGER NOT NULL DEFAULT 0,
    songs_skipped INTEGER NOT NULL DEFAULT 0,
    errors_encountered INTEGER NOT NULL DEFAULT 0,

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    estimated_completion TIMESTAMPTZ,

    -- Error handling
    error_message TEXT,

    -- Session metadata
    client_id TEXT,
    initiated_by_user_id UUID REFERENCES users(id),
    configuration JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for music scan sessions
COMMENT ON TABLE music_scan_sessions IS 'Tracks music library scanning sessions with progress and statistics';
COMMENT ON COLUMN music_scan_sessions.base_path IS 'Root directory path being scanned for music files';
COMMENT ON COLUMN music_scan_sessions.status IS 'Session status: running, completed, failed, paused, cancelled';
COMMENT ON COLUMN music_scan_sessions.total_files IS 'Total number of audio files discovered (set after initial scan)';
COMMENT ON COLUMN music_scan_sessions.processed_files IS 'Number of files processed so far';
COMMENT ON COLUMN music_scan_sessions.last_processed_path IS 'Most recent file path processed for resumability';
COMMENT ON COLUMN music_scan_sessions.songs_added IS 'Number of new songs added to the database';
COMMENT ON COLUMN music_scan_sessions.songs_updated IS 'Number of existing songs updated';
COMMENT ON COLUMN music_scan_sessions.songs_skipped IS 'Number of files skipped (duplicates, unsupported, etc.)';
COMMENT ON COLUMN music_scan_sessions.configuration IS 'Scan configuration options (batch size, file types, etc.)';

-- Create music jobs table for individual music processing tasks
CREATE TABLE music_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core job identification
    job_type VARCHAR(50) NOT NULL,
    scan_session_id UUID REFERENCES music_scan_sessions(id) ON DELETE CASCADE,

    -- Target entities
    file_path TEXT NOT NULL,
    media_blob_id VARCHAR(16) REFERENCES media_blobs(id) ON DELETE CASCADE,
    song_id UUID REFERENCES songs(id) ON DELETE CASCADE,

    -- Job status and processing
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    worker_id TEXT,

    -- Job parameters and results
    parameters JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',

    -- Timing and retries
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,

    -- Error handling
    error_message TEXT,
    error_details JSONB,

    -- Deduplication hash
    job_hash CHAR(64) GENERATED ALWAYS AS (
        encode(sha256((file_path || ':' || job_type)::bytea), 'hex')
    ) STORED,

    -- Progress tracking (for long-running jobs)
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    progress_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for music jobs
COMMENT ON TABLE music_jobs IS 'Individual music processing jobs (metadata extraction, thumbnail generation, etc.)';
COMMENT ON COLUMN music_jobs.job_type IS 'Type: scan_file, extract_metadata, generate_thumbnail, generate_waveform, process_song';
COMMENT ON COLUMN music_jobs.file_path IS 'Full file system path to the audio file being processed';
COMMENT ON COLUMN music_jobs.parameters IS 'Job-specific parameters (target dimensions, quality settings, etc.)';
COMMENT ON COLUMN music_jobs.result IS 'Job execution results (extracted metadata, generated file info, etc.)';
COMMENT ON COLUMN music_jobs.job_hash IS 'SHA-256 hash for deduplication based on file_path:job_type';
COMMENT ON COLUMN music_jobs.progress_percentage IS 'Completion percentage for long-running jobs (0-100)';
COMMENT ON COLUMN music_jobs.error_details IS 'Structured error information for debugging';

-- Create indexes for music scan sessions
CREATE INDEX idx_music_scan_sessions_status ON music_scan_sessions(status);
CREATE INDEX idx_music_scan_sessions_base_path ON music_scan_sessions(base_path);
CREATE INDEX idx_music_scan_sessions_started_at ON music_scan_sessions(started_at);
CREATE INDEX idx_music_scan_sessions_user_id ON music_scan_sessions(initiated_by_user_id);
CREATE INDEX idx_music_scan_sessions_active ON music_scan_sessions(id)
    WHERE status IN ('running', 'paused');

-- Create indexes for music jobs
CREATE INDEX idx_music_jobs_job_type ON music_jobs(job_type);
CREATE INDEX idx_music_jobs_status ON music_jobs(status);
CREATE INDEX idx_music_jobs_priority ON music_jobs(priority);
CREATE INDEX idx_music_jobs_scan_session_id ON music_jobs(scan_session_id);
CREATE INDEX idx_music_jobs_file_path ON music_jobs(file_path);
CREATE INDEX idx_music_jobs_media_blob_id ON music_jobs(media_blob_id);
CREATE INDEX idx_music_jobs_song_id ON music_jobs(song_id);
CREATE INDEX idx_music_jobs_scheduled_at ON music_jobs(scheduled_at);
CREATE INDEX idx_music_jobs_created_at ON music_jobs(created_at);
CREATE INDEX idx_music_jobs_updated_at ON music_jobs(updated_at);
CREATE INDEX idx_music_jobs_worker_id ON music_jobs(worker_id) WHERE worker_id IS NOT NULL;

-- Index for finding jobs ready to process
CREATE INDEX idx_music_jobs_ready ON music_jobs(priority DESC, scheduled_at ASC)
    WHERE status = 'pending';

-- Unique index for job deduplication
CREATE UNIQUE INDEX idx_music_jobs_dedup ON music_jobs(file_path, job_type)
    WHERE status IN ('pending', 'in_progress');

-- Index for monitoring failed jobs
CREATE INDEX idx_music_jobs_failed ON music_jobs(job_type, created_at)
    WHERE status IN ('failed', 'failed_permanently');

-- Add constraints for valid values
ALTER TABLE music_scan_sessions ADD CONSTRAINT chk_music_scan_sessions_status
    CHECK (status IN ('running', 'completed', 'failed', 'paused', 'cancelled'));

ALTER TABLE music_scan_sessions ADD CONSTRAINT chk_music_scan_sessions_files_processed
    CHECK (processed_files >= 0 AND (total_files IS NULL OR processed_files <= total_files));

ALTER TABLE music_scan_sessions ADD CONSTRAINT chk_music_scan_sessions_counters
    CHECK (songs_added >= 0 AND songs_updated >= 0 AND songs_skipped >= 0 AND errors_encountered >= 0);

ALTER TABLE music_jobs ADD CONSTRAINT chk_music_jobs_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'failed_permanently', 'cancelled'));

ALTER TABLE music_jobs ADD CONSTRAINT chk_music_jobs_priority
    CHECK (priority IN ('low', 'normal', 'high', 'critical'));

ALTER TABLE music_jobs ADD CONSTRAINT chk_music_jobs_retry_count
    CHECK (retry_count >= 0 AND retry_count <= max_retries);

ALTER TABLE music_jobs ADD CONSTRAINT chk_music_jobs_progress
    CHECK (progress_percentage >= 0 AND progress_percentage <= 100);

ALTER TABLE music_jobs ADD CONSTRAINT chk_music_jobs_job_type
    CHECK (job_type IN ('scan_file', 'extract_metadata', 'generate_thumbnail', 'generate_waveform', 'process_song'));

-- Create triggers to update updated_at timestamps
CREATE TRIGGER trigger_music_scan_sessions_updated_at
    BEFORE UPDATE ON music_scan_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_music_jobs_updated_at
    BEFORE UPDATE ON music_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to atomically claim music jobs for processing
CREATE OR REPLACE FUNCTION claim_music_jobs(
    worker_id_param TEXT,
    limit_param INTEGER DEFAULT 1,
    job_type_filter VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    job_type VARCHAR,
    scan_session_id UUID,
    file_path TEXT,
    media_blob_id VARCHAR(16),
    song_id UUID,
    parameters JSONB,
    retry_count INTEGER,
    max_retries INTEGER,
    created_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    UPDATE music_jobs
    SET
        status = 'in_progress',
        worker_id = worker_id_param,
        started_at = NOW(),
        updated_at = NOW()
    WHERE music_jobs.id IN (
        SELECT mj.id
        FROM music_jobs mj
        WHERE mj.status = 'pending'
        AND mj.scheduled_at <= NOW()
        AND (job_type_filter IS NULL OR mj.job_type = job_type_filter)
        ORDER BY mj.priority DESC, mj.scheduled_at ASC
        LIMIT limit_param
        FOR UPDATE SKIP LOCKED
    )
    RETURNING
        music_jobs.id,
        music_jobs.job_type,
        music_jobs.scan_session_id,
        music_jobs.file_path,
        music_jobs.media_blob_id,
        music_jobs.song_id,
        music_jobs.parameters,
        music_jobs.retry_count,
        music_jobs.max_retries,
        music_jobs.created_at,
        music_jobs.scheduled_at;
END;
$$ LANGUAGE plpgsql;

-- Function to update scan session progress
CREATE OR REPLACE FUNCTION update_scan_session_progress(
    session_id_param UUID,
    processed_files_param INTEGER,
    last_processed_path_param TEXT DEFAULT NULL,
    songs_added_delta INTEGER DEFAULT 0,
    songs_updated_delta INTEGER DEFAULT 0,
    songs_skipped_delta INTEGER DEFAULT 0,
    errors_delta INTEGER DEFAULT 0
)
RETURNS BOOLEAN AS $$
DECLARE
    rows_affected INTEGER;
    new_total_files INTEGER;
    completion_estimate TIMESTAMPTZ;
BEGIN
    -- Update session with new progress
    UPDATE music_scan_sessions
    SET
        processed_files = processed_files_param,
        last_processed_path = COALESCE(last_processed_path_param, last_processed_path),
        songs_added = songs_added + songs_added_delta,
        songs_updated = songs_updated + songs_updated_delta,
        songs_skipped = songs_skipped + songs_skipped_delta,
        errors_encountered = errors_encountered + errors_delta,
        updated_at = NOW()
    WHERE id = session_id_param
    AND status = 'running';

    GET DIAGNOSTICS rows_affected = ROW_COUNT;

    -- If session was updated, get total files for completion calculation
    IF rows_affected > 0 THEN
        SELECT total_files INTO new_total_files
        FROM music_scan_sessions
        WHERE id = session_id_param;

        -- Calculate estimated completion if we have total files
        IF new_total_files IS NOT NULL AND new_total_files > 0 THEN
            SELECT
                started_at + (NOW() - started_at) * (new_total_files::DECIMAL / GREATEST(processed_files_param, 1))
            INTO completion_estimate
            FROM music_scan_sessions
            WHERE id = session_id_param;

            UPDATE music_scan_sessions
            SET estimated_completion = completion_estimate
            WHERE id = session_id_param;
        END IF;
    END IF;

    RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- Function to complete a scan session
CREATE OR REPLACE FUNCTION complete_scan_session(
    session_id_param UUID,
    final_status VARCHAR DEFAULT 'completed',
    error_message_param TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    rows_affected INTEGER;
BEGIN
    UPDATE music_scan_sessions
    SET
        status = final_status,
        completed_at = NOW(),
        error_message = error_message_param,
        updated_at = NOW()
    WHERE id = session_id_param
    AND status IN ('running', 'paused');

    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- Function to retry failed music jobs with exponential backoff
CREATE OR REPLACE FUNCTION retry_failed_music_jobs(
    job_type_filter VARCHAR DEFAULT NULL,
    max_retries_param INTEGER DEFAULT 3,
    session_id_filter UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE music_jobs
    SET
        status = 'pending',
        retry_count = retry_count + 1,
        scheduled_at = NOW() + INTERVAL '1 minute' * POWER(2, retry_count),
        worker_id = NULL,
        started_at = NULL,
        error_message = NULL,
        error_details = NULL,
        updated_at = NOW()
    WHERE status = 'failed'
    AND retry_count < max_retries_param
    AND (job_type_filter IS NULL OR job_type = job_type_filter)
    AND (session_id_filter IS NULL OR scan_session_id = session_id_filter);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to cancel stale music jobs
CREATE OR REPLACE FUNCTION cancel_stale_music_jobs(timeout_minutes INTEGER DEFAULT 120)
RETURNS INTEGER AS $$
DECLARE
    cancelled_count INTEGER;
BEGIN
    UPDATE music_jobs
    SET
        status = 'failed',
        error_message = 'Job timed out after ' || timeout_minutes || ' minutes',
        error_details = jsonb_build_object('timeout_reason', 'stale_job_cleanup'),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE status = 'in_progress'
    AND started_at < NOW() - INTERVAL '1 minute' * timeout_minutes;

    GET DIAGNOSTICS cancelled_count = ROW_COUNT;
    RETURN cancelled_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get scan session statistics
CREATE OR REPLACE FUNCTION get_scan_session_stats(session_id_param UUID)
RETURNS TABLE (
    session_id UUID,
    base_path TEXT,
    status VARCHAR,
    progress_percentage DECIMAL,
    processed_files INTEGER,
    total_files INTEGER,
    songs_added INTEGER,
    songs_updated INTEGER,
    songs_skipped INTEGER,
    errors_encountered INTEGER,
    elapsed_time_minutes INTEGER,
    estimated_remaining_minutes INTEGER,
    jobs_pending BIGINT,
    jobs_in_progress BIGINT,
    jobs_completed BIGINT,
    jobs_failed BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mss.id,
        mss.base_path,
        mss.status,
        CASE
            WHEN mss.total_files IS NOT NULL AND mss.total_files > 0 THEN
                (mss.processed_files::DECIMAL / mss.total_files * 100)::DECIMAL(5,2)
            ELSE NULL
        END as progress_percentage,
        mss.processed_files,
        mss.total_files,
        mss.songs_added,
        mss.songs_updated,
        mss.songs_skipped,
        mss.errors_encountered,
        EXTRACT(EPOCH FROM (NOW() - mss.started_at))::INTEGER / 60 as elapsed_time_minutes,
        CASE
            WHEN mss.estimated_completion IS NOT NULL THEN
                GREATEST(0, EXTRACT(EPOCH FROM (mss.estimated_completion - NOW()))::INTEGER / 60)
            ELSE NULL
        END as estimated_remaining_minutes,
        COUNT(CASE WHEN mj.status = 'pending' THEN 1 END) as jobs_pending,
        COUNT(CASE WHEN mj.status = 'in_progress' THEN 1 END) as jobs_in_progress,
        COUNT(CASE WHEN mj.status = 'completed' THEN 1 END) as jobs_completed,
        COUNT(CASE WHEN mj.status IN ('failed', 'failed_permanently') THEN 1 END) as jobs_failed
    FROM music_scan_sessions mss
    LEFT JOIN music_jobs mj ON mss.id = mj.scan_session_id
    WHERE mss.id = session_id_param
    GROUP BY mss.id, mss.base_path, mss.status, mss.processed_files, mss.total_files,
             mss.songs_added, mss.songs_updated, mss.songs_skipped, mss.errors_encountered,
             mss.started_at, mss.estimated_completion;
END;
$$ LANGUAGE plpgsql;

-- Function to get music job queue health
CREATE OR REPLACE FUNCTION get_music_job_health()
RETURNS TABLE (
    total_jobs BIGINT,
    pending_jobs BIGINT,
    in_progress_jobs BIGINT,
    completed_jobs BIGINT,
    failed_jobs BIGINT,
    avg_processing_time_minutes DECIMAL,
    active_sessions BIGINT,
    stale_jobs BIGINT,
    oldest_pending_age_minutes INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_jobs,
        COUNT(CASE WHEN mj.status = 'pending' THEN 1 END)::BIGINT as pending_jobs,
        COUNT(CASE WHEN mj.status = 'in_progress' THEN 1 END)::BIGINT as in_progress_jobs,
        COUNT(CASE WHEN mj.status = 'completed' THEN 1 END)::BIGINT as completed_jobs,
        COUNT(CASE WHEN mj.status IN ('failed', 'failed_permanently') THEN 1 END)::BIGINT as failed_jobs,
        COALESCE(AVG(EXTRACT(EPOCH FROM (mj.completed_at - mj.started_at)) / 60), 0)::DECIMAL as avg_processing_time_minutes,
        (SELECT COUNT(*) FROM music_scan_sessions WHERE status = 'running')::BIGINT as active_sessions,
        COUNT(CASE WHEN mj.status = 'in_progress' AND mj.started_at < NOW() - INTERVAL '2 hours' THEN 1 END)::BIGINT as stale_jobs,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(CASE WHEN mj.status = 'pending' THEN mj.created_at END)))::INTEGER / 60, 0) as oldest_pending_age_minutes
    FROM music_jobs mj;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old completed scan sessions and jobs
CREATE OR REPLACE FUNCTION cleanup_old_music_data(days_to_keep INTEGER DEFAULT 30)
RETURNS TABLE (
    deleted_sessions INTEGER,
    deleted_jobs INTEGER
) AS $$
DECLARE
    session_count INTEGER;
    job_count INTEGER;
BEGIN
    -- Delete old completed scan sessions (will cascade to jobs)
    DELETE FROM music_scan_sessions
    WHERE status IN ('completed', 'failed', 'cancelled')
    AND updated_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS session_count = ROW_COUNT;

    -- Delete orphaned completed jobs (shouldn't happen due to cascade, but safety)
    DELETE FROM music_jobs
    WHERE status IN ('completed', 'failed_permanently', 'cancelled')
    AND updated_at < NOW() - INTERVAL '1 day' * days_to_keep
    AND scan_session_id IS NULL;

    GET DIAGNOSTICS job_count = ROW_COUNT;

    RETURN QUERY SELECT session_count, job_count;
END;
$$ LANGUAGE plpgsql;

-- Create view for scan session monitoring
CREATE VIEW music_scan_sessions_status AS
SELECT
    status,
    COUNT(*) as session_count,
    AVG(processed_files) as avg_processed_files,
    SUM(songs_added) as total_songs_added,
    SUM(songs_updated) as total_songs_updated,
    SUM(errors_encountered) as total_errors,
    MIN(started_at) as oldest_session,
    MAX(started_at) as newest_session
FROM music_scan_sessions
GROUP BY status;

-- Create view for job queue monitoring
CREATE VIEW music_job_queue_status AS
SELECT
    job_type,
    status,
    COUNT(*) as job_count,
    AVG(retry_count) as avg_retries,
    MIN(created_at) as oldest_job,
    MAX(created_at) as newest_job,
    AVG(CASE
        WHEN started_at IS NOT NULL AND completed_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (completed_at - started_at))
        END) as avg_processing_seconds
FROM music_jobs
GROUP BY job_type, status;

-- Add notification triggers for real-time updates
CREATE OR REPLACE FUNCTION notify_music_scan_progress()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify on significant progress updates
    IF (NEW.processed_files - COALESCE(OLD.processed_files, 0)) >= 10
       OR NEW.status != OLD.status
       OR OLD.status IS NULL THEN
        PERFORM pg_notify('music_notifications',
            json_build_object(
                'type', 'scan_progress',
                'session_id', NEW.id,
                'status', NEW.status,
                'processed_files', NEW.processed_files,
                'total_files', NEW.total_files,
                'base_path', NEW.base_path
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_music_scan_progress_notification
    AFTER INSERT OR UPDATE ON music_scan_sessions
    FOR EACH ROW
    EXECUTE FUNCTION notify_music_scan_progress();

-- Add job completion notification trigger
CREATE OR REPLACE FUNCTION notify_music_job_completion()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify when jobs complete or fail
    IF NEW.status IN ('completed', 'failed', 'failed_permanently')
       AND OLD.status = 'in_progress' THEN
        PERFORM pg_notify('music_notifications',
            json_build_object(
                'type', 'job_completed',
                'job_id', NEW.id,
                'job_type', NEW.job_type,
                'status', NEW.status,
                'file_path', NEW.file_path,
                'session_id', NEW.scan_session_id
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_music_job_completion_notification
    AFTER UPDATE ON music_jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_music_job_completion();
