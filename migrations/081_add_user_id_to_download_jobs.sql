-- Add user_id column to download_jobs table to track which user initiated the download

-- Add user_id column to download_jobs table
ALTER TABLE download_jobs
ADD COLUMN user_id uuid REFERENCES users(id);

-- Create index for efficient user-based queries
CREATE INDEX idx_download_jobs_user_id ON download_jobs(user_id);

-- Add index for user + status queries (for user's download history)
CREATE INDEX idx_download_jobs_user_status ON download_jobs(user_id, status, created_at DESC);
