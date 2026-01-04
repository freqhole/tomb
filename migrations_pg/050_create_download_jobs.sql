-- Create download_jobs table for URL-based downloads
CREATE TABLE download_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    download_path TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on status for efficient job querying
CREATE INDEX idx_download_jobs_status ON download_jobs(status);

-- Create index on created_at for ordering
CREATE INDEX idx_download_jobs_created_at ON download_jobs(created_at);

-- Create index on status and created_at for efficient pending job queries
CREATE INDEX idx_download_jobs_pending ON download_jobs(status, created_at) WHERE status = 'queued';
