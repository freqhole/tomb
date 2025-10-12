-- Add client_timestamp column to media_events table for proper chronological ordering
-- This allows us to use actual listening time instead of batch processing time

-- Add client_timestamp column
ALTER TABLE media_events ADD COLUMN client_timestamp timestamp with time zone;

-- Create index for performance on client_timestamp ordering
CREATE INDEX IF NOT EXISTS idx_media_events_client_timestamp
ON media_events(client_timestamp DESC);

-- Create index for combined ordering (fallback to created_at when client_timestamp is null)
CREATE INDEX IF NOT EXISTS idx_media_events_timestamp_order
ON media_events(COALESCE(client_timestamp, created_at) DESC);

-- Function updates will be in separate migration 077
COMMENT ON COLUMN media_events.client_timestamp IS 'timestamp from client when event actually occurred (for chronological ordering)';
